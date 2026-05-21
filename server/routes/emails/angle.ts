import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../../lib/prisma.js";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { parseBody } from "../../lib/parse-params.js";
import { sendRouteError } from "../../lib/route-error.js";
import { invalidateEmailDashboardCache } from "../../lib/email-cache.js";
import {
  parseCachedDossierEnvelope,
  getDossierSlot,
  pickFitAngle,
  pickGtmAngle,
  pickOpsAngle,
} from "../../lib/ai/research-fit-angle.js";
import { resolveProfileForGeneration } from "../../lib/sender-profile.js";

// Swap the angle a verbatim draft is built around. The original draft
// rendered its template with the role's company-side line + candidate-side
// line substituted in (eng: featureLine + fitAngle, gtm: gtmTriggerLine +
// gtmProofOfMotion, ops: opsInflectionLine + opsSystemBuilt). To re-anchor,
// we ask the role's picker for a new candidate-side line that matches the
// user-chosen company-side line, then string-substitute the old values out
// of body + subject. No Claude rewrite — verbatim templates stay verbatim.
//
// Out of scope for v1: non-verbatim drafts (ai / template / fallback).
// They were generated with Claude rewriting the personalization into prose,
// so a simple string replace would leave half the email referring to the
// old angle. Those callsites need a full regenerate path that remembers
// the originating template — Email.templateId doesn't exist yet.

// Discriminates which role's pipeline this swap targets. Picked from the
// presence of the role-specific input field (featureLine / triggerLine /
// inflectionLine), not from a separate `role` param — the field name *is*
// the role tag and prevents a malformed body from picking a slot that
// doesn't match the value being swapped.
type SwapRole = "eng" | "gtm" | "ops";

interface SwapPlan {
  role: SwapRole;
  newCompanyLine: string;
}

function planSwap(body: Record<string, unknown>): SwapPlan | { error: string } {
  const fields: Array<{ key: "featureLine" | "triggerLine" | "inflectionLine"; role: SwapRole }> = [
    { key: "featureLine", role: "eng" },
    { key: "triggerLine", role: "gtm" },
    { key: "inflectionLine", role: "ops" },
  ];
  const provided = fields.filter(f => typeof body[f.key] === "string");
  if (provided.length === 0) {
    return { error: "Exactly one of featureLine / triggerLine / inflectionLine is required" };
  }
  if (provided.length > 1) {
    return { error: "Only one of featureLine / triggerLine / inflectionLine may be set per request" };
  }
  const { key, role } = provided[0];
  const raw = body[key];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    // Clearing the angle is not supported on the verbatim fast path: the
    // saved body has the merge tags already substituted, so removing the
    // anchor text leaves orphan grammar with no template to re-render
    // against. The picker UI doesn't surface this option; reject here so
    // other callers don't trip the same hole.
    return { error: `${key} must be a non-empty string. Clearing requires regenerating the draft.` };
  }
  return { role, newCompanyLine: raw.trim() };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req) ?? {};
    const { emailId } = body as Record<string, unknown>;

    if (typeof emailId !== "string" || !emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }

    const planned = planSwap(body as Record<string, unknown>);
    if ("error" in planned) {
      return res.status(400).json({ error: planned.error });
    }
    const { role, newCompanyLine } = planned;

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        status: true,
        subject: true,
        body: true,
        featureLine: true,
        fitAngle: true,
        gtmTriggerLine: true,
        gtmProofOfMotion: true,
        opsInflectionLine: true,
        opsSystemBuilt: true,
        generationKind: true,
        userLead: {
          select: {
            userId: true,
            company: { select: { id: true, name: true, researchDossier: true, researchedAt: true } },
          },
        },
        customContact: { select: { userId: true } },
      },
    });

    if (!email) return res.status(404).json({ error: "Draft not found" });
    const ownerId = email.userLead?.userId ?? email.customContact?.userId;
    if (ownerId !== userId) return res.status(404).json({ error: "Draft not found" });
    if (email.status !== "draft") {
      return res.status(409).json({ error: "Only drafts can change angle" });
    }

    // Fast-path only applies when the existing draft was rendered verbatim
    // and its old company-side line is non-empty (we need anchor text to
    // swap). Other generationKinds need a full regenerate that's not in
    // scope yet.
    if (email.generationKind !== "verbatim") {
      return res.status(409).json({ error: "Change angle is only available for verbatim drafts" });
    }

    const company = email.userLead?.company;
    if (!company) {
      return res.status(409).json({ error: "This draft has no company dossier" });
    }
    const envelope = parseCachedDossierEnvelope(company.researchDossier, company.researchedAt);

    if (role === "eng") {
      const slot = getDossierSlot(envelope, "engineering");
      const dossier = slot?.dossier ?? null;
      if (!dossier || dossier.surfaces.length === 0) {
        return res.status(409).json({ error: "No surfaces available for this company" });
      }
      if (!dossier.surfaces.includes(newCompanyLine)) {
        return res.status(400).json({ error: "featureLine must be one of the company's surfaces" });
      }
      if (!email.featureLine) {
        return res.status(409).json({ error: "This draft has no featureLine to replace" });
      }
      if (newCompanyLine === email.featureLine) {
        return res.status(200).json({
          id: email.id,
          subject: email.subject ?? "",
          body: email.body ?? "",
          featureLine: email.featureLine,
          fitAngle: email.fitAngle,
        });
      }

      const profile = await resolveProfileForGeneration(userId);
      const refit = await pickFitAngle({
        dossier,
        resumeText: profile.resumeText,
        apiKey: profile.apiKey,
        forceFeatureLine: newCompanyLine,
      });

      const swapped = swapPair(email.subject, email.body, [
        [email.featureLine, newCompanyLine],
        [email.fitAngle, refit.fitAngle],
      ]);

      const updated = await prisma.email.update({
        where: { id: email.id },
        data: {
          subject: swapped.subject,
          body: swapped.body,
          featureLine: newCompanyLine,
          fitAngle: refit.fitAngle ?? null,
        },
        select: { id: true, subject: true, body: true, featureLine: true, fitAngle: true },
      });
      await invalidateEmailDashboardCache(userId);
      return res.status(200).json({
        id: updated.id,
        subject: updated.subject ?? "",
        body: updated.body ?? "",
        featureLine: updated.featureLine,
        fitAngle: updated.fitAngle,
      });
    }

    if (role === "gtm") {
      const slot = getDossierSlot(envelope, "gtm");
      const dossier = slot?.dossier ?? null;
      if (!dossier) {
        return res.status(409).json({ error: "No GTM dossier available for this company" });
      }
      // Triggers and recentMoves are both valid trigger-line anchors per
      // the GTM picker prompt — surface both as the option set.
      const options = [...dossier.triggers, ...dossier.recentMoves];
      if (options.length === 0) {
        return res.status(409).json({ error: "No GTM triggers available for this company" });
      }
      if (!options.includes(newCompanyLine)) {
        return res.status(400).json({ error: "triggerLine must be one of the company's GTM triggers or recent moves" });
      }
      if (!email.gtmTriggerLine) {
        return res.status(409).json({ error: "This draft has no triggerLine to replace" });
      }
      if (newCompanyLine === email.gtmTriggerLine) {
        return res.status(200).json({
          id: email.id,
          subject: email.subject ?? "",
          body: email.body ?? "",
          triggerLine: email.gtmTriggerLine,
          proofOfMotion: email.gtmProofOfMotion,
        });
      }

      const profile = await resolveProfileForGeneration(userId);
      const refit = await pickGtmAngle({
        dossier,
        resumeText: profile.resumeText,
        apiKey: profile.apiKey,
        forceTriggerLine: newCompanyLine,
      });

      const swapped = swapPair(email.subject, email.body, [
        [email.gtmTriggerLine, newCompanyLine],
        [email.gtmProofOfMotion, refit.proofOfMotion],
      ]);

      const updated = await prisma.email.update({
        where: { id: email.id },
        data: {
          subject: swapped.subject,
          body: swapped.body,
          gtmTriggerLine: newCompanyLine,
          gtmProofOfMotion: refit.proofOfMotion ?? null,
        },
        select: { id: true, subject: true, body: true, gtmTriggerLine: true, gtmProofOfMotion: true },
      });
      await invalidateEmailDashboardCache(userId);
      return res.status(200).json({
        id: updated.id,
        subject: updated.subject ?? "",
        body: updated.body ?? "",
        triggerLine: updated.gtmTriggerLine,
        proofOfMotion: updated.gtmProofOfMotion,
      });
    }

    // role === "ops"
    const slot = getDossierSlot(envelope, "operations");
    const dossier = slot?.dossier ?? null;
    if (!dossier) {
      return res.status(409).json({ error: "No ops dossier available for this company" });
    }
    // Inflections are the preferred anchor per OPS_PICK_SYSTEM, with
    // openRoles + recentHires as fallback options.
    const options = [...dossier.inflections, ...dossier.openRoles, ...dossier.recentHires];
    if (options.length === 0) {
      return res.status(409).json({ error: "No ops inflections available for this company" });
    }
    if (!options.includes(newCompanyLine)) {
      return res.status(400).json({ error: "inflectionLine must be one of the company's ops inflections, open roles, or recent hires" });
    }
    if (!email.opsInflectionLine) {
      return res.status(409).json({ error: "This draft has no inflectionLine to replace" });
    }
    if (newCompanyLine === email.opsInflectionLine) {
      return res.status(200).json({
        id: email.id,
        subject: email.subject ?? "",
        body: email.body ?? "",
        inflectionLine: email.opsInflectionLine,
        systemBuilt: email.opsSystemBuilt,
      });
    }

    const profile = await resolveProfileForGeneration(userId);
    const refit = await pickOpsAngle({
      dossier,
      resumeText: profile.resumeText,
      apiKey: profile.apiKey,
      forceInflectionLine: newCompanyLine,
    });

    const swapped = swapPair(email.subject, email.body, [
      [email.opsInflectionLine, newCompanyLine],
      [email.opsSystemBuilt, refit.systemBuilt],
    ]);

    const updated = await prisma.email.update({
      where: { id: email.id },
      data: {
        subject: swapped.subject,
        body: swapped.body,
        opsInflectionLine: newCompanyLine,
        opsSystemBuilt: refit.systemBuilt ?? null,
      },
      select: { id: true, subject: true, body: true, opsInflectionLine: true, opsSystemBuilt: true },
    });
    await invalidateEmailDashboardCache(userId);
    return res.status(200).json({
      id: updated.id,
      subject: updated.subject ?? "",
      body: updated.body ?? "",
      inflectionLine: updated.opsInflectionLine,
      systemBuilt: updated.opsSystemBuilt,
    });
  } catch (err) {
    return sendRouteError(res, err, "Could not change angle");
  }
}

// Apply pair-wise string substitutions to subject + body. Pairs with a
// null/empty old value are skipped — they have no anchor text to replace,
// so the new candidate-side line stays only in the DB column. (This
// matches the original eng path's behavior when fitAngle was empty.)
function swapPair(
  subject: string | null,
  body: string | null,
  pairs: Array<readonly [string | null, string | null]>,
): { subject: string; body: string } {
  let s = subject ?? "";
  let b = body ?? "";
  for (const [oldValue, newValueRaw] of pairs) {
    if (!oldValue) continue;
    const newValue = newValueRaw ?? "";
    s = s.split(oldValue).join(newValue);
    b = b.split(oldValue).join(newValue);
  }
  return { subject: s, body: b };
}

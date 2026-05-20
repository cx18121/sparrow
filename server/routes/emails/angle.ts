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
} from "../../lib/ai/research-fit-angle.js";
import { resolveProfileForGeneration } from "../../lib/sender-profile.js";

// Swap the angle a verbatim draft is built around. The original draft
// rendered its template with featureLine + fitAngle substituted in. To
// re-anchor, we ask pickFitAngle for a new fitAngle that matches the
// user-chosen featureLine, then string-substitute the old values out of
// body + subject. No Claude rewrite — verbatim templates stay verbatim.
//
// Out of scope for v1: non-verbatim drafts (ai / template / fallback).
// They were generated with Claude rewriting the personalization into
// prose, so a simple string replace would leave half the email referring
// to the old angle. Those callsites need a full regenerate path that
// remembers the originating template — Email.templateId doesn't exist yet.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req) ?? {};
    const { emailId, featureLine: rawFeatureLine } = body as Record<string, unknown>;

    if (typeof emailId !== "string" || !emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }
    // Clearing the angle is not supported on the verbatim fast path: the
    // saved body has the merge tags already substituted, so removing the
    // featureLine text leaves orphan grammar ("just shipped , which is...")
    // with no template to re-render against. The picker UI doesn't surface
    // this option; reject here so other callers don't trip the same hole.
    if (typeof rawFeatureLine !== "string" || rawFeatureLine.trim().length === 0) {
      return res.status(400).json({ error: "featureLine must be a non-empty string. Clearing requires regenerating the draft." });
    }
    const newFeatureLine: string = rawFeatureLine.trim();

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        status: true,
        subject: true,
        body: true,
        featureLine: true,
        fitAngle: true,
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
    // and its old featureLine is non-empty (we need anchor text to swap).
    // Other generationKinds need a full regenerate that's not in scope yet.
    if (email.generationKind !== "verbatim") {
      return res.status(409).json({ error: "Change angle is only available for verbatim drafts" });
    }
    if (!email.featureLine || email.featureLine.length === 0) {
      return res.status(409).json({ error: "This draft has no featureLine to replace" });
    }

    const company = email.userLead?.company;
    if (!company) {
      return res.status(409).json({ error: "This draft has no company dossier" });
    }
    // Change-angle operates on a verbatim eng draft (it swaps Email.featureLine,
    // which is engineering-shaped). Read from the engineering slot per ADR-0005.
    const envelope = parseCachedDossierEnvelope(company.researchDossier, company.researchedAt);
    const slot = getDossierSlot(envelope, "engineering");
    const dossier = slot?.dossier ?? null;
    if (!dossier || dossier.surfaces.length === 0) {
      return res.status(409).json({ error: "No surfaces available for this company" });
    }
    if (!dossier.surfaces.includes(newFeatureLine)) {
      return res.status(400).json({ error: "featureLine must be one of the company's surfaces" });
    }
    if (newFeatureLine === email.featureLine) {
      // No-op: caller asked for the angle that's already in place.
      return res.status(200).json({
        id: email.id,
        subject: email.subject ?? "",
        body: email.body ?? "",
        featureLine: email.featureLine,
        fitAngle: email.fitAngle,
      });
    }

    const profile = await resolveProfileForGeneration(userId);

    // Re-derive fitAngle against the new featureLine. Cheap (Claude Haiku,
    // 256 tokens). The model uses the same dossier and the same resume;
    // only FEATURE is forced.
    const refit = await pickFitAngle({
      dossier,
      resumeText: profile.resumeText,
      apiKey: profile.apiKey,
      forceFeatureLine: newFeatureLine,
    });

    const oldFeatureLine = email.featureLine;
    const oldFitAngle = email.fitAngle ?? "";
    const newFitAngle = refit.fitAngle ?? "";

    const swap = (text: string | null | undefined): string => {
      let s = text ?? "";
      s = s.split(oldFeatureLine).join(newFeatureLine);
      if (oldFitAngle) s = s.split(oldFitAngle).join(newFitAngle);
      return s;
    };

    const updated = await prisma.email.update({
      where: { id: email.id },
      data: {
        subject: swap(email.subject),
        body: swap(email.body),
        featureLine: newFeatureLine,
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
  } catch (err) {
    return sendRouteError(res, err, "Could not change angle");
  }
}

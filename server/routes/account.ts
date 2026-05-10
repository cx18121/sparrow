import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { decrypt } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../lib/supabaseAdmin.js";

async function revokeGoogleGrant(encryptedRefreshToken: string | null | undefined) {
  if (!encryptedRefreshToken) return;

  try {
    const refreshToken = decrypt(encryptedRefreshToken);
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    await oauth2.revokeToken(refreshToken);
  } catch (err) {
    // Account deletion should still remove local data if the Google token was
    // already invalid or the revoke endpoint is temporarily unavailable.
    console.warn("Google grant revoke failed during account deletion", err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const admin = getSupabaseAdmin();
    const { data: profile, error: profileLoadError } = await admin
      .from("user_profiles")
      .select("google_refresh_token_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileLoadError) return res.status(500).json({ error: "Failed to delete account" });

    await prisma.$transaction(async tx => {
      await tx.email.deleteMany({
        where: {
          OR: [
            { userLead: { userId } },
            { customContact: { userId } },
          ],
        },
      });
      await tx.campaignLead.deleteMany({
        where: {
          OR: [
            { campaign: { userId } },
            { userLead: { userId } },
          ],
        },
      });
      await tx.campaignSeenCompany.deleteMany({ where: { campaign: { userId } } });
      await tx.discoverySeenCompany.deleteMany({ where: { userId } });
      // Wipe user-scoped quotas (Apollo, anything keyed on userId) but leave
      // gmail-scoped send quotas intact: those are keyed on the Gmail address
      // (not this user id), and we want a user who deletes + recreates their
      // account to inherit any sends they already made today against the same
      // Gmail account — otherwise they could bypass the daily cap by churning
      // accounts and risk a real Gmail-side rate limit.
      await tx.dailyQuota.deleteMany({ where: { subjectId: userId, scope: { not: "gmail" } } });
      await tx.campaign.deleteMany({ where: { userId } });
      await tx.userLead.deleteMany({ where: { userId } });
      await tx.customContact.deleteMany({ where: { userId } });
      await tx.template.deleteMany({ where: { userId } });
    });

    await revokeGoogleGrant(profile?.google_refresh_token_encrypted);

    const { error: profileError } = await admin.from("user_profiles").delete().eq("user_id", userId);
    if (profileError) return res.status(500).json({ error: "Failed to delete account" });

    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) return res.status(500).json({ error: "Failed to delete account" });

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete account" });
  }
}

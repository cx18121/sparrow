import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const admin = getSupabaseAdmin();

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
      await tx.dailyQuota.deleteMany({ where: { subjectId: userId } });
      await tx.campaign.deleteMany({ where: { userId } });
      await tx.userLead.deleteMany({ where: { userId } });
      await tx.customContact.deleteMany({ where: { userId } });
      await tx.template.deleteMany({ where: { userId } });
    });

    const { error: profileError } = await admin.from("user_profiles").delete().eq("user_id", userId);
    if (profileError) return res.status(500).json({ error: "Failed to delete account" });

    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) return res.status(500).json({ error: "Failed to delete account" });

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete account" });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin, getUserIdFromRequest } from "../lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const admin = getSupabaseAdmin();

  // Delete all user data across tables
  await Promise.all([
    admin.from("profiles").delete().eq("id", userId),
    admin.from("campaigns").delete().eq("user_id", userId),
    admin.from("leads").delete().eq("user_id", userId),
    admin.from("custom_contacts").delete().eq("user_id", userId),
    admin.from("templates").delete().eq("user_id", userId),
    admin.from("emails").delete().eq("user_id", userId),
  ]);

  // Delete the auth user
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return res.status(500).json({ error: "Failed to delete account" });

  return res.status(200).json({ success: true });
}

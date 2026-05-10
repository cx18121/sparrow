import { google } from "googleapis";
import { prisma } from "./prisma.js";

export async function createOrRenewGmailWatch(params: {
  userId: string;
  email: string;
  oauth2: InstanceType<typeof google.auth.OAuth2>;
}): Promise<void> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) return;

  const { userId, email, oauth2 } = params;
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const response = await gmail.users.watch({
    userId: "me",
    requestBody: { topicName: topic, labelIds: ["INBOX"] },
  });

  const { historyId, expiration } = response.data;
  if (!historyId || !expiration) return;

  await prisma.userGmailWatch.upsert({
    where: { userId },
    create: {
      userId,
      email,
      watchExpiresAt: new Date(Number(expiration)),
      historyId,
      pubsubTopic: topic,
    },
    update: {
      email,
      watchExpiresAt: new Date(Number(expiration)),
      historyId,
      pubsubTopic: topic,
    },
  });
}

export async function renewExpiringWatches(oauth2Factory: (refreshToken: string) => InstanceType<typeof google.auth.OAuth2>): Promise<{ renewed: number; failed: number }> {
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const watches = await prisma.userGmailWatch.findMany({
    where: { watchExpiresAt: { lte: cutoff } },
  });

  let renewed = 0;
  let failed = 0;

  for (const watch of watches) {
    try {
      const { getSupabaseAdmin } = await import("./supabaseAdmin.js");
      const { decrypt } = await import("./crypto.js");
      const supabase = getSupabaseAdmin();
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("google_refresh_token_encrypted")
        .eq("user_id", watch.userId)
        .maybeSingle();

      if (!profile?.google_refresh_token_encrypted) { failed++; continue; }

      const refreshToken = decrypt(profile.google_refresh_token_encrypted);
      const oauth2 = oauth2Factory(refreshToken);
      await createOrRenewGmailWatch({ userId: watch.userId, email: watch.email, oauth2 });
      renewed++;
    } catch {
      failed++;
    }
  }

  return { renewed, failed };
}

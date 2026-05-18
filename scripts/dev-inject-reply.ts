import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

// Companion helper for /api/dev/inject-reply. Removes the two manual
// steps you'd otherwise repeat each time: pull a Supabase access token
// out of DevTools, then dig up a sent emailId from the DB.
//
// Auto-discovers the most recent `sent` email for the caller (userId
// decoded from the JWT's `sub` claim) and either posts the inject-reply
// request directly or just prints a runnable curl.
//
// Usage:
//   export SUPABASE_ACCESS_TOKEN=eyJhbGciO...   # one-time per session
//   npx tsx scripts/dev-inject-reply.ts                      # fire as REPLY
//   npx tsx scripts/dev-inject-reply.ts --classification auto # AUTO_REPLY
//   npx tsx scripts/dev-inject-reply.ts --classification bounce
//   npx tsx scripts/dev-inject-reply.ts --print              # curl template only
//   npx tsx scripts/dev-inject-reply.ts --email-id <id>      # override discovery
//   npx tsx scripts/dev-inject-reply.ts --base http://localhost:5174
//
// Where to find SUPABASE_ACCESS_TOKEN: open the running dev app in your
// browser → DevTools → Application → Local Storage → key starting with
// `sb-<project>-auth-token` → copy the `access_token` field.

const DEFAULT_BASE = "http://localhost:3000";

interface Args {
  classification: "reply" | "auto" | "bounce";
  print: boolean;
  emailId: string | null;
  base: string;
}

function parseArgs(argv: string[]): Args {
  let classification: Args["classification"] = "reply";
  let print = false;
  let emailId: string | null = null;
  let base = DEFAULT_BASE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--print") print = true;
    else if (a === "--classification") {
      const v = argv[++i];
      if (v !== "reply" && v !== "auto" && v !== "bounce") {
        throw new Error(`--classification must be reply | auto | bounce (got ${v})`);
      }
      classification = v;
    } else if (a === "--email-id") emailId = argv[++i] ?? null;
    else if (a === "--base") base = argv[++i] ?? DEFAULT_BASE;
  }
  return { classification, print, emailId, base };
}

function decodeUserIdFromJwt(token: string): string {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("token is not a JWT (no payload segment)");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!decoded.sub) throw new Error("JWT payload has no `sub` claim");
  return decoded.sub;
}

// Map --classification → realistic-looking payload that the production
// classifier (server/lib/reply-classification.ts) routes to that branch.
function payloadFor(cls: Args["classification"]): {
  fromAddress: string;
  subject: string;
  snippet: string;
  headers?: Record<string, string>;
} {
  if (cls === "auto") {
    return {
      fromAddress: "auto-responder@example.com",
      subject: "Out of office — back next week",
      snippet: "I am currently away from the office and will respond on return.",
    };
  }
  if (cls === "bounce") {
    return {
      fromAddress: "mailer-daemon@example.com",
      subject: "Undeliverable: outreach",
      snippet: "Your message could not be delivered to the intended recipient.",
    };
  }
  return {
    fromAddress: "alice@example.com",
    subject: "Re: outreach",
    snippet: "Thanks for reaching out — happy to chat.",
  };
}

async function findRecentSentEmail(userId: string): Promise<string | null> {
  // Mirror the ownership shape from the inject-reply endpoint: an Email row
  // is "owned" by the userLead.userId OR customContact.userId. Look for
  // sent rows under either path, newest first.
  const row = await prisma.email.findFirst({
    where: {
      status: "sent",
      OR: [
        { userLead: { userId } },
        { customContact: { userId } },
      ],
    },
    orderBy: { sentAt: "desc" },
    select: { id: true, subject: true, sentAt: true },
  });
  if (!row) return null;
  console.log(`[dev-inject-reply] using email ${row.id} ("${row.subject ?? "(no subject)"}" sent ${row.sentAt?.toISOString()})`);
  return row.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("[dev-inject-reply] SUPABASE_ACCESS_TOKEN env var is required.");
    console.error("  Grab it from the dev app: DevTools → Application → Local Storage →");
    console.error("  key `sb-<project>-auth-token` → copy the `access_token` field.");
    process.exit(2);
  }

  const userId = decodeUserIdFromJwt(token);
  const emailId = args.emailId ?? await findRecentSentEmail(userId);
  if (!emailId) {
    console.error(`[dev-inject-reply] No sent email found for user ${userId}. Send something first or pass --email-id.`);
    process.exit(1);
  }

  const body = { emailId, ...payloadFor(args.classification) };

  if (args.print) {
    const headersFlag = body.headers ? ` -H 'x-extra-headers: ${JSON.stringify(body.headers)}'` : "";
    console.log(
      `curl -X POST ${args.base}/api/dev/inject-reply \\\n` +
      `  -H 'authorization: Bearer ${token}' \\\n` +
      `  -H 'content-type: application/json'${headersFlag} \\\n` +
      `  -d '${JSON.stringify(body)}'`,
    );
    return;
  }

  const res = await fetch(`${args.base}/api/dev/inject-reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[dev-inject-reply] ${res.status} ${res.statusText}: ${text}`);
    process.exit(1);
  }
  console.log(`[dev-inject-reply] OK (${res.status})`);
  console.log(text);
}

main()
  .catch(err => {
    console.error("[dev-inject-reply] crashed:", err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());

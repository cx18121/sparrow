import type { ReplyClassification } from "@prisma/client";

const BOUNCE_FROM = /^(mailer-daemon|postmaster)@|^Mail Delivery Subsystem\b/i;
const BOUNCE_SUBJECT = /\b(undeliverable|delivery\s+status\s+notification|delivery\s+failure|failed\s+delivery|address\s+not\s+found|mail\s+delivery\s+failed)\b/i;

const OOO_SUBJECT = /\b(out\s+of\s+(?:the\s+)?office|on\s+vacation|on\s+leave|away\s+from\s+(?:the\s+)?office)\b/i;
const OOO_BODY = /\b(i\s+am\s+(?:currently\s+)?(?:out\s+of\s+(?:the\s+)?office|away|on\s+vacation|on\s+leave)|i\s+will\s+(?:be\s+)?(?:back|return)|be\s+back\s+on|return\s+on)\b/i;
const AUTO_RESPONSE_PATTERNS = /\b(this\s+is\s+an?\s+automated?\s+(?:response|reply|message)|auto.?reply|auto.?response|do\s+not\s+reply\s+to\s+this)\b/i;

export function classifyReply(params: {
  fromAddress: string;
  subject: string;
  snippet: string;
  headers: Record<string, string>;
}): ReplyClassification {
  const { fromAddress, subject, snippet, headers } = params;

  if (BOUNCE_FROM.test(fromAddress) || BOUNCE_SUBJECT.test(subject)) {
    return "BOUNCE";
  }

  const autoSubmitted = headers["auto-submitted"] ?? "";
  if (autoSubmitted && autoSubmitted !== "no") return "AUTO_REPLY";
  if (headers["x-autoreply"]) return "AUTO_REPLY";
  if (headers["x-auto-response-suppress"]) return "AUTO_REPLY";

  if (
    OOO_SUBJECT.test(subject) ||
    OOO_BODY.test(snippet) ||
    AUTO_RESPONSE_PATTERNS.test(subject) ||
    AUTO_RESPONSE_PATTERNS.test(snippet)
  ) {
    return "AUTO_REPLY";
  }

  return "REPLY";
}

export function headersFromGmailPayload(payload: { headers?: Array<{ name?: string | null; value?: string | null }> | null }): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of payload.headers ?? []) {
    if (h.name && h.value) result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

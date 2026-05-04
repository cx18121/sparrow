import { randomBytes } from "node:crypto";

export interface Attachment {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

export function encodeHeader(value: string): string {
  return value.replace(/[\r\n"]/g, "");
}

export function encodeAddressHeader(name: string | null, email: string): string {
  const cleanEmail = email.replace(/[\r\n<>]/g, "").trim();
  const cleanName = name?.replace(/[\r\n"]/g, "").trim();
  return cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail;
}

function chunkBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

export function mimeFromFileName(fileName: string | null | undefined): string {
  const lower = (fileName ?? "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

// Strips dangerous HTML to prevent stored XSS reaching the recipient's email client.
export function sanitizeHtml(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\bhref\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, 'href="about:blank"');
}

export function buildAttachment(fileName: string, mimeType: string, buffer: Buffer): Attachment {
  return {
    fileName,
    contentType: mimeType || mimeFromFileName(fileName),
    contentBase64: chunkBase64(buffer.toString("base64")),
  };
}

export function buildMimeMessage(
  toHeader: string,
  encodedSubject: string,
  htmlBody: string,
  attachments: Attachment[]
): string {
  if (attachments.length === 0) {
    return [
      `To: ${toHeader}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      htmlBody,
    ].join("\r\n");
  }
  const mixedBoundary = `mixed_${randomBytes(8).toString("hex")}`;
  const altBoundary = `alt_${randomBytes(8).toString("hex")}`;
  const lines = [
    `To: ${toHeader}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlBody,
    "",
    `--${altBoundary}--`,
  ];
  for (const att of attachments) {
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${encodeHeader(att.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encodeHeader(att.fileName)}"`,
      "",
      att.contentBase64,
    );
  }
  lines.push(`--${mixedBoundary}--`);
  return lines.join("\r\n");
}

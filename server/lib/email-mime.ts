import { randomBytes } from "node:crypto";

export interface Attachment {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n"]/g, "");
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
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

const HTML_TAG_NAMES = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

function containsHtmlTag(value: string): boolean {
  return Array.from(value.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)).some(match =>
    HTML_TAG_NAMES.has(match[1].toLowerCase()),
  );
}

// Strips dangerous HTML to prevent stored XSS reaching the recipient's email client.
export function sanitizeHtml(raw: string): string {
  const sanitized = raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\bhref\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, 'href="about:blank"');
  if (containsHtmlTag(sanitized)) return sanitized;
  return sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")
    .replace(/ {2,}/g, spaces => ` ${"&nbsp;".repeat(spaces.length - 1)}`)
    .replace(/\r\n|\r|\n/g, "<br>");
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
      "Content-Transfer-Encoding: 8bit",
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
    "Content-Transfer-Encoding: 8bit",
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

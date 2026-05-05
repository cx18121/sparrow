import { describe, expect, it } from "vitest";
import {
  buildAttachment,
  buildMimeMessage,
  encodeAddressHeader,
  encodeHeader,
  mimeFromFileName,
  sanitizeHtml,
} from "../lib/email-mime.js";

describe("email MIME helpers", () => {
  it("sanitizes header values before MIME assembly", () => {
    expect(encodeHeader('Hello\r\nBcc: attacker@example.com "quoted"')).toBe("HelloBcc: attacker@example.com quoted");
    expect(encodeAddressHeader('Jane\r\n"Bcc"', " jane@example.com\r\n<bad> ")).toBe("JaneBcc <jane@example.combad>");
  });

  it("RFC 2047 encodes non-ASCII subject headers", () => {
    expect(encodeHeader("[TEST] Quick intro — Charlie Xue")).toBe(
      "=?UTF-8?B?W1RFU1RdIFF1aWNrIGludHJvIOKAlCBDaGFybGllIFh1ZQ==?=",
    );
  });

  it("detects common attachment MIME types from file names", () => {
    expect(mimeFromFileName("resume.PDF")).toBe("application/pdf");
    expect(mimeFromFileName("resume.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeFromFileName("resume.doc")).toBe("application/msword");
    expect(mimeFromFileName("notes.txt")).toBe("text/plain");
    expect(mimeFromFileName("archive.bin")).toBe("application/octet-stream");
    expect(mimeFromFileName(null)).toBe("application/octet-stream");
  });

  it("removes script blocks, event handlers, and javascript links from HTML", () => {
    const html = sanitizeHtml('<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:evil()">x</a>');

    expect(html).toBe('<p >Hi</p><a href="about:blank">x</a>');
    expect(sanitizeHtml("<a href=javascript:evil()>x</a>")).toBe('<a href="about:blank">x</a>');
  });

  it("preserves plaintext line breaks when rendering as HTML", () => {
    expect(sanitizeHtml("Bryon, hello\n\nThanks,\nCharlie Xue")).toBe(
      "Bryon, hello<br><br>Thanks,<br>Charlie Xue",
    );
  });

  it("preserves tabs and repeated spaces in plaintext bodies", () => {
    expect(sanitizeHtml("Column\tValue\nIndented    text")).toBe(
      "Column&nbsp;&nbsp;&nbsp;&nbsp;Value<br>Indented &nbsp;&nbsp;&nbsp;text",
    );
  });

  it("builds chunked base64 attachments with inferred fallback MIME type", () => {
    const attachment = buildAttachment("resume.pdf", "", Buffer.from("x".repeat(80)));

    expect(attachment.fileName).toBe("resume.pdf");
    expect(attachment.contentType).toBe("application/pdf");
    expect(attachment.contentBase64).toContain("\r\n");
  });

  it("builds a simple HTML message when there are no attachments", () => {
    const message = buildMimeMessage("Jane <jane@example.com>", "Hello", "<p>Body</p>", []);

    expect(message).toContain("To: Jane <jane@example.com>\r\n");
    expect(message).toContain("Subject: Hello\r\n");
    expect(message).toContain("Content-Type: text/html; charset=utf-8\r\n");
    expect(message.endsWith("<p>Body</p>")).toBe(true);
  });

  it("builds a multipart message with sanitized attachment filenames", () => {
    const message = buildMimeMessage("jane@example.com", "Hello", "<p>Body</p>", [
      {
        fileName: 'resume"\r\nbad.pdf',
        contentType: "application/pdf",
        contentBase64: "eA==",
      },
    ]);

    expect(message).toContain("Content-Type: multipart/mixed;");
    expect(message).toContain("Content-Type: multipart/alternative;");
    expect(message).toContain('name="resumebad.pdf"');
    expect(message).toContain('filename="resumebad.pdf"');
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).toContain("eA==");
  });
});

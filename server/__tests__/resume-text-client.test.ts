import { describe, expect, it } from "vitest";

import { normalizeExtractedText } from "../../src/lib/resumeText.js";

describe("resume text extraction helpers", () => {
  it("removes isolated PDF icon glyphs and mojibake from extracted text", () => {
    const raw = [
      "Charles Xue  cx267@cornell.edu | (609) 349-5591 | §  cx18121 | ï  in/charles-xue | €  charliexue.com",
      "Education  Cornell University",
    ].join("\n");

    expect(normalizeExtractedText(raw)).toBe(
      "Charles Xue cx267@cornell.edu | (609) 349-5591 | cx18121 | in/charles-xue | charliexue.com\nEducation Cornell University",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  createWorkspaceConfig,
  getAttachmentLibrary,
  normalizeSendingLimits,
  profileResumeTextFromWorkspace,
} from "../../src/lib/workspaceConfig.js";

describe("createWorkspaceConfig", () => {
  it("defaults senderName from the user's full Google profile name", () => {
    const config = createWorkspaceConfig({
      user: {
        email: "cx267@cornell.edu",
        user_metadata: { name: "Charlie Xue" },
      },
      templates: [],
    });

    expect(config.senderName).toBe("Charlie Xue");
  });

  it("preserves the senderName explicitly saved by the user", () => {
    const config = createWorkspaceConfig({
      user: {
        email: "cx267@cornell.edu",
        user_metadata: { full_name: "Charlie Xue" },
      },
      templates: [],
      data: { senderName: "Charlie" },
    });

    expect(config.senderName).toBe("Charlie");
  });

  it("falls back to the first existing Template when a saved templateId is stale", () => {
    const config = createWorkspaceConfig({
      user: { email: "cx267@cornell.edu", user_metadata: {} },
      templates: [{ id: "template-1", name: "Intro" }],
      data: { templateId: "deleted-template" },
    });

    expect(config.templateId).toBe("template-1");
  });

  it("normalizes sending limits to product bounds", () => {
    expect(normalizeSendingLimits({ dailyMax: 0, delaySeconds: 4 })).toEqual({
      dailyMax: 1,
      delaySeconds: 15,
    });
    expect(normalizeSendingLimits({ dailyMax: 999, delaySeconds: 7200 })).toEqual({
      dailyMax: 500,
      delaySeconds: 3600,
    });
    expect(normalizeSendingLimits({ dailyMax: "bad", delaySeconds: null })).toEqual({
      dailyMax: 250,
      delaySeconds: 15,
    });
  });

  it("derives the attachment library from resume plus reusable files", () => {
    expect(getAttachmentLibrary({
      resumePath: "user-1/resume.pdf",
      resumeFileName: "resume.pdf",
      resumeUploadedAt: "2026-01-01T00:00:00.000Z",
      files: [{ id: "file-1", path: "files/user-1/file-1", fileName: "onepager.txt" }],
    })).toEqual([
      {
        id: "resume",
        path: "user-1/resume.pdf",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        size: null,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        source: "resume",
      },
      {
        id: "file-1",
        path: "files/user-1/file-1",
        fileName: "onepager.txt",
        source: "library",
      },
    ]);
  });

  it("keeps typed pitch separate from extracted resume text while building profile context", () => {
    const config = createWorkspaceConfig({
      user: { email: "cx267@cornell.edu", user_metadata: {} },
      templates: [],
      data: {
        resumeText: "Typed pitch for outreach.",
        resumeExtractedText: "Extracted resume content.",
      },
    });

    expect(config.resumeText).toBe("Typed pitch for outreach.");
    expect(config.resumeExtractedText).toBe("Extracted resume content.");
    expect(profileResumeTextFromWorkspace(config)).toBe("Typed pitch for outreach.\n\nExtracted resume content.");
  });
});

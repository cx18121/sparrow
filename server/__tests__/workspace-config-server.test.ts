import { describe, expect, it } from "vitest";

import {
  attachmentLibraryFromWorkspaceConfig,
  normalizeSendingLimits,
  parseWorkspaceConfig,
} from "../lib/workspace-config.js";

describe("server Workspace config", () => {
  it("returns an empty config for non-object values", () => {
    expect(parseWorkspaceConfig(null)).toEqual({});
    expect(parseWorkspaceConfig("bad")).toEqual({});
    expect(parseWorkspaceConfig([])).toEqual({});
  });

  it("normalizes sending limits to server send bounds", () => {
    expect(normalizeSendingLimits({ dailyMax: 0, delaySeconds: 4 })).toEqual({
      dailyMax: 1,
      delaySeconds: 15,
    });
    expect(normalizeSendingLimits({ dailyMax: 999, delaySeconds: 7200 })).toEqual({
      dailyMax: 500,
      delaySeconds: 3600,
    });
    expect(normalizeSendingLimits(null)).toEqual({
      dailyMax: 100,
      delaySeconds: 15,
    });
  });

  it("derives attachment library entries including the resume default", () => {
    expect(attachmentLibraryFromWorkspaceConfig({
      resumePath: "user-1/resume.pdf",
      resumeFileName: "resume.pdf",
      files: [{ id: "file-1", path: "files/user-1/file-1", fileName: "onepager.txt", mimeType: "text/plain" }],
    })).toEqual([
      {
        id: "resume",
        path: "user-1/resume.pdf",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
      },
      {
        id: "file-1",
        path: "files/user-1/file-1",
        fileName: "onepager.txt",
        mimeType: "text/plain",
      },
    ]);
  });
});

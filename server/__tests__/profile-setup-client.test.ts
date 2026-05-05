import { describe, expect, it } from "vitest";

import {
  SETTINGS_TABS,
  getGoogleErrorMessage,
  getSettingsTabStatus,
  hasRecoverableCompletedSetup,
  profileSetupSummary,
} from "../../src/lib/profileSetup.ts";

describe("Profile setup helpers", () => {
  it("keeps the three Settings tabs required by the workspace architecture", () => {
    expect(SETTINGS_TABS.map(tab => tab.key)).toEqual([
      "profile",
      "sending",
      "account",
    ]);
    expect(SETTINGS_TABS.map(tab => tab.label)).toEqual([
      "Profile",
      "Sending",
      "Account",
    ]);
  });

  it("treats a sender plus Template as recoverable completed setup", () => {
    expect(hasRecoverableCompletedSetup({
      workspaceConfig: {
        senderName: "Jordan",
        templateId: "template-1",
      },
    })).toBe(true);

    expect(hasRecoverableCompletedSetup({
      workspaceConfig: {
        senderName: "Jordan",
        customTemplate: { subject: "Hi", body: "Body" },
      },
    })).toBe(true);

    expect(hasRecoverableCompletedSetup({
      workspaceConfig: {
        senderName: "",
        templateId: "template-1",
      },
    })).toBe(false);
  });

  it("summarizes incomplete setup without requiring Gmail for Profile completion", () => {
    const summary = profileSetupSummary({
      workspaceConfig: { senderName: "Jordan", resumeText: "Background" },
      profile: { hasGoogleRefreshToken: false, resumeText: null },
    });

    expect(summary.hasSender).toBe(true);
    expect(summary.hasResume).toBe(true);
    expect(summary.hasGoogle).toBe(false);
    expect(summary.incomplete).toEqual(["account"]);
  });

  it("maps Settings tab warning dots from setup summary", () => {
    expect(getSettingsTabStatus({
      workspaceConfig: { senderName: "", resumeText: "" },
      profile: { hasGoogleRefreshToken: false, resumeText: null },
    })).toEqual({
      profile: "warn",
      sending: null,
      account: "warn",
    });

    expect(getSettingsTabStatus({
      workspaceConfig: { senderName: "Jordan", resumeText: "Background" },
      profile: { hasGoogleRefreshToken: true, resumeText: null },
    })).toEqual({
      profile: "ok",
      sending: null,
      account: "ok",
    });
  });

  it("maps Google callback error codes to actionable copy", () => {
    expect(getGoogleErrorMessage("missing_refresh_token")).toMatch(/did not issue a refresh token/i);
    expect(getGoogleErrorMessage("unknown_code")).toBe("Could not connect Gmail (unknown_code). Try again.");
    expect(getGoogleErrorMessage(null)).toBe("");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSupabaseAdmin } = vi.hoisted(() => ({
  mockGetSupabaseAdmin: vi.fn(),
}));

vi.mock("../lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

import {
  buildSenderContextFromProfile,
  ProfileError,
  resolveProfileForGeneration,
  type ResolvedProfile,
} from "../lib/sender-profile.js";

function makeSupabaseProfileResult(result: { data: unknown; error: unknown }) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

describe("resolveProfileForGeneration", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "  host-key  ";
  });

  afterEach(() => {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  });

  it("loads profile data and uses the host-managed Claude key", async () => {
    const supabase = makeSupabaseProfileResult({
      data: {
        resume_text: "Built an eval harness.",
        resume_path: "user-1/resume.pdf",
        workspace_config: {
          senderName: "Jane Smith",
          resumeFileName: "resume.pdf",
        },
      },
      error: null,
    });
    mockGetSupabaseAdmin.mockReturnValue(supabase);

    const profile = await resolveProfileForGeneration("user-1");

    expect(supabase.from).toHaveBeenCalledWith("user_profiles");
    expect(supabase.select).toHaveBeenCalledWith("resume_text, resume_path, workspace_config");
    expect(supabase.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(profile.apiKey).toBe("host-key");
    expect(profile.senderName).toBe("Jane Smith");
    expect(profile.resumeText).toBe("Built an eval harness.");
    expect(profile.ws.resumePath).toBe("user-1/resume.pdf");
  });

  it("returns null sender fields and empty workspace config when the profile row is missing", async () => {
    mockGetSupabaseAdmin.mockReturnValue(makeSupabaseProfileResult({ data: null, error: null }));

    const profile = await resolveProfileForGeneration("user-1");

    expect(profile).toMatchObject({
      apiKey: "host-key",
      senderName: null,
      resumeText: null,
      ws: {},
    });
  });

  it("throws a deployment configuration error when the host key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockGetSupabaseAdmin.mockReturnValue(makeSupabaseProfileResult({ data: null, error: null }));

    await expect(resolveProfileForGeneration("user-1")).rejects.toMatchObject({
      message: "Email generation is not configured on this deployment. Contact the host.",
      status: 500,
    });
  });

  it("wraps Supabase read errors as profile errors", async () => {
    mockGetSupabaseAdmin.mockReturnValue(makeSupabaseProfileResult({ data: null, error: { message: "db down" } }));

    await expect(resolveProfileForGeneration("user-1")).rejects.toEqual(new ProfileError("db down", 500));
  });
});

describe("buildSenderContextFromProfile", () => {
  const profile: ResolvedProfile = {
    apiKey: "host-key",
    senderName: "Jane Smith",
    resumeText: "Built a multi-agent evaluation harness.",
    ws: {
      senderName: "Jane Smith",
    },
  };

  it("combines workspace identity, tone, extra context, and resume instructions", () => {
    const context = buildSenderContextFromProfile(profile, {
      tone: "confident",
      extraContext: "Prefer backend infrastructure examples",
      includeResumeBullet: true,
    });

    expect(context).toContain("Name: Jane Smith");
    expect(context).toContain("Tone: confident");
    expect(context).toContain("Use one relevant detail from the sender's resume");
    expect(context).toContain("Prefer backend infrastructure examples");
    expect(context).toContain("Resume excerpt: Built a multi-agent evaluation harness.");
  });

  it("omits the Background line and optional extras when they are empty", () => {
    const context = buildSenderContextFromProfile(profile, {
      tone: "",
      extraContext: null,
      includeResumeBullet: false,
    });

    expect(context).not.toContain("Background:");
    expect(context).not.toContain("Tone:");
    expect(context).not.toContain("Use one relevant detail");
  });
});

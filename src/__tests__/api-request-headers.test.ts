import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
  },
}));

import { generateEmail, setApiAccessToken, setApiUserId } from "../lib/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("request() header merging", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setApiUserId("user-1");
    setApiAccessToken("test-token");
    fetchSpy = vi.fn(async () => jsonResponse({ subject: "ok", body: "ok" }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setApiUserId(null);
    setApiAccessToken(null);
  });

  // Regression: opts.headers must not clobber Authorization / Content-Type.
  // Bug shipped briefly in production after b22f8e1 added Idempotency-Key
  // to generateEmail and the spread order in request() dropped the bearer.
  it("preserves Authorization and Content-Type when caller passes opts.headers", async () => {
    await generateEmail({ userLeadId: "lead-1", save: true }, "draft-save:lead:lead-1:abc");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("draft-save:lead:lead-1:abc");
    expect(init.method).toBe("POST");
  });

  it("still sends Authorization and Content-Type when no opts.headers are passed", async () => {
    await generateEmail({ userLeadId: "lead-2", save: false });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });
});

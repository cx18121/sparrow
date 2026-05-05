import { beforeEach, describe, expect, it } from "vitest";

import {
  emailDashboardCacheKey,
  getEmailDashboardCache,
  invalidateEmailDashboardCache,
  setEmailDashboardCache,
} from "../lib/email-cache.js";

describe("email dashboard cache", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & {
      __dashCache?: Map<string, { data: unknown; ts: number }>;
    }).__dashCache = new Map();
  });

  it("uses distinct keys for global and campaign dashboard reads", () => {
    expect(emailDashboardCacheKey("user-1")).toBe("user-1:global");
    expect(emailDashboardCacheKey("user-1", "campaign-1")).toBe("user-1:campaign:campaign-1");
  });

  it("stores warm dashboard data and expires stale entries", () => {
    const fresh = { drafts: [{ id: "draft-1" }], sent: [] };
    const stale = { drafts: [], sent: [{ id: "sent-1" }] };

    setEmailDashboardCache(emailDashboardCacheKey("user-1"), fresh);
    (globalThis as typeof globalThis & {
      __dashCache?: Map<string, { data: unknown; ts: number }>;
    }).__dashCache!.set("user-1:campaign:old", { data: stale, ts: Date.now() - 31_000 });

    expect(getEmailDashboardCache(emailDashboardCacheKey("user-1"))).toEqual(fresh);
    expect(getEmailDashboardCache("user-1:campaign:old")).toBeNull();
  });

  it("invalidates every dashboard cache entry for one user", () => {
    setEmailDashboardCache(emailDashboardCacheKey("user-1"), { drafts: [], sent: [] });
    setEmailDashboardCache(emailDashboardCacheKey("user-1", "campaign-1"), { drafts: [], sent: [] });
    setEmailDashboardCache(emailDashboardCacheKey("user-2"), { drafts: [], sent: [] });

    invalidateEmailDashboardCache("user-1");

    expect(getEmailDashboardCache(emailDashboardCacheKey("user-1"))).toBeNull();
    expect(getEmailDashboardCache(emailDashboardCacheKey("user-1", "campaign-1"))).toBeNull();
    expect(getEmailDashboardCache(emailDashboardCacheKey("user-2"))).toEqual({ drafts: [], sent: [] });
  });
});

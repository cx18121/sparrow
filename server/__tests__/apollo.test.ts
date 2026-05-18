import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAxios } = vi.hoisted(() => {
  const mockAxios = {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: vi.fn((err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError)),
  };
  return { mockAxios };
});

vi.mock("axios", () => ({
  default: mockAxios,
}));

import {
  checkApiHealth,
  enrichDomain,
  normalizeDomain,
  revealPerson,
  searchContacts,
  searchOrganization,
} from "../lib/apollo.js";

describe("Apollo HTTP primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes raw website URLs into Apollo domain values", () => {
    expect(normalizeDomain(" HTTPS://www.Example.com/path/to/page ")).toBe("example.com");
    expect(normalizeDomain("www.startup.ai")).toBe("startup.ai");
    expect(normalizeDomain("subdomain.example.com/careers")).toBe("subdomain.example.com");
  });

  it("checks API health using the Apollo auth health endpoint", async () => {
    mockAxios.get.mockResolvedValue({ status: 200 });

    await expect(checkApiHealth("apollo-key")).resolves.toBe(true);

    expect(mockAxios.get).toHaveBeenCalledWith("https://api.apollo.io/v1/auth/health", {
      headers: {
        "x-api-key": "apollo-key",
        "Content-Type": "application/json",
        accept: "application/json",
      },
    });
  });

  it("returns false when the API health check fails", async () => {
    mockAxios.get.mockRejectedValue(new Error("network down"));

    await expect(checkApiHealth("apollo-key")).resolves.toBe(false);
  });

  it("searches contacts with senior title filters by default", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        people: [{ id: "person-1", first_name: "Jane", title: "Founder", has_email: true }],
      },
    });

    await expect(searchContacts("example.com", "apollo-key", { retry: false })).resolves.toEqual([
      { id: "person-1", first_name: "Jane", title: "Founder", has_email: true },
    ]);

    expect(mockAxios.post).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/mixed_people/api_search",
      expect.objectContaining({
        q_organization_domains_list: ["example.com"],
        person_titles: expect.arrayContaining(["Founder", "CTO", "CEO"]),
        per_page: 10,
      }),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("uses GTM titles plus the universal safety net when role=gtm", async () => {
    mockAxios.post.mockResolvedValue({ data: { people: [] } });

    await searchContacts("example.com", "apollo-key", {
      retry: false,
      role: "gtm",
    });

    const body = mockAxios.post.mock.calls[0][1];
    expect(body.person_titles).toEqual(
      expect.arrayContaining(["Founder", "CEO", "Head of Sales", "CMO"]),
    );
    // No engineering-specific titles when the user picked GTM only — this
    // is the whole point of per-campaign role targeting.
    expect(body.person_titles).not.toContain("CTO");
    expect(body.person_titles).not.toContain("VP Engineering");
  });

  it("does not duplicate universal titles in the resolved title set", async () => {
    mockAxios.post.mockResolvedValue({ data: { people: [] } });

    await searchContacts("example.com", "apollo-key", { retry: false, role: "engineering" });

    const titles = mockAxios.post.mock.calls[0][1].person_titles as string[];
    expect(titles.filter(t => t === "Founder").length).toBe(1);
    expect(titles.filter(t => t === "CEO").length).toBe(1);
  });

  it("falls back to engineering-default titles when role is null (backward compat)", async () => {
    mockAxios.post.mockResolvedValue({ data: { people: [] } });

    await searchContacts("example.com", "apollo-key", { retry: false, role: null });

    const titles = mockAxios.post.mock.calls[0][1].person_titles as string[];
    // Same default as the pre-refactor TARGET_TITLES baseline.
    expect(titles).toEqual(expect.arrayContaining(["Founder", "CEO", "CTO", "VP Engineering"]));
  });

  it("can search contacts without title filters for fallback discovery", async () => {
    mockAxios.post.mockResolvedValue({ data: { people: [] } });

    await searchContacts("example.com", "apollo-key", { retry: false, titleFilter: false });

    const body = mockAxios.post.mock.calls[0][1];
    expect(body).toEqual({
      q_organization_domains_list: ["example.com"],
      per_page: 10,
    });
  });

  it("propagates search errors when retry is disabled for serverless callers", async () => {
    const error = Object.assign(new Error("rate limited"), {
      isAxiosError: true,
      response: { status: 429, data: { error: "slow down" } },
    });
    mockAxios.post.mockRejectedValue(error);

    await expect(searchContacts("example.com", "apollo-key", { retry: false })).rejects.toThrow("rate limited");
  });

  it("returns the first matching organization from Apollo org search", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        organizations: [
          {
            id: "org-1",
            name: "Acme",
            primary_domain: "acme.com",
            website_url: "https://acme.com",
            sic_codes: ["7372"],
            naics_codes: ["541511"],
            founded_year: 2020,
          },
        ],
      },
    });

    await expect(searchOrganization("Acme", "apollo-key")).resolves.toMatchObject({
      id: "org-1",
      primary_domain: "acme.com",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/mixed_companies/search",
      { q_organization_name: "Acme", per_page: 1 },
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("reveals people by Apollo person id", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        person: {
          id: "person-1",
          name: "Jane Smith",
          email: "jane@example.com",
          title: "Founder",
          linkedin_url: "https://linkedin.example/jane",
        },
      },
    });

    await expect(revealPerson("person-1", "apollo-key")).resolves.toMatchObject({
      id: "person-1",
      email: "jane@example.com",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/people/match",
      { id: "person-1", reveal_personal_emails: false },
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("enriches a domain by searching previews and revealing the first match", async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { people: [{ id: "person-1" }] } })
      .mockResolvedValueOnce({
        data: {
          person: {
            name: "Jane Smith",
            email: "jane@example.com",
            title: "Founder",
            linkedin_url: "https://linkedin.example/jane",
          },
        },
      });

    await expect(enrichDomain("https://www.example.com/jobs", "apollo-key")).resolves.toEqual({
      personId: "person-1",
      name: "Jane Smith",
      email: "jane@example.com",
      title: "Founder",
      linkedinUrl: "https://linkedin.example/jane",
    });
    expect(mockAxios.post.mock.calls[0][1].q_organization_domains_list).toEqual(["example.com"]);
    expect(mockAxios.post.mock.calls[1][1]).toEqual({ id: "person-1", reveal_personal_emails: false });
  });

  it("returns no enrichment when Apollo has no contact previews for the domain", async () => {
    mockAxios.post.mockResolvedValue({ data: { people: [] } });

    await expect(enrichDomain("example.com", "apollo-key")).resolves.toBeNull();
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
  });
});

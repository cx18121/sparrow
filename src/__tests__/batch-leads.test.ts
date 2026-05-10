import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock supabase before importing api so the module resolves correctly.
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({}),
    },
  },
}));

import { setApiAccessToken, setApiUserId } from "../lib/api";

// Helpers to build deterministic fetch responses for batch API calls.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apolloPreview(companyId: string, personId: string) {
  return jsonResponse({
    companyId,
    usedFallback: false,
    previews: [{ id: personId, firstName: "Jordan", lastNameObfuscated: "L***", title: "CEO", hasEmail: false, companyName: companyId }],
  });
}

function savedLead(companyId: string, personId: string) {
  return jsonResponse({ id: `lead_${companyId}`, userId: "u1", companyId, contactId: null, apolloPersonId: personId, status: "SAVED" }, 201);
}

describe("batch leads API sequence", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setApiUserId("u1");
    setApiAccessToken("tok");
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setApiUserId(null);
    setApiAccessToken(null);
  });

  it("apolloSearch POST carries the bearer token and correct body", async () => {
    const { apolloSearch } = await import("../lib/api");
    fetchSpy.mockResolvedValueOnce(apolloPreview("co_1", "person_1"));
    const result = await apolloSearch("acme.test", "co_1");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/apollo-search/);
    expect(init.method).toBe("POST");
    expect(init.headers?.Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ domain: "acme.test", companyId: "co_1" });
    expect(result.previews[0].id).toBe("person_1");
  });

  it("saveLead POST body includes companyId and apolloPersonId", async () => {
    const { saveLead } = await import("../lib/api");
    fetchSpy.mockResolvedValueOnce(savedLead("co_1", "person_1"));
    const lead = await saveLead({ companyId: "co_1", contactId: null, apolloPersonId: "person_1", notes: "CEO" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.companyId).toBe("co_1");
    expect(body.apolloPersonId).toBe("person_1");
    expect(lead.id).toBe("lead_co_1");
  });

  it("addCampaignLead POST carries campaignId and userLeadId", async () => {
    const { addCampaignLead } = await import("../lib/api");
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "cl_1" }, 201));
    await addCampaignLead("cmp_1", "lead_1");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({ campaignId: "cmp_1", userLeadId: "lead_1" });
  });

  it("generateEmail with save:true sends the flag and idempotency key", async () => {
    const { generateEmail } = await import("../lib/api");
    fetchSpy.mockResolvedValueOnce(jsonResponse({ emailId: "draft_1", subject: "Hi", body: "<p>Hi</p>" }));
    await generateEmail({ userLeadId: "lead_1", templateId: "tpl_1", save: true }, "idem-key-abc");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/emails\/generate/);
    const body = JSON.parse(init.body);
    expect(body.save).toBe(true);
    expect(body.userLeadId).toBe("lead_1");
    expect(init.headers?.["Idempotency-Key"]).toBe("idem-key-abc");
  });

  it("full save-contacts sequence: apolloSearch → saveLead → addCampaignLead", async () => {
    const { apolloSearch, saveLead, addCampaignLead } = await import("../lib/api");
    fetchSpy
      .mockResolvedValueOnce(apolloPreview("co_1", "p1"))  // apolloSearch
      .mockResolvedValueOnce(savedLead("co_1", "p1"))       // saveLead
      .mockResolvedValueOnce(jsonResponse({}, 201))          // addCampaignLead
      .mockResolvedValueOnce(apolloPreview("co_2", "p2"))  // apolloSearch
      .mockResolvedValueOnce(savedLead("co_2", "p2"))       // saveLead
      .mockResolvedValueOnce(jsonResponse({}, 201));         // addCampaignLead

    // Simulate what handleBatch('contacts') does per company.
    for (const [cid, pid] of [["co_1", "p1"], ["co_2", "p2"]]) {
      const data = await apolloSearch(`${cid}.test`, cid);
      const top = data.previews[0];
      const lead = await saveLead({ companyId: cid, contactId: null, apolloPersonId: top.id, notes: top.title });
      await addCampaignLead("cmp_1", lead.id);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    // Apollo was called for both companies
    const apolloCalls = fetchSpy.mock.calls.filter(([url]) => url.includes("apollo-search"));
    expect(apolloCalls).toHaveLength(2);
    // saveLead was called for both
    const leadCalls = fetchSpy.mock.calls.filter(([url]) => url.includes("/api/leads"));
    expect(leadCalls).toHaveLength(2);
  });

  it("generateEmail is called per company in generate-emails mode", async () => {
    const { apolloSearch, saveLead, addCampaignLead, generateEmail } = await import("../lib/api");
    fetchSpy
      .mockResolvedValueOnce(apolloPreview("co_1", "p1"))
      .mockResolvedValueOnce(savedLead("co_1", "p1"))
      .mockResolvedValueOnce(jsonResponse({}, 201))
      .mockResolvedValueOnce(jsonResponse({ emailId: "draft_1", subject: "Hi", body: "" }));

    const data = await apolloSearch("co_1.test", "co_1");
    const lead = await saveLead({ companyId: "co_1", contactId: null, apolloPersonId: data.previews[0].id, notes: "CEO" });
    await addCampaignLead("cmp_1", lead.id);
    await generateEmail({ userLeadId: lead.id, templateId: "tpl_1", save: true }, `batch-co_1-${lead.id}`);

    const generateCalls = fetchSpy.mock.calls.filter(([url]) => url.includes("emails/generate"));
    expect(generateCalls).toHaveLength(1);
    const genBody = JSON.parse(generateCalls[0][1].body);
    expect(genBody.save).toBe(true);
    expect(genBody.userLeadId).toBe("lead_co_1");
  });
})

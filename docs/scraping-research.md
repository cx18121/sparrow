# Scraping pipeline expansion — research

**Date:** 2026-05-10
**Goal:** Expand the 14-adapter scraping pipeline to (a) surface post-Series-B startups that are *already in the DB but mislabeled or null-staged* and (b) add growth-stage VC sources we genuinely don't cover.

---

## TL;DR

1. **Post-B isn't filtered out — it's mislabeled or null-staged.** Three normalizers (YC, a16z, Accel) collapse later rounds into early buckets; six sources don't emit stage at all. Fixing this surfaces existing post-B data without scraping anything new.
2. **topstartups.io is not the answer.** It aggregates from 9 investors, 7 of which we already cover. Net new = Benchmark + Khosla, both early-stage. It does *not* solve the growth-stage gap.
3. **Tiger Global, Bond Capital, Sequoia Heritage have no first-party portfolio pages.** Skip — data only exists in paywalled DBs.
4. **a16z's `/portfolio` is a marquee-exits showcase**, not a real list. Our existing `a16z` adapter covers what's available.
5. **Top-5 new sources to add**, ranked by ease × growth-stage coverage:
   1. **Lightspeed (LSVP)** — `lsvp.com/portfolio/`, ~500 cos, richest metadata of any candidate (name + founders + stage + Backed-Since).
   2. **IVP** — `ivp.com/portfolio/`, ~150 cos, pure late-stage.
   3. **Coatue** — `coatue.com/portfolio`, ~300+ cos, Load-more pagination.
   4. **Pear VC** — `pear.vc/companies/` (user-requested, trivial static scrape).
   5. **Wave Ventures** — `wave.ventures/founders` (user-requested, trivial). Note `.ventures`, not `.fi`.
6. **Tier-2 (needs Playwright):** Insight Partners (~800 cos, biggest absolute payoff, pure growth-stage) and General Catalyst (partial list by design).

---

## Part 1 — Existing pool: mapper audit

The `Company.stage` column is free-form text. The wizard filters on equality. The `audienceToPrismaWhere` query adds `isVerified: true` baseline — that's a *source-quality* gate (excludes scratchpad sources), **not** a stage gate. So in principle the whole funnel is stage-agnostic.

In practice, the normalizers are lossy on the post-B end and most sources don't emit stage at all.

### Stage assignment by source

| Source | Sets `stage`? | Strategy | Lossy on post-B? |
|---|---|---|---|
| `yc` | yes | `mapYCStage()` | **was lossy** — `Growth` → `Series A`; **patched** in commit 2e35907 to `Series B` |
| `a16z` | yes | `mapStage()` | **was lossy** — `growth`/`late` → `Series B`; **patched** in commit 2e35907 to `Series C+` |
| `accel` | yes | `mapStage()` | **was lossy** — `growth` → `Series B`; **patched** in commit 2e35907 to `Series C+` |
| `firstround` | yes | passthrough of `initialPartnership` | unknown — raw text from FR's Sanity CMS, no normalization |
| `thehub` | yes | `mapFundingStage()` | OK — `series c`/`late` → `Series C+` |
| `kleinerperkins` | yes | KP CMS taxonomy (ID → string) | KP itself only tags Seed / Series B — no finer granularity available from their CMS |
| `sequoia` | **no** | – | – (every row has `stage: null`) |
| `greylock` | **no** | – | – |
| `bessemer` | **no** | – | – |
| `foundersfund` | **no** | – | – |
| `gv` | **no** | – | – |
| `hn-hiring` | no | – | (unverified source, hidden by default) |
| `gregslist` | no | – | (unverified source, hidden by default) |
| `startups-gallery` | no | – | (unverified source, hidden by default) |

### Implications

- **Three lossy mappers** (`yc`, `a16z`, `accel`) silently stripped the post-B signal. **Patched** in commit 2e35907 — re-run `audit-stages.ts` after the next ingest cycle to verify the `Series C+` bucket fills out and Stripe-era YC alumni leave `Series A`.
- **Five truly silent sources** (`sequoia`, `greylock`, `bessemer`, `foundersfund`, `gv`) have `stage: null` on every row. Surveyed each — none is a one-line fix; each requires per-source investigation (see below).
- **Stage semantics leak.** For VC scrapers, `stage` is the round-the-VC-participated-in, not the company's current stage. A Sequoia "Series A" alum is probably now Series D. Honest fix: enrich post-ingest from a freshness source (Crunchbase open data, recent-funding-round feed) — out of Phase 1 scope, but should sit in Phase 4.

### Silent-source survey (Phase 1.5, deferred work)

| Source | Stage on source data? | Effort to populate |
|---|---|---|
| `sequoia` | Possibly — detail pages have a stage section but it's currently only used to detect exits (`li.clist__item` parsing) | Detail-page HTML re-inspection; the scraper already fetches each detail page so adding stage extraction is cheap if the markup is consistent |
| `greylock` | No — only `portfolio_status` (current vs exited) is exposed in the inline portfolio JSON | Would need to scrape detail pages — much higher cost |
| `bessemer` | No — list-only markup with name / description / sector | Would need to scrape detail pages |
| `foundersfund` | Possibly — `class_list` already exposes `company_industry-*`; a `company_stage-*` pattern likely exists in the same WP taxonomy | Low cost: probe live data, extend `extractIndustry` pattern |
| `gv` | Possibly — Sanity GROQ query only asks for `name, website, sector`; the schema may have `stage` available | Low cost: schema introspection + query update |

Recommended sequence when we revisit: probe FoundersFund's `class_list` first (highest signal-to-effort), then GV's Sanity schema, then Sequoia detail pages. Greylock and Bessemer can wait until we add a Playwright helper for detail-page batching.

### Ground-truth audit script

`scripts/audit-stages.ts` (added) prints the `(source, stage)` distribution from the live DB plus a stage roll-up. Run:

```sh
tsx scripts/audit-stages.ts                # all rows
tsx scripts/audit-stages.ts --verified-only # mirrors the wizard's visible set
```

This shows the actual shape of the data — whether `Series C+` is suspiciously rare next to `Series B` (lossy-mapper smell) and which sources are pure-null.

### Recommended fixes (Phase 1.5)

Before adding any new source:

1. **`yc.ts`** — `Growth` → `Series B` (was `Series A`); keep `Late` → `Series C+`. ✅ commit 2e35907
2. **`a16z.ts`** — `growth`/`late` → `Series C+` (was `Series B`). ✅ commit 2e35907
3. **`accel.ts`** — `growth` → `Series C+` (was `Series B`). ✅ commit 2e35907
4. **`firstround.ts`** — wrap `c.initialPartnership` in a passthrough normalizer with a small canonical set so it joins cleanly with the wizard filter values. (Deferred — survey shows the FR field is already mostly canonical; recheck once we have audit-stages output.)
5. **Five silent sources** — see the survey table below. None is a one-line fix; deferred to alongside the Phase 2 manifest framework work.

The mapper patches (1–3) are landed. Re-run `audit-stages.ts` after the next ingest cycle to see the `Series C+` bucket fill out.

---

## Part 2 — New source survey

Full table is in `.scratch/scraping-research-exa.md`; the actionable subset:

| Fund | URL | Shape | ~Count | Metadata quality | Verdict |
|---|---|---|---|---|---|
| Lightspeed (LSVP) | `lsvp.com/portfolio/` | static HTML cards | ~500 | name + founders + founded year + **stage** + Backed-Since + status | **Add #1** |
| IVP | `ivp.com/portfolio/` | static grid, filterable | ~150 | name + detail-page slug | **Add #2** (pure growth-stage) |
| Coatue | `coatue.com/portfolio` | static cards, Load-more (likely AJAX) | ~300+ | name only on card | **Add #3** |
| Pear VC | `pear.vc/companies/` | static WP-style cards | ~50+ | name + tag + exit status | **Add #4** (user-requested) |
| Wave Ventures | `wave.ventures/founders` | Squarespace static | ~12 visible (~40 in CB) | name + outbound site link | **Add #5** (user-requested) |
| Insight Partners | `insightpartners.com/portfolio/` | JS-rendered shell | ~800 | needs Playwright or reverse-eng XHR | **Tier-2** — biggest payoff |
| General Catalyst | `generalcatalyst.com/portfolio` | JS-rendered, sectioned | partial-by-design | name + sector | Tier-2 |
| ICONIQ Growth | `iconiq.com/growth/portfolio` | inconclusive on first pass | ? | ? | Investigate further |
| Tiger Global | none public | – | – | – | **Skip** |
| Bond Capital | none public | – | – | – | **Skip** |
| Sequoia Heritage | wealth-mgmt arm | – | – | – | **Skip** |
| a16z Growth | `a16z.com/portfolio` | marquee exits only | ~24 | – | **Skip** (existing adapter covers) |

### topstartups.io

- Aggregates from 9 investors: Accel, A16Z, Benchmark, Bessemer, Founders Fund, Khosla, Kleiner, Sequoia, YC.
- We already cover 7. Net new: **Benchmark + Khosla** — both early-stage, not the growth gap.
- **Skip scraping topstartups.** If we want Benchmark and Khosla, hit their portfolio pages directly (next-pass research).

---

## Part 3 — Phase 2 framework recommendation

**No runtime LLM extractor.** Author cost is paid once at adapter-creation time (the LLM is *me*, not a per-page API call). Runtime is deterministic.

Two adapter classes:

### A) Manifest-driven (for static HTML list portfolios)

A `sources/<slug>.json` file plus one shared runner. New source = JSON edit:

```json
{
  "source": "lightspeed",
  "name": "Lightspeed",
  "listUrl": "https://lsvp.com/portfolio/",
  "selectors": {
    "item": ".portfolio-card",
    "name": ".card-title",
    "website": "a.company-link@href",
    "stage": ".card-stage",
    "description": ".card-description"
  },
  "pagination": { "type": "none" },
  "investors": ["lightspeed"],
  "isVerified": true
}
```

Single `scripts/ingest-from-manifest.ts` reads the JSON, runs cheerio/CSS-selector extraction, hands `CompanyRecord[]` to existing `runIngestor()`. Reuses dedupe / tags / quality / retry infra.

**Fits:** Lightspeed, IVP, Pear, Wave, likely Sequoia detail pages.
**Doesn't fit:** Coatue (Load-more pagination), Insight (JS-rendered), General Catalyst (JS), any site where pagination needs JS execution.

### B) Hand-coded adapters (for everything else)

Same pattern as today. I author each one once. For Tier-2 JS-rendered sites we add a Playwright dependency to `scripts/_lib/` and a `withBrowser(fn)` helper so Coatue/Insight/GC can share browser setup.

### Discovery helper

`scripts/discover-vcs.ts` — operator runs `tsx scripts/discover-vcs.ts "European seed VCs robotics"` → Exa returns candidate portfolio URLs → operator decides whether to write a manifest or skip. Surface-only; no auto-ingestion.

---

## Part 4 — Phase 3 priority order

Recommended sequence, assuming we want pilot-quality results fast and to validate the manifest framework before bigger lifts:

1. **Phase 1.5 fixes** (no new sources) — patch the 3 lossy mappers, populate the 6 silent ones. Surfaces existing post-B today.
2. **Build the manifest framework** + one pilot manifest: `Pear VC`. Confirms the runner works end-to-end.
3. **Wave Ventures** via manifest. Second smoke test.
4. **Lightspeed** via manifest. First high-value scrape.
5. **IVP** via manifest (may need a per-detail-page hop for website URLs — handled by manifest schema if we add an optional `detailFollow: { urlSelector, websiteSelector }` block).
6. **Coatue** as a hand-coded adapter (Load-more pagination).
7. Re-run `audit-stages.ts`. The post-B counts should jump materially. Audit coverage gaps that remain.
8. **Tier-2 (separate decision):** invest in a Playwright helper to unlock Insight Partners + General Catalyst. Insight alone is +800 growth-stage rows.
9. **Benchmark + Khosla** as direct manifest adapters (next-pass research first to confirm portfolio page shape).

Estimated effort: 1.5–2 days for steps 1–7, assuming Phase 1.5 patches are accepted and the manifest schema is well-shaped.

---

## Appendix — Files added in Phase 1

- `scripts/audit-stages.ts` — DB-side stage distribution audit. Run with `tsx scripts/audit-stages.ts [--verified-only]`.
- `.scratch/scraping-research-exa.md` — raw Exa-research transcript, kept for traceability.
- `docs/scraping-research.md` — this document.

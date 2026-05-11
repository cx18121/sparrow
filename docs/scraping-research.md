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

### Silent-source survey results

Live probes against each source's public surface (committed under
`scripts/_probe-*.ts` for reproducibility):

| Source | Probe outcome | Verdict |
|---|---|---|
| `a16z` | Live data carries Seed / Venture / Growth tags. The previous mapper handled Seed and Growth but never Venture (275 of 835 rows). **+263 rows recovered.** Probe: `_probe-a16z-stages.ts` | ✅ **Patched in fb7332f** |
| `foundersfund` | `class_list` exposes only `company_industry-*`. The `acf` (Advanced Custom Fields) block is empty `[]` across every sampled doc. No stage data on public site. Probe: `_probe-ff-classlist.ts`, `_probe-ff-acf.ts` | ❌ Skip — needs Phase 4 enrichment |
| `gv` | Sanity schema for `company` has only `_id, _type, name, website, sector, secondarySector, investors`. No funding-stage or round field exists. Probe: `_probe-gv-schema.ts` | ❌ Skip — data doesn't exist |
| `sequoia` | Detail pages render `Founded YYYY` / `Partnered YYYY` / founders / partners / jobs in `li.clist__item`. No "Series X" / "Stage" markup. Probe: `_probe-sequoia-detail.ts` (Stripe, Klarna, Linear) | ❌ Skip — data not on page |
| `greylock` | Inline `var data_portfolio_*` JSON has `portfolio_status` (current/exited) but no round info. Already established in pre-probe inspection. | ❌ Skip — detail-page scrape too costly without a Playwright helper |
| `bessemer` | List-page markup is name / description / sector only. Detail pages exist but require a second-pass scrape. | ❌ Skip — detail-page scrape needs Playwright helper |

**Conclusion:** a16z is the only silent source whose stage data is recoverable from the current scrape surface. For the remaining five, the canonical fix is *enrichment*: cross-reference Crunchbase open data (or another recent-funding-round feed) post-ingest and write the latest round back to `Company.stage`. That's Phase 4 work, scoped separately from this milestone.

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

## Part 3 — Implementation pattern

Every new source is a hand-coded adapter under `scripts/ingest-<source>.ts` implementing `IngestorAdapter` and calling `runIngestor(adapter)`. The shared runner handles domain extraction, dedupe, free-hosting filter, tag/quality assembly, concurrency, and retry. Author cost is paid once at adapter-creation time; runtime is deterministic.

A short-lived JSON manifest framework (`scripts/_lib/manifest-ingestor.ts` + `sources/<slug>.json`) was tried for Pear and Wave, then removed. Every interesting next source (Lightspeed needs a detail-page hop, Coatue needs Load-more pagination, IVP needs a detail-page hop, Insight needs JS rendering) required a framework extension before the manifest could express it. The break-even — ~10 mechanically-similar sources — never arrived because each VC's portfolio is custom-shaped. Hand-coded adapters at ~70–160 lines each ship faster and stay easier to debug than extending a generic schema.

**Conventions for new adapters:**
- One file per source: `scripts/ingest-<source>.ts`
- Export an `IngestorAdapter` with `name` (log label), `source` (canonical slug), and `fetchAndParse()` returning `CompanyRecord[]`
- Set `investors: [<slug>]` so the investor namespace tag fires
- Set `signals: ["vc-backed"]` for VC-portfolio sources
- Set `isVerified: true` for named-VC sources, `false` for scratchpad sources (hn-hiring, gregslist, startups-gallery)
- Stage normalization: prefer the source's own labels when granular (Pear emits `Seed`/`Series A`/`Series D` directly); collapse to `Series C+` when the source only knows "growth fund" (a16z, Accel)
- Filter exits at the source — skip rows tagged Acquired/IPO before they reach upsert. Their domains usually redirect to the acquirer and pollute the pool.

---

## Part 4 — Phase 3 priority order

Sequence the remaining work by row count and source difficulty:

1. **Phase 1.5 fixes** ✅ — three lossy stage mappers patched (YC, a16z, Accel); a16z Venture/seed recovery added (+263 rows). See commits `2e35907` and `fb7332f`.
2. **Pear VC** ✅ — hand-coded adapter at `scripts/ingest-pear.ts`. ~211 companies, granular Pre-Seed → Series E. Filters Acquired/IPO.
3. **Wave Ventures** ✅ — hand-coded adapter at `scripts/ingest-wave.ts`. 12 companies.
4. **Lightspeed (LSVP)** — ~664 companies. List view has stage / founded year / status; external website needs a per-company detail-page fetch. Hand-code with a small concurrency limit and request delay.
5. **IVP** — ~150 companies. Static grid; website lives on the per-company detail page. Same pattern as Lightspeed.
6. **Coatue** — ~300 companies. Load-more pagination; either probe the underlying XHR or paginate via query param.
7. Re-run `audit-stages.ts`. The post-B counts should jump materially. Audit remaining coverage gaps.
8. **Tier-2 (separate decision):** Insight Partners is ~800 growth-stage rows but is JS-rendered — needs Playwright. Worth the lift if growth-stage volume is the priority.
9. **Benchmark + Khosla** as direct adapters (one-pass research first to confirm portfolio page shape).

Estimated effort: ~1 day for steps 4–6 (Lightspeed, IVP, Coatue) as standalone adapters.

---

## Appendix — Files added in Phase 1

- `scripts/audit-stages.ts` — DB-side stage distribution audit. Run with `tsx scripts/audit-stages.ts [--verified-only]`.
- `.scratch/scraping-research-exa.md` — raw Exa-research transcript, kept for traceability.
- `docs/scraping-research.md` — this document.

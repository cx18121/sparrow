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
6. **Tier-2:** Insight Partners (originally flagged as needing Playwright; re-classified — WordPress REST surfaces everything, no browser needed; **shipped, 509 ingested**) and General Catalyst (partial list by design).

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
| Insight Partners | `insightpartners.com/portfolio/` | JS-rendered shell; **WP REST under the hood** | 845 | name+website+status via custom REST endpoint | **Tier-1** (re-classified — no Playwright) |
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
4. **Lightspeed (LSVP)** ✅ — hand-coded adapter at `scripts/ingest-lightspeed.ts`. 503 ingested (from ~536 reachable after filtering 124 exits). Granular Seed → Series H. Filters Status of Public / IPO / Acquired (Lightspeed labels post-IPO companies as `Public`, not `IPO` — both indicate an exit). Stage normalizer folds sub-rounds (Seed-1/2 → Seed, A-1 / Early → Series A) and drops ambiguous labels (Common, Ordinary → null). Card layouts vary: compact `<h5>` name, founder-card `<h6>` "Role, Company", and a spotlight `<h4>` for the lead card — adapter tries all three. Detail-page hop is needed because the company URL only appears wrapped in `.banner-logo` / `.company-logo` on `lsvp.com/company/<slug>/`.
5. **IVP** ✅ — hand-coded adapter at `scripts/ingest-ivp.ts`. 83 ingested (from 152 portfolio slugs). List page exposes `a.portfolio-grid-item` anchors → `/portfolio/<slug>/`; detail page yields `<h1>` for the company name, the first non-IVP non-social external href for the website, and a "Founded YYYY | Partnered YYYY [ | IPO ... ] [ | Acquired ... ]" summary line for exit detection. **No stage data on either surface** — every row ingests with `stage=null`. Conservative pacing (concurrency 3, 600ms delay, Chrome UA) held cleanly with zero 503s. Exit filter has two layers: (a) parse the summary for `IPO` / `Acquired by` / `Acquired YYYY` / `<acquirer> Acquired <ourname>`, with a special-case that treats `Acquired <ProperNoun> <year>` as the acquirer pattern (Harness acquired Traceable in 2025, the only false positive in the portfolio); (b) a 32-name hand-curated `PREEXISTING_PUBLICS` skiplist for companies IVP doesn't flag (e.g. Netflix, GitHub, Slack, Uber, Robinhood, SoFi) because the IPO/Acquired line tracks only IVP's investment-window exits. Defensive skip on 2 unparseable summaries (`steelbrick`, `pure-storage` — both happen to be exits anyway).
6. **Coatue** ✅ — hand-coded adapter at `scripts/ingest-coatue.ts`. 61 ingested (74 entries → 10 Exit-status, 1 no-url, 2 cross-page domain duplicates filtered). Coatue is Next.js + Contentful CMS; the full list ships inside the SSR'd `#__NEXT_DATA__` JSON for both `/portfolio` and `/privates-portfolio`. The "Load more" UI is purely client-side reveal — no XHR pagination, no detail-page hop. Per-company shape: `{ name, url, type, status }`. `status` is `Active | Exit` (direct filter), `type` is `Growth | Venture` — maps `Growth → Series C+` per the existing a16z/Accel late-stage VC convention; `Venture` ingests with `stage=null` because Coatue's earlier fund spans Pre-Seed to Series B and a single label can't disambiguate. Survey-table estimate of ~300 was stale — the live site exposes 72 unique entries.
7. Re-run `audit-stages.ts`. The post-B counts should jump materially. Audit remaining coverage gaps.
8. **Insight Partners** ✅ — hand-coded adapter at `scripts/ingest-insight.ts`. **509 ingested** (845 portfolio entries → 532 after-parse → 289 `Prior Investment` exits filtered, 3 no-status, 18 no-website, 3 detail-fetch failures, 23 cross-source duplicates). The Tier-2 "needs Playwright" framing was wrong: the `/portfolio` page is a Vue shell, but Insight is WordPress underneath with two public REST endpoints — `/wp-json/wp/v2/sfcompany?per_page=100&page=N` for the paginated list (9 calls × 100) and `/wp-json/insight/v1/get-company-content?id=<id>` for the rendered per-company HTML. The custom endpoint returns `{request, content}` where `content` carries the canonical website (the anchor wrapping `svg.svg-icon__new-window` — every other link in the social row reuses the same `title="Learn More About <Name>"` attribute, so the SVG glyph is the only reliable discriminator) and an explicit `Status` field (`Current Investment` vs `Prior Investment`). The `/insight/v1/*` endpoints return double-encoded JSON (string-wrapped JSON), so the adapter forces `responseType: "text"` + manual `JSON.parse` to handle both shapes. Because Insight's CMS labels exits explicitly, no `PREEXISTING_PUBLICS` skiplist is needed (unlike IVP, whose `Founded ... | Partnered ...` summary only flags exits during the investment window). Conservative pacing (concurrency 3, 600ms, plain Chrome UA) per the Lightspeed lesson; ~10 min walltime for 845 detail fetches. Same shape as IVP: no stage data on either surface, so every surviving row ingests with `stage=null`.
9. **Benchmark + Khosla** as direct adapters (one-pass research first to confirm portfolio page shape).

**Pacing lesson from Lightspeed.** First run with concurrency 5, 300ms delay, and `Mozilla/5.0 (compatible; SparrowBot/1.0)` UA tripped lsvp.com's WAF cumulative quota partway through and lost ~190 detail pages to alphabetical-from-mid-run 503s. Same script with concurrency 3, 600ms delay, and a plain Chrome UA captured 503/515 cleanly with zero 503s. The throttle is **per-session/IP-cumulative**, not per-second — so retry-with-backoff would have stayed inside the same lockout window. For IVP, Coatue, and Insight, default to the conservative knobs and only loosen if the source proves resilient.

**Lesson from Insight (re: framing).** "JS-rendered, needs Playwright" was a Vue-shell artifact; the underlying CMS exposed a public REST API that surfaced everything Playwright would have rendered. For any future Tier-2 source flagged "needs Playwright," check first for `/wp-json/`, a Next.js `/_next/data/<build>/<page>.json`, a Sanity GraphQL endpoint, or an `__NEXT_DATA__` blob before reaching for a browser. The REST path is dramatically cheaper to run, easier to debug, and more durable across CMS theme upgrades.

Steps 1–6 and 8 shipped. Remaining: step 7 (re-audit) and step 9 (Benchmark + Khosla).

---

## Appendix — Files added in Phase 1

- `scripts/audit-stages.ts` — DB-side stage distribution audit. Run with `tsx scripts/audit-stages.ts [--verified-only]`.
- `.scratch/scraping-research-exa.md` — raw Exa-research transcript, kept for traceability.
- `docs/scraping-research.md` — this document.

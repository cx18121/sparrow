# Company research dossiers have a 150-day freshness TTL

Status: Accepted 2026-05-22.

Per-Company research dossiers (`Company.researchDossier`) are produced by the Exa-first / Tavily-fallback retrieval pipeline (`server/lib/ai/research-fit-angle.ts`) and consumed by the per-user fit-angle picker. The earlier behavior was **cache-forever**: once a slot was written, it persisted until manually invalidated by a re-research path that didn't exist. ADR-0005 deferred the freshness question explicitly ("production today treats any cached dossier as fresh until a manual re-research path is added"), with the bet that staleness would not become a problem before a real signal forced a decision.

Two failure modes drove the change.

**Incident (2026-05-15): empty dossiers persisting past the env-var fix.** `EXA_API_KEY` was briefly missing in prod. During that window, every newly-researched company got an empty dossier written to its slot. When the env var was restored, the dossiers stayed empty — `slotIsFresh` (then nonexistent) would have caught the empty state on the next request, but cache-forever meant those companies kept generating personalization-less drafts until the slot was manually cleared. Cache-forever leaves no automatic recovery path from a window of bad writes.

**Quality decay over time.** A dossier captured 6+ months ago cites surfaces and recent launches that may now be retired or superseded. The personalization quality cost is silent — the draft still ships, the user has no signal that the cited surface is stale — but the model's claim ("I noticed your $WHATEVER") becomes embarrassing rather than impressive.

This ADR commits to the following.

**1. Per-slot freshness predicate.** `slotIsFresh<T>(slot, isEmpty)` in `server/lib/draft-generation.ts` returns true iff the slot's dossier is non-empty AND `now - researchedAt <= DOSSIER_TTL_MS`. `DOSSIER_TTL_MS = 150 * 24 * 60 * 60 * 1000`. The check is per-slot, not per-company — otherwise a fresh `engineering` dossier would falsely freshen empty `gtm`/`operations` slots, defeating the role-aware retrieval shipped by ADR-0005.

**2. 150 days, chosen by inspection.** The TTL is "the longest interval where a missed launch or retired surface in the cited dossier is unlikely to be embarrassing." This is a judgment call, not a measured value — half a year is short enough that funding-round inflections and product launches are usually still current, long enough that ordinary draft volume doesn't repeatedly re-pay the Exa retrieval cost for the same company. The number is reversible; bumping it to 90 or 240 days is a one-line change.

**3. On-demand refresh, no background job.** Stale slots are treated as cache-miss; the *next* draft generation for that company in that role triggers fresh research. There is no scheduler, no nightly re-research, no user-facing "refresh this dossier" button. The downside is that a stale company stays stale until someone tries to draft against it; the upside is that the system stays simple and the cost is bounded by actual usage.

**4. Legacy flat rows trip the check immediately.** Some `Company.researchDossier` rows still carry the pre-envelope flat shape from before ADR-0005's per-role envelope. `parseCachedDossierEnvelope` upgrades them in-memory with `researchedAt` defaulting to epoch zero when no per-slot timestamp is available — so `slotIsFresh` always returns false on first read, and the slot re-runs through fresh research. This is the desired behavior — it both upgrades the row shape and refreshes the (likely-old) content.

## Consequences

**The first draft against a 150+ day-old company pays the full Exa retrieval cost** (~5–10s synthesis included). That's the price of correctness. Subsequent drafts in the same role within the next 150 days are cheap.

**Cross-role drafts can paying-write-paying-pattern through a single company.** If a user drafts at company X for engineering today and a different user drafts at the same company X for GTM tomorrow, both pay Exa retrieval — the slots are independent. ADR-0005 already documented this trade-off ("the retrieval cost trade-off — a company researched for all 4 roles pays 4× — is acceptable at current volume").

**No user-visible staleness UI** is part of this decision. A draft generated against a 149-day-old dossier and a draft generated against a 1-day-old dossier are indistinguishable in the UI. If staleness becomes a UX issue (users sending drafts that cite long-retired surfaces and getting embarrassed), surfacing slot age in the angle picker would close it. Not part of this slice.

**No per-company override** (e.g. "this is a fast-moving company, refresh every 30 days"). One TTL globally. Per-company overrides are a complexity trap — the right next step if 150 days proves wrong globally is to lower the global value, not to ship per-company tuning.

**Background-refresh is the obvious next step if usage shifts.** A nightly cron that re-researches the most-drafted-against companies before they go stale would erase the "first-draft pays" cost at the price of running Exa retrieval against companies that may never be drafted again. Worth measuring before adding.

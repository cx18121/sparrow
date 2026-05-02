---
status: partial
phase: 02-discovery
source: [02-VERIFICATION.md]
started: 2026-03-22T03:00:00Z
updated: 2026-03-22T03:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. YC Ingestion Live Run
expected: Fetches 5,000+ YC companies, logs count, upserts without errors, exits cleanly
result: [pending]

### 2. Apollo Enrichment Live Run
expected: Health check passes, 2 companies processed, contacts upserted with lastVerifiedAt set
result: [pending]

### 3. Product Hunt Ingestion Live Run
expected: Fetches up to 5 pages / 100 posts, logs count, exits cleanly
result: [pending]

### 4. Poll Orchestrator Stability
expected: YC cycle completes, Product Hunt skipped (no PRODUCTHUNT_TOKEN logged), Apollo skipped (no APOLLO_API_KEY logged) — clean log output, no crash
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

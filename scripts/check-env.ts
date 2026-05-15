// Check that every env var Sparrow needs at runtime is configured for a
// given Vercel environment. Surfaces missing required keys before they
// silently degrade features (e.g. an unset EXA_API_KEY collapses email
// personalization to null and made every draft collapse to greeting +
// sign-off in prod on 2026-05-15).
//
// Usage:
//   npx tsx scripts/check-env.ts                  # production (default)
//   npx tsx scripts/check-env.ts preview
//   npx tsx scripts/check-env.ts development
//
// Exits 1 if any REQUIRED var is missing, so CI / pre-deploy hooks can gate.

import { execSync } from "node:child_process";

type Severity = "required" | "recommended" | "optional";

interface VarSpec {
  name: string;
  severity: Severity;
  group: string;
  note?: string;
}

// Grouped roughly by feature surface. Anything REQUIRED breaks a core flow if
// missing; RECOMMENDED degrades quality (e.g. dossier research) but doesn't
// hard-fail; OPTIONAL is a knob with a sensible default.
const SPEC: VarSpec[] = [
  // Database
  { name: "DATABASE_URL", severity: "required", group: "Database" },
  { name: "DIRECT_URL", severity: "required", group: "Database" },

  // Supabase (server + client)
  { name: "SUPABASE_URL", severity: "required", group: "Supabase" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", severity: "required", group: "Supabase" },
  { name: "VITE_SUPABASE_URL", severity: "required", group: "Supabase" },
  { name: "VITE_SUPABASE_ANON_KEY", severity: "required", group: "Supabase" },

  // Auth + encryption
  { name: "ENCRYPTION_KEY", severity: "required", group: "Auth" },
  { name: "APP_ORIGIN", severity: "required", group: "Auth" },

  // Google OAuth / Gmail send
  { name: "GOOGLE_CLIENT_ID", severity: "required", group: "Google" },
  { name: "GOOGLE_CLIENT_SECRET", severity: "required", group: "Google" },
  { name: "GOOGLE_OAUTH_STATE_SECRET", severity: "required", group: "Google" },

  // Gmail push webhooks
  { name: "GMAIL_PUBSUB_TOPIC", severity: "required", group: "Gmail webhooks" },
  { name: "GMAIL_WEBHOOK_AUDIENCE", severity: "required", group: "Gmail webhooks" },
  { name: "CRON_SECRET", severity: "required", group: "Gmail webhooks" },

  // AI generation
  { name: "ANTHROPIC_API_KEY", severity: "required", group: "AI generation", note: "host-managed Claude key powering every draft" },
  { name: "EXA_API_KEY", severity: "required", group: "AI generation", note: "primary research provider; without it drafts lose feature_line/fit_angle" },
  { name: "TAVILY_API_KEY", severity: "recommended", group: "AI generation", note: "fallback only when Exa returns 0 results" },

  // Apollo
  { name: "APOLLO_API_KEY", severity: "required", group: "Apollo" },

  // Optional tuning knobs
  { name: "TAVILY_SEARCH_DEPTH", severity: "optional", group: "AI tuning", note: "advanced (default) | basic" },
  { name: "EXA_RECENCY_DAYS", severity: "optional", group: "AI tuning", note: "default 180" },
  { name: "APOLLO_REVEAL_DAILY_LIMIT", severity: "optional", group: "Apollo" },
];

const ENVIRONMENT = process.argv[2] || "production";
const VALID_ENVS = new Set(["production", "preview", "development"]);
if (!VALID_ENVS.has(ENVIRONMENT)) {
  console.error(`Unknown environment "${ENVIRONMENT}". Use one of: ${[...VALID_ENVS].join(", ")}`);
  process.exit(2);
}

function fetchVercelEnvNames(env: string): Set<string> {
  // `vercel env ls <env>` prints a fixed-width table. The first column is the
  // var name and subsequent columns show value/environments/age. We parse the
  // name column rather than depending on a --json flag (CLI versions differ
  // on JSON support).
  let raw: string;
  try {
    raw = execSync(`vercel env ls ${env}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.error("Failed to run `vercel env ls`. Is the Vercel CLI installed and logged in?");
    console.error(err instanceof Error ? err.message : err);
    process.exit(3);
  }

  const names = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Header row starts with "name"; data rows start with an uppercase var name.
    if (!/^[A-Z][A-Z0-9_]*\b/.test(trimmed)) continue;
    const name = trimmed.split(/\s+/)[0];
    names.add(name);
  }
  return names;
}

function severityLabel(severity: Severity): string {
  return severity === "required" ? "REQUIRED" : severity === "recommended" ? "RECOMMENDED" : "OPTIONAL";
}

function statusLabel(present: boolean, severity: Severity): string {
  if (present) return "[ ok ]";
  if (severity === "required") return "[MISS!]";
  return "[ -- ]";
}

const present = fetchVercelEnvNames(ENVIRONMENT);

console.log(`\nVercel env audit — ${ENVIRONMENT}\n`);

const byGroup = new Map<string, VarSpec[]>();
for (const spec of SPEC) {
  const list = byGroup.get(spec.group) ?? [];
  list.push(spec);
  byGroup.set(spec.group, list);
}

let missingRequired = 0;
let missingRecommended = 0;
for (const [group, specs] of byGroup) {
  console.log(group);
  for (const spec of specs) {
    const hit = present.has(spec.name);
    if (!hit && spec.severity === "required") missingRequired++;
    if (!hit && spec.severity === "recommended") missingRecommended++;
    const note = spec.note ? ` — ${spec.note}` : "";
    console.log(`  ${statusLabel(hit, spec.severity)}  ${spec.name.padEnd(32)} ${severityLabel(spec.severity).padEnd(12)}${note}`);
  }
  console.log();
}

// Surface any prod var Sparrow doesn't know about — could be safe (manual
// experimentation) or a typo of a key the code expects. Either way worth
// seeing once.
const known = new Set(SPEC.map(s => s.name));
const unknown = [...present].filter(name => !known.has(name));
if (unknown.length > 0) {
  console.log(`Unknown vars on Vercel (not referenced in this audit):`);
  for (const name of unknown.sort()) console.log(`  -  ${name}`);
  console.log();
}

if (missingRequired > 0) {
  console.log(`FAIL: ${missingRequired} required var(s) missing.`);
  process.exit(1);
}
if (missingRecommended > 0) {
  console.log(`OK with warnings: ${missingRecommended} recommended var(s) missing.`);
} else {
  console.log("OK: all required and recommended vars present.");
}

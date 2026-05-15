// Pre-build env check. Runs in the Vercel build runtime, where required env
// vars are already injected. Fails the build (and therefore the deploy) when
// anything required is missing — so a misconfigured Vercel project can't ship
// a half-broken deployment that silently degrades features at runtime.
//
// Differs from scripts/check-env.ts: that one shells out to `vercel env ls`
// (manual tool, requires CLI auth). This one inspects process.env directly,
// has no external dependencies, and runs automatically via `prebuild`.

interface VarSpec {
  name: string;
  severity: "required" | "recommended";
  note?: string;
}

const SPEC: VarSpec[] = [
  // Database
  { name: "DATABASE_URL", severity: "required" },
  { name: "DIRECT_URL", severity: "required" },

  // Supabase server + client
  { name: "SUPABASE_URL", severity: "required" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", severity: "required" },
  { name: "VITE_SUPABASE_URL", severity: "required" },
  { name: "VITE_SUPABASE_ANON_KEY", severity: "required" },

  // Auth
  { name: "ENCRYPTION_KEY", severity: "required" },
  { name: "APP_ORIGIN", severity: "required" },

  // Google OAuth
  { name: "GOOGLE_CLIENT_ID", severity: "required" },
  { name: "GOOGLE_CLIENT_SECRET", severity: "required" },
  { name: "GOOGLE_OAUTH_STATE_SECRET", severity: "required" },

  // Gmail push
  { name: "GMAIL_PUBSUB_TOPIC", severity: "required" },
  { name: "GMAIL_WEBHOOK_AUDIENCE", severity: "required" },
  { name: "CRON_SECRET", severity: "required" },

  // AI generation
  { name: "ANTHROPIC_API_KEY", severity: "required", note: "host-managed Claude key" },
  { name: "EXA_API_KEY", severity: "required", note: "primary research provider; missing this collapses email personalization" },
  { name: "TAVILY_API_KEY", severity: "recommended", note: "fallback only when Exa returns 0 results" },

  // Apollo
  { name: "APOLLO_API_KEY", severity: "required" },
];

// Local dev runs `vite build` via `npm run build` too. Skip the gate when the
// build isn't happening on Vercel — local builds shouldn't fail just because
// a developer hasn't pulled the prod env. Vercel sets VERCEL=1 in CI.
const isVercelBuild = process.env.VERCEL === "1";
const force = process.argv.includes("--force");
if (!isVercelBuild && !force) {
  console.log("[check-build-env] Skipping (not on Vercel). Pass --force to run locally.");
  process.exit(0);
}

const missing: VarSpec[] = [];
const recommendedMissing: VarSpec[] = [];

for (const spec of SPEC) {
  const value = process.env[spec.name]?.trim();
  if (value) continue;
  if (spec.severity === "required") missing.push(spec);
  else recommendedMissing.push(spec);
}

if (recommendedMissing.length > 0) {
  console.warn("[check-build-env] Recommended vars missing (build continuing):");
  for (const spec of recommendedMissing) {
    console.warn(`  - ${spec.name}${spec.note ? ` — ${spec.note}` : ""}`);
  }
}

if (missing.length > 0) {
  console.error(`\n[check-build-env] FAIL: ${missing.length} required env var(s) missing:`);
  for (const spec of missing) {
    console.error(`  - ${spec.name}${spec.note ? ` — ${spec.note}` : ""}`);
  }
  console.error("\nAdd them in Vercel Project Settings → Environment Variables.\n");
  process.exit(1);
}

console.log("[check-build-env] OK: all required env vars present.");

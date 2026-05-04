import "dotenv/config";
import { researchCompanyDossier, pickFitAngle } from "../server/lib/ai/research-fit-angle.js";

// Live smoke test for the dossier + per-user pick flow:
//   1. researchCompanyDossier runs once with web search → structured dossier
//   2. pickFitAngle runs twice (resume A, resume B) → unique feature lines
//      from the same dossier, proving the per-user uniqueness contract.
//
// Costs: 1 web-search call (~$0.03) + 2 token-only calls (~$0.001 each) ≈ $0.05 total.
// In production, the dossier is cached on Company for 30 days, so subsequent
// drafts to the same company are token-only.
//
// Usage:
//   npx tsx scripts/smoke-research-fit-angle.ts
//   npx tsx scripts/smoke-research-fit-angle.ts --company linear.app

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env or your shell.");
  process.exit(1);
}
const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();
if (!tavilyApiKey) {
  console.error("TAVILY_API_KEY is not set. Add it to .env or your shell — research is disabled without it.");
  process.exit(1);
}

const args = process.argv.slice(2);
const companyArg = args.indexOf("--company");
const domain = companyArg >= 0 ? args[companyArg + 1] : "anthropic.com";

const RESUME_A = `
Charles Xue — CS & Statistics @ Cornell University.

Projects:
- Multi-agent eval harness: built a deterministic replay tool for cross-model
  agent benchmarks; reduced flaky scores by 60% by pinning seed + tool order.
- RAG eval pipeline: shipped retrieval + answer-faithfulness scoring across 6
  internal LLM clients; cut hallucination rate 38% by hybrid HNSW + lexical.
`.trim();

const RESUME_B = `
Devon Park — EE @ MIT.

Projects:
- Inference cost optimizer: built a per-tenant GPU scheduler that reduced
  cold-start latency 4x and cut cost-per-token 28% via batch coalescing.
- Hardware-accelerated retry middleware: wrote a Rust crate for SDK retry
  logic with circuit breaker + jittered backoff, used by 3 production teams.
- Distributed tracing: instrumented an LLM gateway with OpenTelemetry to
  surface tail-latency outliers across model providers.
`.trim();

async function main() {
  console.log(`> Researching ${domain} once (web search)...\n`);
  const t0 = Date.now();
  const dossier = await researchCompanyDossier({
    company: {
      name: domain.split(".")[0],
      description: null,
      oneLiner: null,
      stage: null,
      industry: null,
      isHiring: false,
      domain,
    },
    apiKey: apiKey!,
    tavilyApiKey: tavilyApiKey!,
  });

  console.log("Dossier:");
  console.log(`  summary:        ${dossier.summary}`);
  console.log(`  surfaces:       ${dossier.surfaces.join(", ") || "(none)"}`);
  console.log(`  recentLaunches: ${dossier.recentLaunches.join(", ") || "(none)"}`);
  console.log(`  technicalAreas: ${dossier.technicalAreas.join(", ") || "(none)"}`);
  console.log(`  (research took ${Date.now() - t0}ms)\n`);

  if (dossier.surfaces.length === 0) {
    console.warn("Dossier has no surfaces. pickFitAngle will short-circuit to nulls.");
    process.exit(2);
  }

  console.log("> Picking fit angle for Resume A (Cornell, eval/RAG focus)...");
  const tA = Date.now();
  const a = await pickFitAngle({ dossier, resumeText: RESUME_A, apiKey: apiKey! });
  console.log(`  featureLine: ${a.featureLine ?? "<NONE>"}`);
  console.log(`  fitAngle:    ${a.fitAngle ?? "<NONE>"}`);
  console.log(`  (pick took ${Date.now() - tA}ms)\n`);

  console.log("> Picking fit angle for Resume B (MIT, infra/cost focus)...");
  const tB = Date.now();
  const b = await pickFitAngle({ dossier, resumeText: RESUME_B, apiKey: apiKey! });
  console.log(`  featureLine: ${b.featureLine ?? "<NONE>"}`);
  console.log(`  fitAngle:    ${b.fitAngle ?? "<NONE>"}`);
  console.log(`  (pick took ${Date.now() - tB}ms)\n`);

  if (a.featureLine && b.featureLine && a.featureLine === b.featureLine) {
    console.warn("WARNING: Both resumes picked the same featureLine. Per-user uniqueness contract weakened.");
    console.warn("  This is OK if the dossier only has one really compelling surface, but worth checking.");
  } else if (a.featureLine && b.featureLine) {
    console.log("Per-user uniqueness verified: each resume picked a different featureLine.");
  }
}

main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { ingestYC } from "./ingest-yc.js";
import { enrichApollo } from "./enrich-apollo.js";
import { ingestProductHunt } from "./ingest-producthunt.js";
import { ingestCrunchbase } from "./ingest-crunchbase.js";

// Configuration from environment variables.
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "86400000", 10);
const SKIP_PRODUCTHUNT = process.env.SKIP_PRODUCTHUNT === "true";
const SKIP_CRUNCHBASE = process.env.SKIP_CRUNCHBASE === "true";
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const PRODUCTHUNT_TOKEN = process.env.PRODUCTHUNT_TOKEN;
const CRUNCHBASE_API_KEY = process.env.CRUNCHBASE_API_KEY;
const FRESHNESS_HOURS = parseInt(process.env.FRESHNESS_HOURS ?? "24", 10);

export async function runPollCycle(): Promise<void> {
  console.log(`[POLL] Starting cycle at ${new Date().toISOString()}`);

  // Step 1: Always run YC ingestion.
  try {
    await ingestYC();
  } catch (e) {
    console.error("[POLL] YC failed:", (e as Error).message);
  }

  // Step 2: Run Product Hunt if not skipped and token is available.
  if (!SKIP_PRODUCTHUNT && PRODUCTHUNT_TOKEN) {
    try {
      await ingestProductHunt();
    } catch (e) {
      console.error("[POLL] Product Hunt failed:", (e as Error).message);
    }
  } else if (SKIP_PRODUCTHUNT) {
    console.log("[POLL] Skipping Product Hunt (SKIP_PRODUCTHUNT=true)");
  } else {
    console.log("[POLL] Skipping Product Hunt (no PRODUCTHUNT_TOKEN)");
  }

  // Step 3: Run Crunchbase ingestion if not skipped and API key is available.
  if (!SKIP_CRUNCHBASE && CRUNCHBASE_API_KEY) {
    try {
      await ingestCrunchbase();
    } catch (e) {
      console.error("[POLL] Crunchbase failed:", (e as Error).message);
    }
  } else if (SKIP_CRUNCHBASE) {
    console.log("[POLL] Skipping Crunchbase (SKIP_CRUNCHBASE=true)");
  } else {
    console.log("[POLL] Skipping Crunchbase (no CRUNCHBASE_API_KEY)");
  }

  // Step 4: Run Apollo enrichment only if API key is set.
  if (APOLLO_API_KEY) {
    const freshnessThreshold = new Date(
      Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000
    );
    const staleCount = await prisma.contact.count({
      where: {
        OR: [
          { lastVerifiedAt: null },
          { lastVerifiedAt: { lt: freshnessThreshold } },
        ],
      },
    });

    console.log(`[POLL] ${staleCount} contacts need enrichment`);

    try {
      await enrichApollo();
    } catch (e) {
      console.error("[POLL] Apollo enrichment failed:", (e as Error).message);
    }
  } else {
    console.log("[POLL] Skipping Apollo enrichment (no APOLLO_API_KEY)");
  }

  console.log(`[POLL] Cycle complete at ${new Date().toISOString()}`);
}

export async function startPolling(): Promise<void> {
  console.log(`[POLL] Starting with interval ${POLL_INTERVAL_MS}ms`);

  // Run the first cycle immediately.
  await runPollCycle();

  const intervalId = setInterval(async () => {
    await runPollCycle().catch((e) => {
      console.error("[POLL] Unhandled cycle error:", (e as Error).message);
    });
  }, POLL_INTERVAL_MS);

  // Graceful shutdown on SIGINT / SIGTERM.
  const shutdown = async (signal: string) => {
    console.log(`[POLL] Received ${signal} — shutting down gracefully.`);
    clearInterval(intervalId);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPolling().catch(console.error);
}

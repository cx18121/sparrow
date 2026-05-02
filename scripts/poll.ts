import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { ingestYC } from "./ingest-yc.js";
import { ingestTheHub } from "./ingest-thehub.js";
import { ingestGregslist } from "./ingest-gregslist.js";
import { ingestHNHiring } from "./ingest-hn-hiring.js";
import { ingestAccel } from "./ingest-accel.js";
import { ingestKleinerPerkins } from "./ingest-kleinerperkins.js";
import { ingestFirstRound } from "./ingest-firstround.js";
import { ingestA16z } from "./ingest-a16z.js";
import { ingestGV } from "./ingest-gv.js";
import { ingestBessemer } from "./ingest-bessemer.js";
import { ingestGreylock } from "./ingest-greylock.js";
import { ingestFoundersFund } from "./ingest-foundersfund.js";
import { ingestSequoia } from "./ingest-sequoia.js";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "86400000", 10);
const SKIP_THEHUB = process.env.SKIP_THEHUB === "true";
const SKIP_GREGSLIST = process.env.SKIP_GREGSLIST === "true";
const SKIP_HN_HIRING = process.env.SKIP_HN_HIRING === "true";
const SKIP_ACCEL = process.env.SKIP_ACCEL === "true";
const SKIP_KLEINERPERKINS = process.env.SKIP_KLEINERPERKINS === "true";
const SKIP_FIRSTROUND = process.env.SKIP_FIRSTROUND === "true";
const SKIP_A16Z = process.env.SKIP_A16Z === "true";
const SKIP_GV = process.env.SKIP_GV === "true";
const SKIP_BESSEMER = process.env.SKIP_BESSEMER === "true";
const SKIP_GREYLOCK = process.env.SKIP_GREYLOCK === "true";
const SKIP_FOUNDERSFUND = process.env.SKIP_FOUNDERSFUND === "true";
const SKIP_SEQUOIA = process.env.SKIP_SEQUOIA === "true";

let cycleRunning = false;

export async function runPollCycle(): Promise<void> {
  if (cycleRunning) {
    console.log("[POLL] Skipping — previous cycle still running");
    return;
  }
  cycleRunning = true;
  console.log(`[POLL] Starting cycle at ${new Date().toISOString()}`);

  // Step 1: YC
  try {
    await ingestYC();
  } catch (e) {
    console.error("[POLL] YC failed:", (e as Error).message);
  }

  // Step 2: The Hub
  if (!SKIP_THEHUB) {
    try { await ingestTheHub(); } catch (e) { console.error("[POLL] The Hub failed:", (e as Error).message); }
  } else {
    console.log("[POLL] Skipping The Hub (SKIP_THEHUB=true)");
  }

  // Step 5: Gregslist
  if (!SKIP_GREGSLIST) {
    try { await ingestGregslist(); } catch (e) { console.error("[POLL] Gregslist failed:", (e as Error).message); }
  } else {
    console.log("[POLL] Skipping Gregslist (SKIP_GREGSLIST=true)");
  }

  // Step 6: HN Who is Hiring
  if (!SKIP_HN_HIRING) {
    try { await ingestHNHiring(); } catch (e) { console.error("[POLL] HN Hiring failed:", (e as Error).message); }
  } else {
    console.log("[POLL] Skipping HN Hiring (SKIP_HN_HIRING=true)");
  }

  // Step 8: VC portfolio scrapers
  for (const [name, skip, fn] of [
    ["Accel", SKIP_ACCEL, ingestAccel],
    ["KleinerPerkins", SKIP_KLEINERPERKINS, ingestKleinerPerkins],
    ["FirstRound", SKIP_FIRSTROUND, ingestFirstRound],
    ["a16z", SKIP_A16Z, ingestA16z],
    ["GV", SKIP_GV, ingestGV],
    ["Bessemer", SKIP_BESSEMER, ingestBessemer],
    ["Greylock", SKIP_GREYLOCK, ingestGreylock],
    ["FoundersFund", SKIP_FOUNDERSFUND, ingestFoundersFund],
    ["Sequoia", SKIP_SEQUOIA, ingestSequoia],
  ] as const) {
    if (skip) {
      console.log(`[POLL] Skipping ${name} (SKIP_${name.toUpperCase()}=true)`);
    } else {
      try { await fn(); } catch (e) { console.error(`[POLL] ${name} failed:`, (e as Error).message); }
    }
  }

  console.log(`[POLL] Cycle complete at ${new Date().toISOString()}`);
  cycleRunning = false;
}

export async function startPolling(): Promise<void> {
  console.log(`[POLL] Starting with interval ${POLL_INTERVAL_MS}ms`);
  await runPollCycle();

  const intervalId = setInterval(async () => {
    await runPollCycle().catch((e) => {
      console.error("[POLL] Unhandled cycle error:", (e as Error).message);
    });
  }, POLL_INTERVAL_MS);

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

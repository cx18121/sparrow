// Verify relative imports in code that ships to the @vercel/node runtime
// carry an explicit `.js` extension. tsconfig uses moduleResolution: bundler
// so extensionless relative imports type-check fine, and Vite tolerates them
// at dev time — but Node's ESM resolver does not, and a missed `.js` shows up
// in prod as `FUNCTION_INVOCATION_FAILED / ERR_MODULE_NOT_FOUND` (see the
// 2026-05-18 incident with src/types/audience.ts → './roleFamilies').
//
// Scope: server/** plus src/types/** — the only src/ subtree that gets pulled
// into the serverless bundle in production. (src/lib/* and src/components/*
// also get imported by `server/__tests__/*`, but those run under vitest's
// resolver, never under @vercel/node.)
//
// Wired into the pre-push hook alongside tsc + vitest.

import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const ROOTS = ["server", "src/types"];
const ALLOWED_EXT = /\.(js|json|css)$/;

// Catches both static imports/exports and dynamic import().
// Group 2 is the specifier. Multiline /s flag is intentional so import blocks
// that span lines are still captured.
const SPECIFIER_PATTERNS: RegExp[] = [
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

interface Violation {
  file: string;
  specifier: string;
}

async function* walk(root: string): AsyncGenerator<string> {
  // node:fs/promises#glob is stable in Node 22+ (ships with @types/node).
  for await (const entry of glob(`${root}/**/*.{ts,tsx}`)) {
    if (entry.includes("__tests__")) continue;
    if (entry.endsWith(".d.ts")) continue;
    yield entry;
  }
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

async function checkFile(file: string): Promise<Violation[]> {
  const src = await readFile(file, "utf8");
  const found: Violation[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of src.matchAll(pattern)) {
      const spec = m[1];
      if (!isRelative(spec)) continue;
      if (ALLOWED_EXT.test(spec)) continue;
      found.push({ file, specifier: spec });
    }
  }
  return found;
}

async function main() {
  const all: Violation[] = [];
  for (const root of ROOTS) {
    for await (const file of walk(root)) {
      all.push(...(await checkFile(file)));
    }
  }
  if (all.length === 0) {
    console.log("[check-esm-extensions] OK");
    return;
  }
  console.error(`[check-esm-extensions] ${all.length} extensionless relative import(s) — Node ESM will reject these at runtime:`);
  for (const v of all) {
    console.error(`  ${v.file}: '${v.specifier}'  → add .js`);
  }
  process.exit(1);
}

main().catch(err => {
  console.error("[check-esm-extensions] crashed:", err);
  process.exit(2);
});

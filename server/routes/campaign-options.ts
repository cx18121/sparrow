import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import {
  readCompanyOptionsSnapshot,
  refreshCompanyOptionsSnapshot,
} from "../lib/company-options.js";

// The Leads-tab filter-chip endpoint. Backed by the CompanyOptionsSnapshot
// table (migration 20260523001500), which is refreshed manually via
// scripts/refresh-company-options.ts after ingest sessions complete.
//
// Why a precomputed snapshot:
//   The response is global — every authed user gets the same data, the
//   only inputs are Company rows. The 10 underlying aggregations
//   (5 DISTINCT scans + 1 unnest GROUP BY + 4 counts) cost ~40s tail
//   cold-cache against a 34k-row Company table. Pre-2026-05-22, the
//   in-process LRU (commit daff053) hid this per-instance but didn't
//   address the cross-instance miss-storm risk. The snapshot moves the
//   answer into a single-row PK lookup.
//
// Fallback path: if the snapshot row hasn't been populated yet (fresh
// deploy, brand-new database), compute live + write the row + serve.
// Subsequent requests hit the now-populated snapshot.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const snapshot = await readCompanyOptionsSnapshot();
    if (snapshot) return res.status(200).json(snapshot);

    // Snapshot not populated yet. Compute live, persist, and serve. The
    // next request gets the cheap path.
    const computed = await refreshCompanyOptionsSnapshot();
    res.status(200).json(computed);
  } catch (err) {
    res.status(500).json({ error: "Could not load campaign options" });
  }
}

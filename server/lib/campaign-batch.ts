// Backward-compat shim. The real Batch module lives in ./batch.ts.
// New code should import { Batch } from "./batch.js" directly.

import { Batch, type BatchValue, type BatchHistory } from "./batch.js";

export type BatchResult = BatchValue;
export type { BatchHistory };
export { Batch };

export async function generateCampaignBatch(
  campaignId: string,
  userId: string,
  apolloKey: string | null
): Promise<BatchValue> {
  return Batch.generate(campaignId, userId, apolloKey);
}

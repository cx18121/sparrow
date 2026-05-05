import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  actionKey,
  clearPendingActionsForTest,
  createIdempotencyKey,
  isActionPending,
  runExclusive,
} from "../../src/lib/pendingActions.ts";

describe("pending action helpers", () => {
  beforeEach(() => {
    clearPendingActionsForTest();
  });

  it("dedupes concurrent work with the same action key", async () => {
    const task = vi.fn(async () => "done");

    const first = runExclusive("draft:1", task);
    const second = runExclusive("draft:1", task);

    expect(first).toBe(second);
    expect(isActionPending("draft:1")).toBe(true);
    await expect(first).resolves.toBe("done");
    expect(task).toHaveBeenCalledOnce();
    expect(isActionPending("draft:1")).toBe(false);
  });

  it("builds stable string keys and prefixed idempotency keys", () => {
    expect(actionKey("generate", "lead", 1, null)).toBe("generate:lead:1:");
    expect(createIdempotencyKey("generate")).toMatch(/^generate:/);
  });
});

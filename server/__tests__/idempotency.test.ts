import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const mockTx = {
    $executeRaw: vi.fn(),
    idempotencyKey: {
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const mockPrisma = {
    $transaction: vi.fn(async (fn) => fn(mockTx)),
    idempotencyKey: {
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { mockPrisma, mockTx };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import { hashRequest, runPersistentIdempotent } from "../lib/idempotency.js";

describe("persistent idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
    mockTx.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.update.mockResolvedValue({});
    mockPrisma.idempotencyKey.delete.mockResolvedValue({});
  });

  it("runs a new operation once and stores the completed response", async () => {
    const task = vi.fn(async () => ({ emailId: "email-1", subject: "Hello" }));

    const result = await runPersistentIdempotent({
      userId: "user-1",
      key: "generate-1",
      requestHash: "hash-1",
      task,
      db: mockPrisma as any,
    });

    expect(result).toEqual({ emailId: "email-1", subject: "Hello" });
    expect(task).toHaveBeenCalledOnce();
    expect(mockTx.idempotencyKey.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user-1",
        key: "generate-1",
        requestHash: "hash-1",
        status: "processing",
      }),
    }));
    expect(mockPrisma.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        response: { emailId: "email-1", subject: "Hello" },
      }),
    }));
  });

  it("returns a stored completed response without rerunning the task", async () => {
    mockTx.idempotencyKey.findUnique.mockResolvedValue({
      userId: "user-1",
      key: "generate-1",
      requestHash: "hash-1",
      status: "completed",
      response: { emailId: "email-existing", subject: "Existing" },
    });
    const task = vi.fn(async () => ({ emailId: "email-new" }));

    const result = await runPersistentIdempotent({
      userId: "user-1",
      key: "generate-1",
      requestHash: "hash-1",
      task,
      db: mockPrisma as any,
    });

    expect(result).toEqual({ emailId: "email-existing", subject: "Existing" });
    expect(task).not.toHaveBeenCalled();
  });

  it("rejects reuse of the same key for a different request body", async () => {
    mockTx.idempotencyKey.findUnique.mockResolvedValue({
      userId: "user-1",
      key: "generate-1",
      requestHash: "hash-old",
      status: "completed",
      response: { emailId: "email-existing" },
    });

    await expect(runPersistentIdempotent({
      userId: "user-1",
      key: "generate-1",
      requestHash: "hash-new",
      task: vi.fn(),
      db: mockPrisma as any,
    })).rejects.toThrow(/different request/i);
  });

  it("hashes equivalent object bodies consistently", () => {
    expect(hashRequest({ b: 2, a: { d: 4, c: 3 } })).toBe(hashRequest({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";

type StepInput = {
  id?: string;
  order?: number;
  name?: string;
  templateId?: string | null;
  waitDays?: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "PATCH") return update(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(_req: VercelRequest, res: VercelResponse, userId: string) {
  const items = await prisma.sequence.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      steps: { orderBy: { order: "asc" } },
    },
  });
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { name, description, steps } = body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const sequence = await prisma.sequence.create({
    data: {
      userId,
      name: name as string,
      description: (description as string | null) ?? null,
      steps: {
        create: normalizeSteps((steps as StepInput[]) ?? []),
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  res.status(201).json(sequence);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { id, name, description, steps } = body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });

  const existing = await prisma.sequence.findUnique({ where: { id: id as string } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Sequence not found" });
  }

  const sequence = await prisma.$transaction(async (tx) => {
    await tx.sequence.update({
      where: { id: id as string },
      data: {
        ...(name !== undefined && { name: name as string }),
        ...(description !== undefined && { description: description as string | null }),
      },
    });

    if (Array.isArray(steps)) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId: id as string } });
      const normalized = normalizeSteps(steps as StepInput[]);
      if (normalized.length > 0) {
        await tx.sequenceStep.createMany({
          data: normalized.map((s) => ({ ...s, sequenceId: id as string })),
        });
      }
    }

    const updated = await tx.sequence.findUnique({
      where: { id: id as string },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!updated) throw new Error("Sequence disappeared during update");
    return updated;
  });

  res.status(200).json(sequence);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) return res.status(400).json({ error: "id query param is required" });

  const existing = await prisma.sequence.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Sequence not found" });
  }

  await prisma.sequence.delete({ where: { id } });
  res.status(204).end();
}

function normalizeSteps(steps: StepInput[]): Array<{
  order: number;
  name: string;
  templateId: string | null;
  waitDays: number;
}> {
  return steps.map((s, i) => ({
    order: typeof s.order === "number" ? s.order : i,
    name: s.name ?? `Step ${i + 1}`,
    templateId: s.templateId ?? null,
    waitDays: typeof s.waitDays === "number" ? s.waitDays : 0,
  }));
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body as Record<string, unknown>;
}

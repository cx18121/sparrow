import { prisma } from "./prisma.js";
import { revealAndUpsertContact } from "./apollo-enrichment.js";
import { GenerationError } from "./generation-error.js";

interface DraftTargetParams {
  userId: string;
  userLeadId?: string;
  customContactId?: string;
}

export interface DraftTarget {
  contactInfo: { name: string | null; title: string | null };
  companyInfo: {
    name: string;
    description: string | null;
    oneLiner: string | null;
    stage: string | null;
    industry: string | null;
    isHiring: boolean;
  };
  savedLeadId: string | null;
  savedContactId: string | null;
  savedCustomContactId: string | null;
}

async function lookupRecipient(params: DraftTargetParams) {
  const { userId, userLeadId, customContactId } = params;

  if (customContactId) {
    const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
    if (!cc || cc.userId !== userId) throw new GenerationError("Custom contact not found", 404);
    return { kind: "customContact" as const, cc, lead: null as null, contact: null as null };
  }

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId! },
    include: { company: true, contact: true },
  });
  if (!lead || lead.userId !== userId) throw new GenerationError("Lead not found", 404);

  return { kind: "lead" as const, cc: null as null, lead, contact: lead.contact };
}

async function revealLeadContact(
  lead: { id: string; apolloPersonId: string | null; companyId: string },
  userId: string
) {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!lead.apolloPersonId || !apolloKey) return null;
  try {
    const saved = await revealAndUpsertContact(lead.apolloPersonId, lead.companyId, apolloKey, userId);
    if (saved) {
      await prisma.userLead.update({ where: { id: lead.id }, data: { contactId: saved.id } });
      return prisma.contact.findUnique({ where: { id: saved.id } });
    }
  } catch (err) {
    console.warn("Apollo reveal failed during draft generation:", err);
  }
  return null;
}

export async function resolveDraftTarget(params: DraftTargetParams): Promise<DraftTarget> {
  const lookup = await lookupRecipient(params);

  if (lookup.kind === "customContact") {
    const { cc } = lookup;
    return {
      contactInfo: { name: cc.name, title: cc.title },
      companyInfo: {
        name: cc.companyName ?? "",
        description: null,
        oneLiner: null,
        stage: null,
        industry: null,
        isHiring: false,
      },
      savedLeadId: null,
      savedContactId: null,
      savedCustomContactId: cc.id,
    };
  }

  const { lead } = lookup;
  const contact = lookup.contact ?? await revealLeadContact(lead, params.userId);

  if (!contact) {
    throw new GenerationError(
      lead.apolloPersonId
        ? "Could not fetch contact details for this lead. Try enriching it again from Discover."
        : "Lead has no contact. Save a lead from Discover to get contact details.",
      400
    );
  }

  return {
    contactInfo: { name: contact.name, title: contact.title },
    companyInfo: {
      name: lead.company.name,
      description: lead.company.description,
      oneLiner: lead.company.oneLiner,
      stage: lead.company.stage,
      industry: lead.company.industry,
      isHiring: lead.company.isHiring,
    },
    savedLeadId: lead.id,
    savedContactId: contact.id,
    savedCustomContactId: null,
  };
}

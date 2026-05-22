// High-precision regex filter for exa-discovery junk: VC funds, consulting
// firms, agencies, non-profits, .gov/.edu domains, etc. Used at two points:
//
//   1. ingest-exa-discovery.ts — applied at fetch time so new junk never
//      lands as isVerified=true.
//   2. demote-exa-junk.ts — applied retroactively to clean up the existing
//      pool (see commit history for the one-shot run).
//
// Conservative by design: false positives are worse than false negatives
// because the LLM classifier (classify-exa-startups.ts) is a second pass
// that catches the remaining ambiguous cases.

type Pattern = { name: string; re: RegExp; field: "name" | "description" | "domain" };

const PATTERNS: Pattern[] = [
  { name: "name-ventures-fund", re: /\b(Ventures|Capital|Partners|Holdings|VC|Equity)$/i, field: "name" },
  { name: "name-consulting", re: /\b(Consulting|Consultancy|Consultants|Advisors|Advisory)\b/i, field: "name" },
  { name: "name-accelerator", re: /\b(Accelerator|Incubator|Studio Labs?|Venture Labs?)\b/i, field: "name" },
  { name: "name-foundation", re: /\b(Foundation|Non-?profit|Charity|Institute)\b/i, field: "name" },
  { name: "name-agency", re: /\b(Agency|Marketing Agency|Digital Agency|Creative Agency|PR Agency)\b/i, field: "name" },
  { name: "name-law", re: /\b(Law Firm|LLP|Esq\.?|Attorneys?|Lawyers?)\b/i, field: "name" },
  { name: "desc-consulting-firm", re: /\b(consulting firm|consultancy|advisory firm|management consultancy)\b/i, field: "description" },
  { name: "desc-vc-fund", re: /\b(venture capital firm|VC firm|investment firm|private equity firm|seed fund|growth fund|venture fund|family office)\b/i, field: "description" },
  { name: "desc-accelerator", re: /\b(startup accelerator|business accelerator|early-stage incubator|venture studio)\b/i, field: "description" },
  { name: "desc-nonprofit", re: /\b(non-?profit organization|501\(?c\)?3|registered charity|NGO|charitable foundation)\b/i, field: "description" },
  { name: "desc-agency", re: /\b(marketing agency|advertising agency|creative agency|digital agency|PR agency|design agency|branding agency|communications agency)\b/i, field: "description" },
  { name: "desc-government", re: /\b(government agency|public sector|municipality|federal agency)\b/i, field: "description" },
  { name: "domain-gov", re: /\.gov(\.[a-z]{2,})?$/i, field: "domain" },
  { name: "domain-edu", re: /\.edu(\.[a-z]{2,})?$/i, field: "domain" },
  { name: "domain-mil", re: /\.mil$/i, field: "domain" },
];

export interface JunkHit { pattern: string; field: string; matched: string; }

export function detectExaJunk(args: { name: string; domain?: string | null; description?: string | null }): JunkHit | null {
  for (const p of PATTERNS) {
    const value = p.field === "name" ? args.name : p.field === "domain" ? args.domain ?? "" : args.description ?? "";
    const m = value.match(p.re);
    if (m) return { pattern: p.name, field: p.field, matched: m[0] };
  }
  return null;
}

export { PATTERNS as EXA_JUNK_PATTERNS };

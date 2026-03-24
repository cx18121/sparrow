/**
 * Normalize a job title string to a standardized role category.
 * Returns null if input is null or empty.
 */
export function normalizeRole(title: string | null): string | null {
  if (!title) return null;

  const lower = title.toLowerCase();

  if (
    lower.includes("founder") ||
    lower.includes("co-founder") ||
    lower.includes("ceo")
  ) {
    return "founder";
  }

  if (
    lower.includes("cto") ||
    lower.includes("engineer") ||
    lower.includes("developer") ||
    lower.includes("technical") ||
    lower.includes("vp eng") ||
    lower.includes("head of eng")
  ) {
    return "technical";
  }

  if (
    lower.includes("sales") ||
    lower.includes("marketing") ||
    lower.includes("growth") ||
    lower.includes("biz dev") ||
    lower.includes("business") ||
    lower.includes("cmo") ||
    lower.includes("cro")
  ) {
    return "business";
  }

  return "other";
}

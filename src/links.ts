import type { IssueLinkType } from "./jira.js";

export interface ResolvedLink {
  type: IssueLinkType;
  /** Issue the link is read from (Jira's outwardIssue). */
  outward: string;
  /** Issue the link points at (Jira's inwardIssue). */
  inward: string;
}

/**
 * Turn "`from` <relation> `to`" into the outward/inward pair Jira wants.
 * `relation` may be a link type name ("Blocks", treated as its outward phrase) or either
 * directional phrase ("blocks", "is blocked by"); matching is case-insensitive.
 */
export function resolveLink(types: IssueLinkType[], relation: string, from: string, to: string): ResolvedLink | undefined {
  const want = relation.trim().toLowerCase();
  const eq = (s?: string) => (s ?? "").trim().toLowerCase() === want;

  const byOutward = types.find((t) => eq(t.outward));
  if (byOutward) return { type: byOutward, outward: from, inward: to };
  const byInward = types.find((t) => eq(t.inward));
  if (byInward) return { type: byInward, outward: to, inward: from };
  const byName = types.find((t) => eq(t.name));
  if (byName) return { type: byName, outward: from, inward: to };
  return undefined;
}

/** One line per type, showing the phrases a caller may pass as `relation`. */
export function describeLinkTypes(types: IssueLinkType[]): string {
  return types.map((t) => `  ${t.name}: "${t.outward}" / "${t.inward}"`).join("\n") || "  (none)";
}

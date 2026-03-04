export const SEARCH_HASH_QUERY_PARAM = "q";

function stripLeadingHash(rawHash: string): string {
  return rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
}

export function readHashSearchQuery(rawHash: string): string | null {
  const stripped = stripLeadingHash(rawHash).trim();
  if (!stripped) return null;

  const candidate = stripped.startsWith("?") ? stripped.slice(1) : stripped;
  const params = new URLSearchParams(candidate);
  if (!params.has(SEARCH_HASH_QUERY_PARAM)) return null;

  const value = (params.get(SEARCH_HASH_QUERY_PARAM) ?? "").trim();
  return value || null;
}

export function buildHashSearchTemplateUrl(base: URL): string {
  const next = new URL(base.toString());
  next.hash = `${SEARCH_HASH_QUERY_PARAM}=%s`;
  return next.toString();
}

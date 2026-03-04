const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export const ALLOWED_FMT_FLAGS = new Set([
  "open_base_path",
  "open_snap_domain",
  "url_encode_placeholder",
  "url_encode_space_to_plus",
]);

export const DEFAULT_FMT_FLAGS = [
  "open_base_path",
  "open_snap_domain",
  "url_encode_placeholder",
  "url_encode_space_to_plus",
] as const;

export function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function toSafeRedirectUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

export function toHttpsDomain(domain: string, fallback = "https://www.google.com/"): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return toSafeRedirectUrl(domain) ?? fallback;
  }
  return `https://${domain}`;
}

export function sanitizeToken(value: unknown, maxTokenLength = 128): string | null {
  if (typeof value !== "string") return null;
  const token = normalizeToken(value);
  if (!token || token.length > maxTokenLength) return null;
  if (/\s/u.test(token) || CONTROL_CHARS.test(token)) return null;
  return token;
}

export function sanitizeTokenList(value: unknown, maxTokenLength = 128): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<string>();
  for (const entry of value) {
    const token = sanitizeToken(entry, maxTokenLength);
    if (token) set.add(token);
  }
  return set.size > 0 ? [...set] : undefined;
}

export function sanitizeFmtFlags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (ALLOWED_FMT_FLAGS.has(normalized)) set.add(normalized);
  }
  return set.size > 0 ? [...set] : undefined;
}

export function sanitizeOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  if (CONTROL_CHARS.test(trimmed)) return undefined;
  return trimmed;
}

export function sanitizeDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim();
  if (!domain || domain.length > 255 || CONTROL_CHARS.test(domain)) return undefined;
  if (domain.includes("@")) return undefined;

  const candidate = domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;

  try {
    const parsed = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return undefined;
    if (!parsed.hostname || parsed.username || parsed.password) return undefined;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return undefined;
    if (parsed.search || parsed.hash) return undefined;
    return parsed.host.toLowerCase();
  } catch (_error) {
    return undefined;
  }
}

export function sanitizeTemplateUrl(value: unknown, maxUrlLength = 2000): string | undefined {
  if (typeof value !== "string") return undefined;
  const template = value.trim();
  if (!template || template.length > maxUrlLength) return undefined;
  if (CONTROL_CHARS.test(template) || template.includes("\\")) return undefined;

  if (template.startsWith("http://") || template.startsWith("https://")) {
    const placeholderSafe = template.replace(/\{\{\{s\}\}\}/g, "query").replace(/\$[0-9]+/g, "query");
    if (!toSafeRedirectUrl(placeholderSafe)) return undefined;
    return template;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(template)) return undefined;
  if (template.startsWith("//")) return undefined;
  return template;
}

export function sanitizeRegexPattern(value: unknown, maxLength = 2000): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  if (CONTROL_CHARS.test(trimmed)) return undefined;
  return trimmed;
}

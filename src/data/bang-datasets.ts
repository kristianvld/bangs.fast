import {
  sanitizeDomain,
  sanitizeFmtFlags,
  sanitizeOptionalText,
  sanitizeRegexPattern,
  sanitizeTemplateUrl,
  sanitizeToken,
  sanitizeTokenList,
} from "../redirect/sanitize";

const DATASET_BASE_PATH = `${import.meta.env.BASE_URL}datasets/`;
export const BANG_DATASET_MANIFEST_URL = `${DATASET_BASE_PATH}manifest.json`;

export const KAGI_COMMUNITY_BANGS_SOURCE_URL = `${DATASET_BASE_PATH}kagi-community.json`;
export const KAGI_INTERNAL_BANGS_SOURCE_URL = `${DATASET_BASE_PATH}kagi-internal.json`;
export const DUCKDUCKGO_BANGS_SOURCE_URL = `${DATASET_BASE_PATH}duckduckgo.json`;

export type BangDatasetSourceId = "kagi-community" | "kagi-internal" | "duckduckgo";

type BangRecordBase = {
  t: string;
  s: string;
  d: string;
  u: string;
  ts?: string[];
  ad?: string;
  x?: string;
  c?: string;
  sc?: string;
  fmt?: string[];
};

export type BangDatasetEntry = BangRecordBase;

export type BangDatasetSource = {
  id: BangDatasetSourceId;
  label: string;
  description: string;
  sourceUrl: string;
  defaultEnabled: boolean;
};

export type StoredBangDataset = {
  sourceId: BangDatasetSourceId;
  sourceUrl: string;
  fetchedAt: string;
  hash: string;
  bangs: BangDatasetEntry[];
};

export type BangDatasetManifestSource = {
  sourceId: BangDatasetSourceId;
  sourceUrl: string;
  fetchedAt: string;
  hash: string;
  entryCount: number;
  path: string;
};

export type BangDatasetManifest = {
  generatedAt: string;
  sources: Partial<Record<BangDatasetSourceId, BangDatasetManifestSource>>;
};

export const BANG_DATASET_SOURCES: readonly BangDatasetSource[] = [
  {
    id: "kagi-community",
    label: "Kagi Community",
    description: "Kagi community-maintained bang list",
    sourceUrl: KAGI_COMMUNITY_BANGS_SOURCE_URL,
    defaultEnabled: true,
  },
  {
    id: "kagi-internal",
    label: "Kagi Internal",
    description: "Kagi internal bang list",
    sourceUrl: KAGI_INTERNAL_BANGS_SOURCE_URL,
    defaultEnabled: false,
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    description: "DuckDuckGo bang list",
    sourceUrl: DUCKDUCKGO_BANGS_SOURCE_URL,
    defaultEnabled: false,
  },
] as const;

export const DEFAULT_BANG_SOURCE_ORDER: readonly BangDatasetSourceId[] = BANG_DATASET_SOURCES.map((source) => source.id);
export const DEFAULT_ENABLED_BANG_SOURCES: readonly BangDatasetSourceId[] = BANG_DATASET_SOURCES
  .filter((source) => source.defaultEnabled)
  .map((source) => source.id);

const SOURCE_BY_ID: Record<BangDatasetSourceId, BangDatasetSource> = {
  "kagi-community": BANG_DATASET_SOURCES[0],
  "kagi-internal": BANG_DATASET_SOURCES[1],
  duckduckgo: BANG_DATASET_SOURCES[2],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIsoTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeSourceUrl(sourceId: BangDatasetSourceId, value: unknown): string {
  const fallback = SOURCE_BY_ID[sourceId].sourceUrl;
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fallback;
    }
    return parsed.toString();
  } catch (_error) {
    return fallback;
  }
}

function isBangDatasetSourceId(value: unknown): value is BangDatasetSourceId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOURCE_BY_ID, value);
}

export function getBangDatasetSource(sourceId: BangDatasetSourceId): BangDatasetSource {
  return SOURCE_BY_ID[sourceId];
}

function normalizeBangRecordShape(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;

  const normalized: Record<string, unknown> = {
    t: raw.t,
    s: raw.s,
    d: raw.d,
    u: raw.u,
  };

  if (raw.ts !== undefined) normalized.ts = raw.ts;
  if (raw.ad !== undefined) normalized.ad = raw.ad;
  if (raw.x !== undefined) normalized.x = raw.x;
  if (raw.c !== undefined) normalized.c = raw.c;
  if (raw.sc !== undefined) normalized.sc = raw.sc;
  if (raw.fmt !== undefined) normalized.fmt = raw.fmt;

  return normalized;
}

export function sanitizeBangDatasetEntry(raw: unknown): BangDatasetEntry | null {
  const normalized = normalizeBangRecordShape(raw);
  if (!normalized) return null;

  const trigger = sanitizeToken(normalized.t);
  const name = sanitizeOptionalText(normalized.s, 240);
  const domain = sanitizeDomain(normalized.d);
  const template = sanitizeTemplateUrl(normalized.u);
  if (!trigger || !name || !domain || !template) {
    return null;
  }

  const aliases = sanitizeTokenList(normalized.ts)?.filter((alias) => alias !== trigger);
  const category = sanitizeOptionalText(normalized.c, 120);
  const subcategory = sanitizeOptionalText(normalized.sc, 120);
  const regex = sanitizeRegexPattern(normalized.x);
  const fmt = sanitizeFmtFlags(normalized.fmt);
  const altDomain = sanitizeDomain(normalized.ad);

  const bang: BangDatasetEntry = {
    t: trigger,
    s: name,
    d: domain,
    u: template,
  };
  if (aliases && aliases.length > 0) bang.ts = aliases;
  if (altDomain) bang.ad = altDomain;
  if (regex) bang.x = regex;
  if (category) bang.c = category;
  if (subcategory) bang.sc = subcategory;
  if (fmt && fmt.length > 0) bang.fmt = fmt;
  return bang;
}

function resolveRawDatasetEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  return Array.isArray(raw.bangs) ? raw.bangs : [];
}

export function sanitizeBangDataset(raw: unknown): BangDatasetEntry[] {
  const rawEntries = resolveRawDatasetEntries(raw);
  if (rawEntries.length === 0) return [];

  const byTrigger = new Map<string, BangDatasetEntry>();
  for (const entry of rawEntries) {
    const bang = sanitizeBangDatasetEntry(entry);
    if (!bang) continue;
    byTrigger.set(bang.t, bang);
  }

  return [...byTrigger.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function sanitizeDatasetHash(value: unknown): string | null {
  return sanitizeOptionalText(value, 120) ?? null;
}

function sanitizeStoredBangDatasetFromRaw(
  raw: unknown,
  expectedSourceId?: BangDatasetSourceId,
): StoredBangDataset | null {
  if (!isRecord(raw) || !isBangDatasetSourceId(raw.sourceId)) return null;
  if (expectedSourceId && raw.sourceId !== expectedSourceId) return null;

  const hash = sanitizeDatasetHash(raw.hash);
  if (!hash) return null;

  const bangs = sanitizeBangDataset(raw.bangs);
  if (bangs.length === 0) return null;

  return {
    sourceId: raw.sourceId,
    sourceUrl: normalizeSourceUrl(raw.sourceId, raw.sourceUrl),
    fetchedAt: normalizeIsoTimestamp(raw.fetchedAt),
    hash,
    bangs,
  };
}

export function sanitizeStoredBangDataset(raw: unknown): StoredBangDataset | null {
  return sanitizeStoredBangDatasetFromRaw(raw);
}

async function parseDatasetPayload(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (_error) {
    throw new Error("Dataset response is not valid JSON");
  }
}

export async function fetchLatestBangDataset(sourceId: BangDatasetSourceId, signal?: AbortSignal): Promise<StoredBangDataset> {
  const source = getBangDatasetSource(sourceId);
  const response = await fetch(source.sourceUrl, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.sourceUrl} (${response.status})`);
  }

  const payload = await parseDatasetPayload(response);
  const dataset = sanitizeStoredBangDatasetFromRaw(payload, sourceId);
  if (!dataset) {
    throw new Error(`Fetched dataset for ${source.label} has invalid canonical format`);
  }

  return dataset;
}

function sanitizeManifestSource(sourceId: BangDatasetSourceId, raw: unknown): BangDatasetManifestSource | null {
  if (!isRecord(raw)) return null;

  const sourceUrl = normalizeSourceUrl(sourceId, raw.sourceUrl);
  const fetchedAt = normalizeIsoTimestamp(raw.fetchedAt);
  const hash = sanitizeOptionalText(raw.hash, 120);
  const path = sanitizeOptionalText(raw.path, 240);

  const entryCount =
    typeof raw.entryCount === "number" && Number.isFinite(raw.entryCount) && raw.entryCount >= 0
      ? Math.round(raw.entryCount)
      : null;

  if (!hash || !path || entryCount === null) return null;

  return {
    sourceId,
    sourceUrl,
    fetchedAt,
    hash,
    entryCount,
    path,
  };
}

export function sanitizeBangDatasetManifest(raw: unknown): BangDatasetManifest | null {
  if (!isRecord(raw) || !isRecord(raw.sources)) return null;

  const generatedAt = normalizeIsoTimestamp(raw.generatedAt);
  const sources: Partial<Record<BangDatasetSourceId, BangDatasetManifestSource>> = {};

  for (const source of BANG_DATASET_SOURCES) {
    const sanitized = sanitizeManifestSource(source.id, raw.sources[source.id]);
    if (sanitized) {
      sources[source.id] = sanitized;
    }
  }

  return {
    generatedAt,
    sources,
  };
}

export async function fetchBangDatasetManifest(signal?: AbortSignal): Promise<BangDatasetManifest> {
  const response = await fetch(BANG_DATASET_MANIFEST_URL, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${BANG_DATASET_MANIFEST_URL} (${response.status})`);
  }

  const payload = await parseDatasetPayload(response);
  const manifest = sanitizeBangDatasetManifest(payload);
  if (!manifest) {
    throw new Error("Dataset manifest payload is invalid");
  }

  return manifest;
}

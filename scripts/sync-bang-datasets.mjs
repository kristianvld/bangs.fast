import { mkdir, writeFile } from "node:fs/promises";

const OUTPUT_DIR = new URL("../public/datasets/", import.meta.url);

const KAGI_COMMUNITY_SOURCE_URL = "https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json";
const KAGI_INTERNAL_SOURCE_URL = "https://raw.githubusercontent.com/kagisearch/bangs/main/data/kagi_bangs.json";
const DUCKDUCKGO_SOURCE_URL = "https://duckduckgo.com/bang.js";

const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_FMT_FLAGS = new Set(["open_base_path", "open_snap_domain", "url_encode_placeholder", "url_encode_space_to_plus"]);
const MAX_TOKEN_LENGTH = 128;
const MAX_TEXT_FIELD_LENGTH = 240;
const MAX_URL_FIELD_LENGTH = 2000;

const SOURCES = [
  {
    id: "kagi-community",
    upstreamUrl: KAGI_COMMUNITY_SOURCE_URL,
  },
  {
    id: "kagi-internal",
    upstreamUrl: KAGI_INTERNAL_SOURCE_URL,
  },
  {
    id: "duckduckgo",
    upstreamUrl: DUCKDUCKGO_SOURCE_URL,
  },
];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function parseJsonLikeText(text) {
  const direct = parseJsonCandidate(text);
  if (direct !== undefined) return direct;

  const trimmed = text.trim();

  const firstArrayIndex = trimmed.indexOf("[");
  const lastArrayIndex = trimmed.lastIndexOf("]");
  if (firstArrayIndex >= 0 && lastArrayIndex > firstArrayIndex) {
    const arrayPayload = parseJsonCandidate(trimmed.slice(firstArrayIndex, lastArrayIndex + 1));
    if (arrayPayload !== undefined) return arrayPayload;
  }

  const firstObjectIndex = trimmed.indexOf("{");
  const lastObjectIndex = trimmed.lastIndexOf("}");
  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    const objectPayload = parseJsonCandidate(trimmed.slice(firstObjectIndex, lastObjectIndex + 1));
    if (objectPayload !== undefined) return objectPayload;
  }

  throw new Error("Source payload is not valid JSON");
}

function normalizeBangRecordShape(raw) {
  if (!isPlainObject(raw)) return null;

  const normalized = {
    t: raw.t ?? raw.bang,
    s: raw.s ?? raw.site,
    d: raw.d ?? raw.domain,
    u: raw.u ?? raw.url,
  };

  if (raw.ts !== undefined) normalized.ts = raw.ts;
  if (raw.ad !== undefined) normalized.ad = raw.ad;
  if (raw.x !== undefined) normalized.x = raw.x;
  if (raw.c !== undefined || raw.category !== undefined) normalized.c = raw.c ?? raw.category;
  if (raw.sc !== undefined || raw.subcategory !== undefined) normalized.sc = raw.sc ?? raw.subcategory;
  if (raw.fmt !== undefined) normalized.fmt = raw.fmt;

  return normalized;
}

function sanitizeToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (!token) return null;
  if (token.length > MAX_TOKEN_LENGTH) return null;
  if (/\s/u.test(token)) return null;
  if (CONTROL_CHARS_PATTERN.test(token)) return null;
  return token;
}

function sanitizeTokenList(value) {
  if (!Array.isArray(value)) return undefined;
  const deduped = new Set();
  for (const entry of value) {
    const token = sanitizeToken(entry);
    if (!token) continue;
    deduped.add(token);
  }
  return deduped.size > 0 ? [...deduped] : undefined;
}

function sanitizeFmtFlags(value) {
  if (!Array.isArray(value)) return undefined;
  const deduped = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (!ALLOWED_FMT_FLAGS.has(normalized)) continue;
    deduped.add(normalized);
  }
  return deduped.size > 0 ? [...deduped] : undefined;
}

function sanitizeOptionalText(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) return undefined;
  if (CONTROL_CHARS_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeDomain(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 255) return undefined;
  if (CONTROL_CHARS_PATTERN.test(trimmed)) return undefined;
  if (trimmed.includes("@")) return undefined;

  const hasProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return undefined;
    if (!parsed.hostname) return undefined;
    if (parsed.username || parsed.password) return undefined;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return undefined;
    if (parsed.search || parsed.hash) return undefined;
    return parsed.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function sanitizeTemplateUrl(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_URL_FIELD_LENGTH) return undefined;
  if (CONTROL_CHARS_PATTERN.test(trimmed)) return undefined;
  if (trimmed.includes("\\")) return undefined;

  const isAbsoluteHttp = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  if (isAbsoluteHttp) {
    const placeholderSafe = trimmed.replace(/\{\{\{s\}\}\}/g, "query").replace(/\$[0-9]+/g, "query");
    const parsed = toSafeRedirectUrl(placeholderSafe);
    if (!parsed) return undefined;
    return trimmed;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return undefined;
  if (trimmed.startsWith("//")) return undefined;

  return trimmed;
}

function sanitizeRegexPattern(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_URL_FIELD_LENGTH) return undefined;
  if (CONTROL_CHARS_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function toSafeRedirectUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeBang(raw) {
  const normalized = normalizeBangRecordShape(raw);
  if (!normalized) return null;

  const trigger = sanitizeToken(normalized.t);
  const name = sanitizeOptionalText(normalized.s, MAX_TEXT_FIELD_LENGTH);
  const domain = sanitizeDomain(normalized.d);
  const template = sanitizeTemplateUrl(normalized.u);

  if (!trigger || !name || !domain || !template) {
    return null;
  }

  const aliases = sanitizeTokenList(normalized.ts)?.filter((token) => token !== trigger);
  const category = sanitizeOptionalText(normalized.c, 120);
  const subcategory = sanitizeOptionalText(normalized.sc, 120);
  const regex = sanitizeRegexPattern(normalized.x);
  const fmt = sanitizeFmtFlags(normalized.fmt);
  const adDomain = sanitizeDomain(normalized.ad);

  const bang = {
    t: trigger,
    s: name,
    d: domain,
    u: template,
  };
  if (aliases && aliases.length > 0) bang.ts = aliases;
  if (adDomain) bang.ad = adDomain;
  if (regex) bang.x = regex;
  if (category) bang.c = category;
  if (subcategory) bang.sc = subcategory;
  if (fmt && fmt.length > 0) bang.fmt = fmt;

  return bang;
}

function dedupeByTrigger(bangs) {
  const map = new Map();
  for (const bang of bangs) {
    map.set(bang.t, bang);
  }
  return [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function equivalentBangSignature(bang) {
  return JSON.stringify({
    s: bang.s,
    d: bang.d,
    u: bang.u,
    ad: bang.ad ?? "",
    x: bang.x ?? "",
    c: bang.c ?? "",
    sc: bang.sc ?? "",
    fmt: [...(bang.fmt ?? [])].sort(),
  });
}

function compareTriggerPriority(left, right) {
  const byLength = left.length - right.length;
  if (byLength !== 0) return byLength;
  return left.localeCompare(right);
}

function mergeEquivalentDuckDuckGoBangs(bangs) {
  const groups = new Map();
  for (const bang of bangs) {
    const signature = equivalentBangSignature(bang);
    const current = groups.get(signature);
    if (current) {
      current.push(bang);
    } else {
      groups.set(signature, [bang]);
    }
  }

  const merged = [];
  for (const group of groups.values()) {
    const primary = [...group].sort((left, right) => compareTriggerPriority(left.t, right.t))[0];
    const mergedBang = { ...primary };

    if (group.length > 1) {
      const aliasSet = new Set();
      for (const bang of group) {
        aliasSet.add(bang.t);
        for (const alias of bang.ts ?? []) {
          aliasSet.add(alias);
        }
      }
      aliasSet.delete(primary.t);
      const aliases = [...aliasSet].sort((left, right) => left.localeCompare(right));
      if (aliases.length > 0) {
        mergedBang.ts = aliases;
      } else {
        delete mergedBang.ts;
      }
    }

    merged.push(mergedBang);
  }

  const primaryTriggers = new Set(merged.map((bang) => bang.t));
  for (const bang of merged) {
    if (!bang.ts) continue;
    const filteredAliases = bang.ts.filter((alias) => !primaryTriggers.has(alias));
    if (filteredAliases.length > 0) {
      bang.ts = filteredAliases;
    } else {
      delete bang.ts;
    }
  }

  return merged.sort((left, right) => left.t.localeCompare(right.t));
}

function extractRawEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isPlainObject(payload)) return [];

  const knownArrayFields = ["bangs", "data", "results", "items", "entries"];
  for (const field of knownArrayFields) {
    if (Array.isArray(payload[field])) {
      return payload[field];
    }
  }

  const values = Object.values(payload);
  if (values.length > 0 && values.every((value) => isPlainObject(value))) {
    return values;
  }

  return [];
}

function fnv1aHex(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildDatasetHash(bangs) {
  return fnv1aHex(JSON.stringify(bangs));
}

async function loadFromUrl(url) {
  const response = await fetch(url, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  const text = await response.text();
  return parseJsonLikeText(text);
}

async function buildSourceDataset(source) {
  const fetchedAt = new Date().toISOString();
  const payload = await loadFromUrl(source.upstreamUrl);
  const entries = extractRawEntries(payload);

  const sanitized = [];
  let droppedInvalid = 0;

  for (const raw of entries) {
    const bang = sanitizeBang(raw);
    if (!bang) {
      droppedInvalid += 1;
      continue;
    }
    sanitized.push(bang);
  }

  const dedupedByTrigger = dedupeByTrigger(sanitized);
  const isDuckDuckGo = source.id === "duckduckgo";
  const bangs = isDuckDuckGo ? mergeEquivalentDuckDuckGoBangs(dedupedByTrigger) : dedupedByTrigger;
  if (bangs.length === 0) {
    throw new Error(`No valid bangs produced for ${source.id}`);
  }

  const hash = buildDatasetHash(bangs);
  const dataset = {
    sourceId: source.id,
    sourceUrl: source.upstreamUrl,
    fetchedAt,
    hash,
    bangs,
  };

  return {
    sourceId: source.id,
    dataset,
    stats: {
      total: entries.length,
      kept: bangs.length,
      droppedInvalid,
      droppedDuplicateTrigger: sanitized.length - dedupedByTrigger.length,
      mergedEquivalentEntries: dedupedByTrigger.length - bangs.length,
    },
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const manifest = {
    generatedAt,
    sources: {},
  };

  for (const source of SOURCES) {
    const built = await buildSourceDataset(source);
    const outputPath = new URL(`${source.id}.json`, OUTPUT_DIR);
    await writeFile(outputPath, `${JSON.stringify(built.dataset)}\n`, "utf8");

    manifest.sources[source.id] = {
      sourceId: source.id,
      path: `datasets/${source.id}.json`,
      sourceUrl: source.upstreamUrl,
      fetchedAt: built.dataset.fetchedAt,
      hash: built.dataset.hash,
      entryCount: built.dataset.bangs.length,
    };

    const { total, kept, droppedInvalid, droppedDuplicateTrigger, mergedEquivalentEntries } = built.stats;
    console.log(
      `[${source.id}] wrote ${outputPath.pathname} (input: ${total}, kept: ${kept}, dropped invalid: ${droppedInvalid}, duplicate trigger: ${droppedDuplicateTrigger}, merged equivalent: ${mergedEquivalentEntries})`,
    );
  }

  const manifestPath = new URL("manifest.json", OUTPUT_DIR);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote manifest to ${manifestPath.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

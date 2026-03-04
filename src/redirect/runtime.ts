import { DEFAULT_ENGINE_URLS } from "./constants";
import { logNonFatalError } from "./non-fatal";
import { DEFAULT_FMT_FLAGS, normalizeToken, toHttpsDomain, toSafeRedirectUrl } from "./sanitize";
import type { CompiledBang, CompiledRedirectIndex } from "./types";
import { readHashSearchQuery } from "../search-url";

function absoluteTemplate(bang: CompiledBang): string {
  if (bang.u.startsWith("http://") || bang.u.startsWith("https://")) {
    return bang.u;
  }
  if (bang.u.startsWith("/")) {
    return `${toHttpsDomain(bang.d)}${bang.u}`;
  }
  return `${toHttpsDomain(bang.d)}/${bang.u}`;
}

function buildBangUrl(bang: CompiledBang, query: string): string {
  const fmt = new Set(bang.f ?? DEFAULT_FMT_FLAGS);
  const template = absoluteTemplate(bang);

  if (!query) {
    if (fmt.has("open_snap_domain") && bang.a) {
      return toHttpsDomain(bang.a);
    }
    if (fmt.has("open_base_path")) {
      try {
        const parsed = new URL(template);
        return `${parsed.protocol}//${parsed.host}/`;
      } catch (error) {
        logNonFatalError("Failed to parse bang template when building base-path URL", error);
        return toHttpsDomain(bang.d);
      }
    }
    return toHttpsDomain(bang.d);
  }

  const encodePart = (value: string): string => {
    if (!fmt.has("url_encode_placeholder")) return value;
    let encoded = encodeURIComponent(value);
    if (fmt.has("url_encode_space_to_plus")) {
      encoded = encoded.replace(/%20/g, "+");
    }
    return encoded;
  };

  let built = template;
  if (bang.x) {
    try {
      const regex = new RegExp(bang.x);
      const match = query.match(regex);
      if (match) {
        built = built.replace(/\$(\d+)/g, (_full, groupIndex) => {
          const value = match[Number(groupIndex)] ?? "";
          return encodePart(value);
        });
      }
    } catch (error) {
      logNonFatalError("Invalid bang regex pattern; falling back to placeholder substitution", error);
    }
  }

  return built.replace(/\{\{\{s\}\}\}/g, encodePart(query));
}

function buildDefaultEngineUrl(index: CompiledRedirectIndex, query: string): string {
  const encoded = encodeURIComponent(query);
  if (index.e === "bang") {
    const fallbackIdx = index.m[normalizeToken(index.b)];
    if (typeof fallbackIdx === "number") {
      const fallbackBang = index.bs[fallbackIdx];
      if (fallbackBang) return buildBangUrl(fallbackBang, query);
    }
    return query ? DEFAULT_ENGINE_URLS.google.replace("{{{s}}}", encoded) : "https://www.google.com/";
  }

  const template = DEFAULT_ENGINE_URLS[index.e] ?? DEFAULT_ENGINE_URLS.google;
  if (!query) {
    return template.replace("/search?q={{{s}}}", "").replace("?q={{{s}}}", "");
  }
  return template.replace("{{{s}}}", encoded);
}

type KnownBangMatch = {
  bang: CompiledBang;
  start: number;
  end: number;
};

function findFirstKnownBang(rawQuery: string, index: CompiledRedirectIndex): KnownBangMatch | null {
  const pattern = /(?:^|\s)(!([^\s]+))/gu;

  for (const match of rawQuery.matchAll(pattern)) {
    const bangToken = match[1];
    const rawTrigger = match[2];
    const matchIndex = match.index;
    if (typeof matchIndex !== "number") continue;

    const bangStartInMatch = match[0].length - bangToken.length;
    const bangStart = matchIndex + bangStartInMatch;
    const bangEnd = bangStart + bangToken.length;

    const bangIdx = index.m[normalizeToken(rawTrigger)];
    if (typeof bangIdx !== "number") continue;

    const bang = index.bs[bangIdx];
    if (!bang) continue;

    return { bang, start: bangStart, end: bangEnd };
  }

  return null;
}

function stripBangToken(rawQuery: string, bang: Pick<KnownBangMatch, "start" | "end">): string {
  const before = rawQuery.slice(0, bang.start).trimEnd();
  const after = rawQuery.slice(bang.end).trimStart();
  return `${before} ${after}`.trim();
}

export function resolveRedirectUrlFromIndex(url: URL, index: CompiledRedirectIndex): string | null {
  const rawQuery = readHashSearchQuery(url.hash);
  if (!rawQuery) return null;

  const knownBangMatch = findFirstKnownBang(rawQuery, index);
  const query = knownBangMatch ? stripBangToken(rawQuery, knownBangMatch) : rawQuery;

  let candidate: string;
  if (knownBangMatch) {
    candidate = buildBangUrl(knownBangMatch.bang, query);
    return toSafeRedirectUrl(candidate) ?? "https://www.google.com/";
  }

  candidate = buildDefaultEngineUrl(index, query);
  return toSafeRedirectUrl(candidate) ?? "https://www.google.com/";
}

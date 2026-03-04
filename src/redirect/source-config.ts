import {
  DEFAULT_BANG_SOURCE_ORDER,
  DEFAULT_ENABLED_BANG_SOURCES,
  type BangDatasetSourceId,
} from "../data/bang-datasets";
import { readLocalStorageItem, writeLocalStorageItem } from "./browser-storage";
import { logNonFatalError } from "./non-fatal";

export const SOURCE_CONFIG_STORAGE_KEY = "bangs-source-config-v1";

export type BangSourceConfig = {
  order: BangDatasetSourceId[];
  enabled: BangDatasetSourceId[];
};

export type BangSourcePreset = "kagi" | "kagi-internal" | "ddg";

function isSourceId(value: unknown): value is BangDatasetSourceId {
  return value === "kagi-community" || value === "kagi-internal" || value === "duckduckgo";
}

function uniqueSourceIds(values: readonly BangDatasetSourceId[]): BangDatasetSourceId[] {
  return [...new Set(values)];
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function presetToBangSourceConfig(preset: BangSourcePreset): BangSourceConfig {
  switch (preset) {
    case "kagi":
      return {
        order: ["kagi-community", "kagi-internal", "duckduckgo"],
        enabled: ["kagi-community"],
      };
    case "kagi-internal":
      return {
        order: ["kagi-internal", "kagi-community", "duckduckgo"],
        enabled: ["kagi-community", "kagi-internal"],
      };
    case "ddg":
      return {
        order: ["duckduckgo", "kagi-community", "kagi-internal"],
        enabled: ["duckduckgo"],
      };
  }
}

export function sourceConfigToBangSourcePreset(config: BangSourceConfig): BangSourcePreset {
  const enabled = new Set(config.enabled);
  if (enabled.size === 1 && enabled.has("duckduckgo")) return "ddg";
  if (enabled.has("kagi-community") && enabled.has("kagi-internal") && !enabled.has("duckduckgo")) {
    return "kagi-internal";
  }
  return "kagi";
}

export function canonicalizeBangSourceConfig(config: BangSourceConfig): BangSourceConfig {
  return presetToBangSourceConfig(sourceConfigToBangSourcePreset(config));
}

export function sanitizeBangSourceConfig(candidate: unknown): BangSourceConfig {
  const fallback: BangSourceConfig = {
    order: [...DEFAULT_BANG_SOURCE_ORDER],
    enabled: [...DEFAULT_ENABLED_BANG_SOURCES],
  };

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return fallback;
  }

  const obj = candidate as { order?: unknown; enabled?: unknown };

  const orderCandidates = Array.isArray(obj.order) ? obj.order.filter(isSourceId) : [];
  const order = uniqueSourceIds(orderCandidates);
  for (const sourceId of DEFAULT_BANG_SOURCE_ORDER) {
    if (!order.includes(sourceId)) {
      order.push(sourceId);
    }
  }

  const enabledCandidates = Array.isArray(obj.enabled) ? obj.enabled.filter(isSourceId) : [];
  const enabledSet = new Set(enabledCandidates);
  const enabled = order.filter((sourceId) => enabledSet.has(sourceId));

  return {
    order,
    enabled: enabled.length > 0 ? enabled : [...DEFAULT_ENABLED_BANG_SOURCES],
  };
}

export function readBangSourceConfig(): BangSourceConfig {
  const persistCanonical = (config: BangSourceConfig): BangSourceConfig => {
    const canonical = canonicalizeBangSourceConfig(config);
    if (!arraysEqual(canonical.order, config.order) || !arraysEqual(canonical.enabled, config.enabled)) {
      writeLocalStorageItem(SOURCE_CONFIG_STORAGE_KEY, JSON.stringify(canonical));
    }
    return canonical;
  };

  try {
    const raw = readLocalStorageItem(SOURCE_CONFIG_STORAGE_KEY);
    if (!raw) return persistCanonical(sanitizeBangSourceConfig(null));
    return persistCanonical(sanitizeBangSourceConfig(JSON.parse(raw) as unknown));
  } catch (error) {
    logNonFatalError("Failed to read bang source config, using defaults", error);
    return persistCanonical(sanitizeBangSourceConfig(null));
  }
}

export function saveBangSourceConfig(config: BangSourceConfig): BangSourceConfig {
  const canonical = canonicalizeBangSourceConfig(sanitizeBangSourceConfig(config));
  writeLocalStorageItem(SOURCE_CONFIG_STORAGE_KEY, JSON.stringify(canonical));
  return canonical;
}

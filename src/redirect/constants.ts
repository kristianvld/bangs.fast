import type { DefaultEngine } from "./types";

export const REDIRECT_INDEX_VERSION = 1 as const;
export const REDIRECT_INDEX_DB_NAME = "bangs-redirect-index";
export const REDIRECT_INDEX_STORE_NAME = "compiled";
export const REDIRECT_INDEX_STORE_KEY = "index";
export const BANG_DATASET_STORE_NAME = "datasets";
export const STATE_STORAGE_KEY = "bangs-local-state-v1";

export const DEFAULT_ENGINE_URLS: Record<Exclude<DefaultEngine, "bang">, string> = {
  google: "https://www.google.com/search?q={{{s}}}",
  ddg: "https://duckduckgo.com/?q={{{s}}}",
  bing: "https://www.bing.com/search?q={{{s}}}",
  kagi: "https://kagi.com/search?q={{{s}}}",
  brave: "https://search.brave.com/search?q={{{s}}}",
};

export const DEFAULT_ENGINE_VALUES = ["google", "ddg", "bing", "kagi", "brave", "bang"] as const;

export const DEFAULT_ENGINE: DefaultEngine = "google";
export const DEFAULT_BANG_TRIGGER = "g";

export function isDefaultEngine(value: unknown): value is DefaultEngine {
  return typeof value === "string" && (DEFAULT_ENGINE_VALUES as readonly string[]).includes(value);
}

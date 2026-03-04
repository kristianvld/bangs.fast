import { DEFAULT_BANG_TRIGGER, DEFAULT_ENGINE, isDefaultEngine } from "./constants";
import { logNonFatalError } from "./non-fatal";
import {
  sanitizeDomain,
  sanitizeFmtFlags,
  sanitizeRegexPattern,
  sanitizeTemplateUrl,
  sanitizeToken,
  sanitizeTokenList,
} from "./sanitize";
import type { DefaultEngine } from "./types";

type RuntimeBang = {
  t: string;
  d: string;
  u: string;
  ts?: string[];
  a?: string;
  x?: string;
  f?: string[];
  disabled?: boolean;
};

type RuntimeOverride = {
  disabled: true;
};

export type RuntimeState = {
  overrides: Record<string, RuntimeOverride>;
  custom: RuntimeBang[];
  settings: {
    defaultEngine: DefaultEngine;
    defaultBangTrigger: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeOverride(raw: unknown): RuntimeOverride | null {
  if (!isRecord(raw)) return null;
  return raw.disabled === true ? { disabled: true } : null;
}

function sanitizeCustomBang(raw: unknown): RuntimeBang | null {
  if (!isRecord(raw)) return null;
  const trigger = sanitizeToken(raw.t);
  const domain = sanitizeDomain(raw.d);
  const template = sanitizeTemplateUrl(raw.u);
  if (!trigger || !domain || !template) return null;

  const aliases = sanitizeTokenList(raw.ts)?.filter((alias) => alias !== trigger);
  const altDomain = sanitizeDomain(raw.ad);
  const fmt = sanitizeFmtFlags(raw.fmt);
  const regex = sanitizeRegexPattern(raw.x);

  const bang: RuntimeBang = {
    t: trigger,
    d: domain,
    u: template,
    disabled: raw.disabled === true,
  };
  if (aliases && aliases.length > 0) bang.ts = aliases;
  if (altDomain) bang.a = altDomain;
  if (regex) bang.x = regex;
  if (fmt && fmt.length > 0) bang.f = fmt;
  return bang;
}

function sanitizeEngine(value: unknown): DefaultEngine {
  return isDefaultEngine(value) ? value : DEFAULT_ENGINE;
}

export function parseRuntimeState(rawState: string): RuntimeState {
  const fallback: RuntimeState = {
    overrides: {},
    custom: [],
    settings: {
      defaultEngine: DEFAULT_ENGINE,
      defaultBangTrigger: DEFAULT_BANG_TRIGGER,
    },
  };

  if (!rawState) return fallback;

  try {
    const parsed = JSON.parse(rawState) as unknown;
    if (!isRecord(parsed)) return fallback;

    const overrides: Record<string, RuntimeOverride> = {};
    if (isRecord(parsed.overrides)) {
      for (const [rawTrigger, rawPatch] of Object.entries(parsed.overrides)) {
        const trigger = sanitizeToken(rawTrigger);
        const override = sanitizeOverride(rawPatch);
        if (!trigger || !override) continue;
        overrides[trigger] = override;
      }
    }

    const custom: RuntimeBang[] = [];
    if (Array.isArray(parsed.custom)) {
      for (const entry of parsed.custom) {
        const bang = sanitizeCustomBang(entry);
        if (bang) custom.push(bang);
      }
    }

    const settingsObj = isRecord(parsed.settings) ? parsed.settings : {};
    const defaultBangTrigger = sanitizeToken(settingsObj.defaultBangTrigger) ?? DEFAULT_BANG_TRIGGER;

    return {
      overrides,
      custom,
      settings: {
        defaultEngine: sanitizeEngine(settingsObj.defaultEngine),
        defaultBangTrigger,
      },
    };
  } catch (error) {
    logNonFatalError("Failed to parse runtime state; using defaults", error);
    return fallback;
  }
}

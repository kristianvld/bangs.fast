import { DEFAULT_BANG_TRIGGER, DEFAULT_ENGINE, isDefaultEngine, REDIRECT_INDEX_VERSION } from "./constants";
import {
  sanitizeDomain,
  sanitizeFmtFlags,
  sanitizeRegexPattern,
  sanitizeTemplateUrl,
  sanitizeToken,
  sanitizeTokenList,
} from "./sanitize";
import { parseRuntimeState, type RuntimeState } from "./state";
import type { CompiledBang, CompiledRedirectIndex, DefaultEngine } from "./types";

type BaseBang = {
  t: string;
  d: string;
  u: string;
  ts?: string[];
  ad?: string;
  x?: string;
  fmt?: string[];
};

function sanitizeBaseBang(raw: unknown): BaseBang | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const trigger = sanitizeToken(obj.t);
  const domain = sanitizeDomain(obj.d);
  const template = sanitizeTemplateUrl(obj.u);
  if (!trigger || !domain || !template) return null;

  const aliases = sanitizeTokenList(obj.ts)?.filter((alias) => alias !== trigger);
  const altDomain = sanitizeDomain(obj.ad);
  const regex = sanitizeRegexPattern(obj.x);
  const fmt = sanitizeFmtFlags(obj.fmt);

  const bang: BaseBang = {
    t: trigger,
    d: domain,
    u: template,
  };
  if (aliases && aliases.length > 0) bang.ts = aliases;
  if (altDomain) bang.ad = altDomain;
  if (regex) bang.x = regex;
  if (fmt && fmt.length > 0) bang.fmt = fmt;
  return bang;
}

function compactBang(bang: BaseBang): CompiledBang {
  const compact: CompiledBang = {
    d: bang.d,
    u: bang.u,
  };
  if (bang.ad) compact.a = bang.ad;
  if (bang.x) compact.x = bang.x;
  if (bang.fmt && bang.fmt.length > 0) compact.f = bang.fmt;
  return compact;
}

function toDefaultEngine(raw: string): DefaultEngine {
  return isDefaultEngine(raw) ? raw : DEFAULT_ENGINE;
}

function isBaseBangDisabled(trigger: string, state: RuntimeState): boolean {
  return state.overrides[trigger]?.disabled === true;
}

function addBangToIndex(
  bang: BaseBang,
  compiledBangs: CompiledBang[],
  tokenMap: Record<string, number>,
): void {
  const index = compiledBangs.length;
  compiledBangs.push(compactBang(bang));

  tokenMap[bang.t] = index;
  for (const alias of bang.ts ?? []) {
    tokenMap[alias] = index;
  }
}

export function compileRedirectIndex(
  rawState: string,
  signature: string,
  rawBaseBangs: readonly unknown[],
): CompiledRedirectIndex {
  const state = parseRuntimeState(rawState);
  const compiledBangs: CompiledBang[] = [];
  const tokenMap: Record<string, number> = Object.create(null);

  for (const rawBase of rawBaseBangs) {
    const base = sanitizeBaseBang(rawBase);
    if (!base) continue;
    if (isBaseBangDisabled(base.t, state)) continue;
    addBangToIndex(base, compiledBangs, tokenMap);
  }

  for (const custom of state.custom) {
    if (custom.disabled) continue;
    addBangToIndex(
      {
        t: custom.t,
        d: custom.d,
        ad: custom.a,
        u: custom.u,
        x: custom.x,
        fmt: custom.f,
        ts: custom.ts,
      },
      compiledBangs,
      tokenMap,
    );
  }

  return {
    v: REDIRECT_INDEX_VERSION,
    s: signature,
    e: toDefaultEngine(state.settings.defaultEngine),
    b: state.settings.defaultBangTrigger || DEFAULT_BANG_TRIGGER,
    bs: compiledBangs,
    m: tokenMap,
  };
}

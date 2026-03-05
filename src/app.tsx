import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, Copy, Edit2, Eye, EyeOff, Info, Plus, RotateCcw, Share2, Trash2, type IconProps } from "react-feather";
import "./styles.css";
import { DEFAULT_BANG_SOURCE_ORDER, fetchLatestBangDataset, getBangDatasetSource, sanitizeBangDatasetEntry, type BangDatasetEntry, type BangDatasetSourceId } from "./data/bang-datasets";
import { readLocalStorageItem, writeLocalStorageItem } from "./redirect/browser-storage";
import { ensureBangDataset, readBangDatasets, saveBangDataset, type BangDatasetMap } from "./redirect/dataset-cache";
import { mergeBangDatasets, type MergedBangDataset } from "./redirect/dataset-merge";
import { DEFAULT_BANG_TRIGGER, DEFAULT_ENGINE, isDefaultEngine, STATE_STORAGE_KEY } from "./redirect/constants";
import { ensureRedirectIndex } from "./redirect/index-cache";
import { logNonFatalError } from "./redirect/non-fatal";
import { resetLocalData } from "./redirect/reset";
import { presetToBangSourceConfig as presetToSourceConfig, readBangSourceConfig, saveBangSourceConfig, sourceConfigToBangSourcePreset as sourceConfigToPreset, type BangSourceConfig, type BangSourcePreset } from "./redirect/source-config";
import type { DefaultEngine } from "./redirect/types";
import { sanitizeOptionalText, sanitizeToken } from "./redirect/sanitize";
import { checkForEditorServiceWorkerUpdate } from "./service-worker-registration";
import { decodeSharePayloadFromHash, encodeSharePayloadToHashToken, extractShareTokenFromHash } from "./share-url";
import { buildHashSearchTemplateUrl } from "./search-url";
import { fetchAppVersionSnapshot, type AppVersionSnapshot } from "./version";
import { cn } from "./lib/cn";

type Bang = BangDatasetEntry;

type BangOverride = {
  disabled: true;
};

type CustomBang = Bang & {
  id: string;
  disabled?: boolean;
};

type State = {
  overrides: Record<string, BangOverride>;
  custom: CustomBang[];
  settings: {
    defaultEngine: DefaultEngine;
    defaultBangTrigger: string;
  };
};

type RowKind = "original" | "custom" | "disabled";

type BangRow = {
  rowId: string;
  bang: Bang;
  trigger: string;
  kind: RowKind;
  source: "base" | "custom";
};

type FallbackBangOption = {
  rowId: string;
  trigger: string;
  aliases: string[];
  name: string;
  domain: string;
};

type FilterKind = "all" | "custom" | "disabled";

type VisibleColumns = {
  showName: boolean;
  showDomain: boolean;
  showAliases: boolean;
  showStatus: boolean;
  count: number;
};

type MessageTone = "default" | "danger";

type MessageDialogOptions = {
  title: string;
  body: string;
  isConfirm: boolean;
  tone?: MessageTone;
  okLabel?: string;
  cancelLabel?: string;
};

type MessageDialogState = {
  title: string;
  body: string;
  isConfirm: boolean;
  tone: MessageTone;
  okLabel: string;
  cancelLabel: string;
};

type EditorMode = { mode: "create" } | { mode: "duplicate" } | { mode: "custom"; customId: string };

type EditorFormState = {
  t: string;
  s: string;
  d: string;
  u: string;
  ts: string;
  c: string;
  sc: string;
  x: string;
  fmt: string;
};

type BootStatus = "loading" | "ready" | "error";
type BrowserHelpTab = "chrome" | "firefox" | "brave" | "safari";

type ShareCustomBangPayload = {
  i?: string;
  t?: string;
  s?: string;
  d?: string;
  u?: string;
  ts?: string[];
  c?: string;
  sc?: string;
  x?: string;
  f?: string[];
  dis?: 1;
};

type SharePayloadV1 = {
  v: 1;
  p: BangSourcePreset;
  e: DefaultEngine;
  b: string;
  d: string[];
  c: ShareCustomBangPayload[];
};

type ShareImportSummaryScope = "absolute" | "delta";

type ShareImportSummaryOverview = {
  absolute: string[];
  delta: string[];
};

type ShareImportSummarySection = {
  scope: ShareImportSummaryScope;
  title: string;
  items: string[];
};

type ShareImportSummary = {
  overview: ShareImportSummaryOverview;
  sections: ShareImportSummarySection[];
};

type PendingShareImport = {
  payload: SharePayloadV1;
  nextPreset: BangSourcePreset;
  nextStateCandidate: State;
  summary: ShareImportSummary;
  encoding: "compressed" | "raw";
};

type ToastItem = {
  id: number;
  message: string;
  isEntering: boolean;
  isLeaving: boolean;
};

type HelpBrowserValue = {
  label: string;
  value: string;
  copyLabel: string;
};

type HelpBrowserLink = {
  label: string;
  href: string;
};

type HelpBrowserContent = {
  title: string;
  values: HelpBrowserValue[];
  steps: ReactNode[];
  links: HelpBrowserLink[];
  note?: ReactNode;
};

type IconName = "edit" | "duplicate" | "disable" | "enable" | "restore" | "delete" | "copy" | "info" | "back" | "add" | "share";

const DEFAULT_STATE: State = {
  overrides: {},
  custom: [],
  settings: {
    defaultEngine: DEFAULT_ENGINE,
    defaultBangTrigger: DEFAULT_BANG_TRIGGER,
  },
};

const DEFAULT_ENGINES: Record<DefaultEngine, { label: string }> = {
  google: { label: "Google" },
  ddg: { label: "DuckDuckGo" },
  bing: { label: "Bing" },
  kagi: { label: "Kagi" },
  brave: { label: "Brave" },
  bang: { label: "Custom Bang" },
};

const EMPTY_EDITOR_FORM: EditorFormState = {
  t: "",
  s: "",
  d: "",
  u: "",
  ts: "",
  c: "",
  sc: "",
  x: "",
  fmt: "",
};

const MAX_CUSTOM_BANGS = 2000;
const MAX_OVERRIDES = 20000;
const VIRTUAL_OVERSCAN = 14;
const INITIAL_ROW_HEIGHT = 58;
const MAX_TOASTS = 6;
const TOAST_VISIBLE_MS = 2200;
const TOAST_EXIT_MS = 220;

const FILTER_OPTIONS: ReadonlyArray<{ value: FilterKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "disabled", label: "Disabled" },
];

const PRESET_LABELS: Record<BangSourcePreset, string> = {
  kagi: "Kagi",
  "kagi-internal": "Kagi + Kagi Internal",
  ddg: "DuckDuckGo",
};

const CODE_CHIP_BASE_CLASS = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-[#d8dde3] bg-[#f4f6f8] px-1.5 py-0.5";
const SEARCH_URL_CODE_CHIP_CLASS = `${CODE_CHIP_BASE_CLASS} w-fit max-w-[min(100%,72ch)]`;
const HELP_VALUE_CODE_CHIP_CLASS = CODE_CHIP_BASE_CLASS;
const HELP_INLINE_CODE_CHIP_CLASS = "inline-block rounded-md border border-[#d8dde3] bg-[#f4f6f8] px-1.5 py-0.5";

const HELP_BROWSER_TABS: ReadonlyArray<{ id: BrowserHelpTab; label: string }> = [
  { id: "chrome", label: "Chrome" },
  { id: "firefox", label: "Firefox" },
  { id: "brave", label: "Brave" },
  { id: "safari", label: "Safari" },
];

function detectPreferredBrowserHelpTab(): BrowserHelpTab {
  if (typeof navigator === "undefined") return "chrome";

  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("firefox")) return "firefox";

  const navigatorWithBrave = navigator as Navigator & {
    brave?: unknown;
  };
  if (navigatorWithBrave.brave) return "brave";
  if (userAgent.includes("brave")) return "brave";

  const isSafari = userAgent.includes("safari") && !userAgent.includes("chrome") && !userAgent.includes("chromium") && !userAgent.includes("crios") && !userAgent.includes("edg") && !userAgent.includes("opr") && !userAgent.includes("brave");
  if (isSafari) return "safari";

  return "chrome";
}

function normalizeTrigger(value: string): string {
  return value.trim().toLowerCase();
}

function createCustomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `c_${crypto.randomUUID()}`;
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function splitCsv(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  return items.length > 0 ? items : undefined;
}

function nullable(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formToBang(input: EditorFormState): Bang {
  return {
    t: normalizeTrigger(input.t),
    s: input.s.trim(),
    d: input.d.trim(),
    u: input.u.trim(),
    ts: splitCsv(input.ts),
    c: nullable(input.c),
    sc: nullable(input.sc),
    x: nullable(input.x),
    fmt: splitCsv(input.fmt),
  };
}

function sanitizeBangEntry(raw: unknown): Bang | null {
  return sanitizeBangDatasetEntry(raw);
}

function sanitizeBangOverride(raw: unknown): BangOverride | null {
  if (!isPlainObject(raw)) return null;
  return raw.disabled === true ? { disabled: true } : null;
}

function sanitizeCustomId(value: unknown): string | null {
  return sanitizeOptionalText(value, 120) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeBaseBangs(rawBangs: readonly Bang[]): Bang[] {
  const byTrigger = new Map<string, Bang>();
  for (const raw of rawBangs) {
    const sanitized = sanitizeBangEntry(raw);
    if (!sanitized) continue;
    byTrigger.set(sanitized.t, sanitized);
  }
  return [...byTrigger.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function toBaseByTriggerMap(bangs: readonly Bang[]): Map<string, Bang> {
  const map = new Map<string, Bang>();
  for (const bang of bangs) {
    map.set(bang.t, bang);
  }
  return map;
}

function sanitizeState(candidate: unknown, baseByTrigger: ReadonlyMap<string, Bang>): State {
  if (!isPlainObject(candidate)) {
    return structuredClone(DEFAULT_STATE);
  }

  const overrides: Record<string, BangOverride> = {};
  if (isPlainObject(candidate.overrides)) {
    for (const [rawTrigger, rawPatch] of Object.entries(candidate.overrides).slice(0, MAX_OVERRIDES)) {
      const trigger = sanitizeToken(rawTrigger);
      if (!trigger) continue;
      const override = sanitizeBangOverride(rawPatch);
      if (!override) continue;
      overrides[trigger] = override;
    }
  }

  const custom: CustomBang[] = [];
  const seenCustomIds = new Set<string>();
  if (Array.isArray(candidate.custom)) {
    for (const entry of candidate.custom.slice(0, MAX_CUSTOM_BANGS)) {
      const bang = sanitizeBangEntry(entry);
      if (!bang) continue;

      const entryObj = isPlainObject(entry) ? entry : {};
      let id = sanitizeCustomId(entryObj.id) ?? createCustomId();
      while (seenCustomIds.has(id)) {
        id = createCustomId();
      }
      seenCustomIds.add(id);

      const legacyOverride = overrides[bang.t];
      const isLegacyDisabled = legacyOverride?.disabled === true && !baseByTrigger.has(bang.t);

      custom.push({
        ...bang,
        id,
        disabled: entryObj.disabled === true || isLegacyDisabled,
      });
    }
  }

  const settingsObj = isPlainObject(candidate.settings) ? candidate.settings : {};
  const defaultEngine = isDefaultEngine(settingsObj.defaultEngine) ? settingsObj.defaultEngine : DEFAULT_STATE.settings.defaultEngine;
  const defaultBangTrigger = sanitizeToken(settingsObj.defaultBangTrigger) ?? DEFAULT_STATE.settings.defaultBangTrigger;

  return {
    overrides,
    custom,
    settings: {
      defaultEngine,
      defaultBangTrigger,
    },
  };
}

function isBangSourcePreset(value: unknown): value is BangSourcePreset {
  return value === "kagi" || value === "kagi-internal" || value === "ddg";
}

function toDisabledBaseTriggers(state: State): string[] {
  return Object.entries(state.overrides)
    .filter(([, value]) => value?.disabled === true)
    .map(([trigger]) => trigger)
    .sort((left, right) => left.localeCompare(right));
}

function canonicalTokenList(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const set = new Set<string>();
  for (const value of values) {
    const token = sanitizeToken(value);
    if (token) set.add(token);
  }
  if (set.size === 0) return undefined;
  return [...set].sort((left, right) => left.localeCompare(right));
}

function stateToSharePayload(state: State, preset: BangSourcePreset, baseByTrigger: ReadonlyMap<string, Bang> | null = null): SharePayloadV1 {
  const disabledBaseTriggers = toDisabledBaseTriggers(state).filter((trigger) => (baseByTrigger ? baseByTrigger.has(trigger) : true));

  const custom = state.custom.map((entry): ShareCustomBangPayload => {
    const payload: ShareCustomBangPayload = {
      t: entry.t,
      s: entry.s,
      d: entry.d,
      u: entry.u,
    };

    const aliases = canonicalTokenList(entry.ts);
    if (aliases) payload.ts = aliases;
    if (entry.c) payload.c = entry.c;
    if (entry.sc) payload.sc = entry.sc;
    if (entry.x) payload.x = entry.x;
    if (entry.fmt && entry.fmt.length > 0) {
      payload.f = [...entry.fmt];
    }
    if (entry.disabled) payload.dis = 1;

    return payload;
  });

  return {
    v: 1,
    p: preset,
    e: state.settings.defaultEngine,
    b: state.settings.defaultBangTrigger,
    d: disabledBaseTriggers,
    c: custom,
  };
}

function parseSharePayload(candidate: unknown):
  | {
      ok: true;
      payload: SharePayloadV1;
      nextPreset: BangSourcePreset;
      nextStateCandidate: State;
    }
  | {
      ok: false;
      reason: string;
    } {
  if (!isPlainObject(candidate)) {
    return { ok: false, reason: "Shared settings payload must be an object." };
  }

  if (candidate.v !== 1) {
    return { ok: false, reason: "Shared settings version is not supported." };
  }

  const nextPreset = isBangSourcePreset(candidate.p) ? candidate.p : "ddg";
  const defaultEngine = isDefaultEngine(candidate.e) ? candidate.e : DEFAULT_STATE.settings.defaultEngine;
  const defaultBangTrigger = sanitizeToken(candidate.b) ?? DEFAULT_STATE.settings.defaultBangTrigger;

  const disabledSet = new Set<string>();
  if (Array.isArray(candidate.d)) {
    for (const value of candidate.d.slice(0, MAX_OVERRIDES)) {
      const token = sanitizeToken(value);
      if (token) disabledSet.add(token);
    }
  }

  const overrides: Record<string, BangOverride> = {};
  for (const token of disabledSet) {
    overrides[token] = { disabled: true };
  }

  const custom: CustomBang[] = [];
  const seenCustomIds = new Set<string>();
  if (Array.isArray(candidate.c)) {
    for (const rawEntry of candidate.c.slice(0, MAX_CUSTOM_BANGS)) {
      if (!isPlainObject(rawEntry)) continue;
      const entry = rawEntry as ShareCustomBangPayload;

      const bang = sanitizeBangEntry({
        t: entry.t,
        s: entry.s,
        d: entry.d,
        u: entry.u,
        ts: Array.isArray(entry.ts) ? entry.ts : undefined,
        c: entry.c,
        sc: entry.sc,
        x: entry.x,
        fmt: Array.isArray(entry.f) ? entry.f : undefined,
      });
      if (!bang) continue;

      let id = sanitizeCustomId(entry.i) ?? createCustomId();
      while (seenCustomIds.has(id)) {
        id = createCustomId();
      }
      seenCustomIds.add(id);

      custom.push({
        ...bang,
        id,
        disabled: entry.dis === 1,
      });
    }
  }

  const nextStateCandidate: State = {
    overrides,
    custom,
    settings: {
      defaultEngine,
      defaultBangTrigger,
    },
  };

  return {
    ok: true,
    payload: stateToSharePayload(nextStateCandidate, nextPreset),
    nextPreset,
    nextStateCandidate,
  };
}

function customBangSignature(bang: CustomBang): string {
  return JSON.stringify({
    t: bang.t,
    s: bang.s,
    d: bang.d,
    u: bang.u,
    ts: bang.ts ?? [],
    c: bang.c ?? "",
    sc: bang.sc ?? "",
    x: bang.x ?? "",
    f: bang.fmt ?? [],
    dis: bang.disabled === true,
  });
}

function formatCustomBangSummaryLine(bang: CustomBang): string {
  const disabledSuffix = bang.disabled ? " [disabled]" : "";
  return `!${bang.t} (${bang.s})${disabledSuffix}`;
}

function buildShareImportSummary(currentPreset: BangSourcePreset, currentState: State, nextPreset: BangSourcePreset, nextState: State): ShareImportSummary {
  const overviewAbsolute: string[] = ["This import replaces all local settings in this browser.", `Base set: ${PRESET_LABELS[nextPreset]}`, `Default search: ${DEFAULT_ENGINES[nextState.settings.defaultEngine].label}`];
  const overviewDelta: string[] = ["This import replaces all local settings in this browser.", `Base set: ${PRESET_LABELS[currentPreset]} → ${PRESET_LABELS[nextPreset]}`, `Default search: ${DEFAULT_ENGINES[currentState.settings.defaultEngine].label} → ${DEFAULT_ENGINES[nextState.settings.defaultEngine].label}`];

  if (currentState.settings.defaultBangTrigger !== nextState.settings.defaultBangTrigger || nextState.settings.defaultEngine === "bang" || currentState.settings.defaultEngine === "bang") {
    overviewAbsolute.push(`Fallback bang: !${nextState.settings.defaultBangTrigger}`);
    overviewDelta.push(`Fallback bang: !${currentState.settings.defaultBangTrigger} → !${nextState.settings.defaultBangTrigger}`);
  }

  const sections: ShareImportSummarySection[] = [];

  const currentDisabled = new Set(toDisabledBaseTriggers(currentState));
  const nextDisabled = new Set(toDisabledBaseTriggers(nextState));

  const newlyDisabled = [...nextDisabled].filter((trigger) => !currentDisabled.has(trigger)).sort((left, right) => left.localeCompare(right));
  const reEnabled = [...currentDisabled].filter((trigger) => !nextDisabled.has(trigger)).sort((left, right) => left.localeCompare(right));

  const currentCustomByTrigger = new Map<string, CustomBang>();
  for (const entry of currentState.custom) {
    currentCustomByTrigger.set(entry.t, entry);
  }
  const nextCustomByTrigger = new Map<string, CustomBang>();
  for (const entry of nextState.custom) {
    nextCustomByTrigger.set(entry.t, entry);
  }

  const addedCustom: CustomBang[] = [];
  const updatedCustom: Array<{ previous: CustomBang; next: CustomBang }> = [];
  const removedCustom: CustomBang[] = [];

  for (const [trigger, next] of nextCustomByTrigger) {
    const current = currentCustomByTrigger.get(trigger);
    if (!current) {
      addedCustom.push(next);
      continue;
    }
    if (customBangSignature(current) !== customBangSignature(next)) {
      updatedCustom.push({ previous: current, next });
    }
  }

  for (const [trigger, current] of currentCustomByTrigger) {
    if (!nextCustomByTrigger.has(trigger)) {
      removedCustom.push(current);
    }
  }

  addedCustom.sort((left, right) => left.t.localeCompare(right.t));
  updatedCustom.sort((left, right) => left.next.t.localeCompare(right.next.t));
  removedCustom.sort((left, right) => left.t.localeCompare(right.t));

  sections.push({
    scope: "absolute",
    title: `Custom bangs (${nextState.custom.length})`,
    items: [...nextState.custom].sort((left, right) => left.t.localeCompare(right.t)).map((entry) => formatCustomBangSummaryLine(entry)),
  });

  if (addedCustom.length > 0) {
    sections.push({
      scope: "delta",
      title: `New custom bangs (${addedCustom.length})`,
      items: addedCustom.map((entry) => formatCustomBangSummaryLine(entry)),
    });
  }

  if (updatedCustom.length > 0) {
    sections.push({
      scope: "delta",
      title: `Updated custom bangs (${updatedCustom.length})`,
      items: updatedCustom.map(({ previous, next }) => {
        const fromDisabled = previous.disabled ? " [disabled]" : "";
        const toDisabled = next.disabled ? " [disabled]" : "";
        return `!${next.t} (${previous.s}${fromDisabled} → ${next.s}${toDisabled})`;
      }),
    });
  }

  if (removedCustom.length > 0) {
    sections.push({
      scope: "delta",
      title: `Custom bangs to remove (${removedCustom.length})`,
      items: removedCustom.map((entry) => formatCustomBangSummaryLine(entry)),
    });
  }

  sections.push({
    scope: "absolute",
    title: `Disabled base bangs (${nextDisabled.size})`,
    items: [...nextDisabled].sort((left, right) => left.localeCompare(right)).map((trigger) => `!${trigger}`),
  });
  if (newlyDisabled.length > 0) {
    sections.push({
      scope: "delta",
      title: `Disabled base bangs (${newlyDisabled.length})`,
      items: newlyDisabled.map((trigger) => `!${trigger}`),
    });
  }
  if (reEnabled.length > 0) {
    sections.push({
      scope: "delta",
      title: `Base bangs to re-enable (${reEnabled.length})`,
      items: reEnabled.map((trigger) => `!${trigger}`),
    });
  }

  return {
    overview: {
      absolute: overviewAbsolute,
      delta: overviewDelta,
    },
    sections,
  };
}

function buildShareUrl(hashToken: string): string {
  const root = new URL(import.meta.env.BASE_URL, window.location.origin);
  root.hash = hashToken;
  return root.toString();
}

function clearShareHashFromUrl(): void {
  const token = extractShareTokenFromHash(window.location.hash);
  if (!token) return;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}

function loadState(baseByTrigger: ReadonlyMap<string, Bang>): State {
  try {
    const raw = readLocalStorageItem(STATE_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeState(parsed, baseByTrigger);
  } catch (error) {
    logNonFatalError("Failed to parse local state; using defaults", error);
    return structuredClone(DEFAULT_STATE);
  }
}

function bangTokenSet(bang: Pick<Bang, "t" | "ts">): Set<string> {
  const tokens = new Set<string>();
  const trigger = normalizeTrigger(bang.t);
  if (trigger) tokens.add(trigger);
  for (const alias of bang.ts ?? []) {
    const normalized = normalizeTrigger(alias);
    if (normalized) tokens.add(normalized);
  }
  return tokens;
}

function computeRows(baseBangs: readonly Bang[], currentState: State): BangRow[] {
  const rows: BangRow[] = [];

  for (const base of baseBangs) {
    const isDisabled = currentState.overrides[base.t]?.disabled === true;
    rows.push({
      rowId: `base:${base.t}`,
      bang: base,
      trigger: base.t,
      kind: isDisabled ? "disabled" : "original",
      source: "base",
    });
  }

  for (const custom of currentState.custom) {
    rows.push({
      rowId: custom.id,
      bang: custom,
      trigger: custom.t,
      kind: custom.disabled ? "disabled" : "custom",
      source: "custom",
    });
  }

  rows.sort((a, b) => a.trigger.localeCompare(b.trigger) || a.rowId.localeCompare(b.rowId));
  return rows;
}

function reconcileCustomPriorityConflicts(currentState: State, baseBangs: readonly Bang[]): State {
  const customTokens = new Set<string>();
  for (const custom of currentState.custom) {
    if (custom.disabled) continue;
    for (const token of bangTokenSet(custom)) {
      customTokens.add(token);
    }
  }

  if (customTokens.size === 0) return currentState;

  let nextOverrides = currentState.overrides;
  let changed = false;

  for (const base of baseBangs) {
    if (nextOverrides[base.t]?.disabled === true) continue;

    const baseTokens = bangTokenSet(base);
    const hasConflict = [...baseTokens].some((token) => customTokens.has(token));
    if (!hasConflict) continue;

    if (!changed) {
      nextOverrides = { ...nextOverrides };
      changed = true;
    }
    nextOverrides[base.t] = { disabled: true };
  }

  if (!changed) return currentState;
  return {
    ...currentState,
    overrides: nextOverrides,
  };
}

async function ensureSourceDatasets(
  sourceIds: readonly BangDatasetSourceId[],
  currentDatasets: BangDatasetMap,
  datasetVersions: Partial<Record<BangDatasetSourceId, { hash: string }>> | null,
): Promise<{
  datasets: BangDatasetMap;
  failed: BangDatasetSourceId[];
  errors: Partial<Record<BangDatasetSourceId, string>>;
}> {
  const datasets: BangDatasetMap = { ...currentDatasets };
  const failed: BangDatasetSourceId[] = [];
  const errors: Partial<Record<BangDatasetSourceId, string>> = {};

  for (const sourceId of sourceIds) {
    const current = datasets[sourceId];
    const versionSource = datasetVersions?.[sourceId];
    const shouldRefresh = !current || (versionSource ? current.hash !== versionSource.hash : false);
    if (!shouldRefresh) continue;

    try {
      const latest = current ? await fetchLatestBangDataset(sourceId) : await ensureBangDataset(sourceId);
      datasets[sourceId] = await saveBangDataset(latest);
    } catch (error) {
      if (!current) {
        failed.push(sourceId);
      }
      errors[sourceId] = error instanceof Error ? error.message : String(error);
    }
  }

  return { datasets, failed, errors };
}

function parseRankQuery(raw: string): { query: string; isBangQuery: boolean } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { query: "", isBangQuery: false };
  const isBangQuery = trimmed.startsWith("!");
  const query = isBangQuery ? normalizeTrigger(trimmed.replace(/^!+/, "")) : trimmed;
  return { query, isBangQuery };
}

function scoreTextMatch(query: string, value: string | undefined, weights: { exact: number; prefix: number; contains: number; minContainsLength: number }): number {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (normalized === query) return weights.exact;
  if (normalized.startsWith(query)) return weights.prefix;
  if (query.length >= weights.minContainsLength && normalized.includes(query)) return weights.contains;
  return 0;
}

function scoreTriggerAliasMatch(query: string, trigger: string, aliases: string[], isBangQuery: boolean): number {
  const values = [trigger, ...aliases].map(normalizeTrigger);
  let best = 0;

  for (const value of values) {
    if (value === query) {
      const exactScore = 1500 - Math.min(220, value.length);
      best = Math.max(best, exactScore);
      continue;
    }

    if (value.startsWith(query)) {
      const prefixPenalty = Math.max(0, value.length - query.length);
      const prefixScore = 1200 - Math.min(260, prefixPenalty * 8);
      best = Math.max(best, prefixScore);
      continue;
    }

    const allowContains = query.length >= (isBangQuery ? 3 : 2);
    if (!allowContains) continue;
    if (!value.includes(query)) continue;

    const containsPenalty = value.indexOf(query) * 5 + Math.max(0, value.length - query.length);
    const containsBase = isBangQuery ? 520 : 760;
    const containsScore = containsBase - Math.min(260, containsPenalty);
    best = Math.max(best, containsScore);
  }

  return best;
}

function scoreFallbackOption(option: FallbackBangOption, rawQuery: string): number {
  const { query, isBangQuery } = parseRankQuery(rawQuery);
  if (!query) return 1;

  const triggerAliasScore = scoreTriggerAliasMatch(query, option.trigger, option.aliases, isBangQuery);
  if (isBangQuery) return triggerAliasScore;

  let score = triggerAliasScore;
  score = Math.max(score, scoreTextMatch(query, option.name, { exact: 700, prefix: 540, contains: 360, minContainsLength: 2 }));
  score = Math.max(score, scoreTextMatch(query, option.domain, { exact: 680, prefix: 520, contains: 340, minContainsLength: 2 }));
  return score;
}

function scoreRowForEditorSearch(row: BangRow, rawQuery: string): number {
  const { query, isBangQuery } = parseRankQuery(rawQuery);
  if (!query) return 1;

  const aliases = row.bang.ts ?? [];
  const triggerAliasScore = scoreTriggerAliasMatch(query, row.bang.t, aliases, isBangQuery);
  if (isBangQuery) return triggerAliasScore;

  let score = triggerAliasScore;
  score = Math.max(score, scoreTextMatch(query, row.bang.s, { exact: 700, prefix: 540, contains: 360, minContainsLength: 2 }));
  score = Math.max(score, scoreTextMatch(query, row.bang.d, { exact: 680, prefix: 520, contains: 340, minContainsLength: 2 }));
  score = Math.max(score, scoreTextMatch(query, row.bang.c, { exact: 500, prefix: 360, contains: 220, minContainsLength: 2 }));
  score = Math.max(score, scoreTextMatch(query, row.bang.sc, { exact: 460, prefix: 320, contains: 200, minContainsLength: 2 }));
  score = Math.max(score, scoreTextMatch(query, row.bang.u, { exact: 420, prefix: 280, contains: 140, minContainsLength: 3 }));

  return score;
}

function buildFallbackOptions(rows: readonly BangRow[]): FallbackBangOption[] {
  const byTrigger = new Map<string, FallbackBangOption>();
  for (const row of rows) {
    if (row.kind === "disabled") continue;
    byTrigger.set(row.bang.t, {
      rowId: row.rowId,
      trigger: row.bang.t,
      aliases: row.bang.ts ?? [],
      name: row.bang.s,
      domain: row.bang.d,
    });
  }
  return [...byTrigger.values()].sort((a, b) => a.trigger.localeCompare(b.trigger));
}

function formatFallbackBangLabel(option: FallbackBangOption): string {
  return `!${option.trigger} - ${option.name}`;
}

function parseFallbackToken(raw: string): string | null {
  const match = raw.trim().match(/!?\s*([^\s]+)/u);
  if (!match) return null;
  return normalizeTrigger(match[1]);
}

function findFallbackOptionByToken(options: readonly FallbackBangOption[], token: string | null): FallbackBangOption | null {
  if (!token) return null;
  for (const option of options) {
    if (option.trigger === token || option.aliases.includes(token)) {
      return option;
    }
  }
  return null;
}

function duplicateTokensWithinBang(bang: Pick<Bang, "t" | "ts">): string[] {
  const counts = new Map<string, number>();
  const tokens = [bang.t, ...(bang.ts ?? [])].map(normalizeTrigger).filter(Boolean);
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token);
}

function findDuplicateConflictsForState(candidate: Pick<Bang, "t" | "ts">, currentState: State, baseBangs: readonly Bang[], excludedRowIds: Set<string> = new Set()): Array<{ row: BangRow; matchedTokens: string[] }> {
  const candidateTokens = [...bangTokenSet(candidate)];
  if (candidateTokens.length === 0) return [];

  const conflicts: Array<{ row: BangRow; matchedTokens: string[] }> = [];
  for (const row of computeRows(baseBangs, currentState)) {
    if (row.kind === "disabled") continue;
    if (excludedRowIds.has(row.rowId)) continue;
    const rowTokenSet = bangTokenSet(row.bang);
    const matchedTokens = candidateTokens.filter((token) => rowTokenSet.has(token));
    if (matchedTokens.length > 0) {
      conflicts.push({ row, matchedTokens });
    }
  }

  conflicts.sort((a, b) => a.row.trigger.localeCompare(b.row.trigger) || a.row.rowId.localeCompare(b.row.rowId));
  return conflicts;
}

function disableRowsInState(currentState: State, rows: readonly BangRow[]): State {
  if (rows.length === 0) return currentState;

  let overrides = currentState.overrides;
  let custom = currentState.custom;
  let overridesChanged = false;
  let customChanged = false;

  for (const row of rows) {
    if (row.source === "base") {
      if (overrides[row.trigger]?.disabled === true) continue;
      if (!overridesChanged) {
        overrides = { ...overrides };
        overridesChanged = true;
      }
      overrides[row.trigger] = { disabled: true };
      continue;
    }

    const index = custom.findIndex((entry) => entry.id === row.rowId);
    if (index < 0) continue;
    if (custom[index].disabled === true) continue;
    if (!customChanged) {
      custom = [...custom];
      customChanged = true;
    }
    custom[index] = { ...custom[index], disabled: true };
  }

  if (!overridesChanged && !customChanged) return currentState;
  return {
    ...currentState,
    overrides,
    custom,
  };
}

function formatConflictsForDialog(intro: string, conflicts: Array<{ row: BangRow; matchedTokens: string[] }>, maxLines = 6): string {
  const lines = conflicts.slice(0, maxLines).map((conflict) => {
    const matches = conflict.matchedTokens.map((token) => `!${token}`).join(", ");
    return `• !${conflict.row.bang.t} (${conflict.row.bang.s}) - matches ${matches}`;
  });

  if (conflicts.length > maxLines) {
    lines.push(`• +${conflicts.length - maxLines} more`);
  }

  return `${intro}\n${lines.join("\n")}`;
}

function computeVisibleColumns(width: number): VisibleColumns {
  if (width <= 0) {
    return {
      // Fail-safe before layout is measured: keep only trigger + actions visible.
      showName: false,
      showDomain: false,
      showAliases: false,
      showStatus: false,
      count: 2,
    };
  }

  const triggerMin = 120;
  const actionsWidth = 168;
  const statusWidth = 120;
  const nameWidth = 180;
  const domainWidth = 210;
  const aliasesWidth = 178;

  const available = Math.max(0, Math.floor(width) - 20);
  let used = triggerMin + actionsWidth;

  let showStatus = false;
  let showName = false;
  let showDomain = false;
  let showAliases = false;

  if (available >= used + statusWidth) {
    showStatus = true;
    used += statusWidth;
    if (available >= used + nameWidth) {
      showName = true;
      used += nameWidth;
      if (available >= used + domainWidth) {
        showDomain = true;
        used += domainWidth;
        if (available >= used + aliasesWidth) {
          showAliases = true;
        }
      }
    }
  }

  return {
    showName,
    showDomain,
    showAliases,
    showStatus,
    count: 2 + Number(showStatus) + Number(showName) + Number(showDomain) + Number(showAliases),
  };
}

function iconVariantClass(icon: IconName): string {
  switch (icon) {
    case "disable":
      return "btn-warning";
    case "enable":
      return "btn-success";
    case "delete":
      return "btn-danger";
    default:
      return "btn-subtle";
  }
}

const ICON_COMPONENT_BY_NAME: Record<IconName, ComponentType<IconProps>> = {
  edit: Edit2,
  duplicate: Copy,
  disable: EyeOff,
  enable: Eye,
  restore: RotateCcw,
  delete: Trash2,
  copy: Copy,
  info: Info,
  back: ArrowLeft,
  add: Plus,
  share: Share2,
};

function renderTooltipText(target: HTMLElement, text: string): void {
  target.textContent = "";
  const lines = text.split("\n");

  lines.forEach((line, lineIndex) => {
    const parts = line.split(/(`[^`]*`)/g);
    for (const part of parts) {
      const isCode = part.startsWith("`") && part.endsWith("`") && part.length >= 2;
      if (isCode) {
        const code = document.createElement("code");
        code.textContent = part.slice(1, -1);
        target.appendChild(code);
      } else if (part.length > 0) {
        target.appendChild(document.createTextNode(part));
      }
    }

    if (lineIndex < lines.length - 1) {
      target.appendChild(document.createElement("br"));
    }
  });
}

function renderMessageBody(body: string): ReactNode {
  const rawLines = body.split("\n").map((line) => line.trim());
  const nonEmptyLines = rawLines.filter((line) => line.length > 0);
  if (nonEmptyLines.length === 0) return null;

  const firstBulletIndex = nonEmptyLines.findIndex((line) => line.startsWith("• "));
  if (firstBulletIndex < 0) {
    return <p className="m-0 whitespace-pre-line leading-[1.45] text-app-muted">{body}</p>;
  }

  const introLines = nonEmptyLines.slice(0, firstBulletIndex);
  const bulletLines = nonEmptyLines.slice(firstBulletIndex);

  return (
    <>
      {introLines.length > 0 ? <p className="m-0 whitespace-pre-line leading-[1.45] text-app-muted">{introLines.join("\n")}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {bulletLines
          .filter((line) => line.startsWith("• "))
          .map((line, index) => {
            const content = line.slice(2);
            const moreMatch = content.match(/^\+(\d+)\s+more$/);
            if (moreMatch) {
              return (
                <li key={`more-${index}`} className="message-body-item is-more rounded-lg border border-[#d8dce4] border-l-4 border-l-[#bbc7d8] bg-[#f8fafc] px-2.5 py-2 leading-[1.35] text-app-muted">
                  +{moreMatch[1]} more
                </li>
              );
            }

            const match = content.match(/^!([^\s]+)\s+\((.+)\)\s+-\s+matches\s+(.+)$/);
            if (!match) {
              return (
                <li key={`plain-${index}`} className="message-body-item rounded-lg border border-[#d8dce4] border-l-4 border-l-[#bbc7d8] bg-[#f8fafc] px-2.5 py-2 leading-[1.35] text-app-ink">
                  {content}
                </li>
              );
            }

            return (
              <li key={`match-${index}`} className="message-body-item rounded-lg border border-[#d8dce4] border-l-4 border-l-[#bbc7d8] bg-[#f8fafc] px-2.5 py-2 leading-[1.35] text-app-ink">
                <div className="font-semibold">
                  !{match[1]} ({match[2]})
                </div>
                <div className="mt-0.5 text-[0.85rem] text-app-muted">Matches: {match[3]}</div>
              </li>
            );
          })}
      </ul>
    </>
  );
}

function useGlobalTooltips(): void {
  useEffect(() => {
    const tooltip = document.createElement("div");
    tooltip.className = "global-tooltip";
    document.body.appendChild(tooltip);

    const controller = new AbortController();
    const { signal } = controller;
    let activeTarget: HTMLElement | null = null;

    const hide = (): void => {
      tooltip.classList.remove("is-visible");
      activeTarget = null;
    };

    const position = (target: HTMLElement): void => {
      const rect = target.getBoundingClientRect();
      const margin = 8;
      const offset = 10;

      const tooltipRect = tooltip.getBoundingClientRect();
      let left = rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

      let top = rect.bottom + offset;
      if (top + tooltipRect.height > window.innerHeight - margin) {
        top = rect.top - tooltipRect.height - offset;
      }

      tooltip.style.left = `${Math.round(left)}px`;
      tooltip.style.top = `${Math.round(top)}px`;
    };

    const ensureTooltipHost = (): void => {
      const openDialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
      const host: HTMLElement = openDialogs.length > 0 ? openDialogs[openDialogs.length - 1] : document.body;
      if (tooltip.parentElement !== host) {
        host.appendChild(tooltip);
      }
    };

    const show = (target: HTMLElement): void => {
      const text = target.dataset.tip;
      if (!text) return;
      ensureTooltipHost();
      activeTarget = target;
      tooltip.classList.toggle("is-action", target.classList.contains("action-icon"));
      renderTooltipText(tooltip, text);
      tooltip.classList.add("is-visible");
      position(target);
    };

    const resolveTipTarget = (node: EventTarget | null): HTMLElement | null => {
      if (!(node instanceof Element)) return null;
      return node.closest<HTMLElement>("[data-tip]");
    };

    document.addEventListener(
      "pointerover",
      (event) => {
        const target = resolveTipTarget(event.target);
        if (!target || target === activeTarget) return;
        show(target);
      },
      { capture: true, signal },
    );

    document.addEventListener(
      "pointerout",
      (event) => {
        if (!activeTarget) return;
        const related = resolveTipTarget(event.relatedTarget);
        if (related === activeTarget) return;
        hide();
      },
      { capture: true, signal },
    );

    document.addEventListener("pointerdown", hide, { capture: true, signal });
    document.addEventListener("click", hide, { capture: true, signal });

    document.addEventListener(
      "focusin",
      (event) => {
        const target = resolveTipTarget(event.target);
        if (!target) return;
        show(target);
      },
      { capture: true, signal },
    );

    document.addEventListener(
      "focusout",
      (event) => {
        const target = resolveTipTarget(event.target);
        if (!target) return;
        hide();
      },
      { capture: true, signal },
    );

    window.addEventListener(
      "scroll",
      () => {
        if (activeTarget) position(activeTarget);
      },
      { capture: true, signal },
    );

    window.addEventListener(
      "resize",
      () => {
        if (activeTarget) position(activeTarget);
      },
      { signal },
    );

    window.addEventListener("blur", hide, { signal });

    return () => {
      controller.abort();
      tooltip.remove();
    };
  }, []);
}

function IconGlyph({ name }: { name: IconName }): ReactElement {
  const IconComponent = ICON_COMPONENT_BY_NAME[name];
  return <IconComponent aria-hidden="true" size={18} strokeWidth={2} />;
}

function BangsFastApp(): ReactElement {
  useGlobalTooltips();

  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [failedSources, setFailedSources] = useState<BangDatasetSourceId[]>([]);
  const [showBangLoadingOverlay, setShowBangLoadingOverlay] = useState(true);

  const [sourceConfig, setSourceConfig] = useState<BangSourceConfig>(() => readBangSourceConfig());
  const [sourceDatasets, setSourceDatasets] = useState<BangDatasetMap>({});
  const [baseBangs, setBaseBangs] = useState<Bang[]>([]);
  const [baseByTrigger, setBaseByTrigger] = useState<Map<string, Bang>>(new Map());
  const [state, setState] = useState<State>(() => loadState(new Map()));

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilterKind, setActiveFilterKind] = useState<FilterKind>("all");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia("(max-width: 960px)").matches);

  const [copyUrlSuccess, setCopyUrlSuccess] = useState(false);
  const copyUrlTimerRef = useRef(0);
  const [copyShareSuccess, setCopyShareSuccess] = useState(false);
  const copyShareTimerRef = useRef(0);
  const [isShareExporting, setIsShareExporting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isToastStackHovered, setIsToastStackHovered] = useState(false);
  const toastIdRef = useRef(0);
  const toastDismissTimerRef = useRef<Map<number, number>>(new Map());
  const toastRemovalTimerRef = useRef<Map<number, number>>(new Map());
  const toastDeadlineRef = useRef<Map<number, number>>(new Map());
  const toastRemainingRef = useRef<Map<number, number>>(new Map());
  const toastHoverRef = useRef(false);
  const toastsRef = useRef<ToastItem[]>([]);
  const [pendingShareImport, setPendingShareImport] = useState<PendingShareImport | null>(null);
  const [showShareImportDeltaOnly, setShowShareImportDeltaOnly] = useState(false);
  const shareImportDialogRef = useRef<HTMLDialogElement>(null);
  const shareImportCheckedRef = useRef(false);

  const [isSourcePresetUpdating, setIsSourcePresetUpdating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activeHelpBrowserTab, setActiveHelpBrowserTab] = useState<BrowserHelpTab>(() => detectPreferredBrowserHelpTab());
  const helpDialogRef = useRef<HTMLDialogElement>(null);

  const [messageDialog, setMessageDialog] = useState<MessageDialogState | null>(null);
  const messageDialogRef = useRef<HTMLDialogElement>(null);
  const messageResolverRef = useRef<((result: boolean) => void) | null>(null);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>({ mode: "create" });
  const [editorForm, setEditorForm] = useState<EditorFormState>(EMPTY_EDITOR_FORM);

  const [fallbackInput, setFallbackInput] = useState("");
  const [isFallbackOpen, setIsFallbackOpen] = useState(false);
  const fallbackCloseTimerRef = useRef(0);
  const fallbackWrapRef = useRef<HTMLDivElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pageRootRef = useRef<HTMLElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const [tableWidth, setTableWidth] = useState(0);
  const [tableHeight, setTableHeight] = useState(0);
  const [tableScrollTop, setTableScrollTop] = useState(0);

  const [rowHeight, setRowHeight] = useState(INITIAL_ROW_HEIGHT);
  const firstVirtualRowRef = useRef<HTMLTableRowElement | null>(null);

  const segmentedFilterRef = useRef<HTMLDivElement>(null);
  const segmentedButtonsRef = useRef<Record<FilterKind, HTMLButtonElement | null>>({
    all: null,
    custom: null,
    disabled: null,
  });
  const [segmentedIndicatorStyle, setSegmentedIndicatorStyle] = useState<CSSProperties>({ width: 0, transform: "translateX(0px)" });

  const customSearchUrl = useMemo(() => {
    const endpoint = new URL(import.meta.env.BASE_URL, window.location.origin);
    return buildHashSearchTemplateUrl(endpoint);
  }, []);

  const mountedRef = useRef(true);
  const bootstrapRunRef = useRef(0);

  const stateRef = useRef(state);
  const sourceConfigRef = useRef(sourceConfig);
  const sourceDatasetsRef = useRef(sourceDatasets);
  const baseBangsRef = useRef(baseBangs);
  const baseByTriggerRef = useRef(baseByTrigger);
  const mergedRef = useRef<MergedBangDataset | null>(null);
  const versionSnapshotRef = useRef<AppVersionSnapshot | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    sourceConfigRef.current = sourceConfig;
  }, [sourceConfig]);
  useEffect(() => {
    sourceDatasetsRef.current = sourceDatasets;
  }, [sourceDatasets]);
  useEffect(() => {
    baseBangsRef.current = baseBangs;
  }, [baseBangs]);
  useEffect(() => {
    baseByTriggerRef.current = baseByTrigger;
  }, [baseByTrigger]);
  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);
  useEffect(() => {
    if (toasts.length > 0) return;
    toastHoverRef.current = false;
    setIsToastStackHovered(false);
  }, [toasts]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (copyUrlTimerRef.current) {
        clearTimeout(copyUrlTimerRef.current);
      }
      if (copyShareTimerRef.current) {
        clearTimeout(copyShareTimerRef.current);
      }
      for (const timer of toastDismissTimerRef.current.values()) {
        clearTimeout(timer);
      }
      toastDismissTimerRef.current.clear();
      for (const timer of toastRemovalTimerRef.current.values()) {
        clearTimeout(timer);
      }
      toastRemovalTimerRef.current.clear();
      toastDeadlineRef.current.clear();
      toastRemainingRef.current.clear();
      if (fallbackCloseTimerRef.current) {
        clearTimeout(fallbackCloseTimerRef.current);
      }
    };
  }, []);

  const loadVersionSnapshot = useCallback(async (refresh: boolean): Promise<AppVersionSnapshot | null> => {
    if (!refresh && versionSnapshotRef.current) {
      return versionSnapshotRef.current;
    }

    try {
      const snapshot = await fetchAppVersionSnapshot();
      versionSnapshotRef.current = snapshot;
      return snapshot;
    } catch (error) {
      logNonFatalError("Failed to fetch app version snapshot", error);
      return versionSnapshotRef.current;
    }
  }, []);

  const persistState = useCallback((nextState: State): void => {
    stateRef.current = nextState;
    setState(nextState);

    const serialized = JSON.stringify(nextState);
    writeLocalStorageItem(STATE_STORAGE_KEY, serialized);

    const merged = mergedRef.current;
    if (merged) {
      void ensureRedirectIndex(serialized, merged.hash, merged.bangs);
    }
  }, []);

  const updateState = useCallback(
    (updater: State | ((previous: State) => State)): void => {
      const previous = stateRef.current;
      const next = typeof updater === "function" ? (updater as (value: State) => State)(previous) : updater;
      persistState(next);
    },
    [persistState],
  );

  const setBaseData = useCallback((rawBangs: readonly BangDatasetEntry[]): Bang[] => {
    const sanitized = sanitizeBaseBangs(rawBangs);
    const nextMap = toBaseByTriggerMap(sanitized);
    baseBangsRef.current = sanitized;
    baseByTriggerRef.current = nextMap;
    setBaseBangs(sanitized);
    setBaseByTrigger(nextMap);
    return sanitized;
  }, []);

  const openMessageDialog = useCallback((options: MessageDialogOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      if (messageResolverRef.current) {
        messageResolverRef.current(false);
      }

      messageResolverRef.current = resolve;
      setMessageDialog({
        title: options.title,
        body: options.body,
        isConfirm: options.isConfirm,
        tone: options.tone ?? "default",
        okLabel: options.okLabel ?? "OK",
        cancelLabel: options.cancelLabel ?? "Cancel",
      });
    });
  }, []);

  const closeMessageDialog = useCallback((result: boolean): void => {
    const resolve = messageResolverRef.current;
    messageResolverRef.current = null;
    setMessageDialog(null);
    resolve?.(result);
  }, []);

  const syncDialogOpen = useCallback((dialog: HTMLDialogElement | null, open: boolean): void => {
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, []);

  useEffect(() => {
    syncDialogOpen(helpDialogRef.current, isHelpOpen);
  }, [isHelpOpen, syncDialogOpen]);

  useEffect(() => {
    if (!isHelpOpen) return;
    setActiveHelpBrowserTab(detectPreferredBrowserHelpTab());
  }, [isHelpOpen]);

  useEffect(() => {
    syncDialogOpen(messageDialogRef.current, messageDialog !== null);
  }, [messageDialog, syncDialogOpen]);

  useEffect(() => {
    syncDialogOpen(shareImportDialogRef.current, pendingShareImport !== null);
  }, [pendingShareImport, syncDialogOpen]);

  useEffect(() => {
    syncDialogOpen(editorDialogRef.current, isEditorOpen);
  }, [isEditorOpen, syncDialogOpen]);

  const bootstrapApp = useCallback(async (): Promise<void> => {
    const runId = ++bootstrapRunRef.current;
    setBootStatus("loading");
    setShowBangLoadingOverlay(true);

    try {
      const nextSourceConfig = readBangSourceConfig();
      if (!mountedRef.current || runId !== bootstrapRunRef.current) return;
      sourceConfigRef.current = nextSourceConfig;
      setSourceConfig(nextSourceConfig);

      const cachedDatasets = await readBangDatasets(DEFAULT_BANG_SOURCE_ORDER);
      if (!mountedRef.current || runId !== bootstrapRunRef.current) return;
      sourceDatasetsRef.current = cachedDatasets;
      setSourceDatasets(cachedDatasets);

      const loadedState = loadState(baseByTriggerRef.current);
      stateRef.current = loadedState;
      setState(loadedState);

      const versionSnapshot = await loadVersionSnapshot(true);
      if (!mountedRef.current || runId !== bootstrapRunRef.current) return;

      const targetBuildId = versionSnapshot?.appBuildId ?? __APP_BUILD_ID__;
      void checkForEditorServiceWorkerUpdate(targetBuildId);

      const ensured = await ensureSourceDatasets(nextSourceConfig.enabled, cachedDatasets, versionSnapshot?.datasets ?? null);
      if (!mountedRef.current || runId !== bootstrapRunRef.current) return;
      sourceDatasetsRef.current = ensured.datasets;
      setSourceDatasets(ensured.datasets);

      const merged = mergeBangDatasets(nextSourceConfig, ensured.datasets);
      if (merged.enabledSources.length > 0 && merged.loadedSources.length === 0) {
        setFailedSources(ensured.failed);
        setBootStatus("error");
        setShowBangLoadingOverlay(false);
        return;
      }

      mergedRef.current = merged;
      const sanitizedBase = setBaseData(merged.bangs);

      const reconciledState = reconcileCustomPriorityConflicts(loadedState, sanitizedBase);
      if (reconciledState !== loadedState) {
        persistState(reconciledState);
      } else {
        const serialized = JSON.stringify(loadedState);
        void ensureRedirectIndex(serialized, merged.hash, merged.bangs);
      }

      setFailedSources([]);
      setBootStatus("ready");
      setShowBangLoadingOverlay(false);
    } catch (error) {
      logNonFatalError("Failed to bootstrap application", error);
      if (!mountedRef.current || runId !== bootstrapRunRef.current) return;
      setFailedSources([]);
      setBootStatus("error");
      setShowBangLoadingOverlay(false);
    }
  }, [loadVersionSnapshot, persistState, setBaseData]);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  const inspectShareHashImport = useCallback(async (): Promise<void> => {
    if (!extractShareTokenFromHash(window.location.hash)) return;

    const decoded = await decodeSharePayloadFromHash(window.location.hash);
    if (!decoded.ok) {
      await openMessageDialog({
        title: "Could Not Read Shared Settings",
        body: decoded.reason,
        isConfirm: false,
        okLabel: "OK",
      });
      clearShareHashFromUrl();
      return;
    }

    const parsed = parseSharePayload(decoded.payload);
    if (!parsed.ok) {
      await openMessageDialog({
        title: "Invalid Shared Settings",
        body: parsed.reason,
        isConfirm: false,
        okLabel: "OK",
      });
      clearShareHashFromUrl();
      return;
    }

    const nextState = sanitizeState(parsed.nextStateCandidate, baseByTriggerRef.current);
    const currentPreset = sourceConfigToPreset(sourceConfigRef.current);
    const summary = buildShareImportSummary(currentPreset, stateRef.current, parsed.nextPreset, nextState);

    setShowShareImportDeltaOnly(false);
    setPendingShareImport({
      payload: parsed.payload,
      nextPreset: parsed.nextPreset,
      nextStateCandidate: nextState,
      summary,
      encoding: decoded.encoding,
    });
  }, [openMessageDialog]);

  useEffect(() => {
    if (bootStatus !== "ready") return;
    if (shareImportCheckedRef.current) return;
    shareImportCheckedRef.current = true;
    void inspectShareHashImport();
  }, [bootStatus, inspectShareHashImport]);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 960px)");
    const onChange = (event: MediaQueryListEvent): void => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(viewport.matches);
    viewport.addEventListener("change", onChange);
    return () => {
      viewport.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport && mobileEditorOpen) {
      setMobileEditorOpen(false);
    }
  }, [isMobileViewport, mobileEditorOpen]);

  useLayoutEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      setTableWidth(0);
      setTableHeight(0);
      return;
    }

    const updateMetrics = (): void => {
      const nextWidth = tableWrap.clientWidth || tableWrap.getBoundingClientRect().width;
      const nextHeight = tableWrap.clientHeight;
      setTableWidth(nextWidth);
      setTableHeight(nextHeight);
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(tableWrap);
    return () => {
      observer.disconnect();
    };
  }, [bootStatus, isMobileViewport, mobileEditorOpen]);

  const visibleColumns = useMemo(() => computeVisibleColumns(tableWidth), [tableWidth]);

  const allRows = useMemo(() => computeRows(baseBangs, state), [baseBangs, state]);
  const fallbackOptions = useMemo(() => buildFallbackOptions(allRows), [allRows]);

  const selectedFallback = useMemo(() => {
    const token = normalizeTrigger(state.settings.defaultBangTrigger || DEFAULT_STATE.settings.defaultBangTrigger);
    return findFallbackOptionByToken(fallbackOptions, token) ?? findFallbackOptionByToken(fallbackOptions, DEFAULT_STATE.settings.defaultBangTrigger) ?? fallbackOptions[0] ?? null;
  }, [fallbackOptions, state.settings.defaultBangTrigger]);

  useEffect(() => {
    if (!selectedFallback) {
      if (fallbackInput !== "") {
        setFallbackInput("");
      }
      return;
    }

    if (state.settings.defaultBangTrigger !== selectedFallback.trigger) {
      updateState((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          defaultBangTrigger: selectedFallback.trigger,
        },
      }));
      return;
    }

    if (document.activeElement !== fallbackInputRef.current) {
      setFallbackInput(formatFallbackBangLabel(selectedFallback));
    }
  }, [fallbackInput, selectedFallback, state.settings.defaultBangTrigger, updateState]);

  const isBangMode = state.settings.defaultEngine === "bang";

  useEffect(() => {
    if (!isBangMode) {
      setIsFallbackOpen(false);
    }
  }, [isBangMode]);

  const commitFallbackSelection = useCallback((): boolean => {
    const fallbackOption = findFallbackOptionByToken(fallbackOptions, parseFallbackToken(fallbackInput));
    if (!fallbackOption) {
      if (selectedFallback) {
        setFallbackInput(formatFallbackBangLabel(selectedFallback));
      } else {
        setFallbackInput("");
      }
      return false;
    }

    updateState((previous) => {
      if (previous.settings.defaultBangTrigger === fallbackOption.trigger) return previous;
      return {
        ...previous,
        settings: {
          ...previous.settings,
          defaultBangTrigger: fallbackOption.trigger,
        },
      };
    });
    setFallbackInput(formatFallbackBangLabel(fallbackOption));
    return true;
  }, [fallbackInput, fallbackOptions, selectedFallback, updateState]);

  useEffect(() => {
    if (!isFallbackOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fallbackWrapRef.current?.contains(target)) return;
      commitFallbackSelection();
      setIsFallbackOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [commitFallbackSelection, isFallbackOpen]);

  const rankedFallbackOptions = useMemo(() => {
    if (!isBangMode || !isFallbackOpen || fallbackOptions.length === 0) return [];

    const ranked = fallbackInput.trim().length === 0 ? fallbackOptions.map((option) => ({ option, score: 1 })) : fallbackOptions.map((option) => ({ option, score: scoreFallbackOption(option, fallbackInput) })).filter((entry) => entry.score > 0);

    ranked.sort((a, b) => b.score - a.score || a.option.trigger.localeCompare(b.option.trigger));
    return ranked.slice(0, 50).map((entry) => entry.option);
  }, [fallbackInput, fallbackOptions, isBangMode, isFallbackOpen]);

  const filteredRows = useMemo(() => {
    const scoped = allRows.filter((row) => activeFilterKind === "all" || row.kind === activeFilterKind);

    const query = searchQuery.trim().toLowerCase();
    if (!query) return scoped;

    return scoped
      .map((row) => ({ row, score: scoreRowForEditorSearch(row, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.row.trigger.localeCompare(b.row.trigger))
      .map((entry) => entry.row);
  }, [activeFilterKind, allRows, searchQuery]);

  const customCount = useMemo(() => allRows.filter((row) => row.kind === "custom").length, [allRows]);
  const disabledCount = useMemo(() => allRows.filter((row) => row.kind === "disabled").length, [allRows]);

  const statsText = `${filteredRows.length}/${allRows.length} shown | custom: ${customCount} | disabled: ${disabledCount}`;
  const mobileStatsText = `${allRows.length} total | custom: ${customCount} | disabled: ${disabledCount}`;

  const startIndex = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    return Math.max(0, Math.floor(tableScrollTop / rowHeight) - VIRTUAL_OVERSCAN);
  }, [filteredRows.length, rowHeight, tableScrollTop]);

  const endIndex = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    const viewportHeight = Math.max(1, tableHeight);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + VIRTUAL_OVERSCAN * 2;
    return Math.min(filteredRows.length, startIndex + visibleCount);
  }, [filteredRows.length, rowHeight, startIndex, tableHeight]);

  const topPadding = startIndex * rowHeight;
  const bottomPadding = Math.max(0, (filteredRows.length - endIndex) * rowHeight);
  const virtualRows = filteredRows.slice(startIndex, endIndex);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;

    const maxScrollTop = Math.max(0, filteredRows.length * rowHeight - tableHeight);
    if (tableWrap.scrollTop > maxScrollTop) {
      tableWrap.scrollTop = maxScrollTop;
      setTableScrollTop(maxScrollTop);
    }
  }, [filteredRows.length, rowHeight, tableHeight]);

  useLayoutEffect(() => {
    if (!firstVirtualRowRef.current) return;
    const measuredHeight = firstVirtualRowRef.current.getBoundingClientRect().height;
    if (measuredHeight > 0 && Math.abs(measuredHeight - rowHeight) > 1) {
      setRowHeight(measuredHeight);
    }
  }, [endIndex, rowHeight, startIndex, virtualRows.length, visibleColumns.count]);

  const updateSegmentedIndicator = useCallback(() => {
    const host = segmentedFilterRef.current;
    const activeButton = segmentedButtonsRef.current[activeFilterKind];
    if (!host || !activeButton) return;

    const hostRect = host.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const hostStyles = window.getComputedStyle(host);
    const hostPaddingLeft = Number.parseFloat(hostStyles.paddingLeft || "0") || 0;
    const left = buttonRect.left - hostRect.left - hostPaddingLeft;

    setSegmentedIndicatorStyle({
      width: `${Math.round(buttonRect.width)}px`,
      transform: `translateX(${Math.round(left)}px)`,
    });
  }, [activeFilterKind]);

  useLayoutEffect(() => {
    updateSegmentedIndicator();
  }, [activeFilterKind, isMobileViewport, mobileEditorOpen, tableWidth, updateSegmentedIndicator]);

  useEffect(() => {
    window.addEventListener("resize", updateSegmentedIndicator);
    return () => {
      window.removeEventListener("resize", updateSegmentedIndicator);
    };
  }, [updateSegmentedIndicator]);

  const openEditorForCreate = useCallback((): void => {
    setEditorMode({ mode: "create" });
    setEditorForm(EMPTY_EDITOR_FORM);
    setIsEditorOpen(true);
  }, []);

  const openDuplicateForRow = useCallback((row: BangRow): void => {
    setEditorMode({ mode: "duplicate" });
    setEditorForm({
      t: row.bang.t,
      s: row.bang.s,
      d: row.bang.d,
      u: row.bang.u,
      ts: (row.bang.ts ?? []).join(", "),
      c: row.bang.c ?? "",
      sc: row.bang.sc ?? "",
      x: row.bang.x ?? "",
      fmt: (row.bang.fmt ?? []).join(", "),
    });
    setIsEditorOpen(true);
  }, []);

  const openEditorForCustomRow = useCallback((row: BangRow): void => {
    if (row.source !== "custom") return;

    setEditorMode({ mode: "custom", customId: row.rowId });
    setEditorForm({
      t: row.bang.t,
      s: row.bang.s,
      d: row.bang.d,
      u: row.bang.u,
      ts: (row.bang.ts ?? []).join(", "),
      c: row.bang.c ?? "",
      sc: row.bang.sc ?? "",
      x: row.bang.x ?? "",
      fmt: (row.bang.fmt ?? []).join(", "),
    });
    setIsEditorOpen(true);
  }, []);

  const editorTitle = useMemo(() => {
    if (editorMode.mode === "create") return "Add custom bang";
    if (editorMode.mode === "duplicate") return `Duplicate !${normalizeTrigger(editorForm.t) || "bang"}`;
    return `Edit !${normalizeTrigger(editorForm.t) || "bang"} (custom)`;
  }, [editorForm.t, editorMode.mode]);

  const editorExcludedRowIds = useMemo(() => {
    const ids = new Set<string>();
    if (editorMode.mode === "custom") {
      ids.add(editorMode.customId);
    }
    return ids;
  }, [editorMode]);

  const draftDuplicateConflicts = useMemo(() => {
    const trigger = normalizeTrigger(editorForm.t);
    if (!trigger) return [];

    const aliases = splitCsv(editorForm.ts) ?? [];
    return findDuplicateConflictsForState({ t: trigger, ts: aliases }, state, baseBangs, editorExcludedRowIds);
  }, [baseBangs, editorExcludedRowIds, editorForm.t, editorForm.ts, state]);

  const handleSaveEditor = useCallback(async (): Promise<void> => {
    const currentMode = editorMode;
    const rawDraft = formToBang(editorForm);
    const draftBang = sanitizeBangEntry(rawDraft);

    if (!draftBang) {
      await openMessageDialog({
        title: "Invalid Bang Data",
        body: "Use a non-empty trigger without spaces, a valid domain, and an http(s) or relative template URL.",
        isConfirm: false,
        okLabel: "OK",
      });
      return;
    }

    const selfDuplicates = duplicateTokensWithinBang(draftBang);
    if (selfDuplicates.length > 0) {
      await openMessageDialog({
        title: "Duplicate Tokens In Bang",
        body: `This bang repeats: ${selfDuplicates.map((token) => `!${token}`).join(", ")}. Trigger and aliases must be unique within the same bang.`,
        isConfirm: false,
        okLabel: "OK",
      });
      return;
    }

    let candidateBang: Bang = draftBang;
    let willBeEnabled = true;
    let nextState = stateRef.current;

    if (currentMode.mode === "custom") {
      const existing = nextState.custom.find((item) => item.id === currentMode.customId);
      if (!existing) return;
      willBeEnabled = existing.disabled !== true;
      candidateBang = {
        ...draftBang,
        t: existing.t,
      };
    }

    const conflicts = willBeEnabled ? findDuplicateConflictsForState(candidateBang, nextState, baseBangsRef.current, editorExcludedRowIds) : [];

    if (conflicts.length > 0) {
      const shouldDisable = await openMessageDialog({
        title: "Disable Conflicting Bangs?",
        body: formatConflictsForDialog(`Saving this bang will disable ${conflicts.length} enabled bang(s):`, conflicts),
        isConfirm: true,
        tone: "danger",
        okLabel: "Save & Disable",
        cancelLabel: "Cancel",
      });
      if (!shouldDisable) return;
      nextState = disableRowsInState(
        nextState,
        conflicts.map((conflict) => conflict.row),
      );
    }

    if (currentMode.mode === "custom") {
      const idx = nextState.custom.findIndex((item) => item.id === currentMode.customId);
      if (idx < 0) return;
      const existing = nextState.custom[idx];
      const nextCustom = [...nextState.custom];
      nextCustom[idx] = {
        ...candidateBang,
        id: existing.id,
        disabled: existing.disabled,
      };
      nextState = {
        ...nextState,
        custom: nextCustom,
      };
    } else {
      nextState = {
        ...nextState,
        custom: [
          ...nextState.custom,
          {
            ...candidateBang,
            id: createCustomId(),
          },
        ],
      };
    }

    updateState(nextState);
    setIsEditorOpen(false);
  }, [editorExcludedRowIds, editorForm, editorMode, openMessageDialog, updateState]);

  const handleToggleRowDisabled = useCallback(
    async (row: BangRow): Promise<void> => {
      let nextState = stateRef.current;

      if (row.kind === "disabled") {
        const conflicts = findDuplicateConflictsForState(row.bang, nextState, baseBangsRef.current, new Set([row.rowId]));
        if (conflicts.length > 0) {
          const shouldDisable = await openMessageDialog({
            title: "Enable And Disable Conflicts?",
            body: formatConflictsForDialog(`Enabling this bang will disable ${conflicts.length} conflicting bang(s):`, conflicts),
            isConfirm: true,
            tone: "danger",
            okLabel: "Enable & Disable",
            cancelLabel: "Cancel",
          });
          if (!shouldDisable) return;
          nextState = disableRowsInState(
            nextState,
            conflicts.map((conflict) => conflict.row),
          );
        }
      }

      if (row.source === "base") {
        const nextOverrides = { ...nextState.overrides };
        if (row.kind === "disabled") {
          delete nextOverrides[row.trigger];
        } else {
          nextOverrides[row.trigger] = { disabled: true };
        }
        nextState = {
          ...nextState,
          overrides: nextOverrides,
        };
      } else {
        const idx = nextState.custom.findIndex((entry) => entry.id === row.rowId);
        if (idx >= 0) {
          const nextCustom = [...nextState.custom];
          nextCustom[idx] = {
            ...nextCustom[idx],
            disabled: row.kind !== "disabled",
          };
          nextState = {
            ...nextState,
            custom: nextCustom,
          };
        }
      }

      updateState(nextState);
    },
    [openMessageDialog, updateState],
  );

  const handleRestoreRow = useCallback(
    async (row: BangRow): Promise<void> => {
      let nextState = stateRef.current;

      if (row.source === "custom") {
        nextState = {
          ...nextState,
          custom: nextState.custom.filter((bang) => bang.id !== row.rowId),
        };
        updateState(nextState);
        return;
      }

      if (row.kind === "disabled") {
        const base = baseByTriggerRef.current.get(row.trigger);
        if (base) {
          const conflicts = findDuplicateConflictsForState(base, nextState, baseBangsRef.current, new Set([row.rowId]));
          if (conflicts.length > 0) {
            const shouldDisable = await openMessageDialog({
              title: "Restore And Disable Conflicts?",
              body: formatConflictsForDialog(`Restoring this bang will disable ${conflicts.length} conflicting bang(s):`, conflicts),
              isConfirm: true,
              tone: "danger",
              okLabel: "Restore & Disable",
              cancelLabel: "Cancel",
            });
            if (!shouldDisable) return;
            nextState = disableRowsInState(
              nextState,
              conflicts.map((conflict) => conflict.row),
            );
          }
        }
      }

      const nextOverrides = { ...nextState.overrides };
      delete nextOverrides[row.trigger];
      nextState = {
        ...nextState,
        overrides: nextOverrides,
      };

      updateState(nextState);
    },
    [openMessageDialog, updateState],
  );

  const handleSourcePresetChange = useCallback(
    async (preset: BangSourcePreset): Promise<void> => {
      const currentPreset = sourceConfigToPreset(sourceConfigRef.current);
      if (preset === currentPreset) return;

      const nextConfig = presetToSourceConfig(preset);
      setIsSourcePresetUpdating(true);
      setShowBangLoadingOverlay(true);

      try {
        const versionSnapshot = versionSnapshotRef.current ?? (await loadVersionSnapshot(false));
        const ensured = await ensureSourceDatasets(nextConfig.enabled, sourceDatasetsRef.current, versionSnapshot?.datasets ?? null);
        if (ensured.failed.length > 0) {
          const details = ensured.failed
            .map((sourceId) => {
              const label = getBangDatasetSource(sourceId).label;
              const reason = ensured.errors[sourceId]?.replace(/\s*\n+\s*/g, " | ").trim();
              return `• ${label}${reason ? ` - ${reason}` : ""}`;
            })
            .join("\n");

          await openMessageDialog({
            title: "Could Not Load List Preset",
            body: `Failed to download one or more list sources.\n${details}`,
            isConfirm: false,
            okLabel: "OK",
          });

          return;
        }

        sourceDatasetsRef.current = ensured.datasets;
        setSourceDatasets(ensured.datasets);

        const savedConfig = saveBangSourceConfig(nextConfig);
        sourceConfigRef.current = savedConfig;
        setSourceConfig(savedConfig);

        const merged = mergeBangDatasets(savedConfig, ensured.datasets);
        mergedRef.current = merged;
        const sanitizedBase = setBaseData(merged.bangs);

        const reconciledState = reconcileCustomPriorityConflicts(stateRef.current, sanitizedBase);
        if (reconciledState !== stateRef.current) {
          updateState(reconciledState);
        } else {
          const serialized = JSON.stringify(stateRef.current);
          void ensureRedirectIndex(serialized, merged.hash, merged.bangs);
        }
      } finally {
        setIsSourcePresetUpdating(false);
        setShowBangLoadingOverlay(false);
      }
    },
    [loadVersionSnapshot, openMessageDialog, setBaseData, updateState],
  );

  const handleResetState = useCallback(async (): Promise<void> => {
    const shouldReset = await openMessageDialog({
      title: "Reset Local Changes?",
      body: "This removes all local overrides, custom bangs, preset selection, and related local cache metadata from this browser.",
      isConfirm: true,
      okLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!shouldReset) return;

    setIsResetting(true);
    await resetLocalData();
    window.location.reload();
  }, [openMessageDialog]);

  const clearToastDismissTimer = useCallback((id: number): void => {
    const handle = toastDismissTimerRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      toastDismissTimerRef.current.delete(id);
    }
  }, []);

  const clearToastRemovalTimer = useCallback((id: number): void => {
    const handle = toastRemovalTimerRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      toastRemovalTimerRef.current.delete(id);
    }
  }, []);

  const beginToastExit = useCallback(
    (id: number): void => {
      clearToastDismissTimer(id);
      setToasts((previous) => {
        let found = false;
        const next = previous.map((item) => {
          if (item.id !== id) return item;
          found = true;
          if (item.isLeaving) return item;
          return {
            ...item,
            isEntering: false,
            isLeaving: true,
          };
        });
        return found ? next : previous;
      });

      clearToastRemovalTimer(id);
      const removalTimer = window.setTimeout(() => {
        clearToastRemovalTimer(id);
        toastDeadlineRef.current.delete(id);
        toastRemainingRef.current.delete(id);
        setToasts((previous) => previous.filter((item) => item.id !== id));
      }, TOAST_EXIT_MS);
      toastRemovalTimerRef.current.set(id, removalTimer);
    },
    [clearToastDismissTimer, clearToastRemovalTimer],
  );

  const scheduleToastDismiss = useCallback(
    (id: number, delayMs: number): void => {
      if (delayMs <= 0) {
        beginToastExit(id);
        return;
      }

      clearToastDismissTimer(id);
      toastRemainingRef.current.set(id, delayMs);
      toastDeadlineRef.current.set(id, Date.now() + delayMs);

      const dismissTimer = window.setTimeout(() => {
        toastDismissTimerRef.current.delete(id);
        toastDeadlineRef.current.delete(id);
        if (toastHoverRef.current) {
          toastRemainingRef.current.set(id, 0);
          return;
        }
        beginToastExit(id);
      }, delayMs);
      toastDismissTimerRef.current.set(id, dismissTimer);
    },
    [beginToastExit, clearToastDismissTimer],
  );

  const pauseToastCountdowns = useCallback((): void => {
    toastHoverRef.current = true;
    const now = Date.now();

    for (const [id, handle] of [...toastDismissTimerRef.current.entries()]) {
      clearTimeout(handle);
      toastDismissTimerRef.current.delete(id);
      const deadline = toastDeadlineRef.current.get(id);
      if (deadline !== undefined) {
        toastRemainingRef.current.set(id, Math.max(0, deadline - now));
        toastDeadlineRef.current.delete(id);
      }
    }
  }, []);

  const resumeToastCountdowns = useCallback((): void => {
    toastHoverRef.current = false;

    for (const item of toastsRef.current) {
      if (item.isLeaving) continue;
      const remaining = toastRemainingRef.current.get(item.id) ?? TOAST_VISIBLE_MS;
      scheduleToastDismiss(item.id, remaining);
    }
  }, [scheduleToastDismiss]);

  const showToast = useCallback(
    (message: string): void => {
      const nextId = ++toastIdRef.current;
      const nextToast: ToastItem = {
        id: nextId,
        message,
        isEntering: true,
        isLeaving: false,
      };

      setToasts((previous) => {
        const next = [nextToast, ...previous];
        const kept = next.slice(0, MAX_TOASTS);
        const dropped = next.slice(MAX_TOASTS);

        for (const item of dropped) {
          clearToastDismissTimer(item.id);
          clearToastRemovalTimer(item.id);
          toastDeadlineRef.current.delete(item.id);
          toastRemainingRef.current.delete(item.id);
        }

        return kept;
      });

      toastRemainingRef.current.set(nextId, TOAST_VISIBLE_MS);
      if (!toastHoverRef.current) {
        scheduleToastDismiss(nextId, TOAST_VISIBLE_MS);
      }

      requestAnimationFrame(() => {
        setToasts((previous) =>
          previous.map((item) => {
            if (item.id !== nextId) return item;
            if (!item.isEntering) return item;
            return {
              ...item,
              isEntering: false,
            };
          }),
        );
      });
    },
    [clearToastDismissTimer, clearToastRemovalTimer, scheduleToastDismiss],
  );

  const handleToastPointerEnter = useCallback((): void => {
    setIsToastStackHovered(true);
    pauseToastCountdowns();
  }, [pauseToastCountdowns]);

  const handleToastPointerLeave = useCallback((): void => {
    setIsToastStackHovered(false);
    resumeToastCountdowns();
  }, [resumeToastCountdowns]);

  const handleCopyHelpValue = useCallback(
    async (label: string, value: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(value);
        showToast(`${label} copied`);
      } catch (error) {
        logNonFatalError("Failed to copy help value", error);
      }
    },
    [showToast],
  );

  const handleCopySearchUrl = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(customSearchUrl);
      setCopyUrlSuccess(true);
      showToast("Search URL copied");

      if (copyUrlTimerRef.current) {
        clearTimeout(copyUrlTimerRef.current);
      }
      copyUrlTimerRef.current = window.setTimeout(() => {
        setCopyUrlSuccess(false);
        copyUrlTimerRef.current = 0;
      }, 1200);
    } catch (error) {
      logNonFatalError("Failed to copy search URL", error);
      showToast("Clipboard blocked. Copy URL manually.");
    }
  }, [customSearchUrl, showToast]);

  const handleCopyShareUrl = useCallback(async (): Promise<void> => {
    setIsShareExporting(true);
    try {
      const payload = stateToSharePayload(stateRef.current, sourceConfigToPreset(sourceConfigRef.current), baseByTriggerRef.current);
      const { token } = await encodeSharePayloadToHashToken(payload);
      const shareUrl = buildShareUrl(token);
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopyShareSuccess(true);
        showToast("Settings link copied");
        if (copyShareTimerRef.current) {
          clearTimeout(copyShareTimerRef.current);
        }
        copyShareTimerRef.current = window.setTimeout(() => {
          setCopyShareSuccess(false);
          copyShareTimerRef.current = 0;
        }, 1200);
      } catch (error) {
        logNonFatalError("Failed to copy share URL to clipboard", error);
        showToast("Clipboard blocked. Copy link manually.");
        await openMessageDialog({
          title: "Copy Settings Link Manually",
          body: `The settings link was created, but clipboard access failed.\n\n${shareUrl}`,
          isConfirm: false,
          okLabel: "OK",
        });
      }
    } catch (error) {
      logNonFatalError("Failed to build share URL", error);
      await openMessageDialog({
        title: "Could Not Create Share URL",
        body: "The browser could not create a shareable URL for your current settings.",
        isConfirm: false,
        okLabel: "OK",
      });
    } finally {
      setIsShareExporting(false);
    }
  }, [openMessageDialog, showToast]);

  const dismissShareImport = useCallback((): void => {
    setShowShareImportDeltaOnly(false);
    setPendingShareImport(null);
    clearShareHashFromUrl();
  }, []);

  const handleApplyShareImport = useCallback(async (): Promise<void> => {
    const pending = pendingShareImport;
    if (!pending) return;

    const nextConfig = presetToSourceConfig(pending.nextPreset);
    setShowBangLoadingOverlay(true);

    try {
      const versionSnapshot = versionSnapshotRef.current ?? (await loadVersionSnapshot(false));
      const ensured = await ensureSourceDatasets(nextConfig.enabled, sourceDatasetsRef.current, versionSnapshot?.datasets ?? null);
      if (ensured.failed.length > 0) {
        const details = ensured.failed
          .map((sourceId) => {
            const label = getBangDatasetSource(sourceId).label;
            const reason = ensured.errors[sourceId]?.replace(/\s*\n+\s*/g, " | ").trim();
            return `• ${label}${reason ? ` - ${reason}` : ""}`;
          })
          .join("\n");

        await openMessageDialog({
          title: "Could Not Import Shared Settings",
          body: `Failed to download one or more list sources required by the imported base set.\n${details}`,
          isConfirm: false,
          okLabel: "OK",
        });
        return;
      }

      sourceDatasetsRef.current = ensured.datasets;
      setSourceDatasets(ensured.datasets);

      const savedConfig = saveBangSourceConfig(nextConfig);
      sourceConfigRef.current = savedConfig;
      setSourceConfig(savedConfig);

      const merged = mergeBangDatasets(savedConfig, ensured.datasets);
      if (merged.enabledSources.length > 0 && merged.loadedSources.length === 0) {
        await openMessageDialog({
          title: "Could Not Import Shared Settings",
          body: "The imported base set could not be loaded in this browser.",
          isConfirm: false,
          okLabel: "OK",
        });
        return;
      }

      mergedRef.current = merged;
      const sanitizedBase = setBaseData(merged.bangs);

      const sanitizedImportedState = sanitizeState(pending.nextStateCandidate, toBaseByTriggerMap(sanitizedBase));
      const reconciledImportedState = reconcileCustomPriorityConflicts(sanitizedImportedState, sanitizedBase);
      persistState(reconciledImportedState);

      setShowShareImportDeltaOnly(false);
      setPendingShareImport(null);
      clearShareHashFromUrl();

      await openMessageDialog({
        title: "Settings Imported",
        body: "Shared settings were applied successfully.",
        isConfirm: false,
        okLabel: "OK",
      });
    } finally {
      setShowBangLoadingOverlay(false);
    }
  }, [loadVersionSnapshot, openMessageDialog, pendingShareImport, persistState, setBaseData]);

  const currentPreset = sourceConfigToPreset(sourceConfig);

  const showMainHero = !isMobileViewport || !mobileEditorOpen;
  const showMobileLaunch = isMobileViewport && !mobileEditorOpen;
  const showFooter = !isMobileViewport || !mobileEditorOpen;
  const showEditorPanel = !isMobileViewport || mobileEditorOpen;

  const failedSourceDetails = failedSources.map((sourceId) => getBangDatasetSource(sourceId).label).join(", ");

  const fallbackResultsOpen = isBangMode && isFallbackOpen && rankedFallbackOptions.length > 0;
  const visibleShareImportOverviewLines = useMemo(() => {
    if (!pendingShareImport) return [];
    return showShareImportDeltaOnly ? pendingShareImport.summary.overview.delta : pendingShareImport.summary.overview.absolute;
  }, [pendingShareImport, showShareImportDeltaOnly]);
  const visibleShareImportSections = useMemo(() => {
    const sections = pendingShareImport?.summary.sections ?? [];
    const scope: ShareImportSummaryScope = showShareImportDeltaOnly ? "delta" : "absolute";
    return sections.filter((section) => section.scope === scope);
  }, [pendingShareImport, showShareImportDeltaOnly]);
  const toastStackSizerText = useMemo(() => {
    if (toasts.length === 0) return "";
    return toasts.reduce((widest, item) => (item.message.length > widest.length ? item.message : widest), toasts[0].message);
  }, [toasts]);
  const toastStackHeight = useMemo(() => {
    const collapsedHeight = 62;
    if (!isToastStackHovered) return collapsedHeight;
    if (toasts.length <= 0) return collapsedHeight;
    return toasts.length * 54 + 18;
  }, [isToastStackHovered, toasts.length]);
  const activeHelpBrowserContent = useMemo<HelpBrowserContent>(() => {
    const engineName = "!bangs.fast";
    const searchUrl = customSearchUrl;
    const shortcut = "b";

    switch (activeHelpBrowserTab) {
      case "firefox":
        return {
          title: "Firefox",
          values: [
            { label: "Name", value: engineName, copyLabel: "Name" },
            { label: "Engine URL", value: searchUrl, copyLabel: "Engine URL" },
          ],
          steps: [
            <>
              Open <code className={HELP_INLINE_CODE_CHIP_CLASS}>about:preferences#search</code>.
            </>,
            <>
              In <span className="font-medium text-black">Search Shortcuts</span>, click <span className="font-medium text-black">Add</span>.
            </>,
            <>
              Enter the <span className="font-medium text-black">Name</span> and <span className="font-medium text-black">Engine URL</span> values shown above, then save.
            </>,
            <>
              In <span className="font-medium text-black">Default Search Engine</span>, select <code className={HELP_INLINE_CODE_CHIP_CLASS}>{engineName}</code>.
            </>,
          ],
          links: [
            { label: "Mozilla: add custom search engine", href: "https://support.mozilla.org/kb/add-or-remove-search-engine-firefox#w_add-a-custom-search-engine" },
            { label: "Mozilla: manage default search settings", href: "https://support.mozilla.org/en-US/kb/change-your-default-search-settings-firefox" },
          ],
        };
      case "brave":
        return {
          title: "Brave",
          values: [
            { label: "Name", value: engineName, copyLabel: "Name" },
            { label: "URL with %s", value: searchUrl, copyLabel: "Engine URL" },
            { label: "Shortcut", value: shortcut, copyLabel: "Shortcut" },
          ],
          steps: [
            <>
              Open <code className={HELP_INLINE_CODE_CHIP_CLASS}>brave://settings/search</code>.
            </>,
            <>
              Open <span className="font-medium text-black">Manage search engines and site search</span>.
            </>,
            <>
              Under <span className="font-medium text-black">Site search</span>, click <span className="font-medium text-black">Add</span> and enter the values shown above.
            </>,
            <>
              For <code className={HELP_INLINE_CODE_CHIP_CLASS}>{engineName}</code>, open the menu (<span className="font-medium text-black">⋮</span>) and select <span className="font-medium text-black">Make default</span>.
            </>,
            <>Confirm it appears as the default for address bar searches.</>,
          ],
          links: [{ label: "Brave: set default search engine", href: "https://support.brave.com/hc/en-us/articles/360017479752-How-do-I-set-my-default-search-engine" }],
        };
      case "safari":
        return {
          title: "Safari",
          values: [{ label: "Search URL", value: searchUrl, copyLabel: "Search URL" }],
          steps: [
            <>
              Open Safari <span className="font-medium text-black">Settings</span> and go to <span className="font-medium text-black">Search</span>.
            </>,
            <>
              In <span className="font-medium text-black">Search engine</span>, Safari lets you choose from its available built-in search providers.
            </>,
            <>
              Custom URL-based engines (like <code className={HELP_INLINE_CODE_CHIP_CLASS}>{engineName}</code> with <code className={HELP_INLINE_CODE_CHIP_CLASS}>{searchUrl}</code>) are not available in Safari's default search engine menu.
            </>,
          ],
          links: [{ label: "Apple: change Safari search settings", href: "https://support.apple.com/guide/safari/search-sfria1042d31/mac" }],
          note: (
            <>
              <strong>Note:</strong> Safari currently does not expose a native way to set a custom URL search engine as the default.
            </>
          ),
        };
      case "chrome":
      default:
        return {
          title: "Chrome",
          values: [
            { label: "Name", value: engineName, copyLabel: "Name" },
            { label: "URL with %s", value: searchUrl, copyLabel: "Engine URL" },
            { label: "Shortcut", value: shortcut, copyLabel: "Shortcut" },
          ],
          steps: [
            <>
              Open <code className={HELP_INLINE_CODE_CHIP_CLASS}>chrome://settings/searchEngines</code>.
            </>,
            <>
              Under <span className="font-medium text-black">Site search</span>, click <span className="font-medium text-black">Add</span> and enter the values shown above.
            </>,
            <>
              For <code className={HELP_INLINE_CODE_CHIP_CLASS}>{engineName}</code>, open the menu (<span className="font-medium text-black">⋮</span>) and select <span className="font-medium text-black">Make default</span>.
            </>,
            <>
              Confirm it appears as the default in <span className="font-medium text-black">Search engine used in the address bar</span>.
            </>,
          ],
          links: [{ label: "Google Chrome Help", href: "https://support.google.com/chrome/answer/95426?co=GENIE.Platform%3DDesktop&hl=en" }],
        };
    }
  }, [activeHelpBrowserTab, customSearchUrl]);

  const editorTriggerDisabled = editorMode.mode === "custom";

  const pageClassName = cn("mx-auto flex max-w-[1440px] flex-col gap-4 p-[clamp(14px,2.2vw,24px)] h-screen min-h-dvh", isMobileViewport && "h-auto gap-3 p-3", isMobileViewport && mobileEditorOpen && "h-dvh min-h-dvh gap-0 p-0");

  if (bootStatus === "error") {
    return (
      <main className="grid min-h-dvh place-items-center p-5">
        <section className="grid w-[min(520px,96vw)] gap-3 rounded-[12px] border border-app-line bg-app-panel p-5 shadow-[0_10px_30px_rgba(16,31,36,0.06)]">
          <h1 className="m-0 text-[clamp(1.9rem,2.6vw,2.8rem)] tracking-[-0.02em]">
            <span className="bang-mark">!bangs</span>.fast
          </h1>
          <p className="m-0 text-app-muted">Could not load required bang lists. Check your connection and try again.</p>
          {failedSourceDetails ? <p className="m-0 text-[0.92rem] text-[#7d3b3b]">Failed sources: {failedSourceDetails}</p> : null}
          <button className="btn btn-primary" type="button" onClick={() => void bootstrapApp()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      <main id="page-root" ref={pageRootRef} className={cn("page", pageClassName, isMobileViewport && mobileEditorOpen && "mobile-editor-open")}>
        {showMainHero ? (
          <header className="hero relative rounded-[12px] border border-app-line bg-app-panel p-5 pr-[88px] shadow-[0_10px_30px_rgba(16,31,36,0.06)] max-[960px]:p-4 max-[960px]:pr-[76px]">
            <div className="absolute right-5 top-5 m-0 flex max-[960px]:right-4 max-[960px]:top-4">
              <button type="button" className="btn btn-danger icon-only" aria-label="Reset Local Changes" data-tip="Reset Local Changes" onClick={() => void handleResetState()} disabled={isResetting}>
                <IconGlyph name="delete" />
              </button>
            </div>

            <h1 className="m-0 text-[clamp(1.9rem,2.6vw,2.8rem)] tracking-[-0.02em] max-[720px]:text-[clamp(1.55rem,8.2vw,1.95rem)]">
              <span className="bang-mark">!bangs</span>.fast
            </h1>

            <p className="mt-2 text-app-muted">
              <span className="font-medium text-black">
                <span className="text-[#cf5f20]">!bangs</span>.fast
              </span>{" "}
              is a local bang redirect service that runs fully in your browser. It resolves <span className="font-medium text-[#cf5f20]">!bang</span> queries locally instead of sending every redirect through a backend, and supports multiple base sets: <span className="font-medium text-black">Kagi</span>,{" "}
              <span className="font-medium text-black">Kagi + Kagi Internal</span>, and <span className="font-medium text-black">DuckDuckGo</span>.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-app-muted">
              <span>Add this as your browser custom search URL:</span>
              <code id="custom-search-url" className={SEARCH_URL_CODE_CHIP_CLASS}>
                {customSearchUrl}
              </code>
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <button id="copy-url" type="button" className={cn("btn btn-subtle icon-only", copyUrlSuccess && "is-success")} aria-label="Copy custom search URL" data-tip="Copy search URL" onClick={() => void handleCopySearchUrl()}>
                  <IconGlyph name="copy" />
                </button>
                <button id="copy-share-url" type="button" className={cn("btn btn-subtle icon-only", copyShareSuccess && "is-success")} aria-label="Copy settings link" data-tip="Copy settings link" onClick={() => void handleCopyShareUrl()} disabled={isShareExporting}>
                  <IconGlyph name="share" />
                </button>
                <button id="show-browser-help" type="button" className="btn btn-subtle icon-only" aria-label="Browser setup help" data-tip="Browser setup help" onClick={() => setIsHelpOpen(true)}>
                  <IconGlyph name="info" />
                </button>
              </span>
            </div>
          </header>
        ) : null}

        {showMobileLaunch ? (
          <section id="mobile-editor-launch" className="grid gap-2.5 rounded-[12px] border border-app-line bg-app-panel p-4 shadow-[0_10px_30px_rgba(16,31,36,0.06)]">
            <h2 className="m-0">Bang Editor</h2>
            <p id="mobile-launch-stats" className="m-0 text-app-muted">
              {mobileStatsText}
            </p>
            <button id="open-mobile-editor" type="button" className="btn btn-primary" onClick={() => setMobileEditorOpen(true)}>
              Edit Bangs
            </button>
          </section>
        ) : null}

        {showEditorPanel ? (
          <section id="editor-panel" className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-app-line bg-app-panel", isMobileViewport && mobileEditorOpen && "flex-1 border-0 rounded-none bg-transparent shadow-none")}>
            <div className={cn("flex flex-wrap items-center justify-between gap-2.5 border-b border-app-line p-4", isMobileViewport && mobileEditorOpen && "bg-app-panel")}>
              <div className="flex min-w-0 flex-wrap items-center gap-2 max-[960px]:w-full max-[960px]:flex-[1_1_100%]">
                {isMobileViewport ? (
                  <button id="mobile-editor-back" type="button" className="btn btn-subtle icon-only" aria-label="Back" onClick={() => setMobileEditorOpen(false)}>
                    <IconGlyph name="back" />
                  </button>
                ) : null}

                <div className="flex min-w-0 flex-nowrap items-center gap-2.5 max-[960px]:grid max-[960px]:w-full max-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[960px]:items-center max-[960px]:gap-2.5">
                  <label htmlFor="default-engine" className="whitespace-nowrap text-app-muted max-[960px]:col-span-2">
                    Default search:
                  </label>

                  <select
                    id="default-engine"
                    value={state.settings.defaultEngine}
                    onChange={(event) => {
                      const nextEngine = event.target.value;
                      if (!isDefaultEngine(nextEngine)) return;
                      updateState((previous) => ({
                        ...previous,
                        settings: {
                          ...previous.settings,
                          defaultEngine: nextEngine,
                        },
                      }));
                    }}
                    className={cn("w-[164px] min-w-[164px] max-[960px]:w-full max-[960px]:min-w-0", !isBangMode && "max-[960px]:col-span-2")}
                  >
                    {Object.entries(DEFAULT_ENGINES).map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label}
                      </option>
                    ))}
                  </select>

                  {isBangMode ? (
                    <div id="fallback-bang-wrap" ref={fallbackWrapRef} className="relative min-w-[210px] w-[210px] max-[960px]:w-full max-[960px]:min-w-0">
                      <input
                        ref={fallbackInputRef}
                        id="fallback-bang-search"
                        type="search"
                        placeholder="Search fallback bang (e.g. !g)"
                        autoComplete="off"
                        value={fallbackInput}
                        onFocus={() => {
                          if (fallbackCloseTimerRef.current) {
                            clearTimeout(fallbackCloseTimerRef.current);
                            fallbackCloseTimerRef.current = 0;
                          }
                          setFallbackInput("");
                          setIsFallbackOpen(true);
                        }}
                        onChange={(event) => {
                          setFallbackInput(event.target.value);
                          setIsFallbackOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitFallbackSelection();
                            setIsFallbackOpen(false);
                            return;
                          }
                          if (event.key === "Escape") {
                            setIsFallbackOpen(false);
                            if (selectedFallback) {
                              setFallbackInput(formatFallbackBangLabel(selectedFallback));
                            }
                            fallbackInputRef.current?.blur();
                          }
                        }}
                        onBlur={() => {
                          if (fallbackCloseTimerRef.current) {
                            clearTimeout(fallbackCloseTimerRef.current);
                          }
                          fallbackCloseTimerRef.current = window.setTimeout(() => {
                            commitFallbackSelection();
                            setIsFallbackOpen(false);
                            fallbackCloseTimerRef.current = 0;
                          }, 120);
                        }}
                      />

                      <div
                        id="fallback-bang-results"
                        role="listbox"
                        aria-label="Fallback bang options"
                        className={cn("absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[260px] overflow-auto rounded-[10px] border border-[#c8cfd8] bg-white shadow-[0_10px_22px_rgba(18,31,42,0.14)]", fallbackResultsOpen ? "block" : "hidden")}
                      >
                        {rankedFallbackOptions.map((option) => {
                          const aliasPreview =
                            option.aliases.length > 0
                              ? option.aliases
                                  .slice(0, 3)
                                  .map((alias) => `!${alias}`)
                                  .join(", ")
                              : "";
                          const aliasSuffix = option.aliases.length > 3 ? ", ..." : "";
                          const secondaryParts = [option.domain, aliasPreview ? `aliases: ${aliasPreview}${aliasSuffix}` : ""].filter(Boolean);

                          return (
                            <button
                              key={option.rowId}
                              type="button"
                              data-trigger={option.trigger}
                              role="option"
                              className="grid w-full gap-0.5 border-0 border-b border-[#edf0f4] bg-transparent px-2.5 py-2 text-left last:border-b-0 hover:bg-[#f5f8fc]"
                              onMouseDown={(event) => {
                                event.preventDefault();
                              }}
                              onClick={() => {
                                updateState((previous) => ({
                                  ...previous,
                                  settings: {
                                    ...previous.settings,
                                    defaultBangTrigger: option.trigger,
                                  },
                                }));
                                setFallbackInput(formatFallbackBangLabel(option));
                                setIsFallbackOpen(false);
                              }}
                            >
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-[#24344f]">{formatFallbackBangLabel(option)}</span>
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.82rem] text-app-muted">{secondaryParts.join(" · ")}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex min-w-0 flex-nowrap items-center gap-2.5 max-[960px]:grid max-[960px]:w-full max-[960px]:grid-cols-[minmax(0,1fr)_auto_auto] max-[960px]:items-center max-[960px]:gap-2.5">
                <div className="search-input-wrap relative min-w-[180px] flex-1 basis-[220px] max-[960px]:col-[1] max-[960px]:w-full max-[960px]:min-w-0">
                  <input
                    ref={searchInputRef}
                    id="search-input"
                    type="search"
                    placeholder="Search trigger, aliases, name, domain, category..."
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                    }}
                  />
                  <button
                    id="clear-search"
                    type="button"
                    className="search-clear"
                    aria-label="Clear search"
                    hidden={searchQuery.trim().length === 0}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSearchQuery("");
                      }
                    }}
                  >
                    X
                  </button>
                </div>

                <div id="kind-filter-segmented" ref={segmentedFilterRef} className="relative hidden min-[1043px]:inline-flex items-center rounded-[10px] border border-[#c8cfd8] bg-[#f6f8fb] p-[3px]" role="tablist" aria-label="Bang filter">
                  <div id="kind-filter-indicator" aria-hidden="true" className="pointer-events-none absolute left-[3px] top-[3px] h-[calc(100%-6px)] rounded-[7px] border border-[#c3d3ef] bg-[#dfe9f9] transition-[transform,width] duration-150" style={segmentedIndicatorStyle} />
                  {FILTER_OPTIONS.map((filter) => {
                    const isActive = activeFilterKind === filter.value;
                    return (
                      <button
                        key={filter.value}
                        ref={(element) => {
                          segmentedButtonsRef.current[filter.value] = element;
                        }}
                        type="button"
                        className={cn("relative z-[1] rounded-[7px] border-0 bg-transparent px-2.5 py-1.5 text-[#5b6472]", isActive && "is-active text-[#22334d]")}
                        aria-selected={isActive}
                        onClick={() => {
                          setActiveFilterKind(filter.value);
                        }}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>

                <select
                  id="kind-filter"
                  className="kind-filter-select block min-[1043px]:hidden max-[960px]:col-[2] max-[960px]:min-w-[110px]"
                  value={activeFilterKind}
                  onChange={(event) => {
                    const value = event.target.value as FilterKind;
                    setActiveFilterKind(value);
                  }}
                >
                  {FILTER_OPTIONS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>

                <button id="new-bang" type="button" className="btn btn-primary icon-only action-icon max-[960px]:col-[3] max-[960px]:h-[38px] max-[960px]:w-[38px] max-[960px]:justify-self-start" aria-label="Add Bang" data-tip="Add Bang" onClick={openEditorForCreate}>
                  <IconGlyph name="add" />
                </button>
              </div>
            </div>

            <div className={cn("flex flex-wrap items-center gap-3 border-b border-app-line px-4 py-3", isMobileViewport && mobileEditorOpen && "bg-app-panel")}>
              <div className="inline-flex min-w-0 items-center gap-2 max-[595px]:w-full">
                <label htmlFor="bang-source-preset" className="whitespace-nowrap font-semibold text-app-muted">
                  Base set:
                </label>
                <select
                  id="bang-source-preset"
                  aria-label="Base set preset"
                  value={currentPreset}
                  disabled={isSourcePresetUpdating}
                  onChange={(event) => {
                    void handleSourcePresetChange(event.target.value as BangSourcePreset);
                  }}
                  className="w-[168px] min-w-[168px] max-[595px]:w-auto max-[595px]:min-w-0 max-[595px]:flex-[1_1_auto]"
                >
                  <option value="kagi">Kagi</option>
                  <option value="kagi-internal">Kagi + Kagi Internal</option>
                  <option value="ddg">DuckDuckGo</option>
                </select>
              </div>
              <div id="stats" className="ml-auto text-right text-[0.95rem] text-app-muted max-[595px]:ml-0 max-[595px]:w-full max-[595px]:text-center">
                {statsText}
              </div>
            </div>

            <div
              ref={tableWrapRef}
              className={cn("min-h-0 flex-1 overflow-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]", isMobileViewport && mobileEditorOpen && "bg-app-panel")}
              onScroll={(event) => {
                setTableScrollTop((event.currentTarget as HTMLDivElement).scrollTop);
              }}
            >
              <table id="bang-table" className="w-full min-w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-auto" />
                  {visibleColumns.showName ? <col className="w-[180px]" /> : null}
                  {visibleColumns.showDomain ? <col className="w-[210px]" /> : null}
                  {visibleColumns.showAliases ? <col className="w-[178px]" /> : null}
                  {visibleColumns.showStatus ? <col className="w-[120px]" /> : null}
                  <col className="w-[168px]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-[4] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Trigger</th>
                    {visibleColumns.showName ? <th className="sticky top-0 z-[4] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Name</th> : null}
                    {visibleColumns.showDomain ? <th className="sticky top-0 z-[4] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Domain</th> : null}
                    {visibleColumns.showAliases ? <th className="sticky top-0 z-[4] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Aliases</th> : null}
                    {visibleColumns.showStatus ? <th className="sticky top-0 z-[4] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Status</th> : null}
                    <th className="actions-col sticky top-0 z-[4] w-[168px] min-w-[168px] border-b border-[#ece6dc] bg-[#fcf9f3] px-3 py-2.5 text-left text-[0.9rem] font-semibold text-app-muted max-[720px]:px-2 max-[720px]:py-[9px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? null : (
                    <>
                      {topPadding > 0 ? (
                        <tr className="virtual-spacer">
                          <td colSpan={visibleColumns.count} style={{ height: `${Math.round(topPadding)}px` }} className="h-0 border-0 p-0" />
                        </tr>
                      ) : null}

                      {virtualRows.map((row, index) => {
                        const isFirstVirtualRow = index === 0;
                        return (
                          <tr key={row.rowId} ref={isFirstVirtualRow ? firstVirtualRowRef : null} data-virtual-row="1">
                            <td className="overflow-hidden whitespace-nowrap border-b border-[#ece6dc] px-3 py-2.5 align-top text-ellipsis max-[720px]:px-2 max-[720px]:py-[9px]">
                              <code>!{row.bang.t}</code>
                            </td>
                            {visibleColumns.showName ? <td className="overflow-hidden whitespace-nowrap border-b border-[#ece6dc] px-3 py-2.5 align-top text-ellipsis max-[720px]:px-2 max-[720px]:py-[9px]">{row.bang.s}</td> : null}
                            {visibleColumns.showDomain ? <td className="overflow-hidden whitespace-nowrap border-b border-[#ece6dc] px-3 py-2.5 align-top text-ellipsis max-[720px]:px-2 max-[720px]:py-[9px]">{row.bang.d}</td> : null}
                            {visibleColumns.showAliases ? <td className="overflow-hidden whitespace-nowrap border-b border-[#ece6dc] px-3 py-2.5 align-top text-ellipsis max-[720px]:px-2 max-[720px]:py-[9px]">{(row.bang.ts ?? []).join(", ")}</td> : null}
                            {visibleColumns.showStatus ? (
                              <td className="border-b border-[#ece6dc] px-3 py-2.5 align-top max-[720px]:px-2 max-[720px]:py-[9px]">
                                <span
                                  className={cn(
                                    "rounded-full border border-transparent px-2 py-0.5 text-[0.85rem] capitalize",
                                    row.kind === "original" && "bg-[#f2f4f7] text-[#5b6472]",
                                    row.kind === "custom" && "border-[#9dd6c6] bg-app-brand-soft text-app-brand",
                                    row.kind === "disabled" && "border-[#e4b2b2] bg-[#f6e4e4] text-[#8b3535]",
                                  )}
                                >
                                  {row.kind}
                                </span>
                              </td>
                            ) : null}
                            <td className="actions-col border-b border-[#ece6dc] px-3 py-2.5 align-top max-[720px]:px-2 max-[720px]:py-[9px]">
                              <div className="flex flex-nowrap gap-2">
                                {row.source === "custom" ? (
                                  <button type="button" className={cn("btn icon-only action-icon", iconVariantClass("edit"))} aria-label="Edit" data-tip="Edit" onClick={() => openEditorForCustomRow(row)}>
                                    <IconGlyph name="edit" />
                                  </button>
                                ) : null}

                                <button type="button" className={cn("btn icon-only action-icon", iconVariantClass("duplicate"))} aria-label="Duplicate" data-tip="Duplicate" onClick={() => openDuplicateForRow(row)}>
                                  <IconGlyph name="duplicate" />
                                </button>

                                <button
                                  type="button"
                                  className={cn("btn icon-only action-icon", iconVariantClass(row.kind === "disabled" ? "enable" : "disable"))}
                                  aria-label={row.kind === "disabled" ? "Enable" : "Disable"}
                                  data-tip={row.kind === "disabled" ? "Enable" : "Disable"}
                                  onClick={() => void handleToggleRowDisabled(row)}
                                >
                                  <IconGlyph name={row.kind === "disabled" ? "enable" : "disable"} />
                                </button>

                                <button
                                  type="button"
                                  className={cn("btn icon-only action-icon", iconVariantClass(row.source === "custom" ? "delete" : "restore"))}
                                  aria-label={row.source === "custom" ? "Delete" : "Restore"}
                                  data-tip={row.source === "custom" ? "Delete" : "Restore"}
                                  onClick={() => void handleRestoreRow(row)}
                                >
                                  <IconGlyph name={row.source === "custom" ? "delete" : "restore"} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {bottomPadding > 0 ? (
                        <tr className="virtual-spacer">
                          <td colSpan={visibleColumns.count} style={{ height: `${Math.round(bottomPadding)}px` }} className="h-0 border-0 p-0" />
                        </tr>
                      ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div id="bangs-loading-overlay" hidden={!showBangLoadingOverlay} className="absolute inset-0 z-[12] grid place-items-center bg-[rgba(255,253,248,0.84)] p-3.5 [backdrop-filter:blur(1px)]">
              <div className="inline-flex items-center gap-2 rounded-[10px] border border-app-line bg-[#fffefb] px-3.5 py-2.5 text-app-muted shadow-[0_8px_18px_rgba(16,31,36,0.08)]" role="status" aria-live="polite">
                <span className="bangs-loading-dot h-2 w-2 rounded-full bg-app-brand" aria-hidden="true" />
                Loading bang lists...
              </div>
            </div>
          </section>
        ) : null}

        {showFooter ? (
          <footer className="app-footer text-center text-[0.88rem] text-app-muted">
            Inspired by{" "}
            <a href="https://unduck.link" target="_blank" rel="noreferrer">
              unduck.link
            </a>{" "}
            ·{" "}
            <a href="https://github.com/kristianvld/bangs.fast" target="_blank" rel="noreferrer">
              github.com/kristianvld/bangs.fast
            </a>
          </footer>
        ) : null}
      </main>

      <div className={cn("app-toast-stack", toasts.length > 0 && "is-visible", isToastStackHovered && "is-expanded")} aria-live="polite" aria-atomic="false" style={{ height: `${toastStackHeight}px` }} onPointerEnter={handleToastPointerEnter} onPointerLeave={handleToastPointerLeave}>
        {toasts.length > 0 ? (
          <span className="app-toast-sizer" aria-hidden="true">
            {toastStackSizerText}
          </span>
        ) : null}
        {toasts.map((toast, index) => {
          const collapsedOffset = Math.min(index, 4) * 4;
          const expandedOffset = index * 54;
          let yOffset = isToastStackHovered ? expandedOffset : collapsedOffset;
          if (toast.isEntering) {
            yOffset -= 10;
          } else if (toast.isLeaving) {
            yOffset -= 12;
          }

          const scale = isToastStackHovered ? 1 : Math.max(0.88, 1 - index * 0.035);
          const collapsedOpacity = Math.max(0.26, 1 - index * 0.18);
          const opacity = toast.isEntering || toast.isLeaving ? 0 : isToastStackHovered ? 1 : collapsedOpacity;

          return (
            <div
              key={toast.id}
              className="app-toast-item"
              role="status"
              style={{
                transform: `translate(-50%, ${Math.round(yOffset)}px) scale(${scale})`,
                opacity,
                zIndex: 120 - index,
              }}
            >
              {toast.message}
            </div>
          );
        })}
      </div>

      <dialog
        id="editor-dialog"
        ref={editorDialogRef}
        className="max-h-[calc(100dvh-24px)] w-[min(700px,95vw)] overflow-hidden rounded-[12px] border border-app-line bg-app-panel p-0 text-app-ink"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setIsEditorOpen(false);
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setIsEditorOpen(false);
        }}
        onClose={() => {
          if (isEditorOpen) {
            setIsEditorOpen(false);
          }
        }}
      >
        <form
          id="editor-form"
          method="dialog"
          className="grid max-h-[calc(100dvh-24px)] gap-2.5 overflow-auto p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveEditor();
          }}
        >
          <h3 id="editor-title" className="m-0 mb-1">
            {editorTitle}
          </h3>

          <div id="editor-duplicate-warning" hidden={draftDuplicateConflicts.length === 0} className="editor-duplicate-warning">
            <p>Saving this bang will disable {draftDuplicateConflicts.length} conflicting enabled bang(s):</p>
            <ul>
              {draftDuplicateConflicts.map((conflict) => (
                <li key={conflict.row.rowId} className="rounded-md border border-[#f0c7c7] bg-[#fffafa] px-2 py-1.5">
                  <div className="font-semibold text-[#5f1f1f]">
                    !{conflict.row.bang.t} ({conflict.row.bang.s})
                  </div>
                  <div className="mt-0.5 text-[0.82rem] text-[#7d3b3b]">Matches: {conflict.matchedTokens.map((token) => `!${token}`).join(", ")}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-trigger" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Trigger{" "}
              <span className="help-dot" data-tip="Primary bang token after !. Example: g for !g. Must be unique." aria-label="Primary bang trigger help">
                ?
              </span>
            </label>
            <input id="f-trigger" placeholder="trigger" required value={editorForm.t} disabled={editorTriggerDisabled} onChange={(event) => setEditorForm((previous) => ({ ...previous, t: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-name" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Name{" "}
              <span className="help-dot" data-tip="Display name for this bang." aria-label="Bang name help">
                ?
              </span>
            </label>
            <input id="f-name" placeholder="name" required value={editorForm.s} onChange={(event) => setEditorForm((previous) => ({ ...previous, s: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-domain" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Domain{" "}
              <span className="help-dot" data-tip="Base domain used for homepage/open behavior. Example: www.google.com." aria-label="Domain help">
                ?
              </span>
            </label>
            <input id="f-domain" placeholder="domain" required value={editorForm.d} onChange={(event) => setEditorForm((previous) => ({ ...previous, d: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-url" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Template URL{" "}
              <span className="help-dot" data-tip="Search template. Use {{{s}}} where query should be inserted. Example: https://www.google.com/search?q={{{s}}}." aria-label="Template URL help">
                ?
              </span>
            </label>
            <input id="f-url" placeholder="template URL" required value={editorForm.u} onChange={(event) => setEditorForm((previous) => ({ ...previous, u: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-aliases" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Aliases{" "}
              <span className="help-dot" data-tip="Comma-separated alternative triggers. Example: gh, github." aria-label="Aliases help">
                ?
              </span>
            </label>
            <input id="f-aliases" placeholder="aliases (comma separated)" value={editorForm.ts} onChange={(event) => setEditorForm((previous) => ({ ...previous, ts: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-category" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Category{" "}
              <span className="help-dot" data-tip="Optional grouping label, for search/filter organization." aria-label="Category help">
                ?
              </span>
            </label>
            <input id="f-category" placeholder="category" value={editorForm.c} onChange={(event) => setEditorForm((previous) => ({ ...previous, c: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-subcategory" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Subcategory{" "}
              <span className="help-dot" data-tip="Optional secondary grouping label." aria-label="Subcategory help">
                ?
              </span>
            </label>
            <input id="f-subcategory" placeholder="subcategory" value={editorForm.sc} onChange={(event) => setEditorForm((previous) => ({ ...previous, sc: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-regex" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              Regex Pattern{" "}
              <span className="help-dot" data-tip="Optional pattern to capture groups from query for advanced substitutions like $1, $2 in URL." aria-label="Regex pattern help">
                ?
              </span>
            </label>
            <input id="f-regex" placeholder="regex pattern (optional)" value={editorForm.x} onChange={(event) => setEditorForm((previous) => ({ ...previous, x: event.target.value }))} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="f-fmt" className="inline-flex items-center gap-1.5 text-[0.82rem] uppercase tracking-[0.04em] text-app-muted">
              FMT Flags{" "}
              <span
                className="help-dot"
                data-tip="Behavior flags (comma-separated):&#10;- &#96;open_base_path&#96;: empty query opens site root&#10;- &#96;open_snap_domain&#96;: empty query opens ad domain&#10;- &#96;url_encode_placeholder&#96;: encode query into &#96;{{{s}}}&#96;&#10;- &#96;url_encode_space_to_plus&#96;: spaces become &#96;+&#96;&#10;&#10;Examples:&#10;&#96;open_base_path,url_encode_placeholder&#96;&#10;&#96;url_encode_placeholder,url_encode_space_to_plus&#96;"
                aria-label="Format flags help"
              >
                ?
              </span>
            </label>
            <input id="f-fmt" placeholder="fmt flags (comma separated)" value={editorForm.fmt} onChange={(event) => setEditorForm((previous) => ({ ...previous, fmt: event.target.value }))} />
          </div>

          <div className="dialog-actions mt-1.5 flex justify-end gap-2.5">
            <button type="button" id="cancel-edit" className="btn btn-subtle" onClick={() => setIsEditorOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        id="help-dialog"
        ref={helpDialogRef}
        className="max-h-[calc(100dvh-24px)] w-[min(760px,95vw)] overflow-hidden rounded-[12px] border border-app-line bg-app-panel p-0 text-app-ink"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setIsHelpOpen(false);
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setIsHelpOpen(false);
        }}
        onClose={() => {
          if (isHelpOpen) {
            setIsHelpOpen(false);
          }
        }}
      >
        <div className="help-wrap max-h-[calc(100dvh-24px)] overflow-auto p-[18px]">
          <h3 className="m-0 text-[clamp(1.9rem,2.6vw,2.8rem)] tracking-[-0.02em] text-app-muted max-[720px]:text-[clamp(1.55rem,8.2vw,1.95rem)]">
            Add{" "}
            <span className="whitespace-nowrap">
              <span className="bang-mark">!bangs</span>
              <span className="text-[#223248]">.fast</span>
            </span>{" "}
            to your browser
          </h3>

          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Browser setup tabs">
            {HELP_BROWSER_TABS.map((tab) => {
              const isActive = tab.id === activeHelpBrowserTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cn("rounded-full border border-[#c8cfd8] bg-white px-3 py-1.5 text-[0.9rem] font-semibold text-[#4f5c6f]", isActive && "border-[#9ec3ba] bg-[#e7f2ef] text-[#1c4f45]")}
                  onClick={() => {
                    setActiveHelpBrowserTab(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <section className="mt-3 grid gap-2.5 rounded-[10px] border border-[#dfd6c8] bg-[#fffdf8] p-3">
            <div className="grid gap-2">
              {activeHelpBrowserContent.values.map((value) => (
                <div key={value.label} className="grid gap-1.5 min-[721px]:grid-cols-[116px_minmax(0,1fr)_auto] min-[721px]:items-center">
                  <span className="text-[0.82rem] font-medium tracking-[0.01em] text-app-muted">{value.label}</span>
                  <code className={cn("block", HELP_VALUE_CODE_CHIP_CLASS)}>{value.value}</code>
                  <button type="button" className="btn btn-subtle min-h-[31px] px-2.5 py-[6px] text-[0.82rem] min-[721px]:justify-self-auto" onClick={() => void handleCopyHelpValue(value.copyLabel, value.value)}>
                    Copy
                  </button>
                </div>
              ))}
            </div>
            {activeHelpBrowserContent.note ? <div className="rounded-lg border border-[#e4cbc0] border-l-4 border-l-[#cc7f4d] bg-[#fff8f2] px-2.5 py-2 text-[0.9rem] leading-[1.35] text-[#6a3a1f]">{activeHelpBrowserContent.note}</div> : null}
            <ol className="m-0 grid gap-1.5 pl-5 text-[#263140]">
              {activeHelpBrowserContent.steps.map((step, index) => (
                <li key={`${activeHelpBrowserTab}-step-${index}`}>{step}</li>
              ))}
            </ol>
            <div className="grid gap-1">
              {activeHelpBrowserContent.links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="text-[0.88rem] text-[#1f5a4c] underline hover:[text-decoration-thickness:2px]">
                  {link.label}
                </a>
              ))}
            </div>
          </section>

          <div className="dialog-actions mt-1.5 flex justify-end gap-2.5">
            <button type="button" id="close-help" className="btn btn-subtle" onClick={() => setIsHelpOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        id="share-import-dialog"
        ref={shareImportDialogRef}
        className="max-h-[calc(100dvh-24px)] w-[min(760px,95vw)] overflow-hidden rounded-[12px] border border-[#e5a6a6] bg-app-panel p-0 text-app-ink"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dismissShareImport();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          dismissShareImport();
        }}
        onClose={() => {
          if (pendingShareImport) {
            dismissShareImport();
          }
        }}
      >
        <div className="share-import-wrap grid max-h-[calc(100dvh-24px)] gap-2.5 overflow-auto p-[18px]">
          <h3 className="m-0 text-[1.1rem] text-[#7a2020]">Import Shared Settings?</h3>
          <div className="share-import-view-toggle flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#ecd6d6] bg-[#fff8f8] px-2.5 py-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[0.9rem] text-[#612323]">
              <input
                type="checkbox"
                checked={showShareImportDeltaOnly}
                onChange={(event) => {
                  setShowShareImportDeltaOnly(event.target.checked);
                }}
              />
              Show delta only
            </label>
            <p className="m-0 text-[0.82rem] text-[#874040]">{showShareImportDeltaOnly ? "Showing only changes vs current settings." : "Showing full imported settings."}</p>
          </div>

          <div className="share-import-scroll grid gap-2.5 overflow-auto pr-1">
            <div className="share-import-overview grid gap-1.5 rounded-[10px] border border-[#f0cdcd] bg-[#fff8f8] p-2.5">
              {visibleShareImportOverviewLines.map((line, index) => (
                <p key={`overview-${index}`} className="m-0 leading-[1.4] text-[#612323]">
                  {line}
                </p>
              ))}
            </div>

            <div className="share-import-summary grid gap-2.5 rounded-[10px] border border-[#eadfdf] bg-[#fffcfc] p-2.5">
              {visibleShareImportSections.length > 0 ? (
                visibleShareImportSections.map((section) => (
                  <section key={`${section.scope}:${section.title}`} className="grid gap-1.5">
                    <h4 className="m-0 text-[0.95rem] text-[#652626]">{section.title}</h4>
                    {section.items.length > 0 ? (
                      <ul className="m-0 list-none p-0">
                        {section.items.map((item, index) => (
                          <li key={`${section.title}-${index}`} className="rounded-md border border-[#ecd2d2] bg-[#fffafa] px-2 py-1.5 text-[0.9rem] text-[#3e2626]">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-[0.9rem] text-[#724242]">None</p>
                    )}
                  </section>
                ))
              ) : (
                <p className="m-0 text-[0.9rem] text-[#724242]">No effective changes detected.</p>
              )}
            </div>
          </div>

          <div className="dialog-actions mt-1.5 flex justify-end gap-2.5">
            <button type="button" className="btn btn-subtle" onClick={dismissShareImport}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void handleApplyShareImport()}>
              Import & Overwrite
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        id="message-dialog"
        ref={messageDialogRef}
        className={cn("max-h-[calc(100dvh-24px)] w-[min(520px,92vw)] overflow-hidden rounded-[12px] border border-app-line bg-app-panel p-0 text-app-ink", messageDialog?.tone === "danger" && "is-danger")}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeMessageDialog(false);
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          closeMessageDialog(false);
        }}
        onClose={() => {
          if (messageResolverRef.current) {
            closeMessageDialog(false);
          }
        }}
      >
        <div className="message-wrap grid max-h-[calc(100dvh-24px)] gap-2.5 overflow-auto p-[18px]">
          <h3 id="message-title" className="m-0 text-[1.1rem]">
            {messageDialog?.title ?? "Notice"}
          </h3>
          <div id="message-body" className="message-body grid gap-2">
            {renderMessageBody(messageDialog?.body ?? "")}
          </div>
          <div className="dialog-actions mt-1.5 flex justify-end gap-2.5">
            <button type="button" id="message-cancel" className="btn btn-subtle" hidden={!messageDialog?.isConfirm} onClick={() => closeMessageDialog(false)}>
              {messageDialog?.cancelLabel ?? "Cancel"}
            </button>
            <button type="button" id="message-ok" className={cn("btn", messageDialog?.tone === "danger" ? "btn-danger" : "btn-primary")} onClick={() => closeMessageDialog(true)}>
              {messageDialog?.okLabel ?? "OK"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}

createRoot(app).render(<BangsFastApp />);

import { ensureBangDataset, readBangDatasets, type BangDatasetMap } from "./redirect/dataset-cache";
import { removeSessionStorageItem } from "./redirect/browser-storage";
import { mergeBangDatasets } from "./redirect/dataset-merge";
import { ensureRedirectIndex, readRawStateStorage } from "./redirect/index-cache";
import { logNonFatalError } from "./redirect/non-fatal";
import { resolveRedirectUrlFromIndex } from "./redirect/runtime";
import { type BangDatasetSourceId } from "./data/bang-datasets";
import { readBangSourceConfig } from "./redirect/source-config";
import { readHashSearchQuery } from "./search-url";
import { forceEditorServiceWorkerUpdate } from "./service-worker-registration";

const SHELL_RECOVERY_KEY = "bangs-shell-recovery-attempts-v1";
const SHELL_RECOVERY_PARAM = "__shell_recover";

const currentUrl = new URL(window.location.href);
const hadRecoveryParam = currentUrl.searchParams.has(SHELL_RECOVERY_PARAM);
if (hadRecoveryParam) {
  currentUrl.searchParams.delete(SHELL_RECOVERY_PARAM);
}

removeSessionStorageItem(SHELL_RECOVERY_KEY);

if (hadRecoveryParam) {
  window.history.replaceState(null, "", currentUrl.toString());
}

const searchQuery = readHashSearchQuery(currentUrl.hash);

if (searchQuery) {
  void handleQueryNavigation(currentUrl, searchQuery);
} else {
  void import("./app");
}

async function handleQueryNavigation(url: URL, rawQuery: string): Promise<void> {
  const rawState = readRawStateStorage();
  const sourceConfig = readBangSourceConfig();
  let datasets = await readBangDatasets(sourceConfig.enabled);

  if (!hasAnyEnabledDataset(sourceConfig.enabled, datasets)) {
    datasets = await hydrateEnabledDatasets(sourceConfig.enabled, datasets);
    void installServiceWorkerForSearchNavigation();
  }

  const merged = mergeBangDatasets(sourceConfig, datasets);
  const compiledIndex = await ensureRedirectIndex(rawState, merged.hash, merged.bangs);
  let redirectUrl = compiledIndex ? resolveRedirectUrlFromIndex(url, compiledIndex) : null;
  if (!redirectUrl) {
    redirectUrl = await resolveFallbackRedirectUrl(url, rawState);
  }

  if (redirectUrl) {
    window.location.replace(redirectUrl);
    return;
  }

  window.location.replace(buildEmergencyFallbackUrl(rawQuery));
}

async function resolveFallbackRedirectUrl(url: URL, rawState: string): Promise<string | null> {
  try {
    const { compileRedirectIndex } = await import("./redirect/build-index");
    const fallbackIndex = compileRedirectIndex(rawState, "query-local-fallback", []);
    return resolveRedirectUrlFromIndex(url, fallbackIndex);
  } catch (error) {
    logNonFatalError("Failed to build fallback redirect index during query navigation", error);
    return null;
  }
}

function buildEmergencyFallbackUrl(rawQuery: string): string {
  if (!rawQuery) return "https://www.google.com/";
  return `https://www.google.com/search?q=${encodeURIComponent(rawQuery)}`;
}

function hasAnyEnabledDataset(sourceIds: readonly BangDatasetSourceId[], datasets: BangDatasetMap): boolean {
  return sourceIds.some((sourceId) => Boolean(datasets[sourceId]));
}

async function hydrateEnabledDatasets(sourceIds: readonly BangDatasetSourceId[], current: BangDatasetMap): Promise<BangDatasetMap> {
  const next = { ...current };

  for (const sourceId of sourceIds) {
    if (next[sourceId]) continue;
    try {
      next[sourceId] = await ensureBangDataset(sourceId);
    } catch (error) {
      logNonFatalError(`Failed to hydrate dataset "${sourceId}" during hash search bootstrap`, error);
    }
  }

  return next;
}

async function installServiceWorkerForSearchNavigation(): Promise<void> {
  try {
    const updateTriggered = await forceEditorServiceWorkerUpdate(__APP_BUILD_ID__, {
      reloadOnControllerChange: false,
    });
    if (!updateTriggered) return;

    const registration = await navigator.serviceWorker.ready;
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  } catch (error) {
    logNonFatalError("Service worker bootstrap for hash search navigation failed", error);
  }
}

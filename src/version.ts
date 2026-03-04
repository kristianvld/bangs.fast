import type { BangDatasetSourceId } from "./data/bang-datasets";
import { sanitizeOptionalText } from "./redirect/sanitize";

const APP_VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const SOURCE_IDS: readonly BangDatasetSourceId[] = ["kagi-community", "kagi-internal", "duckduckgo"];

export type AppVersionDatasetSnapshot = {
  hash: string;
};

export type AppVersionSnapshot = {
  appBuildId: string;
  generatedAt: string;
  datasets: Partial<Record<BangDatasetSourceId, AppVersionDatasetSnapshot>>;
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

export function sanitizeAppVersionSnapshot(raw: unknown): AppVersionSnapshot | null {
  if (!isRecord(raw)) return null;

  const appBuildId = sanitizeOptionalText(raw.appBuildId, 160);
  if (!appBuildId) return null;

  const generatedAt = normalizeIsoTimestamp(raw.generatedAt);
  const datasets: Partial<Record<BangDatasetSourceId, AppVersionDatasetSnapshot>> = {};

  const datasetsObj = isRecord(raw.datasets) ? raw.datasets : {};
  for (const sourceId of SOURCE_IDS) {
    const candidate = datasetsObj[sourceId];
    if (!isRecord(candidate)) continue;

    const hash = sanitizeOptionalText(candidate.hash, 120);
    if (!hash) continue;

    datasets[sourceId] = { hash };
  }

  return {
    appBuildId,
    generatedAt,
    datasets,
  };
}

export async function fetchAppVersionSnapshot(signal?: AbortSignal): Promise<AppVersionSnapshot> {
  const response = await fetch(APP_VERSION_URL, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${APP_VERSION_URL} (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  const snapshot = sanitizeAppVersionSnapshot(payload);
  if (!snapshot) {
    throw new Error("App version payload is invalid");
  }

  return snapshot;
}

import {
  DEFAULT_BANG_SOURCE_ORDER,
  fetchLatestBangDataset,
  sanitizeStoredBangDataset,
  type BangDatasetSourceId,
  type StoredBangDataset,
} from "../data/bang-datasets";
import { deleteStoredBangDatasetByKey, readStoredBangDatasetByKey, writeStoredBangDatasetByKey } from "./store";

export type BangDatasetMap = Partial<Record<BangDatasetSourceId, StoredBangDataset>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readBangDataset(sourceId: BangDatasetSourceId): Promise<StoredBangDataset | null> {
  const raw = await readStoredBangDatasetByKey(sourceId);
  if (!raw) return null;

  const sanitized = sanitizeStoredBangDataset(raw);
  if (!sanitized || sanitized.sourceId !== sourceId) {
    await deleteStoredBangDatasetByKey(sourceId);
    return null;
  }

  const rawRecord = isRecord(raw) ? raw : null;
  const shouldRewrite =
    !rawRecord
    || rawRecord.sourceId !== sanitized.sourceId
    || rawRecord.hash !== sanitized.hash
    || rawRecord.sourceUrl !== sanitized.sourceUrl
    || rawRecord.fetchedAt !== sanitized.fetchedAt;

  if (shouldRewrite) {
    await writeStoredBangDatasetByKey(sourceId, sanitized);
  }

  return sanitized;
}

export async function readBangDatasets(sourceIds: readonly BangDatasetSourceId[] = DEFAULT_BANG_SOURCE_ORDER): Promise<BangDatasetMap> {
  const map: BangDatasetMap = {};
  for (const sourceId of sourceIds) {
    const dataset = await readBangDataset(sourceId);
    if (dataset) {
      map[sourceId] = dataset;
    }
  }
  return map;
}

export async function saveBangDataset(dataset: StoredBangDataset): Promise<StoredBangDataset> {
  const sanitized = sanitizeStoredBangDataset(dataset);
  if (!sanitized) {
    throw new Error("Cannot persist invalid dataset payload");
  }
  await writeStoredBangDatasetByKey(sanitized.sourceId, sanitized);
  return sanitized;
}

export async function ensureBangDataset(sourceId: BangDatasetSourceId): Promise<StoredBangDataset> {
  const cached = await readBangDataset(sourceId);
  if (cached) return cached;

  const latest = await fetchLatestBangDataset(sourceId);
  await writeStoredBangDatasetByKey(sourceId, latest);
  return latest;
}

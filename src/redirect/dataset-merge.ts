import type { BangDatasetEntry, BangDatasetSourceId } from "../data/bang-datasets";
import type { BangDatasetMap } from "./dataset-cache";
import type { BangSourceConfig } from "./source-config";

export type MergedBangDataset = {
  bangs: BangDatasetEntry[];
  hash: string;
  enabledSources: BangDatasetSourceId[];
  loadedSources: BangDatasetSourceId[];
};

export function enabledSourceOrder(config: BangSourceConfig): BangDatasetSourceId[] {
  const enabledSet = new Set(config.enabled);
  return config.order.filter((sourceId) => enabledSet.has(sourceId));
}

function buildMergedDatasetVersion(enabledSources: readonly BangDatasetSourceId[], datasetMap: BangDatasetMap): string {
  return enabledSources
    .map((sourceId) => {
      const dataset = datasetMap[sourceId];
      return `${sourceId}:${dataset?.hash ?? "missing"}`;
    })
    .join("|");
}

export function mergeBangDatasets(config: BangSourceConfig, datasetMap: BangDatasetMap): MergedBangDataset {
  const enabledSources = enabledSourceOrder(config);
  const triggerMap = new Map<string, BangDatasetEntry>();
  const loadedSources: BangDatasetSourceId[] = [];

  for (const sourceId of [...enabledSources].reverse()) {
    const dataset = datasetMap[sourceId];
    if (!dataset) continue;
    loadedSources.push(sourceId);
    for (const bang of dataset.bangs) {
      triggerMap.set(bang.t, bang);
    }
  }

  const bangs = [...triggerMap.values()].sort((a, b) => a.t.localeCompare(b.t));

  return {
    bangs,
    hash: buildMergedDatasetVersion(enabledSources, datasetMap),
    enabledSources,
    loadedSources,
  };
}

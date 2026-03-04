import { DEFAULT_BANG_SOURCE_ORDER } from "../data/bang-datasets";
import { removeLocalStorageItem } from "./browser-storage";
import { STATE_STORAGE_KEY } from "./constants";
import { SOURCE_CONFIG_STORAGE_KEY } from "./source-config";
import { deleteCompiledRedirectIndex, deleteStoredBangDatasetByKey } from "./store";

export async function resetLocalData(): Promise<void> {
  removeLocalStorageItem(STATE_STORAGE_KEY);
  removeLocalStorageItem(SOURCE_CONFIG_STORAGE_KEY);

  await Promise.allSettled([
    deleteCompiledRedirectIndex(),
    ...DEFAULT_BANG_SOURCE_ORDER.map((sourceId) => deleteStoredBangDatasetByKey(sourceId)),
  ]);
}

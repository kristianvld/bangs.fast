import { readLocalStorageItem } from "./browser-storage";
import { REDIRECT_INDEX_VERSION, STATE_STORAGE_KEY } from "./constants";
import { logNonFatalError } from "./non-fatal";
import { buildRedirectStateSignature } from "./signature";
import { readCompiledRedirectIndex, writeCompiledRedirectIndex } from "./store";
import type { CompiledRedirectIndex } from "./types";

function isCurrentIndex(index: CompiledRedirectIndex, signature: string): boolean {
  return index.v === REDIRECT_INDEX_VERSION && index.s === signature;
}

export function readRawStateStorage(): string {
  return readLocalStorageItem(STATE_STORAGE_KEY) ?? "";
}

export async function ensureRedirectIndex(
  rawState: string,
  datasetHash: string,
  baseBangs: readonly unknown[],
): Promise<CompiledRedirectIndex | null> {
  const signature = buildRedirectStateSignature(rawState, datasetHash);

  try {
    const cached = await readCompiledRedirectIndex();
    if (cached && isCurrentIndex(cached, signature)) {
      return cached;
    }

    const { compileRedirectIndex } = await import("./build-index");
    const compiled = compileRedirectIndex(rawState, signature, baseBangs);
    await writeCompiledRedirectIndex(compiled);
    return compiled;
  } catch (error) {
    logNonFatalError("Failed to build or persist redirect index", error);
    return null;
  }
}

import { logNonFatalError } from "./non-fatal";

function storageAvailable(storage: Storage | undefined): storage is Storage {
  return typeof storage !== "undefined";
}

function readFromStorage(storage: Storage | undefined, storageName: "localStorage" | "sessionStorage", key: string): string | null {
  if (!storageAvailable(storage)) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    logNonFatalError(`Failed to read ${storageName} key "${key}"`, error);
    return null;
  }
}

function writeToStorage(storage: Storage | undefined, storageName: "localStorage" | "sessionStorage", key: string, value: string): boolean {
  if (!storageAvailable(storage)) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    logNonFatalError(`Failed to write ${storageName} key "${key}"`, error);
    return false;
  }
}

function removeFromStorage(storage: Storage | undefined, storageName: "localStorage" | "sessionStorage", key: string): boolean {
  if (!storageAvailable(storage)) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    logNonFatalError(`Failed to remove ${storageName} key "${key}"`, error);
    return false;
  }
}

export function readLocalStorageItem(key: string): string | null {
  return readFromStorage(globalThis.localStorage, "localStorage", key);
}

export function writeLocalStorageItem(key: string, value: string): boolean {
  return writeToStorage(globalThis.localStorage, "localStorage", key, value);
}

export function removeLocalStorageItem(key: string): boolean {
  return removeFromStorage(globalThis.localStorage, "localStorage", key);
}

export function readSessionStorageItem(key: string): string | null {
  return readFromStorage(globalThis.sessionStorage, "sessionStorage", key);
}

export function writeSessionStorageItem(key: string, value: string): boolean {
  return writeToStorage(globalThis.sessionStorage, "sessionStorage", key, value);
}

export function removeSessionStorageItem(key: string): boolean {
  return removeFromStorage(globalThis.sessionStorage, "sessionStorage", key);
}

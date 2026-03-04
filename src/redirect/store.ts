import type { StoredBangDataset } from "../data/bang-datasets";
import {
  BANG_DATASET_STORE_NAME,
  REDIRECT_INDEX_DB_NAME,
  REDIRECT_INDEX_STORE_KEY,
  REDIRECT_INDEX_STORE_NAME,
} from "./constants";
import type { CompiledRedirectIndex } from "./types";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openRedirectDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(REDIRECT_INDEX_DB_NAME, 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(REDIRECT_INDEX_STORE_NAME)) {
      db.createObjectStore(REDIRECT_INDEX_STORE_NAME);
    }
    if (!db.objectStoreNames.contains(BANG_DATASET_STORE_NAME)) {
      db.createObjectStore(BANG_DATASET_STORE_NAME);
    }
  };
  return requestToPromise(request);
}

export async function readCompiledRedirectIndex(): Promise<CompiledRedirectIndex | null> {
  if (typeof indexedDB === "undefined") return null;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(REDIRECT_INDEX_STORE_NAME, "readonly");
    const store = tx.objectStore(REDIRECT_INDEX_STORE_NAME);
    const result = await requestToPromise(store.get(REDIRECT_INDEX_STORE_KEY));
    await transactionDone(tx);
    return (result as CompiledRedirectIndex | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function writeCompiledRedirectIndex(index: CompiledRedirectIndex): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(REDIRECT_INDEX_STORE_NAME, "readwrite");
    const store = tx.objectStore(REDIRECT_INDEX_STORE_NAME);
    store.put(index, REDIRECT_INDEX_STORE_KEY);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteCompiledRedirectIndex(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(REDIRECT_INDEX_STORE_NAME, "readwrite");
    const store = tx.objectStore(REDIRECT_INDEX_STORE_NAME);
    store.delete(REDIRECT_INDEX_STORE_KEY);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function readStoredBangDatasetByKey(key: string): Promise<unknown> {
  if (typeof indexedDB === "undefined") return null;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(BANG_DATASET_STORE_NAME, "readonly");
    const store = tx.objectStore(BANG_DATASET_STORE_NAME);
    const result = await requestToPromise(store.get(key));
    await transactionDone(tx);
    return (result as unknown) ?? null;
  } finally {
    db.close();
  }
}

export async function writeStoredBangDatasetByKey(key: string, dataset: StoredBangDataset): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(BANG_DATASET_STORE_NAME, "readwrite");
    const store = tx.objectStore(BANG_DATASET_STORE_NAME);
    store.put(dataset, key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteStoredBangDatasetByKey(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const db = await openRedirectDb();
  try {
    const tx = db.transaction(BANG_DATASET_STORE_NAME, "readwrite");
    const store = tx.objectStore(BANG_DATASET_STORE_NAME);
    store.delete(key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

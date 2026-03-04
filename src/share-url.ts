const SHARE_HASH_KEY = "share=";
const SHARE_HASH_VERSION = "v1";
const MAX_HASH_TOKEN_LENGTH = 250_000;
const MAX_BINARY_PAYLOAD_BYTES = 250_000;
const MAX_JSON_PAYLOAD_CHARS = 1_200_000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ShareHashEncoding = "compressed" | "raw";

export type ShareHashDecodeResult =
  | {
      ok: true;
      payload: unknown;
      encoding: ShareHashEncoding;
      serializedLength: number;
    }
  | {
      ok: false;
      reason: string;
    };

function stripLeadingHash(rawHash: string): string {
  return rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(encoded: string): Uint8Array | null {
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = `${base64}${"=".repeat(padLength)}`;

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (_error) {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId = 0;
  try {
    return await Promise.race<T | null>([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function runThroughStream(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Attach a reader before writing so TransformStream backpressure cannot deadlock in Firefox.
  const outputPromise = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  try {
    await writer.write(toArrayBuffer(bytes));
    await writer.close();
  } finally {
    writer.releaseLock();
  }

  const buffer = await outputPromise;
  return new Uint8Array(buffer);
}

async function compress(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") return null;
  try {
    return await withTimeout(runThroughStream(bytes, new CompressionStream("deflate")), 1500);
  } catch (_error) {
    return null;
  }
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream !== "function") return null;
  try {
    return await withTimeout(runThroughStream(bytes, new DecompressionStream("deflate")), 1500);
  } catch (_error) {
    return null;
  }
}

function modeToEncoding(mode: "c" | "r"): ShareHashEncoding {
  return mode === "c" ? "compressed" : "raw";
}

function encodingToMode(encoding: ShareHashEncoding): "c" | "r" {
  return encoding === "compressed" ? "c" : "r";
}

export function extractShareTokenFromHash(rawHash: string): string | null {
  const hash = stripLeadingHash(rawHash).trim();
  if (!hash) return null;
  if (hash.startsWith(SHARE_HASH_KEY)) return hash.slice(SHARE_HASH_KEY.length);
  if (hash.startsWith("share:")) return hash.slice("share:".length);
  if (/^v1[cr][.:]/.test(hash)) return hash;
  return null;
}

export async function encodeSharePayloadToHashToken(payload: unknown): Promise<{
  token: string;
  encoding: ShareHashEncoding;
}> {
  const serialized = JSON.stringify(payload);
  const rawBytes: Uint8Array = new TextEncoder().encode(serialized);

  let encoding: ShareHashEncoding = "raw";
  let payloadBytes = rawBytes;

  const compressed = await compress(rawBytes);
  if (compressed && compressed.length > 0 && compressed.length + 16 < rawBytes.length) {
    encoding = "compressed";
    payloadBytes = compressed;
  }

  const mode = encodingToMode(encoding);
  const encodedPayload = encodeBase64Url(payloadBytes);
  return {
    token: `${SHARE_HASH_KEY}${SHARE_HASH_VERSION}${mode}.${encodedPayload}`,
    encoding,
  };
}

export async function decodeSharePayloadFromHash(rawHash: string): Promise<ShareHashDecodeResult> {
  const token = extractShareTokenFromHash(rawHash);
  if (!token) {
    return { ok: false, reason: "No share payload found in URL hash." };
  }

  if (token.length > MAX_HASH_TOKEN_LENGTH) {
    return { ok: false, reason: "Shared settings payload is too large." };
  }

  const match = token.match(/^v1([cr])[.:]([A-Za-z0-9_-]+)$/);
  if (!match) {
    return { ok: false, reason: "Unsupported shared settings format." };
  }

  const mode = match[1] as "c" | "r";
  const encodedPayload = match[2];
  const decodedBytes = decodeBase64Url(encodedPayload);
  if (!decodedBytes) {
    return { ok: false, reason: "Shared settings payload is not valid base64url data." };
  }

  if (decodedBytes.length > MAX_BINARY_PAYLOAD_BYTES) {
    return { ok: false, reason: "Shared settings payload exceeds size limits." };
  }

  let payloadBytes = decodedBytes;
  if (mode === "c") {
    const decompressed = await decompress(decodedBytes);
    if (!decompressed) {
      return { ok: false, reason: "This browser could not decompress the shared settings payload." };
    }
    payloadBytes = decompressed;
  }

  if (payloadBytes.length > MAX_JSON_PAYLOAD_CHARS) {
    return { ok: false, reason: "Decoded shared settings payload exceeds size limits." };
  }

  const serialized = new TextDecoder().decode(payloadBytes);
  if (serialized.length > MAX_JSON_PAYLOAD_CHARS) {
    return { ok: false, reason: "Decoded shared settings JSON exceeds size limits." };
  }

  try {
    return {
      ok: true,
      payload: JSON.parse(serialized) as unknown,
      encoding: modeToEncoding(mode),
      serializedLength: serialized.length,
    };
  } catch (_error) {
    return { ok: false, reason: "Shared settings payload contains invalid JSON." };
  }
}

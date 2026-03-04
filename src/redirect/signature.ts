import { fnv1aHex } from "./hash";

export function buildRedirectStateSignature(rawState: string, datasetHash: string): string {
  return `${__APP_BUILD_ID__}:${fnv1aHex(`${datasetHash}\n${rawState}`)}`;
}

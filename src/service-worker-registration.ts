import { logNonFatalError } from "./redirect/non-fatal";
import { readLocalStorageItem, writeLocalStorageItem } from "./redirect/browser-storage";

const SERVICE_WORKER_BUILD_ID_KEY = "bangs-sw-build-id-v1";

type ServiceWorkerUpdateOptions = {
  reloadOnControllerChange?: boolean;
};

function resolveSwLocation(): { scope: string; swUrl: string } {
  const scope = import.meta.env.BASE_URL;
  return {
    scope,
    swUrl: `${scope}sw.js`,
  };
}

function supportsServiceWorker(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

function canRegisterServiceWorker(): boolean {
  return supportsServiceWorker() && window.isSecureContext;
}

function isInsecureRegistrationError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  if (error.name === "SecurityError") return true;
  return /insecure/i.test(error.message);
}

function buildVersionedSwUrl(swUrl: string, version: string): string {
  const url = new URL(swUrl, window.location.origin);
  url.searchParams.set("v", version);
  return url.toString();
}

function extractServiceWorkerVersion(scriptUrl: string | null | undefined): string | null {
  if (!scriptUrl) return null;

  try {
    const parsed = new URL(scriptUrl);
    return parsed.searchParams.get("v");
  } catch (_error) {
    return null;
  }
}

function readStoredServiceWorkerBuildId(): string | null {
  const value = readLocalStorageItem(SERVICE_WORKER_BUILD_ID_KEY);
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function writeStoredServiceWorkerBuildId(buildId: string): void {
  writeLocalStorageItem(SERVICE_WORKER_BUILD_ID_KEY, buildId);
}

function collectRegistrationVersions(registration: ServiceWorkerRegistration | null | undefined): Set<string> {
  const versions = new Set<string>();
  if (!registration) return versions;

  const workers = [registration.active, registration.waiting, registration.installing];
  for (const worker of workers) {
    const version = extractServiceWorkerVersion(worker?.scriptURL);
    if (version) {
      versions.add(version);
    }
  }

  return versions;
}

function usesDesiredUpdateViaCache(registration: ServiceWorkerRegistration | null | undefined): boolean {
  return registration?.updateViaCache === "all";
}

export async function forceEditorServiceWorkerUpdate(targetBuildId: string, options: ServiceWorkerUpdateOptions = {}): Promise<boolean> {
  if (!canRegisterServiceWorker()) return false;
  const normalizedBuildId = targetBuildId.trim();
  if (!normalizedBuildId) return false;
  const reloadOnControllerChange = options.reloadOnControllerChange !== false;

  const { scope, swUrl } = resolveSwLocation();

  try {
    const current = await navigator.serviceWorker.getRegistration(scope);
    const currentVersions = collectRegistrationVersions(current);
    const hasDesiredUpdatePolicy = usesDesiredUpdateViaCache(current);

    if (currentVersions.has(normalizedBuildId)) {
      writeStoredServiceWorkerBuildId(normalizedBuildId);
      if (hasDesiredUpdatePolicy) {
        return false;
      }
    }

    if (current && currentVersions.size === 0) {
      // Some browsers may expose worker scriptURL without query params.
      if (readStoredServiceWorkerBuildId() === normalizedBuildId) {
        if (hasDesiredUpdatePolicy) {
          return false;
        }
      }
    }

    if (reloadOnControllerChange) {
      let reloading = false;
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        },
        { once: true },
      );
    }

    await navigator.serviceWorker.register(buildVersionedSwUrl(swUrl, normalizedBuildId), {
      scope,
      updateViaCache: "all",
    });
    writeStoredServiceWorkerBuildId(normalizedBuildId);
    return true;
  } catch (error) {
    if (isInsecureRegistrationError(error)) {
      return false;
    }
    logNonFatalError("Service worker update registration failed", error);
    return false;
  }
}

export async function checkForEditorServiceWorkerUpdate(targetBuildId: string): Promise<void> {
  const updateTriggered = await forceEditorServiceWorkerUpdate(targetBuildId);
  if (!updateTriggered) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  } catch (error) {
    logNonFatalError("Service worker update readiness check failed", error);
  }
}

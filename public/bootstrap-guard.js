(() => {
  const RECOVERY_KEY = "bangs-shell-recovery-attempts-v1";
  const RECOVERY_PARAM = "__shell_recover";
  const MAX_RECOVERY_ATTEMPTS = 2;

  let recoveryTriggered = false;

  function readRecoveryAttempts() {
    try {
      const raw = window.sessionStorage.getItem(RECOVERY_KEY);
      if (!raw) return 0;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (_error) {
      return 0;
    }
  }

  function writeRecoveryAttempts(nextAttempts) {
    try {
      window.sessionStorage.setItem(RECOVERY_KEY, String(nextAttempts));
    } catch (_error) {
      // Ignore storage write errors.
    }
  }

  async function clearServiceWorkerAndCacheStorage() {
    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(registrations.map((registration) => registration.unregister()));
      } catch (_error) {
        // Ignore recovery cleanup errors.
      }
    }

    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.allSettled(keys.map((key) => caches.delete(key)));
      } catch (_error) {
        // Ignore recovery cleanup errors.
      }
    }
  }

  function buildRecoveryUrl() {
    const target = new URL(window.location.href);
    target.searchParams.set(RECOVERY_PARAM, Date.now().toString(36));
    return target.toString();
  }

  async function runRecovery() {
    if (recoveryTriggered) return;

    const attempts = readRecoveryAttempts();
    if (attempts >= MAX_RECOVERY_ATTEMPTS) return;

    recoveryTriggered = true;
    writeRecoveryAttempts(attempts + 1);

    await clearServiceWorkerAndCacheStorage();
    window.location.replace(buildRecoveryUrl());
  }

  function matchesChunkLoadFailureReason(reason) {
    if (!reason) return false;
    return (
      reason.includes("Failed to fetch dynamically imported module")
      || reason.includes("Importing a module script failed")
      || reason.includes("NS_ERROR_CORRUPTED_CONTENT")
      || reason.includes("ChunkLoadError")
      || reason.includes("Loading module from")
    );
  }

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLScriptElement)) return;
    if (target.type !== "module") return;
    void runRecovery();
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    if (!matchesChunkLoadFailureReason(message)) return;
    void runRecovery();
  });
})();

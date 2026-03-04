import { expect, test, type Page } from "@playwright/test";

const APP_DB_NAME = "bangs-redirect-index";
const DATASET_STORE_NAME = "datasets";
const COMMUNITY_SOURCE_ID = "kagi-community";

type VersionFixture = {
  appBuildId: string;
  hash: string;
};

type DatasetFixture = {
  hash: string;
  trigger: string;
  name: string;
  template: string;
  domain: string;
};

function buildVersionFixture({ appBuildId, hash }: VersionFixture): Record<string, unknown> {
  return {
    appBuildId,
    generatedAt: new Date().toISOString(),
    datasets: {
      [COMMUNITY_SOURCE_ID]: { hash },
    },
  };
}

function buildCommunityDatasetFixture({ hash, trigger, name, template, domain }: DatasetFixture): Record<string, unknown> {
  return {
    sourceId: COMMUNITY_SOURCE_ID,
    sourceUrl: "/datasets/kagi-community.json",
    fetchedAt: new Date().toISOString(),
    hash,
    bangs: [
      {
        t: trigger,
        s: name,
        d: domain,
        u: template,
      },
    ],
  };
}

async function waitForEditorReady(page: Page): Promise<void> {
  await expect(page.locator("#editor-panel")).toBeVisible();
  await expect(page.locator("#bangs-loading-overlay")).toBeHidden();
}

async function readStoredDatasetHash(page: Page, sourceId: string): Promise<string | null> {
  try {
    return await page.evaluate(
      async ({ key, dbName, storeName }) => {
        if (typeof indexedDB === "undefined") return null;

        return await new Promise<string | null>((resolve) => {
          const openRequest = indexedDB.open(dbName);

          openRequest.onerror = () => resolve(null);
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            if (!db.objectStoreNames.contains(storeName)) {
              db.close();
              resolve(null);
              return;
            }

            let resolved = false;
            const tx = db.transaction(storeName, "readonly");
            const request = tx.objectStore(storeName).get(key);

            request.onerror = () => {
              if (resolved) return;
              resolved = true;
              db.close();
              resolve(null);
            };
            request.onsuccess = () => {
              if (resolved) return;
              resolved = true;
              const value = request.result as { hash?: unknown } | undefined;
              const hash = typeof value?.hash === "string" ? value.hash : null;
              db.close();
              resolve(hash);
            };

            tx.onabort = () => {
              if (resolved) return;
              resolved = true;
              db.close();
              resolve(null);
            };
          };
        });
      },
      { key: sourceId, dbName: APP_DB_NAME, storeName: DATASET_STORE_NAME },
    );
  } catch (_error) {
    // The page can transiently reload (e.g. service-worker controllerchange); let poll retry.
    return null;
  }
}

async function readServiceWorkerSnapshot(page: Page): Promise<{ scriptUrl: string; updateViaCache: string } | null> {
  try {
    return await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return null;
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find((entry) =>
        [entry.active?.scriptURL, entry.waiting?.scriptURL, entry.installing?.scriptURL].some((url) => typeof url === "string" && url.includes("/sw.js")),
      );
      if (!registration) return null;

      const scriptUrl = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
      if (!scriptUrl) return null;

      return {
        scriptUrl,
        updateViaCache: registration.updateViaCache,
      };
    });
  } catch (_error) {
    // The page can transiently reload while worker control is taking over.
    return null;
  }
}

async function readServiceWorkerControllerScriptUrl(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      if (!("serviceWorker" in navigator)) return null;
      return navigator.serviceWorker.controller?.scriptURL ?? null;
    });
  } catch (_error) {
    return null;
  }
}

async function readLocalStorageValue(page: Page, key: string): Promise<string | null> {
  try {
    return await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  } catch (_error) {
    // The page can transiently reload while service-worker updates roll out.
    return null;
  }
}

test("registers a versioned service worker in editor mode", async ({ page }) => {
  await page.goto("/");
  await waitForEditorReady(page);

  await expect
    .poll(async () => {
      return await readServiceWorkerSnapshot(page);
    })
    .not.toBeNull();

  const snapshot = await readServiceWorkerSnapshot(page);
  expect(snapshot).not.toBeNull();
  expect(snapshot?.scriptUrl).toContain("/sw.js?v=");
  expect(snapshot?.updateViaCache).toBe("all");
});

test("editor detects app build updates and rolls service worker to new build id", async ({ context, page }) => {
  let generation = 1;
  const buildV1 = "sw-roll-v1";
  const buildV2 = "sw-roll-v2";
  const stableDatasetHash = "sw-roll-hash";
  const swScriptRequests: string[] = [];

  await context.route("**/version.json", async (route) => {
    const appBuildId = generation === 1 ? buildV1 : buildV2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildVersionFixture({ appBuildId, hash: stableDatasetHash })),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: stableDatasetHash,
          trigger: "swroll",
          name: "SW Roll",
          template: "https://example.com/sw-roll?q={{{s}}}",
          domain: "example.com",
        }),
      ),
    });
  });

  await context.route("**/sw.js*", async (route) => {
    swScriptRequests.push(route.request().url());
    await route.fallback();
  });

  await page.goto("/");
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!swroll");

  await expect
    .poll(async () => {
      const snapshot = await readServiceWorkerSnapshot(page);
      return snapshot?.scriptUrl ?? null;
    })
    .toContain(`/sw.js?v=${buildV1}`);

  await expect
    .poll(async () => {
      return await readLocalStorageValue(page, "bangs-sw-build-id-v1");
    })
    .toBe(buildV1);

  generation = 2;
  await page.reload();
  await waitForEditorReady(page);

  await expect
    .poll(async () => {
      const snapshot = await readServiceWorkerSnapshot(page);
      return snapshot?.scriptUrl ?? null;
    })
    .toContain(`/sw.js?v=${buildV2}`);

  await expect
    .poll(async () => {
      return await readLocalStorageValue(page, "bangs-sw-build-id-v1");
    })
    .toBe(buildV2);
  expect(swScriptRequests.some((url) => url.includes(`v=${buildV2}`))).toBe(true);
});

test("refreshes enabled dataset when version hash changes", async ({ context, page }) => {
  let generation = 1;
  let communityFetchCount = 0;

  await context.route("**/version.json", async (route) => {
    const payload =
      generation === 1
        ? buildVersionFixture({ appBuildId: "stable-build", hash: "community-hash-v1" })
        : buildVersionFixture({ appBuildId: "stable-build", hash: "community-hash-v2" });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    communityFetchCount += 1;
    const payload =
      generation === 1
        ? buildCommunityDatasetFixture({
            hash: "community-hash-v1",
            trigger: "versionone",
            name: "Version One Search",
            template: "https://example.com/v1?q={{{s}}}",
            domain: "example.com",
          })
        : buildCommunityDatasetFixture({
            hash: "community-hash-v2",
            trigger: "versiontwo",
            name: "Version Two Search",
            template: "https://example.com/v2?q={{{s}}}",
            domain: "example.com",
          });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto("/");
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!versionone");
  expect(communityFetchCount).toBeGreaterThan(0);
  await expect.poll(async () => readStoredDatasetHash(page, COMMUNITY_SOURCE_ID)).toBe("community-hash-v1");

  generation = 2;
  communityFetchCount = 0;

  await page.reload();
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!versiontwo");
  await expect(page.locator("#bang-table")).not.toContainText("!versionone");
  expect(communityFetchCount).toBeGreaterThan(0);
  await expect.poll(async () => readStoredDatasetHash(page, COMMUNITY_SOURCE_ID)).toBe("community-hash-v2");
});

test("editor revisit only fetches version.json when dataset hash is unchanged", async ({ context, page }) => {
  let versionFetchCount = 0;
  let communityFetchCount = 0;
  const stableAppBuild = "stable-editor-revisit-build";
  const stableDatasetHash = "stable-editor-revisit-hash";

  await context.route("**/version.json", async (route) => {
    versionFetchCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildVersionFixture({ appBuildId: stableAppBuild, hash: stableDatasetHash })),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    communityFetchCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: stableDatasetHash,
          trigger: "stableonly",
          name: "Stable Only Search",
          template: "https://example.com/stable?q={{{s}}}",
          domain: "example.com",
        }),
      ),
    });
  });

  await page.goto("/");
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!stableonly");
  await expect
    .poll(async () => {
      return await readServiceWorkerSnapshot(page);
    })
    .not.toBeNull();

  expect(versionFetchCount).toBeGreaterThan(0);
  expect(communityFetchCount).toBeGreaterThan(0);

  const appOrigin = new URL(page.url()).origin;
  versionFetchCount = 0;
  communityFetchCount = 0;

  const revisitSameOriginNetworkRequests: string[] = [];
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(`${appOrigin}/`)) {
      revisitSameOriginNetworkRequests.push(requestUrl);
    }
    await route.fallback();
  });

  await page.close();
  const revisitPage = await context.newPage();
  await revisitPage.goto("/");
  await waitForEditorReady(revisitPage);
  await expect(revisitPage.locator("#bang-table")).toContainText("!stableonly");
  await revisitPage.waitForTimeout(350);

  expect(versionFetchCount).toBeGreaterThan(0);
  expect(communityFetchCount).toBe(0);

  const revisitSameOriginPaths = [...new Set(revisitSameOriginNetworkRequests.map((url) => new URL(url).pathname))];
  expect(revisitSameOriginPaths).toEqual(["/version.json"]);
});

test("search mode performs zero same-origin network requests after warm cache", async ({ context, page }) => {
  await context.route("**/version.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildVersionFixture({ appBuildId: "build-local-query", hash: "local-hash-v1" })),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: "local-hash-v1",
          trigger: "localspec",
          name: "Local Spec",
          template: "https://example.com/search?q={{{s}}}",
          domain: "example.com",
        }),
      ),
    });
  });

  await page.goto("/");
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!localspec");
  await expect
    .poll(async () => {
      return await readServiceWorkerSnapshot(page);
    })
    .not.toBeNull();
  await expect
    .poll(async () => {
      return await readServiceWorkerControllerScriptUrl(page);
    })
    .toContain("/sw.js");

  const appOrigin = new URL(page.url()).origin;

  const sameOriginNetworkRequests: Array<{ method: string; resourceType: string; url: string }> = [];
  const unexpectedExternalNetworkRequests: Array<{ method: string; resourceType: string; url: string }> = [];
  let trackingEnabled = false;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();

    if (!trackingEnabled) {
      if (requestUrl.startsWith("https://example.com/")) {
        if (request.resourceType() === "document") {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><html><body>mock redirect target</body></html>",
          });
        } else {
          await route.fulfill({
            status: 204,
            contentType: "text/plain",
            body: "",
          });
        }
        return;
      }

      await route.fallback();
      return;
    }

    if (requestUrl.startsWith(`${appOrigin}/`)) {
      sameOriginNetworkRequests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: requestUrl,
      });
      await route.continue();
      return;
    }

    if (requestUrl.startsWith("https://example.com/")) {
      if (request.resourceType() === "document") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><body>mock redirect target</body></html>",
        });
      } else {
        await route.fulfill({
          status: 204,
          contentType: "text/plain",
          body: "",
        });
      }
      return;
    }

    unexpectedExternalNetworkRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: requestUrl,
    });
    await route.abort();
  });

  trackingEnabled = true;
  await page.goto("about:blank");
  await page.goto("/#q=!localspec%20offline%20check");
  await page.waitForURL("https://example.com/**");
  await page.waitForTimeout(400);

  const redirected = new URL(page.url());
  expect(`${redirected.origin}${redirected.pathname}`).toBe("https://example.com/search");
  expect(redirected.searchParams.get("q")).toBe("offline check");
  expect(sameOriginNetworkRequests).toEqual([]);
  expect(unexpectedExternalNetworkRequests).toEqual([]);
});

test("first-visit hash search bootstraps datasets without leaking query params to app origin", async ({ context, page }) => {
  let communityFetchCount = 0;
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL must be configured as a string for network assertions");
  }
  const appOrigin = new URL(baseURL).origin;
  const appOriginRequests: string[] = [];

  await context.route("**/datasets/kagi-community.json", async (route) => {
    communityFetchCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: "cold-hash-v1",
          trigger: "localspec",
          name: "Local Spec",
          template: "https://example.com/search?q={{{s}}}",
          domain: "example.com",
        }),
      ),
    });
  });

  await context.route("https://example.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>mock redirect target</body></html>",
    });
  });

  const onRequest = (request: { url: () => string }): void => {
    const requestUrl = request.url();
    if (requestUrl.startsWith(`${appOrigin}/`)) {
      appOriginRequests.push(requestUrl);
    }
  };
  context.on("request", onRequest);

  await page.goto("/#q=!localspec%20first%20visit");
  await page.waitForURL("https://example.com/**");
  await page.waitForTimeout(300);
  context.off("request", onRequest);

  const redirected = new URL(page.url());
  expect(`${redirected.origin}${redirected.pathname}`).toBe("https://example.com/search");
  expect(redirected.searchParams.get("q")).toBe("first visit");
  expect(communityFetchCount).toBeGreaterThan(0);

  const leakedQueryParamRequests = appOriginRequests.filter((requestUrl) => new URL(requestUrl).searchParams.has("q"));
  expect(leakedQueryParamRequests).toEqual([]);
});

test("query-string searches are ignored and stay in editor mode", async ({ context, page }) => {
  const unexpectedExternalDocumentRequests: string[] = [];

  await context.route("https://**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() === "document") {
      unexpectedExternalDocumentRequests.push(request.url());
      await route.abort();
      return;
    }
    await route.fallback();
  });

  await page.goto("/?q=!localspec%20legacy%20mode");
  await waitForEditorReady(page);
  await page.waitForTimeout(300);

  const current = new URL(page.url());
  expect(current.pathname).toBe("/");
  expect(current.searchParams.get("q")).toBe("!localspec legacy mode");
  expect(unexpectedExternalDocumentRequests).toEqual([]);
});

test("search mode preserves unknown bang tokens for default-engine searches", async ({ context, page }) => {
  await context.route("**/version.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildVersionFixture({ appBuildId: "build-unknown-bang", hash: "unknown-bang-hash-v1" })),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: "unknown-bang-hash-v1",
          trigger: "localspec",
          name: "Local Spec",
          template: "https://example.com/search?q={{{s}}}",
          domain: "example.com",
        }),
      ),
    });
  });

  await context.route("https://www.google.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>mock google result</body></html>",
    });
  });

  await page.goto("/#q=!thisdoesnotexist");
  await page.waitForURL("https://www.google.com/**");

  const redirected = new URL(page.url());
  expect(`${redirected.origin}${redirected.pathname}`).toBe("https://www.google.com/search");
  expect(redirected.searchParams.get("q")).toBe("!thisdoesnotexist");
});

test("search mode uses first known bang and keeps unknown bang tokens in the query text", async ({ context, page }) => {
  await context.route("**/version.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildVersionFixture({ appBuildId: "build-mixed-bang-query", hash: "mixed-hash-v1" })),
    });
  });

  await context.route("**/datasets/kagi-community.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        buildCommunityDatasetFixture({
          hash: "mixed-hash-v1",
          trigger: "y",
          name: "Yahoo",
          template: "https://search.yahoo.com/search?p={{{s}}}",
          domain: "search.yahoo.com",
        }),
      ),
    });
  });

  await context.route("https://search.yahoo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>mock yahoo result</body></html>",
    });
  });

  await context.route("https://www.google.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>mock google result</body></html>",
    });
  });

  await page.goto("/");
  await waitForEditorReady(page);
  await expect(page.locator("#bang-table")).toContainText("!y");

  await page.goto("about:blank");
  await page.goto("/#q=!fefe%20!y%20test");
  await expect
    .poll(() => page.url(), { timeout: 5_000 })
    .toContain("https://search.yahoo.com/");

  const redirected = new URL(page.url());
  expect(`${redirected.origin}${redirected.pathname}`).toBe("https://search.yahoo.com/search");
  expect(redirected.searchParams.get("p")).toBe("!fefe test");
});

test("shows copy-manual dialog when share-link clipboard write fails", async ({ context, page }) => {
  await context.addInitScript(() => {
    const blockedWrite = async (): Promise<void> => {
      throw new Error("clipboard-blocked");
    };

    try {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: { writeText: blockedWrite },
      });
    } catch (_error) {
      if (globalThis.navigator.clipboard) {
        globalThis.navigator.clipboard.writeText = blockedWrite;
      }
    }
  });

  await page.goto("/");
  await waitForEditorReady(page);

  await page.click("#copy-share-url");

  await expect(page.locator("#message-dialog")).toBeVisible();
  await expect(page.locator("#message-title")).toHaveText("Copy Settings Link Manually");
  await expect(page.locator("#message-body")).toContainText("clipboard access failed");
  await expect(page.locator("#message-body")).toContainText("/#");
  await expect(page.locator(".app-toast-item").first()).toContainText("Clipboard blocked. Copy link manually.");

  await page.click("#message-ok");
  await expect(page.locator("#message-dialog")).toBeHidden();
});

test("shows toast fallback when search-url clipboard write fails", async ({ context, page }) => {
  await context.addInitScript(() => {
    const blockedWrite = async (): Promise<void> => {
      throw new Error("clipboard-blocked");
    };

    try {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: { writeText: blockedWrite },
      });
    } catch (_error) {
      if (globalThis.navigator.clipboard) {
        globalThis.navigator.clipboard.writeText = blockedWrite;
      }
    }
  });

  await page.goto("/");
  await waitForEditorReady(page);

  await page.click("#copy-url");
  await expect(page.locator(".app-toast-item").first()).toContainText("Clipboard blocked. Copy URL manually.");
});

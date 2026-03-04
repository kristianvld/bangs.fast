import { defineConfig, devices } from "@playwright/test";

const TEST_PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bun run preview -- --host 127.0.0.1 --port ${TEST_PORT} --strictPort`,
    url: `http://127.0.0.1:${TEST_PORT}`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

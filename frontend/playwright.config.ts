import { defineConfig } from "@playwright/test";

const deploymentBasePath = "/BlissHack/";
const previewOrigin = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "./test/integration-tests/browser",
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `${previewOrigin}${deploymentBasePath}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_BASE_PATH=${deploymentBasePath} npm run build && VITE_BASE_PATH=${deploymentBasePath} npm run preview -- --host 127.0.0.1 --port 4174 --strictPort`,
    url: `${previewOrigin}${deploymentBasePath}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

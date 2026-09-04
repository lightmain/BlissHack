import { defineConfig } from "@playwright/test";

const deploymentBasePath = "/BlissHack/";
const previewOrigin = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./test/integration-tests/browser-long",
  outputDir: "./test-results/playwright-long",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 10 * 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: `${previewOrigin}${deploymentBasePath}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_BASE_PATH=${deploymentBasePath} npm run build && VITE_BASE_PATH=${deploymentBasePath} npm run preview -- --host 127.0.0.1 --port 4175 --strictPort`,
    url: `${previewOrigin}${deploymentBasePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/integration-tests/desktop",
  outputDir: "./test-results/playwright-desktop",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
});

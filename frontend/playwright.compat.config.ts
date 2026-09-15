import { defineConfig, devices } from "@playwright/test";

const deploymentBasePath = "/BlissHack/";
const previewOrigin = "http://127.0.0.1:4176";
const basicFlowNames = [
  "renders default Tiles pixels and switches renderers without restarting",
  "plays through startup and routes terminal UI input",
  "enumerates a persisted save after returning home and refreshing",
  "exports, previews, imports, and restores a complete profile",
  "exports, clears, and restores a complete BlissHack backup",
  "exports, deletes, imports, and continues identical raw save bytes",
  "blocks a second game and retries after the owning page closes",
  "keeps a manual Follow anchor after a right-click position look",
  "right-drag pans during position input without submitting it",
  "delays status inspection and keeps pointer and focus tooltips in the shared viewport layer",
  "shows the core permanent-inventory item text without sending game input",
  "inspects the player cell without changing visible messages or turn count",
  "clears inspection tooltips on leave, game key input, and pause",
  "opens an anchored core map menu and cancels it without a turn",
  "opens itemactions from permanent inventory without flashing its selector",
  "moves real menu focus and restores the inventory trigger after Escape",
  "closes on left click outside and restores the inventory trigger",
  "prevents the native menu on right click outside and restores the inventory trigger",
].join("|");

export default defineConfig({
  testDir: "./test/integration-tests/browser",
  outputDir: "./test-results/playwright-compat",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  grep: new RegExp(basicFlowNames),
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
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: `VITE_BASE_PATH=${deploymentBasePath} npm run build && VITE_BASE_PATH=${deploymentBasePath} npm run preview -- --host 127.0.0.1 --port 4176 --strictPort`,
    url: `${previewOrigin}${deploymentBasePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

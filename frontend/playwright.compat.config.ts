import { defineConfig, devices } from "@playwright/test";

const deploymentBasePath = "/BlissHack/";
const previewOrigin = "http://127.0.0.1:4176";
const basicFlowNames = [
  "submits a non-empty character name on blur",
  "activates a focused Role button with Space and advances focus",
  "cancels an existing-save name without restoring it",
  "uses the unified keyboard character setup flow",
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
  "restores the map trigger after every anchored-menu dismissal",
  "opens itemactions from permanent inventory without flashing its selector",
  "keeps permanent inventory mouse-only while core inventory accepts accelerators",
  "navigates result tabs by mouse and keyboard without moving Confirm",
  "keeps long sections independently scrollable without page overflow",
  "fits the result shell at the supported minimum width",
  "moves real menu focus and restores the inventory trigger after Escape",
  "closes on left click outside and restores the inventory trigger",
  "prevents the native menu on right click outside and restores the inventory trigger",
  "uses a five-pixel threshold and rejects non-map drop targets",
  "highlights the player cell and cancels interrupted drags without commands",
  "drops one stack once and waits for a new permanent-inventory revision",
  "keeps worn items and shows the core drop rejection without a turn",
  "HUD visual regression:",
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
    command: `VITE_E2E_FIXTURES=1 VITE_BASE_PATH=${deploymentBasePath} npm run build && VITE_BASE_PATH=${deploymentBasePath} npm run preview -- --host 127.0.0.1 --port 4176 --strictPort`,
    url: `${previewOrigin}${deploymentBasePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

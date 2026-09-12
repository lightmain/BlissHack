import { expect, test } from "@playwright/test";

interface TilePerformanceResult {
  averageDurationMs: number;
  canvasHeight: number;
  canvasWidth: number;
  columnCount: number;
  maxDurationMs: number;
  p95DurationMs: number;
  roundCount: number;
  rowCount: number;
  totalDurationMs: number;
}

declare global {
  interface Window {
    tilePerformanceHarness: {
      measure(roundCount: number): TilePerformanceResult;
    };
  }
}

const DRAW_ROUNDS = 30;
const REFERENCE_AVERAGE_DURATION_MS = 8;
const ALLOWED_REFERENCE_MULTIPLIER = 5;
const TOTAL_DURATION_LIMIT_MS = 1_500;
const P95_DURATION_LIMIT_MS = 60;
const MAX_DURATION_LIMIT_MS = 250;

test("draws a complete tile map repeatedly within the absolute budget", async ({
  page,
}, testInfo) => {
  await page.goto("test/integration-tests/performance/tile-harness.html");
  await expect(page.locator("html")).toHaveAttribute(
    "data-tile-performance-ready",
    "true",
  );

  const result = await page.evaluate((roundCount) => {
    return window.tilePerformanceHarness.measure(roundCount);
  }, DRAW_ROUNDS);

  expect(result.columnCount).toBe(80);
  expect(result.rowCount).toBe(21);
  expect(result.canvasWidth).toBe(1280);
  expect(result.canvasHeight).toBe(336);
  expect(result.roundCount).toBe(DRAW_ROUNDS);
  expect(result.averageDurationMs).toBeLessThan(
    REFERENCE_AVERAGE_DURATION_MS * ALLOWED_REFERENCE_MULTIPLIER,
  );
  expect(result.p95DurationMs).toBeLessThan(P95_DURATION_LIMIT_MS);
  expect(result.maxDurationMs).toBeLessThan(MAX_DURATION_LIMIT_MS);
  expect(result.totalDurationMs).toBeLessThan(TOTAL_DURATION_LIMIT_MS);

  await testInfo.attach("tile-renderer-performance.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  console.log(`Tile renderer performance: ${JSON.stringify(result)}`);
});

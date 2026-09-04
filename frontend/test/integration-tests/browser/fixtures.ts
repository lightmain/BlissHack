import {
  expect,
  test as base,
} from "@playwright/test";
import { attachFailureDiagnostics } from "./helpers/diagnostic-artifact";

type BrowserFixtures = {
  failureDiagnostics: void;
};

/**
 * Ordinary browser-test fixture which preserves local diagnostics on failure.
 * The automatic fixture does not alter page behavior or error expectations.
 */
export const test = base.extend<BrowserFixtures>({
  failureDiagnostics: [async ({ page }, use, testInfo) => {
    await use();
    await attachFailureDiagnostics(page, testInfo);
  }, { auto: true }],
});

export { expect };

import type { Page } from "@playwright/test";

/** Browser failures collected for one Playwright page lifetime. */
export interface CapturedErrors {
  console: string[];
  page: string[];
}

/**
 * Capture browser errors so an apparently playable UI cannot hide failures.
 * @param page - Playwright page under test.
 * @returns mutable error collections populated for the page lifetime.
 */
export function captureErrors(page: Page): CapturedErrors {
  const errors: CapturedErrors = { console: [], page: [] };
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  return errors;
}

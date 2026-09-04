import { describe, expect, it, vi } from "vitest";
import {
  installBrowserErrorListeners,
  type BrowserErrorTarget,
} from "./browser-errors";

/** Create a generic event with one read-only browser-style property. */
function eventWith(type: string, property: string, value: unknown): Event {
  const event = new Event(type);
  Object.defineProperty(event, property, { value });
  return event;
}

describe("browser error listeners", () => {
  it("reports window errors and unhandled rejections once each", () => {
    const target = new EventTarget();
    const report = vi.fn();
    const remove = installBrowserErrorListeners(
      report,
      target as BrowserErrorTarget,
    );

    target.dispatchEvent(eventWith("error", "error", new TypeError("window")));
    target.dispatchEvent(
      eventWith("unhandledrejection", "reason", new Error("promise")),
    );

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(1, {
      event: "browser.window_error",
      error: expect.any(TypeError),
    });
    expect(report).toHaveBeenNthCalledWith(2, {
      event: "browser.unhandled_rejection",
      error: expect.any(Error),
    });

    remove();
    target.dispatchEvent(eventWith("error", "error", new Error("ignored")));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("deduplicates one Error delivered through both browser events", () => {
    const target = new EventTarget();
    const report = vi.fn();
    installBrowserErrorListeners(report, target as BrowserErrorTarget);
    const error = new Error("same failure");

    target.dispatchEvent(eventWith("error", "error", error));
    target.dispatchEvent(eventWith("unhandledrejection", "reason", error));

    expect(report).toHaveBeenCalledOnce();
  });
});

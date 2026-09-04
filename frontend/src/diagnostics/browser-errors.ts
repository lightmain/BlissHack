/** Browser failure information forwarded to the application owner. */
export interface BrowserFailure {
  event: "browser.window_error" | "browser.unhandled_rejection";
  error: unknown;
}

/** Minimum event-target operations needed from a browser window. */
export interface BrowserErrorTarget {
  addEventListener(
    type: "error" | "unhandledrejection",
    listener: EventListener,
  ): void;
  removeEventListener(
    type: "error" | "unhandledrejection",
    listener: EventListener,
  ): void;
}

/**
 * Forward browser failures while deduplicating the same underlying object.
 * @param report - application failure reporter.
 * @param target - browser window or a test event target.
 * @returns listener cleanup function.
 */
export function installBrowserErrorListeners(
  report: (failure: BrowserFailure) => void,
  target: BrowserErrorTarget = window,
): () => void {
  const seen = new WeakSet<object>();

  /** Forward an error object once while allowing independent primitive reasons. */
  function reportOnce(failure: BrowserFailure): void {
    if (isObject(failure.error)) {
      if (seen.has(failure.error)) return;
      seen.add(failure.error);
    }
    report(failure);
  }

  const handleError: EventListener = (event) => {
    const browserEvent = event as ErrorEvent;
    browserEvent.preventDefault();
    reportOnce({
      event: "browser.window_error",
      error: browserEvent.error ?? new Error("Browser window error"),
    });
  };
  const handleRejection: EventListener = (event) => {
    const browserEvent = event as PromiseRejectionEvent;
    browserEvent.preventDefault();
    reportOnce({
      event: "browser.unhandled_rejection",
      error: browserEvent.reason,
    });
  };

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);
  return () => {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
  };
}

/** Return whether a browser failure can have stable object identity. */
function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null)
    || typeof value === "function";
}

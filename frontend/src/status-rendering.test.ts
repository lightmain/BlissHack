import { describe, expect, it } from "vitest";
import { buildHitPointBar, hitPointBarTone } from "./status-rendering";

describe("hit point status bar", () => {
  it("pads the title to 30 characters and splits it by HP percentage", () => {
    const bar = buildHitPointBar("Ada the Tourist", 50);

    expect(bar.text).toHaveLength(30);
    expect(bar.filled).toHaveLength(15);
    expect(bar.empty).toHaveLength(15);
    expect(bar.filled + bar.empty).toBe(bar.text);
  });

  it("keeps one highlighted character for positive HP below one character", () => {
    expect(buildHitPointBar("Ada", 1).filled).toHaveLength(1);
    expect(buildHitPointBar("Ada", 0).filled).toHaveLength(0);
    expect(buildHitPointBar("Ada", 99).filled).toHaveLength(29);
    expect(buildHitPointBar("Ada", 100).filled).toHaveLength(30);
  });

  it.each([
    [100, "full"],
    [99, "healthy"],
    [65, "warning"],
    [49, "low"],
    [32, "danger"],
    [14, "critical"],
  ] as const)("maps %d%% HP to the %s background", (percent, tone) => {
    expect(hitPointBarTone(percent)).toBe(tone);
  });
});

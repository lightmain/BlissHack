import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, resolveBuildId } from "./version";

describe("version metadata", () => {
  it("uses the canonical product version and explicit development build ID", () => {
    expect(PRODUCT_VERSION).toBe("prealpha-3");
    expect(resolveBuildId(undefined)).toBe("prealpha-3-development");
    expect(resolveBuildId("commit-id")).toBe("commit-id");
  });
});

import { defineConfig } from "vitest/config";
import { productVersionDefine } from "./product-version.js";

export default defineConfig({
  define: productVersionDefine,
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
});

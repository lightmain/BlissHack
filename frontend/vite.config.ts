import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { productVersionDefine } from "./product-version.js";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  define: productVersionDefine,
  plugins: [react()],
});

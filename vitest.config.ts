import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Component render tests (tests/workflow/statusColumns.test.ts) import .tsx files.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

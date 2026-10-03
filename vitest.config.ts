import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Component render tests (tests/workflow/statusColumns.test.ts) import .tsx files.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // D177 — a throwaway seeded database + storage per run, a private copy per test file.
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setupEnv.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

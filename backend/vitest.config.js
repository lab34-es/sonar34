import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ["tests/**/*.test.js"],
    setupFiles: ["./tests/setup.js"],
    // Run test files sequentially since they share a SQLite DB
    fileParallelism: false,
  },
});

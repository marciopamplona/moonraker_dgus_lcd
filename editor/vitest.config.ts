import { defineConfig } from "vitest/config";

// The Pi is slow and has 1 GB of RAM: few workers, generous timeouts.
export default defineConfig({
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], testTimeout: 120_000, maxWorkers: 2 },
});

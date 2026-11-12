import { defineConfig } from "vitest/config";

// The Pi is slow and has 1 GB of RAM (shared with Klipper): one worker,
// files in sequence, generous timeouts. Use scripts/test-pi.sh there.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"], setupFiles: ["test/setup.ts"],
    testTimeout: 120_000, maxWorkers: 1, fileParallelism: false,
  },
});

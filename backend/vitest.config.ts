import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Forces deterministic AI mode before the app is imported so the suite
    // never calls a live model provider.
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 30_000,
  },
});

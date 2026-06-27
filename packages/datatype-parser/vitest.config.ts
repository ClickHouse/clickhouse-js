import { defineConfig } from "vitest/config";

// The unit/snapshot suite runs on `node --test` (see package.json `test`);
// vitest is used only for the benchmarks here.
export default defineConfig({
  test: {
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});

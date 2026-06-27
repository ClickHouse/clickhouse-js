import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit + snapshot suite (the `test:*`/`snapshot:*` tsx scripts in
    // package.json are separate live-server tools, not vitest specs).
    include: ["test/**/*.test.ts"],
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});

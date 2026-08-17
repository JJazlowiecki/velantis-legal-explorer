import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See src/lib/test-support/server-only-stub.ts — reproduces Next.js's bundler-level
      // no-op treatment of `server-only` so server-only-guarded modules stay directly
      // testable under vitest's plain Node environment.
      "server-only": fileURLToPath(new URL("./src/lib/test-support/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@couple-ledger/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
    },
  },
  test: { hookTimeout: 30_000, env: { INVITE_HMAC_SECRET: "couple-ledger-integration-test-secret" } },
});

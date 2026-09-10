import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, "tests/__mocks__/electron.ts"),
    },
  },
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-host integration tests spawn the real `wave --stdio` CLI and a local
    // model server — they run in their own config/job (vitest.integration.config.ts,
    // `pnpm -F wave-desktop run test:realhost`), never in the unit gate.
    exclude: ["node_modules", "tests/integration/**"],
    env: {
      // Keep the file logger out of the user's real ~/.wave/logs during tests.
      DISABLE_LOGGER_IO: "true",
    },
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 65,
        statements: 75,
      },
    },
  },
});

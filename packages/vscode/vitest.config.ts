import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "tests/__mocks__/vscode.ts"),
    },
  },
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
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
        // Recalibrated after the stdioAgent/NotificationRouter merge into
        // wave-agent-sdk/stdio (旧温床 4/4): the heavily-tested stdio layer and
        // its behavioral suite now live in agent-sdk, so the in-package share
        // dropped to ~26.6% statements / ~24.6% branches.
        lines: 25,
        functions: 25,
        branches: 23,
        statements: 25,
      },
    },
  },
});

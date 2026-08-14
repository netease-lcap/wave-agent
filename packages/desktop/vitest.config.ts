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
    exclude: ["node_modules"],
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

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporter: "dot",
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.tsx", "src/**/*.css"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 75,
      },
    },
  },
});

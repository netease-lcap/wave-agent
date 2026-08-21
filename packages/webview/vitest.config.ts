import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporter: "dot",
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
    // Node 25+ ships its own experimental localStorage accessor on
    // globalThis; vitest 4.x's getWindowKeys then skips installing jsdom's
    // working Storage (issue vitest-dev/vitest#10867), leaving window.
    // localStorage undefined. Disable Node's accessor so jsdom's copy lands
    // — the flag is rejected on older Node, hence the version guard.
    execArgv:
      Number(process.versions.node.split(".")[0]) >= 25
        ? ["--no-webstorage"]
        : [],
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

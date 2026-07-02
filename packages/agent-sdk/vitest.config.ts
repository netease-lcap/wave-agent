import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig(() => {
  return {
    test: {
      globals: true,
      setupFiles: ["./tests/setup.ts"],
      environment: "node",
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
      exclude: ["node_modules", "dist"],
      // reporters: ["dot"],
      coverage: {
        provider: "v8" as const,
        reporter: ["text", "json", "html"],
        include: ["src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        exclude: ["node_modules", "dist", "tests", "examples"],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
      env: {
        WAVE_API_KEY: "test-token",
        WAVE_BASE_URL: "http://localhost:8080",
        WAVE_MODEL: "test-model",
        WAVE_FAST_MODEL: "test-fast-model",
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});

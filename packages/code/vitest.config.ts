import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig(() => {
  return {
    test: {
      globals: true,
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
          functions: 70,
          branches: 80,
          statements: 80,
        },
      },
      // Test environment variables: disable logger I/O operations by default to improve performance
      onConsoleLog(log: string, type: "stdout" | "stderr"): boolean | void {
        if (type === "stderr") {
          // Allow known expected stderr from print-cli tests
          if (log.includes("Print mode requires a message")) {
            return false;
          }
          throw new Error(`Unexpected stderr: ${log}`);
        }
      },
      env: {
        DISABLE_LOGGER_IO: "true",
        // Set shorter debounce time to accelerate tests
        FILE_SELECTOR_DEBOUNCE_MS: "0",
        PASTE_DEBOUNCE_MS: "0",
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

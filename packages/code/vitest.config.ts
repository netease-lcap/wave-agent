import { defineConfig, type ViteUserConfig } from "vitest/config";
import { resolve } from "path";

// Annotated because the callback form widens `silent` to `string`, which
// type-check rejects.
export default defineConfig((): ViteUserConfig => {
  return {
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
      exclude: ["node_modules", "dist"],
      // 通过的用例不打印 console 输出；失败的用例照打（vitest 会把它的日志重放出来）。
      silent: "passed-only",
      // Test environment variables: disable logger I/O operations by default to improve performance
      env: {
        DISABLE_LOGGER_IO: "true",
        // Set shorter debounce time to accelerate tests
        FILE_SELECTOR_DEBOUNCE_MS: "0",
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

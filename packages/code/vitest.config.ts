import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig(() => {
  // Check if running in CI environment - supports multiple CI environment variables
  const isCI = !!(process.env.CI === "true");

  // Output retry configuration info in CI environment
  if (isCI) {
    console.log(`🔄 CI environment detected: test retry enabled (2 retries)`);
  }

  return {
    test: {
      globals: true,
      environment: "node",
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
      exclude: ["node_modules", "dist"],
      // Enable retry in CI environment: failed tests will retry up to 2 times
      retry: isCI ? 2 : 0,
      reporters: ["dot"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: ["node_modules", "dist", "tests", "examples"],
      },
      // Test environment variables: disable logger I/O operations by default to improve performance
      env: {
        DISABLE_LOGGER_IO: "true",
        // Set shorter debounce time to accelerate tests
        FILE_SELECTOR_DEBOUNCE_MS: "0",
        PASTE_DEBOUNCE_MS: "0",
        WAVE_API_KEY: "test-token",
        WAVE_BASE_URL: "http://localhost:8080",
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});

import { defineConfig, devices } from "@playwright/test";

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: ".",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only. 2 → 1: the flake set that motivated `2` is fixed at the
   * source (session-switch panel width, follow-new-row while pinned, the
   * `remote/build.mjs` output-dir race), and a second retry mostly hides fresh
   * regressions behind a slower green. Revisit if a week shows real flakiness. */
  retries: process.env.CI ? 1 : 0,
  /* Parallel on CI. Was 1: each case used to boot the whole app and reload the
   * dev bundle, so serializing was the only way to keep the run under the job
   * timeout. With the browser-mode migration the remaining e2e set is small
   * enough that 4 workers lands around 1.5 min; the shared-output races that
   * made parallelism unsafe are fixed in `e2e/globalSetup.ts`. */
  workers: process.env.CI ? 4 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  /* 远控页产物（`remote/dist`）全局只建一次：两个远控页用例原先各自在
     `beforeAll` 里现建，`workers > 1` 时会并发删/写同一份输出目录。 */
  globalSetup: "./e2e/globalSetup.ts",
  /* Global test timeout - reduce from default 30s to 10s */
  timeout: 10 * 1000,
  /* Expect timeout - reduce from default 5s to 3s */
  expect: {
    timeout: 3 * 1000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Default viewport size (simulating VS Code sidebar) */
    viewport: { width: 400, height: 800 },
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    /* Screenshot on failure */
    screenshot: "only-on-failure",
    /* Video recording for CI */
    video: process.env.CI ? "retain-on-failure" : "off",
    /* Reduce action timeout from default 0 (30s) to 5s */
    actionTimeout: 5 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "demo",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 400, height: 600 },
        screenshot: "on",
      },
      testMatch: "demo/**/*.demo.ts",
    },
    {
      name: "e2e",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 400, height: 600 },
      },
      testMatch: "e2e/**/*.e2e.ts",
    },
  ],

  /* Webserver configuration for serving test files if needed */
  // Note: For webview testing, we load files directly rather than serving them
});

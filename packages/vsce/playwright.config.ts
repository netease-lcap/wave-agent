import { defineConfig, devices } from '@playwright/test';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'dot',
  /* Global test timeout - reduce from default 30s to 10s */
  timeout: 10 * 1000,
  /* Expect timeout - reduce from default 5s to 3s */
  expect: {
    timeout: 3 * 1000
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Default viewport size (simulating VS Code sidebar) */
    viewport: { width: 400, height: 800 },
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video recording for CI */
    video: process.env.CI ? 'retain-on-failure' : 'off',
    /* Reduce action timeout from default 0 (30s) to 5s */
    actionTimeout: 5 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 800 }
      },
      testMatch: ['**/*.test.ts', '**/*.demo.ts'],
    },
    {
      name: 'demo',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 600 },
        screenshot: 'on',
      },
      testMatch: '**/demo/**/*.demo.ts',
    },
  ],

  /* Webserver configuration for serving test files if needed */
  // Note: For webview testing, we load files directly rather than serving them
});
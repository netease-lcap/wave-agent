import type { Page } from '@playwright/test';

declare global {
  interface Window {
    simulateExtensionMessage: (message: Record<string, unknown>) => void;
  }
}

/**
 * Helper functions to reduce test execution time by replacing fixed waits with condition-based waits
 */

/**
 * Wait for an element to be stable (not changing) for a short period
 * This is more reliable than fixed timeouts for dynamic content
 */
export async function waitForStableElement(page: Page, selector: string, stableTime = 100) {
  await page.waitForSelector(selector, { timeout: 3000 });
  
  let lastContent = '';
  let stableCount = 0;
  const requiredStableChecks = Math.max(2, Math.ceil(stableTime / 50));
  
  while (stableCount < requiredStableChecks) {
    const currentContent = await page.locator(selector).textContent();
    if (currentContent === lastContent) {
      stableCount++;
    } else {
      stableCount = 0;
      lastContent = currentContent || '';
    }
    await page.waitForTimeout(50);
  }
}

/**
 * Wait for a condition to be true, checking every 50ms
 * This is faster than fixed waits and more reliable than immediate checks
 */
export async function waitForCondition(
  page: Page, 
  condition: () => Promise<boolean>, 
  timeout = 2000
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await page.waitForTimeout(50);
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Wait for dropdown/menu to appear and be ready for interaction
 */
export async function waitForDropdownReady(page: Page, dropdownSelector: string) {
  // Wait for dropdown to appear
  await page.waitForSelector(dropdownSelector, { timeout: 2000 });
  
  // Wait for dropdown to have content (options)
  await page.waitForFunction(
    (selector) => {
      const dropdown = document.querySelector(selector);
      return dropdown && dropdown.children.length > 0;
    },
    dropdownSelector,
    { timeout: 1000 }
  );
}

/**
 * Wait for input field to be ready and focused
 */
export async function waitForInputReady(page: Page, inputSelector: string) {
  await page.waitForSelector(inputSelector, { timeout: 2000 });
  await page.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector) as HTMLInputElement;
      return input && !input.disabled && input.offsetParent !== null;
    },
    inputSelector,
    { timeout: 1000 }
  );
}

/**
 * Enhanced message injection that waits for UI updates
 */
export async function injectMessageAndWait(
  page: Page, 
  message: Record<string, unknown>,
  expectedSelector?: string
) {
  await page.evaluate((msg) => {
    window.simulateExtensionMessage(msg);
  }, message);
  
  if (expectedSelector) {
    await page.waitForSelector(expectedSelector, { timeout: 2000 });
  } else {
    // Generic wait for any UI update
    await page.waitForTimeout(50);
  }
}
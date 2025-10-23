/**
 * Generic wait function that waits for specific condition to be met
 * @param condition Condition function, returns true when condition is satisfied
 * @param options Configuration options
 */
export async function waitFor(
  condition: () => boolean,
  options?: {
    timeout?: number; // Timeout (ms), default 5000ms
    interval?: number; // Check interval (ms), default 50ms
    message?: string; // Timeout error message
  },
): Promise<void> {
  const {
    timeout = 5000,
    interval = 50,
    message = "Condition not met within timeout",
  } = options || {};

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
        return;
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error(message));
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Wait for specific text to appear in render result
 * @param lastFrame lastFrame function used to get the latest render frame
 * @param expectedText Expected text to contain
 * @param options Configuration options
 */
export async function waitForText(
  lastFrame: () => string | undefined,
  expectedText: string,
  options?: {
    timeout?: number;
    interval?: number;
    message?: string;
  },
): Promise<void> {
  const { timeout = 5000, interval = 20, message } = options || {};

  return waitFor(
    () => {
      const frame = lastFrame();
      return frame ? frame.includes(expectedText) : false;
    },
    {
      timeout,
      interval,
      message:
        message || `Expected text "${expectedText}" not found within timeout`,
    },
  );
}

/**
 * Wait for specific text to disappear from render result
 * @param lastFrame lastFrame function used to get the latest render frame
 * @param unexpectedText Text that should not be contained
 * @param options Configuration options
 */
export async function waitForTextToDisappear(
  lastFrame: () => string | undefined,
  unexpectedText: string,
  options?: {
    timeout?: number;
    interval?: number;
    message?: string;
  },
): Promise<void> {
  const { timeout = 5000, interval = 20, message } = options || {};

  return waitFor(
    () => {
      const frame = lastFrame();
      return frame ? !frame.includes(unexpectedText) : true;
    },
    {
      timeout,
      interval,
      message:
        message ||
        `Unexpected text "${unexpectedText}" still present after timeout`,
    },
  );
}

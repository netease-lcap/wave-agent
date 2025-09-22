/**
 * 通用的等待函数，等待特定条件满足
 * @param condition 条件函数，返回true表示条件满足
 * @param options 配置选项
 */
export async function waitFor(
  condition: () => boolean,
  options?: {
    timeout?: number; // 超时时间(ms)，默认5000ms
    interval?: number; // 检查间隔(ms)，默认50ms
    message?: string; // 超时错误消息
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
 * 等待渲染结果中包含特定文本
 * @param lastFrame lastFrame 函数，用于获取最新的渲染帧
 * @param expectedText 期望包含的文本
 * @param options 配置选项
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
  const { timeout = 5000, interval = 50, message } = options || {};

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
 * 等待渲染结果中不包含特定文本
 * @param lastFrame lastFrame 函数，用于获取最新的渲染帧
 * @param unexpectedText 不应该包含的文本
 * @param options 配置选项
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
  const { timeout = 5000, interval = 50, message } = options || {};

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

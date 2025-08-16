import { render } from "ink-testing-library";

type RenderResult = ReturnType<typeof render>;

/**
 * 等待 AI is thinking 文案出现
 * @param renderResult ink-testing-library 的渲染结果
 * @param maxAttempts 最大尝试次数，默认20次
 * @param intervalMs 检查间隔，默认50ms
 */
export async function waitForAIThinkingStart(
  renderResult: RenderResult,
  maxAttempts: number = 20,
  intervalMs: number = 50,
): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const checkForThinking = () => {
      attempts++;
      if (
        renderResult.lastFrame?.()?.includes("AI is thinking...") ||
        attempts >= maxAttempts
      ) {
        resolve(undefined);
      } else {
        setTimeout(checkForThinking, intervalMs);
      }
    };
    checkForThinking();
  });
}

/**
 * 等待 AI is thinking 文案消失，表示AI调用完成
 * @param renderResult ink-testing-library 的渲染结果
 * @param maxAttempts 最大尝试次数，默认100次
 * @param intervalMs 检查间隔，默认50ms
 * @param initialDelayMs 开始检查前的初始延迟，默认100ms
 */
export async function waitForAIThinkingEnd(
  renderResult: RenderResult,
  maxAttempts: number = 100,
  intervalMs: number = 50,
  initialDelayMs: number = 100,
): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const checkForThinkingEnd = () => {
      attempts++;
      const frame = renderResult.lastFrame?.();
      if (!frame?.includes("AI is thinking...") || attempts >= maxAttempts) {
        resolve(undefined);
      } else {
        setTimeout(checkForThinkingEnd, intervalMs);
      }
    };
    // 稍微延迟开始检查，确保thinking状态已经设置
    setTimeout(checkForThinkingEnd, initialDelayMs);
  });
}

/**
 * 等待 AI thinking 的完整流程：先等待开始，再等待结束
 * @param renderResult ink-testing-library 的渲染结果
 * @param options 配置选项
 */
export async function waitForAIThinkingComplete(
  renderResult: RenderResult,
  options?: {
    startMaxAttempts?: number;
    endMaxAttempts?: number;
    intervalMs?: number;
    initialDelayMs?: number;
  },
): Promise<void> {
  const {
    startMaxAttempts = 20,
    endMaxAttempts = 100,
    intervalMs = 50,
    initialDelayMs = 100,
  } = options || {};

  // 等待 AI thinking 开始
  await waitForAIThinkingStart(renderResult, startMaxAttempts, intervalMs);

  // 等待 AI thinking 结束
  await waitForAIThinkingEnd(
    renderResult,
    endMaxAttempts,
    intervalMs,
    initialDelayMs,
  );
}

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
 * @param renderResult ink-testing-library 的渲染结果
 * @param expectedText 期望包含的文本
 * @param options 配置选项
 */
export async function waitForText(
  renderResult: RenderResult,
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
      const frame = renderResult.lastFrame?.();
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
 * @param renderResult ink-testing-library 的渲染结果
 * @param unexpectedText 不应该包含的文本
 * @param options 配置选项
 */
export async function waitForTextToDisappear(
  renderResult: RenderResult,
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
      const frame = renderResult.lastFrame?.();
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

import { render } from 'ink-testing-library';

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
      if (renderResult.lastFrame?.()?.includes('🤔 AI is thinking...') || attempts >= maxAttempts) {
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
      if (!frame?.includes('🤔 AI is thinking...') || attempts >= maxAttempts) {
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
  const { startMaxAttempts = 20, endMaxAttempts = 100, intervalMs = 50, initialDelayMs = 100 } = options || {};

  // 等待 AI thinking 开始
  await waitForAIThinkingStart(renderResult, startMaxAttempts, intervalMs);

  // 等待 AI thinking 结束
  await waitForAIThinkingEnd(renderResult, endMaxAttempts, intervalMs, initialDelayMs);
}

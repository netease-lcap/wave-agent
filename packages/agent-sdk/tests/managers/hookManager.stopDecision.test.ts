import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import type { HookExecutionResult } from "../../src/types/hooks.js";

/**
 * `{"decision":"block","reason":"…"}` on stdout with exit 0 — Claude Code's
 * second blocking channel for the two stop events (the other being exit 2 +
 * stderr). A plugin written against Claude Code's docs uses this one, so it has
 * to continue the conversation the same way.
 */
describe("HookManager stop decision:block channel", () => {
  let manager: HookManager;
  let messageManager: {
    addUserMessage: ReturnType<typeof vi.fn>;
    addNoticeBlock: ReturnType<typeof vi.fn>;
    removeLastUserMessage: ReturnType<typeof vi.fn>;
    updateToolBlock: ReturnType<typeof vi.fn>;
  };
  let seq = 0;

  const result = (
    partial: Partial<HookExecutionResult>,
  ): HookExecutionResult => {
    seq += 1;
    return {
      success: true,
      exitCode: 0,
      duration: 47,
      timedOut: false,
      command: `hook-${seq}`,
      ...partial,
    };
  };

  beforeEach(() => {
    const container = new Container();
    manager = new HookManager(container, "/test/workdir", new HookMatcher());
    messageManager = {
      addUserMessage: vi.fn(),
      addNoticeBlock: vi.fn(),
      removeLastUserMessage: vi.fn(),
      updateToolBlock: vi.fn(),
    };
  });

  it("Stop：exit 0 + decision:block 续命，reason 作 isMeta 用户消息", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [
        result({
          stdout: JSON.stringify({ decision: "block", reason: "再来一轮" }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(true);
    expect(outcome.errorMessage).toBe("再来一轮");
    expect(messageManager.addUserMessage).toHaveBeenCalledWith({
      content: "再来一轮",
      isMeta: true,
    });
  });

  it("SubagentStop：同一条通道也生效", () => {
    const outcome = manager.processHookResults(
      "SubagentStop",
      [
        result({
          stdout: JSON.stringify({ decision: "block", reason: "子代理继续" }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome).toEqual({
      shouldBlock: true,
      errorMessage: "子代理继续",
    });
  });

  it("停止事件之外的 decision 不拦停（PreToolUse 忽略该字段）", () => {
    const outcome = manager.processHookResults(
      "PreToolUse",
      [
        result({
          stdout: JSON.stringify({ decision: "block", reason: "不拦" }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(false);
    expect(messageManager.addUserMessage).not.toHaveBeenCalled();
  });

  it("decision:block 但没有 reason ⇒ 不拦停（无处可喂）", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [result({ stdout: JSON.stringify({ decision: "block" }) })],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(false);
    expect(messageManager.addUserMessage).not.toHaveBeenCalled();
  });

  it("reason 为纯空白 ⇒ 不拦停", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [
        result({
          stdout: JSON.stringify({ decision: "block", reason: "   " }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(false);
  });

  it("decision 不是 block（如 approve）⇒ 不拦停", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [result({ stdout: JSON.stringify({ decision: "approve" }) })],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(false);
  });

  it("exit 2 优先于 decision JSON（stderr 才是喂回的内容）", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [
        result({
          exitCode: 2,
          stderr: "来自 stderr",
          stdout: JSON.stringify({ decision: "block", reason: "来自 JSON" }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome).toEqual({
      shouldBlock: true,
      errorMessage: "来自 stderr",
    });
    expect(messageManager.addUserMessage).toHaveBeenCalledTimes(1);
    expect(messageManager.addUserMessage).toHaveBeenCalledWith({
      content: "来自 stderr",
      isMeta: true,
    });
  });

  it("同一个 JSON 里的 systemMessage 仍然单独播给用户", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [
        result({
          stdout: JSON.stringify({
            decision: "block",
            reason: "继续干活",
            systemMessage: "🔄 第 2 轮",
          }),
        }),
      ],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(true);
    expect(messageManager.addNoticeBlock).toHaveBeenCalledWith(
      "🔄 第 2 轮",
      "info",
    );
    expect(messageManager.addUserMessage).toHaveBeenCalledWith({
      content: "继续干活",
      isMeta: true,
    });
  });

  it("Stop 的 exit 0 + 非 JSON stdout ⇒ 不拦停、不进对话（与之前一致）", () => {
    const outcome = manager.processHookResults(
      "Stop",
      [result({ stdout: "纯文本，不是 JSON" })],
      messageManager as never,
    );

    expect(outcome.shouldBlock).toBe(false);
    expect(messageManager.addUserMessage).not.toHaveBeenCalled();
  });
});

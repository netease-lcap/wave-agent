import { describe, expect, it, vi } from "vitest";
import {
  ChatSession,
  type ChatSessionCallbacks,
} from "../../src/session/chatSession";
import type { ConfigurationData } from "../../src/services/configurationService";
import type { StdioClient } from "../../src/stdio/stdioClient";
import type { NotificationRouter } from "wave-agent-sdk/stdio";

/**
 * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）：
 *
 * `autoMemoryEnabled` / `autoMemoryFrequency` 全是可选参数，任何一环漏传都不报错，
 * 只在 SDK 侧静默回落到 settings.json / 默认值——保存看起来成功却不起作用。VSCE
 * 侧漏掉的正是这两个 hop：会话初始化（`initialize` params）与设置保存
 * （`ChatSession.updateConfig` → stdio `updateConfig` params）。这里断言「发给 CLI
 * 的参数里真的带了这个字段」，而不是断言某条内部分支。
 */

function callbacks(): ChatSessionCallbacks {
  return {
    onTasksChange: vi.fn(),
    onSessionIdChange: vi.fn(),
    onStreamingChange: vi.fn(),
    onQueueChange: vi.fn(),
    onCommandRunningChange: vi.fn(),
    onPermissionModeChange: vi.fn(),
    onWorkdirChange: vi.fn(),
    onToolPermissionRequest: vi.fn(async () => ({
      behavior: "allow" as const,
    })),
    onError: vi.fn(),
  };
}

/** A fake JSON-RPC client: records the exact params of every CLI request. */
function fakeClient() {
  const request = vi.fn(
    async (
      method: string,
      _params?: unknown,
      _sessionId?: string,
    ): Promise<unknown> => {
      if (method === "initialize") {
        return {
          sessionId: "sess-1",
          workingDirectory: "/test-workspace",
          permissionMode: "default",
          latestTotalTokens: 0,
        };
      }
      if (method === "updateConfig") return { sessionId: "sess-1" };
      return {};
    },
  );
  return { request };
}

function fakeRouter() {
  return { register: vi.fn(), unregister: vi.fn() };
}

/** The params the client received for `method` (the message body sent to the CLI). */
function paramsFor(
  request: ReturnType<typeof fakeClient>["request"],
  method: string,
): Record<string, unknown> {
  const call = request.mock.calls.find(([m]) => m === method);
  expect(call, `no "${method}" request was sent to the CLI`).toBeDefined();
  return call?.[1] as Record<string, unknown>;
}

const config: ConfigurationData = {
  model: "m",
  autoMemoryEnabled: false,
  autoMemoryFrequency: 5,
};

describe("ChatSession · auto-memory settings reach the CLI", () => {
  it("initialize carries the auto-memory toggle in the CLI params", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      config,
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );

    expect(paramsFor(client.request, "initialize")).toMatchObject({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });

  it("updateConfig carries the auto-memory toggle in the CLI params", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      config,
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    await session.updateConfig(config);

    // false 必须原样下发（写成 `config.autoMemoryEnabled || true` 之类会静默变 true）
    expect(paramsFor(client.request, "updateConfig")).toMatchObject({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });
});

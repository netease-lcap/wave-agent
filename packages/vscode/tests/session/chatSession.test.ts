import { describe, expect, it, vi } from "vitest";
import {
  ChatSession,
  type ChatSessionCallbacks,
} from "../../src/session/chatSession";
import type { StdioClient } from "../../src/stdio/stdioClient";
import type { NotificationRouter } from "wave-agent-sdk/stdio";

/**
 * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）——**PR-2 反转了原先的
 * 修法**：用户偏好（`language` / `autoMemoryEnabled` / `autoMemoryFrequency`）不再
 * 经 `initialize` / `updateConfig` 的 AgentOptions 覆盖层下发，而是由
 * `ConfigurationService` 写用户级 `~/.wave/settings.json`（`updateUserSettings`），
 * 由 SDK 实时重载在下一轮生效（spec core/agent-config.md「设置实时重载」）。
 *
 * 覆盖层会**永久遮蔽** settings.json：一旦经 `updateConfig` 下发过，用户此后直接改
 * settings.json 也不再生效。所以这里断言这两个 hop **真的不带**用户偏好键——把原来
 * 「必须带上」的回归网反转成「必须不带」。
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

/**
 * 不允许出现在 CLI 参数（AgentOptions 覆盖层）里的键：模型由 `/model` 命令经
 * `getConfiguredModels` / `setModel` RPC 管理；用户偏好落 `~/.wave/settings.json`
 * 由 SDK 实时重载生效（覆盖层会永久遮蔽实时值）。
 */
const OVERRIDE_KEYS = [
  "model",
  "fastModel",
  "language",
  "autoMemoryEnabled",
  "autoMemoryFrequency",
] as const;

describe("ChatSession · 配置不经 CLI 参数覆盖层下发", () => {
  it("initialize params 不带任何覆盖层键", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );

    // paramsFor 断言 initialize 确实发过（避免「因为没发所以没有」）
    const params = paramsFor(client.request, "initialize");
    for (const key of OVERRIDE_KEYS) expect(params).not.toHaveProperty(key);
  });

  it("updateConfig 只重建 agent，不带覆盖层键", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    await session.updateConfig();

    const params = paramsFor(client.request, "updateConfig");
    expect(params).toEqual({});
  });
});

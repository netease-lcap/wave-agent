import { describe, expect, it, vi } from "vitest";
import {
  ChatSession,
  type ChatSessionCallbacks,
} from "../../src/session/chatSession";
import type { ConfigurationData } from "../../src/services/configurationService";
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

const config: ConfigurationData = {
  model: "m",
  autoMemoryEnabled: false,
  autoMemoryFrequency: 5,
};

/** 用户偏好三键：只允许出现在 settings.json 里，不得出现在 CLI 参数里。 */
const USER_PREF_KEYS = [
  "language",
  "autoMemoryEnabled",
  "autoMemoryFrequency",
] as const;

describe("ChatSession · 用户偏好不经 CLI 参数覆盖层下发", () => {
  it("initialize params 不带用户偏好键", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      config,
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );

    const params = paramsFor(client.request, "initialize");
    // 非空断言：initialize 确实发了、且仍带会话级键（避免「因为没发所以没有」）
    expect(params).toMatchObject({ model: "m" });
    for (const key of USER_PREF_KEYS) expect(params).not.toHaveProperty(key);
  });

  it("updateConfig params 不带用户偏好键", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      config,
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    await session.updateConfig(config);

    const params = paramsFor(client.request, "updateConfig");
    expect(params).toMatchObject({ model: "m" });
    for (const key of USER_PREF_KEYS) expect(params).not.toHaveProperty(key);
  });
});

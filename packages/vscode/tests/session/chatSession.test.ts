import { describe, expect, it, vi } from "vitest";
import {
  ChatSession,
  type ChatSessionCallbacks,
} from "../../src/session/chatSession";
import type { StdioClient } from "../../src/stdio/stdioClient";
import type { NotificationRouter } from "wave-agent-sdk/host";

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
    onCompactBlockAdded: vi.fn(),
    onMessagesReplaced: vi.fn(),
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
          currentWorkdir: "/test-workspace",
          permissionMode: "default",
          latestTotalTokens: 0,
        };
      }
      if (method === "updateConfig") return { sessionId: "sess-1" };
      if (method === "getMessages") return { messages: [] };
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

  it("getSlashCommands 带上 vscode 入口标识（弹窗的宿主命令由服务端按入口过滤）", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    await session.getSlashCommands();

    expect(paramsFor(client.request, "getSlashCommands")).toEqual({
      surface: "vscode",
    });
  });

  it("initialize 声明 vscode 入口标识（遥测的 app.entrypoint）", async () => {
    const client = fakeClient();
    const session = new ChatSession("sidebar", undefined, callbacks());

    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );

    expect(paramsFor(client.request, "initialize")).toMatchObject({
      entrypoint: "vscode",
    });
  });
});

/**
 * 回归（压缩摘要块在 VS Code 插件上不显示）：压缩对 UI 显示流是纯追加 —— 旧的
 * 「压缩后只 getMessages」既不推给 webview 也不追加显示，摘要在下一次
 * webviewReady 之前一直缺失。现在压缩摘要块随 `compactBlockAdded` 携带完整
 * Message，宿主原样转发给 webview 层（spec core/message-compact.md
 * 「压缩后旧消息在 UI 保留渲染」、ui/stdio-transport.md 场景 7，
 * ui/message-rendering-system.md「宿主不保留消息内容」场景 2 —— 宿主不留、不合并）。
 */
describe("ChatSession · 压缩摘要块走增量通道", () => {
  const compactMessage = {
    id: "c1",
    role: "assistant",
    blocks: [{ type: "compact", content: "对话摘要" }],
  };

  async function initializedSession() {
    const client = fakeClient();
    const cbs = callbacks();
    const session = new ChatSession("sidebar", undefined, cbs);
    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    return { client, cbs, session };
  }

  const getMessagesCalls = (
    request: ReturnType<typeof fakeClient>["request"],
  ) => request.mock.calls.filter(([method]) => method === "getMessages").length;

  it("compactBlockAdded 原样转发，不发起 getMessages，也不在会话上留字段", async () => {
    const { client, cbs, session } = await initializedSession();

    session.agent!.handleNotification("compactBlockAdded", {
      content: "对话摘要",
      message: compactMessage,
    });

    expect(cbs.onCompactBlockAdded).toHaveBeenCalledWith(compactMessage);
    expect(getMessagesCalls(client.request)).toBe(0);
    // 宿主对消息内容零状态：会话上不该再有任何装消息的字段（spec 场景 9）。
    expect(session).not.toHaveProperty("messages");
  });

  it("旧 CLI 只发 content 时回落为 getMessages 拉取", async () => {
    const { client, cbs, session } = await initializedSession();

    session.agent!.handleNotification("compactBlockAdded", {
      content: "对话摘要",
    });

    await vi.waitFor(() => {
      expect(getMessagesCalls(client.request)).toBe(1);
    });
    expect(cbs.onCompactBlockAdded).not.toHaveBeenCalled();
  });

  // 回落的另一半：只拉不推 webview 的话，摘要在下一次 webviewReady 之前一直不
  // 显示 —— 与上面修掉的缺陷同形，只是触发前提收窄到「CLI 比插件旧」。desktop 与
  // JetBrains 的同一回落点都是「拉取 + 推送」（pullAndPushMessages）。
  it("旧 CLI 回落：拉取后把全量列表推给 webview，而不是只拉不发", async () => {
    const client = fakeClient();
    const pulledMessages = [compactMessage];
    client.request.mockImplementation(async (method: string) => {
      if (method === "initialize") {
        return {
          sessionId: "sess-1",
          currentWorkdir: "/test-workspace",
          permissionMode: "default",
          latestTotalTokens: 0,
        };
      }
      if (method === "getMessages") return { messages: pulledMessages };
      return {};
    });
    const cbs = callbacks();
    const session = new ChatSession("sidebar", undefined, cbs);
    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );

    session.agent!.handleNotification("compactBlockAdded", {
      content: "对话摘要",
    });

    await vi.waitFor(() => {
      expect(cbs.onMessagesReplaced).toHaveBeenCalledWith(pulledMessages);
    });
    // 推出去的那份不被宿主留下：回包用完即弃（spec 场景 9）。
    expect(session).not.toHaveProperty("messages");
    expect(cbs.onCompactBlockAdded).not.toHaveBeenCalled();
  });
});

/**
 * 宿主对消息内容零状态（spec ui/message-rendering-system.md「宿主不保留消息内容，
 * 用的时候现取」场景 9）：一次 pull 的回包就是这次调用的全部产出 —— `ChatSession`
 * 上不再有 `messages` 字段，数组在调用方手里活一次；`/rewind` 的边界也不靠本地
 * 数组定位锚点，截断完成后一律重拉（场景 6）。
 */
describe("ChatSession · 取消息不留字段", () => {
  const list = (ids: string[]) =>
    ids.map((id) => ({
      id,
      role: "user" as const,
      blocks: [{ type: "text", content: `消息 ${id}` }],
    }));

  /** `getMessages` 按顺序回放 replies（回滚后那次重拉拿到的就是第二份）。 */
  const sessionWith = async (replies: unknown[]) => {
    const client = fakeClient();
    let pulls = 0;
    client.request.mockImplementation(async (method: string) => {
      if (method === "initialize") {
        return {
          sessionId: "sess-1",
          currentWorkdir: "/test-workspace",
          permissionMode: "default",
          latestTotalTokens: 0,
        };
      }
      if (method === "getMessages") {
        return replies[Math.min(pulls++, replies.length - 1)];
      }
      return {};
    });
    const session = new ChatSession("sidebar", undefined, callbacks());
    await session.initialize(
      undefined,
      client as unknown as StdioClient,
      fakeRouter() as unknown as NotificationRouter,
    );
    return { client, session, pulls: () => pulls };
  };

  it("首屏列表就是这次 getMessages 的回包，会话上不留任何消息字段", async () => {
    const messages = list(["m0", "m1", "m2"]);
    const { client, session } = await sessionWith([
      { messages, contextUsagePercent: 42 },
    ]);

    const pulled = await session.getMessages();

    // 不分页：不跟任何窗口参数（条数 / 上锚点）走，无参重载就是整份列表。
    expect(paramsFor(client.request, "getMessages")).toBeUndefined();
    expect(pulled.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    // 用量是**状态**，宿主可以留着（webview 重建后要补环）。
    expect(session.contextUsagePercent).toBe(42);
    // 消息内容零状态：字段已删，回包用完即弃。
    expect(session).not.toHaveProperty("messages");
  });

  it("回滚之后列表来自重拉结果，不在本地找锚点截断", async () => {
    const before = list(["a", "b", "c"]);
    // 回滚改写了 CLI 的转录，重拉回来的是另一份 —— 若宿主按锚点截断本地数组，
    // 这里只会得到 ["a"]。
    const afterRewind = list(["x", "y"]);
    const { client, session, pulls } = await sessionWith([
      { messages: before },
      { messages: afterRewind },
    ]);
    // 首屏那次 pull（宿主不存它）。
    expect((await session.getMessages()).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const rewind = vi.fn().mockResolvedValue({ inputContent: "rewound draft" });
    (session.agent as unknown as { rewindToMessage: unknown }).rewindToMessage =
      rewind;

    const rewound = await session.rewindToMessage("b");

    expect(rewind).toHaveBeenCalledWith("b");
    expect(session.inputContent).toBe("rewound draft");
    expect(rewound.map((m) => m.id)).toEqual(["x", "y"]);
    // 首屏 + 回滚后各一次：边界来自重拉，不是本地数组。
    expect(pulls()).toBe(2);
    expect(paramsFor(client.request, "getMessages")).toBeUndefined();
    expect(session).not.toHaveProperty("messages");
  });
});

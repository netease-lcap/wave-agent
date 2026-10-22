import { test, expect, vi, beforeEach } from "vitest";

vi.mock("wave-agent-sdk", () => ({
  listSessions: vi.fn(),
}));

import { listSessions } from "wave-agent-sdk";
import type {
  Message,
  QueuedMessage,
  SessionMetadata,
  Task,
  ToolPermissionContext,
} from "wave-agent-sdk";
import {
  RemoteControlCliHost,
  type RemoteControlCliSession,
} from "../../src/remote/remoteControlCliHost.js";
import { REMOTE_HOST_UNSUPPORTED } from "../../src/remote/remoteControlService.js";

const listSessionsMock = vi.mocked(listSessions);

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
): Message {
  return {
    id,
    role,
    timestamp: "2026-10-14T00:00:00.000Z",
    blocks: [{ type: "text", content: text, stage: "end" }],
  } as unknown as Message;
}

function makeSession(
  overrides: Partial<RemoteControlCliSession> = {},
): RemoteControlCliSession {
  return {
    sessionId: () => "sess-1",
    workdir: () => "/work",
    sessionCwd: () => "/work",
    displayMessages: () => [],
    contextUsagePercent: () => 0,
    latestTotalTokens: () => 0,
    permissionMode: () => "default",
    customTitle: () => undefined,
    availableTools: () => [],
    isLoading: () => false,
    hasRunningBackgroundWork: () => false,
    hasPendingMessages: () => false,
    tasks: () => [],
    isCompacting: () => false,
    isCommandRunning: () => false,
    queuedMessages: () => [],
    backgroundTasks: () => [],
    pendingPermissions: () => [],
    sendMessage: vi.fn(),
    abort: vi.fn(),
    setPermissionMode: vi.fn(),
    respondPermission: vi.fn(),
    renameSession: vi.fn(),
    compact: vi.fn(),
    slashCommands: () => [],
    ...overrides,
  };
}

beforeEach(() => {
  listSessionsMock.mockReset();
});

test("statuses: one row, and an approval outranks a running turn", () => {
  // `requires_action` is what makes a phone ring, so it must not be masked by
  // the turn that raised the approval.
  const host = new RemoteControlCliHost(
    makeSession({
      isLoading: () => true,
      pendingPermissions: () => [
        { requestId: "r1", context: {} as ToolPermissionContext },
      ],
    }),
  );
  expect(host.listSessionStatuses()).toEqual([
    { sessionId: "sess-1", status: "requires_action" },
  ]);
});

test("statuses: idle vs running, and nothing at all before the first turn", () => {
  expect(new RemoteControlCliHost(makeSession()).listSessionStatuses()).toEqual(
    [{ sessionId: "sess-1", status: "idle" }],
  );
  expect(
    new RemoteControlCliHost(
      makeSession({ isLoading: () => true }),
    ).listSessionStatuses(),
  ).toEqual([{ sessionId: "sess-1", status: "running" }]);
  // Background work counts as running: the daemon reports it the same way.
  expect(
    new RemoteControlCliHost(
      makeSession({ hasRunningBackgroundWork: () => true }),
    ).listSessionStatuses(),
  ).toEqual([{ sessionId: "sess-1", status: "running" }]);
  expect(
    new RemoteControlCliHost(
      makeSession({ sessionId: () => "" }),
    ).listSessionStatuses(),
  ).toEqual([]);
});

test("listSessions answers with exactly this session, preferring the record on disk", async () => {
  const persisted = {
    id: "sess-1",
    customTitle: "From disk",
  } as SessionMetadata;
  listSessionsMock.mockResolvedValue([
    { id: "other", customTitle: "Elsewhere" } as SessionMetadata,
    persisted,
  ]);

  const host = new RemoteControlCliHost(makeSession());
  expect(listSessionsMock).not.toHaveBeenCalled();
  await expect(host.handleRequest("listSessions", {})).resolves.toEqual({
    sessions: [persisted],
  });
  expect(listSessionsMock).toHaveBeenCalledWith("/work");
});

test("listSessions synthesizes the row for a session not yet on disk", async () => {
  // An empty list would read on the phone as "this machine has nothing to
  // control", which is exactly wrong — the user is sitting in that session.
  listSessionsMock.mockResolvedValue([]);

  const session = makeSession({
    displayMessages: () => [message("m1", "user", "  fix the flaky test  ")],
    latestTotalTokens: () => 42,
  });
  const result = (await new RemoteControlCliHost(session).handleRequest(
    "listSessions",
    {},
  )) as { sessions: SessionMetadata[] };

  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0]).toMatchObject({
    id: "sess-1",
    sessionType: "main",
    workdir: "/work",
    latestTotalTokens: 42,
    firstMessage: "fix the flaky test",
  });
});

test("listSessions still answers when the project directory cannot be read", async () => {
  listSessionsMock.mockRejectedValue(new Error("ENOENT"));

  const result = (await new RemoteControlCliHost(makeSession()).handleRequest(
    "listSessions",
    {},
  )) as { sessions: SessionMetadata[] };
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0].id).toBe("sess-1");
});

test("listDaemonSessions answers the one live session, without reading disk", async () => {
  // The page's session list reads this method, not `listSessions`: its rows
  // must be openable, and the in-memory registry is the only place "which
  // sessions are alive here" is a fact. For this host the registry is the
  // single session it holds (spec remote-control「边界情况」).
  const session = makeSession({
    displayMessages: () => [
      message("m1", "user", "fix the flaky test"),
      message("m2", "assistant", "on it"),
    ],
    customTitle: () => "登录页",
    hasRunningBackgroundWork: () => true,
    hasPendingMessages: () => true,
    isLoading: () => true,
  });

  const result = (await new RemoteControlCliHost(session).handleRequest(
    "listDaemonSessions",
    {},
  )) as { sessions: Array<Record<string, unknown>> };

  expect(result.sessions).toEqual([
    {
      sessionId: "sess-1",
      sessionCwd: "/work",
      isLoading: true,
      hasRunningBackgroundWork: true,
      hasPendingMessages: true,
      messageCount: 2,
      customTitle: "登录页",
      firstMessage: "fix the flaky test",
      lastActiveAt: "2026-10-14T00:00:00.000Z",
    },
  ]);
  expect(listSessionsMock).not.toHaveBeenCalled();
});

test("listDaemonSessions has nothing to list before the first turn", async () => {
  const result = (await new RemoteControlCliHost(
    makeSession({ sessionId: () => "" }),
  ).handleRequest("listDaemonSessions", {})) as { sessions: unknown[] };

  expect(result.sessions).toEqual([]);
});

test("listDaemonSessions omits the label fields it has no material for", async () => {
  // Absent rather than empty: the page falls back to its own placeholder, and
  // the row stays identical in shape to what the daemon reports.
  const result = (await new RemoteControlCliHost(makeSession()).handleRequest(
    "listDaemonSessions",
    {},
  )) as { sessions: Array<Record<string, unknown>> };

  expect(result.sessions[0]).toEqual({
    sessionId: "sess-1",
    sessionCwd: "/work",
    isLoading: false,
    hasRunningBackgroundWork: false,
    hasPendingMessages: false,
    messageCount: 0,
  });
});

test("getMessages answers the whole thread when no window is asked for", async () => {
  const messages = [
    message("m1", "user", "hi"),
    message("m2", "assistant", "hello"),
  ];
  const host = new RemoteControlCliHost(
    makeSession({
      displayMessages: () => messages,
      contextUsagePercent: () => 12,
    }),
  );

  await expect(host.handleRequest("getMessages", {})).resolves.toEqual({
    messages,
    contextUsagePercent: 12,
  });
});

test("getMessages shares the daemon's window semantics", async () => {
  const messages = [
    message("m1", "user", "a"),
    message("m2", "assistant", "b"),
    message("m3", "user", "c"),
  ];
  const host = new RemoteControlCliHost(
    makeSession({ displayMessages: () => messages }),
  );

  await expect(
    host.handleRequest("getMessages", { since: "m1" }),
  ).resolves.toEqual({
    messages: [messages[1], messages[2]],
    hasMore: false,
    total: 3,
    contextUsagePercent: 0,
  });
  // A vanished anchor asks for a rebuild rather than an ever-missing page.
  await expect(
    host.handleRequest("getMessages", { since: "gone" }),
  ).resolves.toEqual({
    messages: [],
    reset: true,
    total: 3,
    contextUsagePercent: 0,
  });
});

test("getMessages rejects a malformed limit as invalid params", async () => {
  const host = new RemoteControlCliHost(
    makeSession({ displayMessages: () => [message("m1", "user", "a")] }),
  );

  await expect(
    host.handleRequest("getMessages", { limit: 0 }),
  ).rejects.toMatchObject({ code: -32602 });
});

test("listPendingPermissions carries the session id alongside each request", async () => {
  const context = { permissionMode: "default" } as ToolPermissionContext;
  const host = new RemoteControlCliHost(
    makeSession({
      pendingPermissions: () => [{ requestId: "r1", context }],
    }),
  );

  await expect(
    host.handleRequest("listPendingPermissions", {}),
  ).resolves.toEqual({
    requests: [{ requestId: "r1", sessionId: "sess-1", context }],
  });
});

test("sendMessage / abortMessage / setPermissionMode reach the session", async () => {
  const session = makeSession();
  const host = new RemoteControlCliHost(session);

  await host.handleRequest("sendMessage", { text: "go", force: true });
  expect(session.sendMessage).toHaveBeenCalledWith("go", true);

  await host.handleRequest("abortMessage", {});
  expect(session.abort).toHaveBeenCalledTimes(1);

  await host.handleRequest("setPermissionMode", { mode: "plan" });
  expect(session.setPermissionMode).toHaveBeenCalledWith("plan");
});

test("renameSession trims the title and refuses an empty one", async () => {
  // The daemon's bridge takes a target sessionId (a host serves many); this host
  // serves exactly one, so the title is the only parameter that means anything
  // here — and an empty title would write a nameless session.
  const session = makeSession();
  const host = new RemoteControlCliHost(session);

  await host.handleRequest("renameSession", {
    sessionId: "sess-1",
    title: "  会话标题  ",
  });
  expect(session.renameSession).toHaveBeenCalledWith("会话标题");

  await expect(
    host.handleRequest("renameSession", { sessionId: "sess-1", title: "   " }),
  ).rejects.toMatchObject({ code: -32602 });
  await expect(
    host.handleRequest("renameSession", { sessionId: "sess-1" }),
  ).rejects.toMatchObject({ code: -32602 });
  expect(session.renameSession).toHaveBeenCalledTimes(1);
});

test("compact forwards custom instructions and tolerates their absence", async () => {
  const session = makeSession();
  const host = new RemoteControlCliHost(session);

  await host.handleRequest("compact", { customInstructions: "keep the API" });
  expect(session.compact).toHaveBeenCalledWith("keep the API");

  await host.handleRequest("compact", {});
  expect(session.compact).toHaveBeenLastCalledWith(undefined);
});

test("getSlashCommands narrows the SDK command to what the page renders", async () => {
  // `handler` is a function: it cannot travel over the relay, and dropping it
  // implicitly (JSON.stringify ignores function-valued properties) would leave
  // the frame's shape to chance.
  const session = makeSession({
    slashCommands: () =>
      [
        {
          id: "review",
          name: "review",
          description: "技能：代码评审",
          skillSource: "user",
          handler: () => {},
        },
        {
          id: "ship",
          name: "ship",
          description: "自定义命令",
          handler: () => {},
        },
      ] as unknown as ReturnType<RemoteControlCliSession["slashCommands"]>,
  });
  const host = new RemoteControlCliHost(session);

  const result = (await host.handleRequest("getSlashCommands", {})) as {
    commands: { id: string; skillSource?: string }[];
  };

  // SDK 那半在前、远控页那批在后 —— 与 daemon 路径回的是同一份形状。
  expect(result.commands.slice(0, 2)).toEqual([
    {
      id: "review",
      name: "review",
      description: "技能：代码评审",
      skillSource: "user",
    },
    { id: "ship", name: "ship", description: "自定义命令" },
  ]);
  expect(result.commands.slice(2).map((command) => command.id)).toEqual([
    "status",
    "clear",
    "compact",
    "tasks",
    "workflows",
    "rewind",
    "btw",
  ]);
});

test("a permissionResponse notification settles the matching request", () => {
  const session = makeSession();
  const host = new RemoteControlCliHost(session);

  host.handleNotification("permissionResponse", {
    requestId: "r1",
    decision: "allow",
  });
  expect(session.respondPermission).toHaveBeenCalledWith("r1", "allow");

  // Anything without both halves is not a decision — ignore rather than guess.
  host.handleNotification("permissionResponse", { decision: "allow" });
  host.handleNotification("permissionResponse", { requestId: "r2" });
  host.handleNotification("messagesChange", { messages: [] });
  expect(session.respondPermission).toHaveBeenCalledTimes(1);
});

test("a whitelisted method this host does not implement says exactly that", async () => {
  // 白名单是**通道级**的（daemon / GUI 子进程 / 前台 CLI 共用一份），宿主实现面
  // 不同：`rewindToMessage` 能过白名单，这条前台会话却没接。答案必须与三种邻居
  // 分得开——`-32601`（通道不放行，页面会跑去升级电脑）、`-32602`（参数错）、
  // 静默不回（界面停在那个动作上）——所以是一个专门的码 + 带方法名的消息。
  const host = new RemoteControlCliHost(makeSession());
  await expect(host.handleRequest("rewindToMessage", {})).rejects.toMatchObject(
    {
      code: REMOTE_HOST_UNSUPPORTED,
      message: expect.stringContaining("rewindToMessage") as unknown as string,
    },
  );
});

test("/btw is not served by a foreground CLI session yet", async () => {
  // 白名单已放行 `askBtw`（页面能承载），但这个宿主只接了会话内那批 —— 与
  // `rewindToMessage` 同一条口径：页面据此说「这台电脑上的会话还不支持附带
  // 提问」，而不是停在加载中。
  const host = new RemoteControlCliHost(makeSession());
  await expect(
    host.handleRequest("askBtw", { question: "今天几号" }),
  ).rejects.toMatchObject({ code: REMOTE_HOST_UNSUPPORTED });
});

test("getSessionInfo answers the session-state family the page re-reads", async () => {
  // 场景 26: these four are *states* the remote page re-reads on every
  // re-alignment, so the reply must carry the facade's current values —
  // whatever the chat hook holds right now — not a transition or a default.
  const tasks = [
    { id: "t1", subject: "改规格", status: "in_progress" },
  ] as unknown as Task[];
  const queued = [{ id: "q1", text: "补一条" }] as unknown as QueuedMessage[];
  const host = new RemoteControlCliHost(
    makeSession({
      tasks: () => tasks,
      isCompacting: () => true,
      isCommandRunning: () => false,
      queuedMessages: () => queued,
      permissionMode: () => "bypassPermissions",
    }),
  );

  await expect(host.handleRequest("getSessionInfo", {})).resolves.toMatchObject(
    {
      tasks,
      isCompacting: true,
      isCommandRunning: false,
      queuedMessages: queued,
      permissionMode: "bypassPermissions",
    },
  );
});

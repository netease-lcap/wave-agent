import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserWindow } from "electron";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

// ---------------------------------------------------------------------------
// fs mock — ConfigStore persistence + desktopHost's tmpdir/artifact helpers
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  existingPaths: new Set<string>(),
  // Paths that exist but are directories (file panel local reads).
  dirPaths: new Set<string>(),
  // realpath overrides: a path that is a symlink to somewhere else (the file
  // panel's workdir containment check resolves both ends).
  realpaths: new Map<string, string>(),
  // When set, fs.promises.writeFile rejects — the file panel's save failure path.
  writeFileError: null as Error | null,
  agentInstances: [] as Array<Record<string, unknown>>,
  clientRequests: [] as Array<{ method: string; params: unknown }>,
  // searchFiles 的回包（`@` 下拉）。默认空列表；测试要文件与子代理条目排序
  // 时才给值。
  searchFilesResult: null as null | { files: Array<Record<string, string>> },
  // 创作集 RPC 回包（`artifact*`）：键是方法名，值是 CLI 侧那份 `{ok,...}`
  // 信封。没登记的按「未打桩」失败返回。
  artifactResponses: new Map<string, unknown>(),
  authUrlHandler: null as ((params: unknown) => void) | null,
  // Shared RPC implementation for the local StdioClient mock and the remote
  // daemon client returned by the connectRemoteDaemon mock — both must answer
  // the same utility methods so auth/worktree/git flows work on every host.
  handleClientRequest: (method: string, params?: unknown) => {
    switch (method) {
      case "listSessions": {
        const workdir =
          (params as { workdir?: string } | undefined)?.workdir ?? "";
        return { sessions: h.dirSessions.get(workdir) ?? [] };
      }
      // /resume picker: every project on this host's disk (CLI-created sessions
      // included), unlike the per-workdir listSessions above.
      case "listAllSessions":
        return { sessions: h.allSessions };
      case "getAuthStatus":
        return {
          isAuthenticated: h.authStatusResults.shift() ?? false,
          serverUrl: h.authServerUrl,
        };
      case "getPromptHistory":
      case "searchPromptHistory":
        return { history: [] };
      case "searchFiles":
        return h.searchFilesResult ?? { files: [] };
      case "writeArtifactFile": {
        // Remote daemon writes to ITS artifacts dir and returns a remote path.
        const name = (params as { name?: string } | undefined)?.name ?? "file";
        return { path: `/remote/tmp/wave-artifacts/${name}` };
      }
      case "listPlugins":
        return { plugins: [] };
      case "listMarketplaces":
        return { marketplaces: [] };
      // addMarketplace 回带市场清单里的名字（非用户输入）→ 成功 toast 取它。
      case "addMarketplace":
        return { name: "team-plugins" };
      case "listGitBranches": {
        if (!h.branchesResult) throw new Error("not a git repository");
        return h.branchesResult;
      }
      case "listDirectories": {
        const dir = (params as { dir?: string } | undefined)?.dir ?? "";
        const queued = h.dirListResults.shift();
        if (queued instanceof Error) throw queued;
        if (queued) return queued;
        if (h.dirListGate) {
          return new Promise<{ resolvedPath: string; dirs: string[] }>(
            (resolve) => {
              h.dirListRelease = resolve;
            },
          );
        }
        return { resolvedPath: dir, dirs: [] };
      }
      // File panel tree: one level per call (spec desktop-file-panel.md
      // 「文件面板工作区目录树」); results are queued so a test can also queue
      // an Error to exercise the retryable-failure reply.
      case "listDirectoryEntries": {
        const dir = (params as { dir?: string } | undefined)?.dir ?? "";
        const queued = h.dirEntriesResults.shift();
        if (queued instanceof Error) throw queued;
        return queued ?? { resolvedPath: dir, entries: [], total: 0 };
      }
      // Diff-panel query: answered by the CLI on the host that owns the repo,
      // so the desktop never runs git (or ssh) for it.
      case "getWorkspaceDiff": {
        if (h.workspaceDiffError) throw h.workspaceDiffError;
        return h.workspaceDiffResult;
      }
      case "createWorktree": {
        if (h.worktreeError) throw h.worktreeError;
        if (!h.worktreeResult) throw new Error("createWorktree not stubbed");
        return h.worktreeResult;
      }
      case "removeWorktree":
        if (h.removeWorktreeError) throw h.removeWorktreeError;
        if (h.removeWorktreeGate)
          return h.removeWorktreeGate.then(() => ({ removed: true }));
        return { removed: true };
      case "getWorktreeChanges":
        if (h.worktreeChangesError) throw h.worktreeChangesError;
        return h.worktreeChangesResult;
      case "listPendingPermissions":
        return { requests: h.pendingPermissionRequests };
      // 创作集：宿主只转发，CLI 进程里那份 `{ ok, data | error }` 信封原样回。
      case "artifactGalleryList":
      case "artifactShareView":
      case "artifactShareSave":
      case "artifactRevoke":
      case "artifactMembersSearch":
        return (
          h.artifactResponses.get(method) ?? {
            ok: false,
            error: `${method} not stubbed`,
          }
        );
      // 机器侧最近目录（spec core/recent-workdirs.md）。默认 `{}` 就是旧版机器的
      // 观感：方法不存在，桌面端保留本地缓存那份而不是清空列表。
      case "getRecentWorkdirs":
        return h.machineRecentWorkdirs ? { dirs: h.machineRecentWorkdirs } : {};
      case "rememberRecentWorkdir":
        return null;
      default:
        return {};
    }
  },
  // Sequential getAuthStatus results, consumed FIFO by the stdio mock. Empty
  // means "logged out" — pushInitialState queries once at webview-ready.
  authStatusResults: [] as boolean[],
  // 服务地址由 CLI 侧 getAuthStatus 解析（宿主只缓存/转发），故 mock 从这里出。
  authServerUrl: "",
  // Per-workdir listSessions results, keyed by directory (FR-020 session tree).
  dirSessions: new Map<string, unknown[]>(),
  // listAllSessions result (the /resume picker's cross-project disk list).
  allSessions: [] as unknown[],
  // FR-052..054: stdio git method stubs. `worktreeError` makes createWorktree
  // reject; `branchesResult: null` simulates a non-git workdir.
  worktreeResult: null as null | {
    name: string;
    path: string;
    branch: string;
    baseBranch: string;
    repoRoot: string;
    isNew: boolean;
  },
  worktreeError: null as Error | null,
  branchesResult: null as null | { branches: string[]; current: string },
  // listDirectories RPC queue (remote dir browser + remote existence probes).
  // Each entry is consumed once: an Error entry rejects the request — with the
  // bridge's「目录不存在或不可读：…」verdict it means "missing dir", anything
  // else is a transport failure; a result entry is returned verbatim. An
  // empty queue answers a generic success for the requested dir.
  dirListResults: [] as Array<{ resolvedPath: string; dirs: string[] } | Error>,
  // listDirectoryEntries RPC queue (file panel tree). Same convention as
  // dirListResults: an Error entry rejects the request (→ retryable error in
  // the tree), a result entry is returned verbatim, an empty queue answers an
  // empty listing for the requested dir.
  dirEntriesResults: [] as Array<
    | {
        resolvedPath: string;
        entries: Array<{ name: string; type: string }>;
        total: number;
      }
    | Error
  >,
  // When set, the listDirectories RPC parks until released via dirListRelease
  // (simulates a slow probe so a test can prove the optimistic switch
  // precedes it). Reset per-test like removeWorktreeGate.
  dirListGate: false as boolean,
  dirListRelease: null as
    | null
    | ((v: { resolvedPath: string; dirs: string[] }) => void),
  // getWorkspaceDiff RPC result, returned verbatim to the diff panel.
  workspaceDiffResult: null as unknown,
  // When set, the getWorkspaceDiff RPC rejects (host unreachable, daemon gone,
  // workdir not a repo) — the panel must fall back to the non-repo placeholder.
  workspaceDiffError: null as Error | null,
  // When set, the removeWorktree RPC awaits this promise (simulates a slow
  // multi-second git worktree remove in the shared stdio process).
  removeWorktreeGate: null as Promise<void> | null,
  // When set, the removeWorktree RPC rejects (host unreachable, stale CLI
  // without the method, path validation refused) — the host must log why
  // instead of swallowing the worktree cleanup failure.
  removeWorktreeError: null as Error | null,
  // getWorktreeChanges RPC (delete-confirmation loss summary). null = the CLI
  // could not inspect the worktree.
  worktreeChangesResult: null as null | { files: number; commits: number },
  worktreeChangesError: null as Error | null,
  // 机器自己的最近打开目录（`~/.wave/recent-workdirs.json`）。null = 旧版机器：
  // `getRecentWorkdirs` 回 `{}`，桌面端据此保留本地缓存那份。
  machineRecentWorkdirs: null as string[] | null,
  // When set, agent.initialize awaits this promise (simulates the multi-second
  // stdio startup so a real webview re-fires webviewReady while the new pane's
  // agent is still mid-spawn and not yet bound to the pane).
  initializeGate: null as Promise<void> | null,
  // The `repoRoot` the CLI's initialize reply carries for the next spawned
  // agent (set when the session root is a linked git worktree). The real
  // StdioAgent takes it from the reply; the mock has no JSON-RPC, so it reads
  // it from here instead.
  sessionRepoRootReply: undefined as string | undefined,
  // Multi-agent pool: each StdioAgent instance gets a unique sessionId so the
  // host's agents Map keys don't collapse (FR-031).
  agentCounter: 0,
  // onClosed handlers registered by ensureRemoteHostClient on each
  // connectRemoteDaemon client — tests fire them to simulate a disconnect.
  closedHandlers: [] as Array<() => void>,
  // listPendingPermissions result for the remote daemon client (SSH remote
  // background: re-surfaced pending approvals on attach).
  pendingPermissionRequests: [] as Array<{
    requestId: string;
    sessionId?: string;
    context: unknown;
  }>,
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn((p: string) => {
    const data = h.files.get(p);
    if (data === undefined) {
      const err = new Error(
        `ENOENT: no such file or directory, open '${p}'`,
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return data;
  }),
  writeFileSync: vi.fn((p: string, data: string | Buffer) => {
    h.files.set(p, data);
  }),
  renameSync: vi.fn((from: string, to: string) => {
    h.files.set(to, h.files.get(from) ?? "");
    h.files.delete(from);
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn((p: string) => h.existingPaths.has(p)),
  promises: {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (p: string, data: string | Buffer) => {
      if (h.writeFileError) throw h.writeFileError;
      h.files.set(p, data);
    }),
    readFile: vi.fn(async (p: string) => {
      const data = h.files.get(p);
      if (data === undefined) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return data;
    }),
    stat: vi.fn(async (p: string) => {
      if (!h.existingPaths.has(p) && !h.files.has(p)) {
        const err = new Error(
          `ENOENT: no such file or directory, stat '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return {
        isDirectory: () => h.dirPaths.has(p),
        isFile: () => !h.dirPaths.has(p),
        mode: 0o644,
      } as unknown as Awaited<ReturnType<typeof import("fs").promises.stat>>;
    }),
    // Symlink resolution for the file panel's workdir containment check. The
    // mock has no inode table, so unknown paths resolve to themselves and
    // `h.realpaths` supplies the cases where a path leads somewhere else.
    realpath: vi.fn(async (p: string) => {
      if (!h.existingPaths.has(p) && !h.files.has(p) && !h.dirPaths.has(p)) {
        const err = new Error(
          `ENOENT: no such file or directory, realpath '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return h.realpaths.get(p) ?? p;
    }),
    chmod: vi.fn(async () => undefined),
    unlink: vi.fn(async (p: string) => {
      h.files.delete(p);
      h.existingPaths.delete(p);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const data = h.files.get(from);
      if (data === undefined) {
        const err = new Error(
          `ENOENT: no such file or directory, rename '${from}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      h.files.set(to, data);
      h.files.delete(from);
    }),
    open: vi.fn(async (p: string) => ({
      read: vi.fn(
        async (
          buf: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const data = h.files.get(p);
          if (data === undefined) return { bytesRead: 0 };
          const content = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data, "utf8");
          const slice = content.subarray(position, position + length);
          slice.copy(buf, offset);
          return { bytesRead: slice.length };
        },
      ),
      close: vi.fn(async () => undefined),
    })),
  },
}));

// ---------------------------------------------------------------------------
// stdio layer mocks
// ---------------------------------------------------------------------------

vi.mock("../src/main/stdio/stdioClient", () => ({
  StdioClient: class {
    onNotification = vi.fn();
    removeOnNotification = vi.fn();
    dispose = vi.fn();
    request = vi.fn(async (method: string, params?: unknown) => {
      h.clientRequests.push({ method, params });
      return h.handleClientRequest(method, params);
    });
  },
}));

vi.mock("wave-agent-sdk/host", async (importOriginal) => ({
  // Spread the real host surface — desktopHost also takes shared literals from
  // this entry; only the two RPC classes are replaced.
  ...(await importOriginal<Record<string, unknown>>()),
  NotificationRouter: class {
    attach = vi.fn();
    registerSession = vi.fn();
    unregisterSession = vi.fn();
    registerGlobal = vi.fn(
      (method: string, handler: (params: unknown) => void) => {
        if (method === "authUrl") h.authUrlHandler = handler;
      },
    );
  },

  StdioAgent: class {
    sessionId: string | undefined;
    currentWorkdir: string | undefined;
    sessionCwd: string | undefined;
    workspaceRoot: string | undefined;
    sessionRepoRoot: string | undefined;
    latestTotalTokens = 0;
    /**
     * CLI 侧的显示流 —— `getMessages` 的取数源。宿主对消息内容零状态（spec
     * ui/message-rendering-system.md「宿主不保留消息内容，用的时候现取」），
     * 所以这个类上**没有** `messages` 字段：谁想读消息，只能调 `getMessages()`
     * 现取，拿到的那份用完即弃。
     */
    daemonMessages: unknown[] | undefined = undefined;
    threadSummary:
      | { messageCount: number; firstUserText?: string }
      | undefined = undefined;
    tasks: unknown[] = [];
    backgroundTasks: unknown[] = [];
    queuedMessages: unknown[] = [];
    isStreaming = false;
    isCommandRunning = false;
    isCompacting = false;
    permissionMode: "default" | "plan" | undefined;
    callbacks: Record<string, (...args: never[]) => void>;

    initialize = vi.fn(async function (
      this: {
        currentWorkdir?: string;
        sessionCwd?: string;
        workspaceRoot?: string;
        sessionRepoRoot?: string;
        sessionId?: string;
      },
      params: { workdir?: string },
    ) {
      this.currentWorkdir = params.workdir;
      this.sessionCwd = params.workdir;
      this.workspaceRoot = params.workdir;
      this.sessionRepoRoot = h.sessionRepoRootReply;
      this.sessionId = `sess-${++h.agentCounter}`;
      if (h.initializeGate) await h.initializeGate;
    });
    destroy = vi.fn(async () => undefined);
    restoreSession = vi.fn(async function (
      this: { sessionId?: string; daemonMessages?: unknown[] },
      sessionId: string,
    ) {
      this.sessionId = sessionId;
      // Mirror the real StdioAgent: restore is a bare RPC — the daemon switches
      // to the session and holds its history daemon-side. Nothing is loaded
      // here; the host pulls it with getMessages() when it needs the list.
      this.daemonMessages = [
        {
          id: "restored-u1",
          role: "user",
          blocks: [{ type: "text", content: "历史会话的第一条消息" }],
        },
      ];
    });
    updateConfig = vi.fn(async () => undefined);
    sendMessage = vi.fn(async () => undefined);
    bang = vi.fn(async () => undefined);
    abortMessage = vi.fn(async () => undefined);
    // Mirror the real flow: the session's content is gone, then a fresh
    // sessionId fires through the sessionIdChange notification.
    clearMessages = vi.fn(async function (this: {
      daemonMessages?: unknown[];
      sessionId?: string;
      callbacks: Record<string, (id: string) => void>;
    }) {
      this.daemonMessages = [];
      const newId = `sess-${++h.agentCounter}`;
      this.sessionId = newId;
      this.callbacks.onSessionIdChange(newId);
    });
    compact = vi.fn(async () => undefined);
    rewindToMessage = vi.fn(async () => ({ inputContent: "rewound draft" }));
    askBtw = vi.fn(async () => "**Sunny** weather");
    getFullMessageThread = vi.fn(async function (this: {
      daemonMessages?: unknown[];
    }) {
      return { messages: this.daemonMessages ?? [], sessionIds: [] };
    });
    // Mirrors StdioAgent.getMessages() with no arguments: the whole list, and
    // the two **state** side effects the host is allowed to keep (thread
    // summary + context usage). No cache is written — the array is discarded.
    getMessages = vi.fn(async function (this: {
      daemonMessages?: unknown[];
      threadSummary:
        | { messageCount: number; firstUserText?: string }
        | undefined;
    }) {
      const all = (this.daemonMessages ?? []) as Array<{
        id?: string;
        role?: string;
        blocks?: Array<{ type?: string; content?: string }>;
      }>;
      const firstUser = all.find((m) => m.role === "user") as
        | { blocks?: Array<{ type?: string; content?: string }> }
        | undefined;
      const firstText = firstUser?.blocks?.find(
        (b) => b.type === "text",
      )?.content;
      this.threadSummary = {
        messageCount: all.length,
        ...(firstText ? { firstUserText: firstText } : {}),
      };
      return all;
    });
    listRewindCheckpoints = vi.fn(async () => ({
      checkpoints: [{ id: "u1", content: "hello" }],
    }));
    getConfiguredModels = vi.fn(async () => ({
      models: ["gpt-4", "claude"],
      currentModel: "gpt-4",
    }));
    setModel = vi.fn(async () => undefined);
    removeQueuedMessage = vi.fn(async () => undefined);
    updateQueuedMessageById = vi.fn(async () => true);
    removeQueuedMessageById = vi.fn(async () => undefined);
    setPermissionMode = vi.fn(async () => undefined);
    getPermissionMode = vi.fn(() => undefined);
    getPlanFile = vi.fn(async () => ({
      path: "/mock/plan.md",
      content: "mock plan content",
    }));
    sendPermissionResponse = vi.fn();
    getBackgroundTaskOutput = vi.fn(async () => null);
    stopBackgroundTask = vi.fn(async () => true);
    getWorkflowRuns = vi.fn(async () => []);
    stopWorkflowRun = vi.fn(async () => true);
    getMcpServers = vi.fn(async () => []);
    connectMcpServer = vi.fn(async () => true);
    disconnectMcpServer = vi.fn(async () => true);
    // 弹窗那批命令由服务端组装：SDK 那一半 + 本入口（`surface: "desktop"`）的
    // 宿主本地命令，后者来自 packages/code 的一张表（由
    // `hostSlashCommands.test.ts` 钉住每条归属哪个入口）。这里只要几行代表性
    // 数据，够验宿主「照原样转发」即可。
    getSlashCommands = vi.fn(async () => [
      {
        id: "review",
        name: "review",
        description: "Code review",
        skillSource: "builtin",
      },
      {
        id: "remote-control",
        name: "remote-control",
        description: "远程控制（用手机接管本机会话）",
        runOnSelect: true,
      },
      {
        id: "plan",
        name: "plan",
        description: "启用规划模式或查看当前方案",
        runOnSelect: true,
      },
      {
        id: "rewind",
        name: "rewind",
        description: "回退到之前的用户消息",
        runOnSelect: true,
      },
      {
        id: "status",
        name: "status",
        description: "查看当前状态",
        runOnSelect: true,
      },
      { id: "btw", name: "btw", description: "旁路提问（不进入聊天记录）" },
    ]);
    getSkillMetadata = vi.fn(async () => [
      {
        name: "deep-research",
        description: "Deep research",
        type: "builtin",
      },
    ]);
    remoteControlStatus = vi.fn(async () => ({
      state: "online",
      url: "wss://relay.example/v1/hosts/ws/h1/client",
      pageUrl: "https://relay.example/remote/?host=h1",
    }));
    remoteControlConnect = vi.fn(async () => ({ state: "connecting" }));
    remoteControlDisconnect = vi.fn(async () => ({ state: "off" }));

    constructor(
      _client: unknown,
      _router: unknown,
      callbacks: Record<string, (...args: never[]) => void>,
    ) {
      this.callbacks = callbacks;
      h.agentInstances.push(this as unknown as Record<string, unknown>);
    }
  },
}));

vi.mock("../src/main/stdio/binaryResolver", () => ({
  resolveWaveBinary: vi.fn(async () => "/mock/wave"),
  ensureCliUpToDate: vi.fn(async () => "/mock/wave"),
  loadBundledCliSource: vi.fn(() => ({
    dir: "/app/root/resources/wave-cli",
    bundleSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  })),
}));

// electron-updater — the auto-update service for logged-in (serverUrl) installs.
// The on() mock records listeners so tests can fire update-available /
// update-downloaded / error to assert the host's update.status wiring.
// (downloading is driven by the desktopUpdateDownload RPC, not an updater event.)
const auListeners: Record<string, Array<(info: unknown) => void>> = {};
vi.mock("electron-updater", () => ({
  autoUpdater: {
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    setFeedURL: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, cb: (info: unknown) => void) => {
      (auListeners[event] ??= []).push(cb);
    }),
  },
}));

// PortForwardManager spawns real `ssh -N -L` processes — stub it entirely and
// assert the wiring (messages in, forwarded results out, session-scoped teardown).
vi.mock("../src/main/portForward", () => {
  class MockPortForwardManager {
    acquire = vi.fn(async () => ({
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    }));
    releaseSession = vi.fn();
    dispose = vi.fn();
    forwardAuthCallback = vi.fn();
  }
  return { PortForwardManager: MockPortForwardManager };
});

// HtmlPreviewServer opens real loopback listeners — stub it here; the class
// itself is covered by tests/htmlPreviewServer.test.ts. The shared call log
// lets the message-flow tests assert acquire/release wiring.
const htmlPreviewMock = vi.hoisted(() => ({
  acquire: vi.fn(
    async (_paneId: string, rootDir: string, servePath: string) =>
      `http://127.0.0.1:45000/${path.basename(servePath)}`,
  ),
  release: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../src/main/htmlPreviewServer", () => {
  class MockHtmlPreviewServer {
    acquire = htmlPreviewMock.acquire;
    release = htmlPreviewMock.release;
    dispose = htmlPreviewMock.dispose;
  }
  return { HtmlPreviewServer: MockHtmlPreviewServer };
});

// remoteCli spawns real `ssh` processes — stub the probes, keep the exported
// constants real so file-panel truncation tests assert against true limits.
vi.mock("../src/main/remoteCli", async () => {
  const actual = await vi.importActual<typeof import("../src/main/remoteCli")>(
    "../src/main/remoteCli",
  );
  return {
    ...actual,
    resolveRemoteWaveBinary: vi.fn(async (host: string) => ({
      binaryPath: `/remote/wave-${host}`,
      nodeVersion: "v22.0.0",
    })),
    ensureRemoteDaemon: vi.fn(
      async (host: string) => `/home/${host}/.wave/daemon.sock`,
    ),
    connectRemoteDaemon: vi.fn(async () => ({
      client: {
        onNotification: vi.fn(),
        onClosed: vi.fn((handler: () => void) => {
          h.closedHandlers.push(handler);
        }),
        dispose: vi.fn(),
        request: vi.fn(async (method: string, params?: unknown) => {
          h.clientRequests.push({ method, params });
          return h.handleClientRequest(method, params);
        }),
      },
      tunnel: { kill: vi.fn() },
    })),
    readRemoteFile: vi.fn(async () => ({
      type: "text",
      mime: "text/plain",
      contentBase64: Buffer.from("remote content").toString("base64"),
      truncated: false,
    })),
  };
});

// withRemoteLoginShell probes the remote login shell via a real `echo $SHELL`
// ssh round trip — stub it to keep host tests offline. Everything else in
// sshHosts (config parsing, spawn args, quoting) stays real.
vi.mock("../src/main/sshHosts", async () => {
  const actual = await vi.importActual<typeof import("../src/main/sshHosts")>(
    "../src/main/sshHosts",
  );
  return {
    ...actual,
    withRemoteLoginShell: vi.fn(
      async (_host: string, command: string) => command,
    ),
  };
});

import { DesktopHost } from "../src/main/desktopHost";
import { ConfigStore } from "../src/main/configStore";
import { HOST_CHANNEL } from "../src/main/channels";
import { shell, dialog, nativeTheme, powerMonitor } from "electron";
import { autoUpdater } from "electron-updater";
import {
  ensureRemoteDaemon,
  connectRemoteDaemon,
  readRemoteFile,
  REMOTE_FILE_MAX_LINES,
  REMOTE_FILE_MAX_BYTES,
} from "../src/main/remoteCli";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const STORE_PATH = "/mock-userData/wave-desktop.json";

/** The send mock of the most recently created host (shownToasts reads it). */
let lastSend: ReturnType<typeof vi.fn> | undefined;

/** The message/action of every update toast the host pushed to the webview. */
function shownToasts(): Array<{
  message: string;
  type?: string;
  position?: string;
  actionLabel?: string;
  action?: { type: string };
}> {
  const send = lastSend;
  if (!send) return [];
  return send.mock.calls
    .filter(
      ([channel, msg]) =>
        channel === HOST_CHANNEL &&
        (msg as { command?: string }).command === "showToast",
    )
    .map(
      ([, msg]) =>
        (
          msg as {
            toast: {
              message: string;
              type?: string;
              position?: string;
              actionLabel?: string;
              action?: { type: string };
            };
          }
        ).toast,
    );
}

/**
 * 插件变更的强引导弹窗计数（`pluginChangePending`，spec plugin「插件变更提示」
 * 2026-09-23 起：桌面端改弹确认框，不再发 toast）。
 */
function pendingPluginPrompts(): number {
  const send = lastSend;
  if (!send) return 0;
  return send.mock.calls.filter(
    ([channel, msg]) =>
      channel === HOST_CHANNEL &&
      (msg as { command?: string }).command === "pluginChangePending",
  ).length;
}

/** Make one utility RPC method throw; returns a restore function for after the test. */
function failRpc(method: string, message: string): () => void {
  const orig = h.handleClientRequest;
  h.handleClientRequest = (m: string, params?: unknown) => {
    if (m === method) throw new Error(message);
    return orig(m, params);
  };
  return () => {
    h.handleClientRequest = orig;
  };
}

function createHost(winWidth = 1280, winHeight = 800) {
  const store = new ConfigStore(STORE_PATH);
  const host = new DesktopHost(store);
  const send = vi.fn();
  lastSend = send;
  const win = {
    webContents: { send },
    isDestroyed: () => false,
    getContentSize: () => [winWidth, winHeight],
  } as unknown as BrowserWindow;
  host.setMainWindow(win);
  // Typed against the shared host→webview contract: an unknown command string
  // or a field access outside the command's payload is a compile error, so a
  // contract rename breaks this suite the same way it breaks the webview one.
  const sent = <C extends HostToWebviewMessage["command"]>(command: C) =>
    send.mock.calls
      .filter(
        ([channel, msg]) =>
          channel === HOST_CHANNEL &&
          (msg as { command?: string }).command === command,
      )
      .map(([, msg]) => msg as Extract<HostToWebviewMessage, { command: C }>);
  return { host, store, send, sent };
}

function lastAgent() {
  const agent = h.agentInstances[h.agentInstances.length - 1];
  expect(agent).toBeDefined();
  return agent as Record<
    string,
    ReturnType<typeof vi.fn> & Record<string, unknown>
  > & {
    callbacks: Record<string, (...args: unknown[]) => void>;
  };
}

/** Mirror what the real StdioAgent does on sessionIdChange: set the field, then fire. */
function fireSessionId(agent: ReturnType<typeof lastAgent>, sessionId: string) {
  agent.sessionId = sessionId;
  agent.callbacks.onSessionIdChange(sessionId);
}

let seededMessageCounter = 0;
/**
 * 让 agent 成为「一条有内容的会话」——用一个真实的用户消息事件表达。
 *
 * 宿主对消息内容零状态（spec ui/message-rendering-system.md「宿主不保留消息
 * 内容，用的时候现取」）：它没有自己的数组可以塞，判据是「收到过消息事件」与
 * 会话索引，所以造数据也只能造事件（CLI 侧那份 `daemonMessages` 跟着长，重拉
 * 时才拉得到东西）。
 */
function fireUserMessage(
  agent: ReturnType<typeof lastAgent>,
  text = "你好",
): {
  id: string;
  role: string;
  blocks: Array<{ type: string; content: string }>;
} {
  const message = {
    id: `u-${++seededMessageCounter}`,
    role: "user",
    blocks: [{ type: "text", content: text }],
  };
  agent.daemonMessages = [
    ...((agent.daemonMessages as unknown[] | undefined) ?? []),
    message,
  ];
  agent.callbacks.onUserMessageAdded(message);
  return message;
}

/** Seed a live conversation: an id-change notification, then a real user turn. */
function seedConversation(
  agent: ReturnType<typeof lastAgent>,
  sessionId: string,
  text = "你好",
) {
  fireSessionId(agent, sessionId);
  fireUserMessage(agent, text);
  return agent;
}

async function readyHost(winWidth?: number, winHeight?: number) {
  const ctx = createHost(winWidth ?? 1280, winHeight ?? 800);
  // workdir is never persisted — pick it from recents like the real UI flow.
  ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
  h.existingPaths.add("/work/a");
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: "/work/a",
  });
  await ctx.host.handleWebviewMessage({ command: "webviewReady" });
  return ctx;
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  h.files.clear();
  h.existingPaths.clear();
  h.dirPaths.clear();
  h.realpaths.clear();
  h.writeFileError = null;
  h.agentInstances.length = 0;
  h.clientRequests.length = 0;
  h.searchFilesResult = null;
  h.authStatusResults.length = 0;
  h.authServerUrl = "";
  h.authUrlHandler = null;
  h.dirSessions.clear();
  h.allSessions = [];
  h.worktreeResult = null;
  h.worktreeError = null;
  h.branchesResult = null;
  h.dirListResults.length = 0;
  h.dirEntriesResults.length = 0;
  h.dirListGate = false;
  h.dirListRelease = null;
  h.workspaceDiffResult = null;
  h.workspaceDiffError = null;
  h.removeWorktreeGate = null;
  h.removeWorktreeError = null;
  h.worktreeChangesResult = null;
  h.worktreeChangesError = null;
  h.machineRecentWorkdirs = null;
  h.initializeGate = null;
  h.sessionRepoRootReply = undefined;
  h.agentCounter = 0;
  h.closedHandlers.length = 0;
  h.pendingPermissionRequests = [];
  h.artifactResponses.clear();
  htmlPreviewMock.acquire.mockClear();
  htmlPreviewMock.release.mockClear();
  htmlPreviewMock.dispose.mockClear();
  vi.clearAllMocks();
  for (const key of Object.keys(auListeners)) delete auListeners[key];
  nativeTheme.__reset();
  powerMonitor.__reset();
  // Reset the auto-reconnect seams (tests shrink them to keep retries fast).
  (
    DesktopHost as unknown as { autoReconnectBaseDelayMs: number }
  ).autoReconnectBaseDelayMs = 5000;
  (
    DesktopHost as unknown as { autoReconnectResumeGraceMs: number }
  ).autoReconnectResumeGraceMs = 8000;
  // Silence error logs from intentionally-triggered failure paths (restore
  // session tunnel down, SSO callback forward failure, update check failure…).
  consoleSpies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")].map(
    (s) => s.mockImplementation(() => {}),
  );
});

afterEach(() => {
  for (const s of consoleSpies) s.mockRestore();
});

// ---------------------------------------------------------------------------
// workdir lifecycle (FR-001/002/003)
// ---------------------------------------------------------------------------

describe("workdir lifecycle", () => {
  it("desktopReady always starts fresh: no workdir restored, recents still listed", async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.addRecentWorkdir({ host: "local", path: "/work/b" });

    await host.handleWebviewMessage({ command: "desktopReady" });

    const states = sent("desktopWorkdirState");
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({
      command: "desktopWorkdirState",
      workdir: undefined,
      host: "local",
      hosts: [],
      recentWorkdirs: ["/work/b", "/work/a"],
    });
  });

  it("desktopReady posts an empty state when no workdir was ever chosen", async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });

    const states = sent("desktopWorkdirState");
    expect(states[0]).toMatchObject({
      workdir: undefined,
      host: "local",
      hosts: [],
      recentWorkdirs: [],
    });
  });

  it("desktopRemoveRecentWorkdir removes the entry and reposts state", async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.addRecentWorkdir({ host: "local", path: "/work/b" });

    await host.handleWebviewMessage({
      command: "desktopRemoveRecentWorkdir",
      path: "/work/a",
    });

    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/work/b" },
    ]);
    const states = sent("desktopWorkdirState");
    expect(states[states.length - 1]).toMatchObject({
      recentWorkdirs: ["/work/b"],
    });
  });

  it("switching workdir destroys the empty agent it replaces instead of leaking it in the pool", async () => {
    const { host } = await readyHost();
    const replaced = lastAgent(); // the fresh empty agent bound to the pane
    h.existingPaths.add("/work/b");

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/b",
    });

    expect(lastAgent()).not.toBe(replaced);
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/b" }),
    );
    expect(replaced.destroy).toHaveBeenCalledTimes(1);
  });

  it("desktopSelectRecentWorkdir drops a stale path and keeps the current agent", async () => {
    const { host, sent, store } = await readyHost();
    const agentBefore = lastAgent();

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/gone",
    });

    expect(store.getRecentWorkdirs()).not.toEqual(
      expect.arrayContaining([{ host: "local", path: "/gone" }]),
    );
    expect(lastAgent()).toBe(agentBefore);
    expect(
      shownToasts().some((t) => t.message.includes("已从最近列表移除")),
    ).toBe(true);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("已从最近列表移除"),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// file suggestions (@file) — workdir resolution
// ---------------------------------------------------------------------------

describe("file suggestions", () => {
  it("falls back to the most recent workdir while the auto new-session agent is still starting (fresh launch)", async () => {
    // Fresh launch: recents list a directory, so the host starts the automatic
    // 新对话 spawn at that dir (spec desktop-sessions.md「会话管理」scenario 2).
    // While that spawn is still initializing no agent is bound yet and host-side
    // this.workdir is unset — an @file request typed in that window must still
    // search the default directory instead of returning an empty list.
    const { host, store } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    let releaseGate!: () => void;
    h.initializeGate = new Promise<void>((resolve) => (releaseGate = resolve));
    await host.handleWebviewMessage({ command: "desktopReady" });
    // Fire (don't await): the auto spawn holds on initializeGate mid-init. Wait
    // until the spawn has created its agent — the stdio client is ready by then
    // (spawnAgent ensures it before creating the agent) while the pane is still
    // unbound, which is exactly the transient window the fallback covers.
    void host.handleWebviewMessage({ command: "webviewReady" });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(1);
    });
    await host.handleWebviewMessage({
      command: "requestFileSuggestions",
      filterText: "app",
      requestId: "r1",
    });

    const search = h.clientRequests.find((r) => r.method === "searchFiles");
    expect(search?.params).toMatchObject({
      workdir: "/work/a",
      query: "app",
      maxResults: 20,
    });
    // Release the gate — the pane settles on the auto new-session agent at /work/a.
    releaseGate();
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(1);
    });
    expect(lastAgent().currentWorkdir).toBe("/work/a");
  });

  it("stays anchored to the session root after bash cd drifts the working directory", async () => {
    const { host, sent } = await readyHost();
    const first = lastAgent();
    seedConversation(first, "sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(
        (sent("desktopPanes").at(-1)!.panes as Array<{ sessionId?: string }>)[1]
          ?.sessionId,
      ).toBe("sess-2");
    });
    const panes = sent("desktopPanes").at(-1)!.panes as Array<{
      paneId: string;
    }>;

    // The agent ran `cd src` — the CLI broadcast workdirChange, drifting the
    // agent's currentWorkdir.
    first.currentWorkdir = "/work/a/src";
    first.callbacks.onWorkdirChange("/work/a/src");

    // Switching back to the drifted pane re-anchors host workdir to the
    // subdir. @file suggestions must still search the session root.
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[0].paneId,
    });
    await host.handleWebviewMessage({
      command: "requestFileSuggestions",
      filterText: "app",
      requestId: "r1",
    });

    const search = h.clientRequests.find((r) => r.method === "searchFiles");
    expect(search?.params).toMatchObject({
      workdir: "/work/a",
      query: "app",
      maxResults: 20,
    });
  });

  it("merges this session's subagents ahead of the file suggestions", async () => {
    // `@` 下拉只有一个列表：子代理条目排在文件建议前面（spec
    // multi-agent/subagent.md「显式子代理调用」）。宿主只报「有哪些子代理」，
    // 名字/描述的过滤留给 webview。
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.getSubagentConfigurations = vi.fn(async () => [
      { name: "Explore", description: "只读探索代码库" },
    ]);
    h.searchFilesResult = { files: [{ path: "src/app.ts", type: "file" }] };

    await host.handleWebviewMessage({
      command: "requestFileSuggestions",
      filterText: "app",
      requestId: "r1",
    });

    const response = sent("fileSuggestionsResponse").at(-1) as {
      suggestions: Array<Record<string, unknown>>;
    };
    expect(response.suggestions[0]).toMatchObject({
      // `path` 是占位符——webview 靠 `agentName` 认条目，不猜 path 前缀。
      path: "agent:Explore",
      name: "Explore",
      agentName: "Explore",
      agentDescription: "只读探索代码库",
      icon: "codicon-hubot",
      isDirectory: false,
    });
    expect(response.suggestions[1]).toMatchObject({
      name: "app.ts",
      path: path.join("/work/a", "src/app.ts"),
      isDirectory: false,
    });
    expect(response.suggestions[1].agentName).toBeUndefined();
  });

  it("keeps file suggestions working when the subagent list cannot be read", async () => {
    // 候选增强不该让整条 `@` 回包失败：读不到子代理就只给文件建议。
    const { host, sent } = await readyHost();
    lastAgent().getSubagentConfigurations = vi.fn(async () => {
      throw new Error("no agent context");
    });
    h.searchFilesResult = { files: [{ path: "src/app.ts", type: "file" }] };

    await host.handleWebviewMessage({
      command: "requestFileSuggestions",
      filterText: "app",
      requestId: "r1",
    });

    const response = sent("fileSuggestionsResponse").at(-1) as {
      suggestions: Array<Record<string, unknown>>;
    };
    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]).toMatchObject({ name: "app.ts" });
    expect(sent("fileSuggestionsError")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// file uploads (+ 上传文件 → uploadFilesToArtifacts)
// ---------------------------------------------------------------------------

describe("uploadFilesToArtifacts", () => {
  it("local session writes to the local artifacts dir and returns the local path", async () => {
    const { host, sent } = await readyHost();
    // NOTE: not Buffer.from('hello').buffer — that returns the shared Buffer
    // pool ArrayBuffer (multi-KB, stale bytes), not a 5-byte buffer.
    const data = new TextEncoder().encode("hello").buffer;

    await host.handleWebviewMessage({
      command: "uploadFilesToArtifacts",
      files: [{ name: "note.txt", data }],
    });

    const success = sent("uploadSuccess").at(-1) as { uploadedFiles: string[] };
    const expected = path.join(os.tmpdir(), "wave-artifacts", "note.txt");
    expect(success.uploadedFiles[0]).toBe(expected);
    // Bytes landed on the local filesystem (mock fs).
    expect(h.files.get(expected)).toEqual(Buffer.from("hello"));
    // Local uploads must not hit the remote-daemon RPC.
    expect(h.clientRequests.some((r) => r.method === "writeArtifactFile")).toBe(
      false,
    );
  });

  it("remote session routes the bytes to the remote daemon and returns the remote path", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.upsertSession({
      sessionId: "sess-remote",
      title: "remote",
      host: "prod",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1,
      lastActiveAt: 1,
    });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-remote",
    });
    // The remote pane's client is established before uploads route to it.
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledWith(
        "prod",
        expect.any(String),
      );
    });

    const data = new TextEncoder().encode("hello").buffer;
    await host.handleWebviewMessage({
      command: "uploadFilesToArtifacts",
      files: [{ name: "note.txt", data }],
    });

    // The bytes go over the tunnel to the remote daemon's writeArtifactFile.
    const write = h.clientRequests.find(
      (r) => r.method === "writeArtifactFile",
    );
    expect(write?.params).toMatchObject({
      name: "note.txt",
      contentBase64: "aGVsbG8=",
    });
    // The inserted path is the remote one the agent can read — not a local path.
    const success = sent("uploadSuccess").at(-1) as { uploadedFiles: string[] };
    expect(success.uploadedFiles[0]).toBe(
      "/remote/tmp/wave-artifacts/note.txt",
    );
    // Nothing written to the local artifacts dir.
    expect(
      h.files.has(path.join(os.tmpdir(), "wave-artifacts", "note.txt")),
    ).toBe(false);
  });

  it("echoes the originating paneId on uploadSuccess so a pane-scoped input can insert the chip", async () => {
    // Regression: the reply must carry the request's paneId — the webview's
    // MessageInput rejects uploadSuccess without a matching paneId for
    // pane-scoped ChatApp instances (the desktop app renders every chat
    // pane-scoped once a session is bound, so the chip silently never
    // appeared in conversations with messages).
    const { host, sent } = await readyHost();
    const data = new TextEncoder().encode("hello").buffer;

    await host.handleWebviewMessage({
      command: "uploadFilesToArtifacts",
      paneId: "pane-1",
      files: [{ name: "note.txt", data }],
    });

    const success = sent("uploadSuccess").at(-1) as {
      uploadedFiles: string[];
      paneId?: string;
    };
    expect(success.paneId).toBe("pane-1");
  });

  it("falls back to the focused pane when the request carries no paneId", async () => {
    // A request without paneId (e.g. the root, pre-pane instance) routes the
    // reply to the focused pane — still deliverable because the root input's
    // paneId guard only applies to pane-scoped instances.
    const { host, sent } = await readyHost();
    const data = new TextEncoder().encode("hello").buffer;

    await host.handleWebviewMessage({
      command: "uploadFilesToArtifacts",
      files: [{ name: "note.txt", data }],
    });

    const success = sent("uploadSuccess").at(-1) as {
      uploadedFiles: string[];
      paneId?: string;
    };
    expect(success.paneId).toBe("pane-1");
  });
});

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

describe("webviewReady / setInitialState", () => {
  it("initializes the stdio client + agent and posts the full initial state", async () => {
    const { sent } = await readyHost();

    const states = sent("setInitialState");
    expect(states.length).toBeGreaterThanOrEqual(1);
    const last = states[states.length - 1];
    expect(last).toMatchObject({
      command: "setInitialState",
      messages: [],
      isStreaming: false,
      isCommandRunning: false,
      isAuthenticated: false,
      workdir: "/work/a",
    });
    // 全局配置是窗口级数据：随 pushAppLevelState 未打标签下发，不在 pane 快照里
    expect(
      sent("configurationResponse").at(-1)!.configurationData,
    ).toBeDefined();

    // Contract gates: setInitialState must always carry inputContent ('' when
    // no draft) and the pane id. These mirror the shared fixture defaults — if
    // the host stops sending them or the fixture default changes, both layers
    // go red together instead of one passing on mock-defined expectations.
    const anchors = fixtures.setInitialState();
    expect(last.inputContent).toBe(anchors.inputContent);
    expect(last.isAuthenticated).toBe(false);
    expect(last.messages).toEqual(anchors.messages);
    expect(last.tasks).toEqual(anchors.tasks);
    expect(last.backgroundTasks).toEqual(anchors.backgroundTasks);
    expect(last.workflowRuns).toEqual(anchors.workflowRuns);
    expect(last.queuedMessages).toEqual(anchors.queuedMessages);
    expect(last.pendingConfirmations).toEqual(anchors.pendingConfirmations);
    expect(last.paneId).toBeTypeOf("string");
  });

  it("declares the desktop entrypoint so telemetry can attribute the session", async () => {
    await readyHost();

    // The value travels the wire as `initialize.entrypoint` and is what the SDK
    // exports as `app.entrypoint` (spec enterprise/opentelemetry.md).
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ entrypoint: "desktop" }),
    );
  });

  it("starts a fresh session on every launch: agent.initialize never carries restoreSessionId", async () => {
    await readyHost();

    const agent = lastAgent();
    for (const [params] of agent.initialize.mock.calls) {
      expect(params).not.toHaveProperty("restoreSessionId");
    }
    expect(agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
  });

  it("shows a toast instead of throwing when initialization fails", async () => {
    const { ensureCliUpToDate } = await import(
      "../src/main/stdio/binaryResolver"
    );
    vi.mocked(ensureCliUpToDate).mockRejectedValueOnce(new Error("no binary"));

    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });

    const toasts = shownToasts().filter((t) =>
      t.message.includes("wave CLI 获取失败"),
    );
    expect(toasts).toHaveLength(1);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("wave CLI 获取失败"),
      ),
    ).toHaveLength(0);
  });

  it("surfaces a local CLI download failure as a toast, not a chat message", async () => {
    const { ensureCliUpToDate } = await import(
      "../src/main/stdio/binaryResolver"
    );
    vi.mocked(ensureCliUpToDate).mockRejectedValueOnce(
      new Error("下载失败（HTTP 500）"),
    );

    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });

    expect(
      shownToasts().some((t) => t.message.includes("wave CLI 获取失败")),
    ).toBe(true);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("wave CLI 获取失败"),
      ),
    ).toHaveLength(0);
  });

  it("surfaces the remote daemon CLI upgrade progress as a toast, not a chat message", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    vi.mocked(ensureRemoteDaemon).mockImplementationOnce(
      async (_host, _version, onNotice) => {
        onNotice?.("正在升级 wave-code 到 v1.0.7，请稍候…");
        return "/home/prod/.wave/daemon.sock";
      },
    );

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await vi.waitFor(() => {
      expect(
        shownToasts().some((t) => t.message.includes("正在升级 wave-code")),
      ).toBe(true);
    });
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("正在升级 wave-code"),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// fresh-launch auto new-session (spec desktop-sessions.md「会话管理」scenario 2:
// 2026-09-08 拍板「刚打开桌面端就跟点击新对话的效果一样」)
// ---------------------------------------------------------------------------

describe("fresh launch auto new-session", () => {
  it("spawns and binds a conversation at the most recent directory on first ready", async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    // Equivalent to one automatic 新对话 click: a fresh agent is spawned and
    // bound to the pane at recents[0], workdir is pushed, input gets focus.
    expect(h.agentInstances).toHaveLength(1);
    expect(lastAgent().currentWorkdir).toBe("/work/a");
    expect(sent("desktopPanes").at(-1)?.panes[0].sessionId).toBe(
      lastAgent().sessionId,
    );
    expect(sent("desktopWorkdirState").at(-1)?.workdir).toBe("/work/a");
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: lastAgent().sessionId },
      messages: [],
      isStreaming: false,
    });
    expect(sent("focusInput").length).toBeGreaterThanOrEqual(1);
  });

  it("flags a freshly spawned pane as having no content, then flips it on the first message", async () => {
    // The renderer cannot tell "brand-new session" from "existing session whose
    // transcript was emptied" (`/rewind` back to the first message, `/clear`) —
    // both show an empty list. `hasContent` is the host's answer, and the
    // webview gates the new-session worktree flow on it
    // (spec desktop-sessions.md「基于分支的 worktree 隔离会话」场景 1/9).
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    expect(sent("desktopPanes").at(-1)?.panes[0].hasContent).toBe(false);

    // The first message flips it; the host pushes panes so the renderer's
    // copy cannot stay stale at the value from spawn time.
    fireUserMessage(lastAgent(), "你好");

    expect(sent("desktopPanes").at(-1)?.panes[0].hasContent).toBe(true);
  });

  it("keeps the blank choose-a-directory welcome when there are no recents", async () => {
    const { host, sent } = createHost();

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    // No recents → nothing to auto-bind: no agent, no workdir, the pane stays
    // the blank new-session state (scenario 10 semantics).
    expect(h.agentInstances).toHaveLength(0);
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: undefined,
      recentWorkdirs: [],
    });
    expect(sent("desktopPanes").at(-1)?.panes[0].sessionId).toBeUndefined();
  });

  it("fires once per launch: repeat desktopReady/webviewReady never spawn a second agent", async () => {
    const { host, store } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });
    expect(h.agentInstances).toHaveLength(1);
    const auto = lastAgent();

    // A webview reload re-fires desktopReady + webviewReady; new panes and
    // settings round-trips remount ChatApp → more webviewReady. None of them
    // may spawn a second automatic agent on the same pane.
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    expect(h.agentInstances).toHaveLength(1);
    expect(lastAgent()).toBe(auto);
  });

  it("defers to a historical session the user selects while the auto spawn is initializing", async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    store.upsertSession({
      sessionId: "sess-1",
      title: "old",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    let releaseInit!: () => void;
    h.initializeGate = new Promise<void>((r) => (releaseInit = r));

    await host.handleWebviewMessage({ command: "desktopReady" });
    const readyPromise = host.handleWebviewMessage({ command: "webviewReady" });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(1); // the auto spawn is mid-init
    });
    const autoAgent = lastAgent();
    expect(autoAgent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );

    // Mid-spawn the user clicks a historical session — its (un-gated) restore
    // lands first and owns the pane.
    h.initializeGate = null;
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)).toMatchObject({
        isRestoring: false,
        session: { id: "sess-1" },
      });
    });

    // The auto spawn completes into an already-rebound pane — it must destroy
    // itself instead of lingering orphaned in the agent pool.
    releaseInit();
    await readyPromise;

    expect(autoAgent.destroy).toHaveBeenCalledTimes(1);
    expect(h.agentInstances.at(-1)).not.toBe(autoAgent);
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: "sess-1" },
    });
  });
});

// ---------------------------------------------------------------------------
// message sending
// ---------------------------------------------------------------------------

describe("sendMessage", () => {
  it("forwards plain text to the agent", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: "sendMessage", text: "hello" });

    expect(lastAgent().sendMessage).toHaveBeenCalledWith(
      "hello",
      undefined,
      false,
    );
  });

  it("maps webview image payloads to { path, mimeType }", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "sendMessage",
      text: "look",
      images: [{ data: "/tmp/a.png", mediaType: "image/png" }],
    });

    expect(lastAgent().sendMessage).toHaveBeenCalledWith(
      "look",
      [{ path: "/tmp/a.png", mimeType: "image/png" }],
      false,
    );
  });

  it("routes bang commands to agent.bang without the prefix", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "sendMessage",
      text: "!ls -la",
    });

    expect(lastAgent().bang).toHaveBeenCalledWith("ls -la");
    expect(lastAgent().sendMessage).not.toHaveBeenCalled();
  });

  it("replies with a system message when the agent is not initialized", async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: "sendMessage", text: "hi" });

    const hints = sent("appendMessage").filter((m) =>
      JSON.stringify(m).includes("请先选择工作目录"),
    );
    expect(hints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// agent → webview notifications
// ---------------------------------------------------------------------------

describe("agent notifications", () => {
  it("onLoadingChange toggles start/endStreaming", async () => {
    const { sent } = await readyHost();
    const { callbacks } = lastAgent();
    callbacks.onLoadingChange(true);
    callbacks.onLoadingChange(false);

    expect(sent("startStreaming")).toHaveLength(1);
    expect(sent("endStreaming")).toHaveLength(1);
  });

  it("restoreSession delivers the restored list via setInitialState, never via updateMessages (FR-031)", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "restoreSession",
      sessionId: "sess-x",
    });

    // Restore is optimistic: the pane switches immediately (isRestoring) while
    // the agent spawns + replays in the background — the restored list lands on
    // the final setInitialState, not the first one.
    await vi.waitFor(() => {
      const states = sent("setInitialState");
      expect(states.at(-1)?.messages).toEqual([
        {
          id: "restored-u1",
          role: "user",
          blocks: [{ type: "text", content: "历史会话的第一条消息" }],
        },
      ]);
    });
    expect(sent("updateMessages")).toHaveLength(0);
  });

  it("restoreSession 的首屏列表来自一次 getMessages 现取（不是缓存残留）", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "restoreSession",
      sessionId: "sess-x",
    });

    // The daemon emits no transcript on restore and this host keeps none —
    // the list has to be pulled, or a re-attached session (remote or local)
    // opens with an empty message list.
    await vi.waitFor(() => {
      expect(lastAgent().getMessages).toHaveBeenCalled();
    });
  });

  it("onMessagesChange never pushes the full list — each message arrives once via appendMessage", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // Contract: the desktop does not subscribe to messagesChange at all —
    // incremental notifications are forwarded, never turned into a snapshot.
    expect(agent.callbacks.onMessagesChange).toBeUndefined();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    agent.callbacks.onUserMessageAdded(userMsg);

    expect(sent("updateMessages")).toHaveLength(0);
    expect(sent("appendMessage")).toEqual([
      expect.objectContaining({ message: userMsg }),
    ]);
  });

  it("discarding a half assistant message only tells the pane — the host has no list to fix", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    const partialAssistant = {
      id: "a-partial",
      role: "assistant",
      blocks: [{ type: "text", content: "我先看看", stage: "streaming" }],
    };
    agent.callbacks.onAssistantMessageAdded(partialAssistant);

    agent.callbacks.onAssistantMessageDiscarded("a-partial");

    // No mirror to keep consistent: the next pull simply will not contain the
    // half message (spec「宿主不保留消息内容，用的时候现取」场景 2).
    expect("messages" in agent).toBe(false);
    expect(sent("discardMessage")).toEqual([
      expect.objectContaining({ messageId: "a-partial" }),
    ]);
  });

  it("error blocks are forwarded as text — the renderer places the block with its own rule", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();

    agent.callbacks.onErrorBlockAdded("插件执行失败");

    // APPEND_ERROR_BLOCK (webview reducer) puts the block on the last message
    // when it is an assistant one, otherwise on a new assistant message below
    // the latest user message — the same rule the host used to apply to its own
    // copy, and what VS Code / JetBrains have always relied on. The host sends
    // the text only, and holds nothing.
    expect(sent("updateErrorBlock")).toEqual([
      expect.objectContaining({ error: "插件执行失败" }),
    ]);
    expect(sent("appendMessage")).toHaveLength(0);
    expect("messages" in agent).toBe(false);
  });

  it("流式增量原样转发，宿主不再合并（自己那份副本已经不存在）", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    const assistantMsg = { id: "a1", role: "assistant", blocks: [] };
    agent.callbacks.onAssistantMessageAdded(assistantMsg);
    agent.callbacks.onAssistantContentUpdated({
      messageId: "a1",
      chunk: "Hello",
      stage: "streaming",
    });
    agent.callbacks.onAssistantContentUpdated({
      messageId: "a1",
      chunk: " world",
      stage: "end",
    });
    agent.callbacks.onAssistantReasoningUpdated({
      messageId: "a1",
      chunk: "思考中",
      stage: "end",
    });
    agent.callbacks.onToolBlockUpdated({
      messageId: "a1",
      id: "tool-1",
      name: "read_file",
      stage: "end",
      result: "file content",
      success: true,
    });

    // 「宿主原样转发、自己不留不合并」(spec 场景 2)：每条增量都到了渲染进程，
    // 内容由它自己的 reducer 累加；宿主这边没有任何数组被写过。
    expect("messages" in agent).toBe(false);
    expect(sent("updateStreamingContent").at(-1)).toMatchObject({
      paneId: "pane-1",
      messageId: "a1",
      chunk: " world",
      stage: "end",
    });
    expect(sent("updateStreamingReasoning").at(-1)).toMatchObject({
      paneId: "pane-1",
      messageId: "a1",
      chunk: "思考中",
      stage: "end",
    });
    expect(sent("updateToolBlock").at(-1)?.params).toMatchObject({
      messageId: "a1",
      id: "tool-1",
      result: "file content",
    });
  });

  it("first user message registers the new session in the sidebar tree with a truncated title (FR-024)", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // The CLI assigns sessionId during initialize() without emitting
    // sessionIdChange, so nothing is in the index yet.
    expect(sent("desktopSessionTree")).toHaveLength(0);

    const longText = "x".repeat(40);
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: longText }],
    };
    // 标题优先读 SDK 的计数器：列表只剩一页，那条首条消息已经不在里面了。
    agent.threadSummary = { messageCount: 1, firstUserText: longText };
    agent.callbacks.onUserMessageAdded(userMsg);

    const tree = sent("desktopSessionTree").at(-1);
    const sessions = (
      (tree?.groups as Array<{
        sessions: Array<{ sessionId: string; title: string }>;
      }>) ?? []
    ).flatMap((g) => g.sessions);
    expect(sessions).toContainEqual(
      expect.objectContaining({
        sessionId: "sess-1",
        title: "x".repeat(30) + "...",
      }),
    );

    // A later message does NOT rewrite the established title.
    const second = {
      id: "u2",
      role: "user",
      blocks: [{ type: "text", content: "另一条消息" }],
    };
    agent.callbacks.onUserMessageAdded(second);
    const sessionsAfter = (
      (sent("desktopSessionTree").at(-1)?.groups as Array<{
        sessions: Array<{ sessionId: string; title: string }>;
      }>) ?? []
    ).flatMap((g) => g.sessions);
    expect(sessionsAfter.find((s) => s.sessionId === "sess-1")?.title).toBe(
      "x".repeat(30) + "...",
    );
  });

  it("a fresh session titles itself from the message event when the thread summary is unknown", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // 新会话没走过 restore、也没压缩过 ⇒ 还没有任何一次 pull 带回 firstUserText
    // （真机上它只随 `getMessages` 的回包到达）。宿主手里没有数组可翻，标题的兜底
    // 来源换成**触发登记的那条消息事件**（userMessageAdded 自带的 message）。
    expect(agent.threadSummary?.firstUserText).toBeUndefined();
    const meta = {
      id: "m1",
      role: "user",
      isMeta: true,
      blocks: [{ type: "text", content: "<system-reminder>注入的规则" }],
    };
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    // 注入的 isMeta 行先到：它不能当标题（登记时标题为空）。
    agent.callbacks.onUserMessageAdded(meta);
    agent.callbacks.onUserMessageAdded(userMsg);

    const sessions = (
      (sent("desktopSessionTree").at(-1)?.groups as Array<{
        sessions: Array<{ sessionId: string; title: string }>;
      }>) ?? []
    ).flatMap((g) => g.sessions);
    // 注入的 isMeta 行不能当标题。
    expect(sessions.find((s) => s.sessionId === "sess-1")?.title).toBe("你好");
  });

  it("setInitialState backfills session.firstMessage from the index after compaction truncated the messages", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();

    // First user message establishes the index title (same as the sidebar).
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "帮我重构登录模块" }],
    };
    agent.threadSummary = {
      messageCount: 1,
      firstUserText: "帮我重构登录模块",
    };
    agent.callbacks.onUserMessageAdded(userMsg);

    // Compaction folds the display stream down to the compact boundary, so a
    // re-pushed pane state can no longer derive the title from the list.
    const compactMsg = {
      id: "c1",
      role: "assistant",
      blocks: [{ type: "compact", content: "对话摘要" }],
    };
    agent.daemonMessages = [compactMsg];
    agent.callbacks.onCompactBlockAdded("对话摘要", compactMsg);

    await host.handleWebviewMessage({ command: "webviewReady" });

    expect(sent("setInitialState").at(-1)?.session).toMatchObject({
      id: "sess-1",
      firstMessage: "帮我重构登录模块",
    });
  });

  it("compaction appends the summary block incrementally instead of re-pushing the list", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    const updateMessagesBefore = sent("updateMessages").length;
    // readyHost 已经为首屏拉过一次；清掉，下面断言的是这次回调自己的行为。
    agent.getMessages.mockClear();

    const compactMsg = {
      id: "c1",
      role: "assistant",
      blocks: [{ type: "compact", content: "对话摘要" }],
    };
    agent.callbacks.onCompactBlockAdded("对话摘要", compactMsg);

    // The webview is told about the one new message ...
    expect(sent("appendMessage").at(-1)?.message).toMatchObject({ id: "c1" });
    // ... and the host keeps nothing of it (spec「宿主不保留消息内容」场景 2).
    expect("messages" in agent).toBe(false);
    // No full-list pull/push: compaction is a pure append on the display stream
    // (spec 场景「压缩完成时页面不被整表替换」).
    expect(sent("updateMessages")).toHaveLength(updateMessagesBefore);
    expect(agent.getMessages).not.toHaveBeenCalled();
  });

  it("compaction without a message on the wire falls back to the full pull", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    const updateMessagesBefore = sent("updateMessages").length;

    // An older CLI sends only the summary text.
    agent.callbacks.onCompactBlockAdded("对话摘要");

    await vi.waitFor(() => {
      expect(sent("updateMessages")).toHaveLength(updateMessagesBefore + 1);
    });
    expect(agent.getMessages).toHaveBeenCalled();
  });

  it("a notification message is forwarded to the pane and nothing else", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();

    const notification = {
      id: "n1",
      role: "user",
      isMeta: true,
      blocks: [
        {
          type: "task_notification",
          taskId: "t1",
          taskType: "bash",
          status: "completed",
          summary: "后台任务完成",
        },
      ],
    };
    agent.callbacks.onNotificationMessageAdded({
      taskId: "t1",
      taskType: "bash",
      status: "completed",
      summary: "后台任务完成",
      message: notification,
    });

    // The webview is told about the new message (it is filtered out of the
    // rendered stream, but still moves the "last message" the error block
    // attaches to) and the host keeps no copy (spec 场景 2).
    expect(sent("appendMessage").at(-1)?.message).toMatchObject({ id: "n1" });
    expect("messages" in agent).toBe(false);
  });

  it("一条屏外会话收到过消息事件，就不会在关闭分屏时被当成空脚手架销毁", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    // 真实场景：后台会话在屏外跑了一轮，通知已经转发过、列表却还没被拉过
    // （宿主不留消息内容，所以「有没有内容」只能靠事件标记）。关闭分屏时它必须
    // 留在池里继续跑，而不是被当成新建会话的脚手架销毁。
    agent.callbacks.onUserMessageAdded({
      id: "m1",
      role: "user",
      blocks: [{ type: "text", content: "后台还在跑" }],
    });
    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
    const layout = () =>
      sent("desktopPanes").at(-1)!.panes as Array<{ paneId: string }>;
    expect(layout()).toHaveLength(2);
    agent.destroy.mockClear();

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: layout()[0].paneId,
    });

    expect(layout()).toHaveLength(1);
    expect(agent.destroy).not.toHaveBeenCalled();
  });

  it("restoring a historical session backfills its sidebar title from history (FR-024)", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: "hist-1",
      title: "",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1,
      lastActiveAt: 1,
    });

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "hist-1",
    });

    // The title backfill happens after the background restore completes.
    await vi.waitFor(() => {
      const tree = sent("desktopSessionTree").at(-1);
      const sessions = (
        (tree?.groups as Array<{
          sessions: Array<{ sessionId: string; title: string }>;
        }>) ?? []
      ).flatMap((g) => g.sessions);
      expect(sessions.find((s) => s.sessionId === "hist-1")?.title).toBe(
        "历史会话的第一条消息",
      );
    });
  });

  it("onSessionIdChange posts updateCurrentSession (session id is never persisted)", async () => {
    const { sent } = await readyHost();
    const { callbacks } = lastAgent();

    callbacks.onSessionIdChange("sess-2");

    const updates = sent("updateCurrentSession");
    expect(updates[updates.length - 1]).toMatchObject({
      session: { id: "sess-2" },
    });
  });

  it("onPermissionModeChange posts updatePermissionMode", async () => {
    const { sent } = await readyHost();
    lastAgent().callbacks.onPermissionModeChange("plan");
    expect(sent("updatePermissionMode")[0]).toMatchObject({ mode: "plan" });
  });

  it("onBtwContent posts btwStream to the pane", async () => {
    const { sent } = await readyHost();
    lastAgent().callbacks.onBtwContent({
      question: "weather?",
      content: "thinking chunk",
      type: "thinking",
    });

    const msg = sent("btwStream")[0];
    expect(msg).toMatchObject({
      question: "weather?",
      content: "thinking chunk",
      type: "thinking",
    });
    expect(msg.paneId).toBeDefined();
  });

  it("onBackgroundTasksChange posts tasks and refreshes workflow runs", async () => {
    const { sent } = await readyHost();
    const runsBefore = sent("updateWorkflowRuns").length;
    lastAgent().callbacks.onBackgroundTasksChange([{ task_id: "t1" }]);

    expect(sent("updateBackgroundTasks")[0]).toMatchObject({
      tasks: [{ task_id: "t1" }],
    });
    // A fresh refresh lands after the background-task change (session pushes
    // also refresh in the background, so assert a new one, not a total count).
    await vi.waitFor(() => {
      expect(sent("updateWorkflowRuns").length).toBeGreaterThan(runsBefore);
    });
  });

  it("authUrl global notification opens the browser (FR-008)", async () => {
    await readyHost();
    h.authUrlHandler?.({ url: "https://sso.example.com/login" });
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://sso.example.com/login",
    );
  });
});

// ---------------------------------------------------------------------------
// permission confirmation flow
// ---------------------------------------------------------------------------

describe("permission confirmations", () => {
  async function triggerPermission(
    sent: ReturnType<typeof createHost>["sent"],
    toolName = "Edit",
  ) {
    const { callbacks } = lastAgent();
    callbacks.onPermissionRequest("req-1", {
      toolName,
      toolInput: { file_path: "/x.ts" },
    });
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(1);
    });
    const msg = sent("showConfirmation")[0];
    return msg.confirmationId as string;
  }

  it("maps Edit to the code-modification confirmation type", async () => {
    const { sent } = await readyHost();
    await triggerPermission(sent, "Edit");
    expect(sent("showConfirmation")[0]).toMatchObject({
      toolName: "Edit",
      confirmationType: "代码修改待确认",
    });
  });

  it("ExitPlanMode showConfirmation carries the plan content to the webview", async () => {
    const { sent } = await readyHost();
    lastAgent().callbacks.onPermissionRequest("req-plan", {
      toolName: "ExitPlanMode",
      permissionMode: "plan",
      planContent: "## 重构方案\n- 步骤一",
    });
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(1);
    });
    const msg = sent("showConfirmation")[0];
    expect(msg).toMatchObject({
      toolName: "ExitPlanMode",
      confirmationType: "计划待确认",
      planContent: "## 重构方案\n- 步骤一",
    });
    expect(msg.paneId).toBeDefined();
  });

  it("a setInitialState snapshot carries the pending ExitPlanMode plan (pane rebind replay)", async () => {
    const { host, store, sent } = await readyHost();
    // Give the first agent a registered session entry (like seedSession).
    const agent1 = lastAgent();
    seedConversation(agent1, "sess-1");
    store.upsertSession({
      sessionId: "sess-1",
      title: "任务A",
      host: "local",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    // Open a second pane, then close the first: sess-1's agent drops out of
    // the pane but stays live in the pool — an unbound background session,
    // exactly the state where ExitPlanMode fires with no paneId (no dialog).
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: "pane-1",
    });

    agent1.callbacks.onPermissionRequest("req-plan", {
      toolName: "ExitPlanMode",
      permissionMode: "plan",
      planContent: "## 重构方案\n- 步骤一",
    });
    // Unbound agent → the request sits pending; no dialog can pop.
    expect(sent("showConfirmation")).toHaveLength(0);

    // Sidebar click on the session → activateAgentInPane pushes a fresh
    // setInitialState snapshot. The replay must carry the pending plan, or the
    // webview reopens the dialog over an empty「等待计划生成…」pane.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    const last = sent("setInitialState").at(-1);
    expect(last.paneId).toBe("pane-2");
    expect(last.pendingConfirmations).toContainEqual(
      expect.objectContaining({
        toolName: "ExitPlanMode",
        confirmationType: "计划待确认",
        planContent: "## 重构方案\n- 步骤一",
      }),
    );
  });

  it("approval resolves an allow decision", async () => {
    const { host, sent } = await readyHost();
    const confirmationId = await triggerPermission(sent, "Bash");

    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId,
      approved: true,
    });

    expect(lastAgent().sendPermissionResponse).toHaveBeenCalledWith("req-1", {
      behavior: "allow",
    });
  });

  it("rejection resolves a deny decision and aborts the message", async () => {
    const { host, sent } = await readyHost();
    const confirmationId = await triggerPermission(sent);

    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId,
      approved: false,
    });

    expect(lastAgent().sendPermissionResponse).toHaveBeenCalledWith("req-1", {
      behavior: "deny",
      message: "用户拒绝了操作",
    });
    expect(lastAgent().abortMessage).toHaveBeenCalled();
  });

  it("ignores responses for unknown confirmation ids", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId: "nope",
      approved: true,
    });
    expect(lastAgent().sendPermissionResponse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// background session confirmation toasts
// (desktop-sessions.md「后台会话确认提醒」) + the 已完成 green dot
// ---------------------------------------------------------------------------

describe("background session toasts", () => {
  /** Give the bound agent a registered session entry (title drives toast copy). */
  function seedSession(
    store: ReturnType<typeof createHost>["store"],
    sessionId: string,
    title: string,
  ) {
    const agent = lastAgent();
    seedConversation(agent, sessionId);
    store.upsertSession({
      sessionId,
      title,
      host: "local",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    return agent;
  }

  /** Open a second pane (spawns + focuses its agent) — pane-1's agent goes background. */
  async function openSecondPane(host: ReturnType<typeof createHost>["host"]) {
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
  }

  /**
   * Detach the pane-1 agent from every pane: open pane-2, then close pane-1.
   * The seeded agent keeps running with no pane (spec「后台会话确认提醒」:
   * toasts only fire for sessions shown in no pane at all).
   */
  async function sendToBackground(host: ReturnType<typeof createHost>["host"]) {
    await openSecondPane(host);
    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: "pane-1",
    });
  }

  const confirmationToasts = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("showToast").filter((m) => m.toast.message.includes("需要确认"));

  /** Sidebar「已完成未读」green dot state for a session (spec desktop-sessions.md
   *  「后台会话「已完成未读」绿点」) — the sole 已完成 reminder now that the
   *  completion toast was removed (2026-09-10 拍板). */
  const newCompletedFor = (
    sent: ReturnType<typeof createHost>["sent"],
    sessionId: string,
  ): boolean => {
    const tree = sent("desktopSessionTree").at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; newCompleted?: boolean }>;
          }>;
        }
      | undefined;
    return (
      (tree?.groups ?? [])
        .flatMap((g) => g.sessions)
        .find((s) => s.sessionId === sessionId)?.newCompleted ?? false
    );
  };

  it("toasts a confirmation request from a pane-less background session with a 查看 action", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);

    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });

    const toasts = confirmationToasts(sent);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toast.message).toBe(
      "会话「任务A」需要确认：命令执行待确认",
    );
    expect(toasts[0].toast.actionLabel).toBe("查看");
    // 2026-09-10 拍板：会话确认 toast 显式声明右下角位置（不并入 app 级顶部形态）
    expect(toasts[0].toast.position).toBe("bottomRight");
    expect(toasts[0].toast.action).toEqual({
      type: "focusSession",
      host: "local",
      sessionId: "sess-1",
    });
  });

  it("does not toast a confirmation for a session shown in a non-focused pane", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    // Pane-1 shows the session side by side while pane-2 holds focus — the
    // dialog is already visible in pane-1, so no toast (spec scenario 2).
    await openSecondPane(host);

    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });

    expect(confirmationToasts(sent)).toHaveLength(0);
    expect(sent("showConfirmation")).toHaveLength(1); // the dialog pops instead
  });

  it("does not toast a confirmation for the session the user is watching", async () => {
    const { store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");

    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });

    expect(sent("showToast")).toHaveLength(0);
    expect(sent("showConfirmation")).toHaveLength(1); // the dialog pops instead
  });

  it("announces a waiting session once per cycle, then again once all requests resolve", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);

    // A burst of follow-up requests while the first is pending: one toast.
    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });
    agent1.callbacks.onPermissionRequest("req-2", {
      toolName: "Edit",
      toolInput: { file_path: "/x.ts" },
    });
    expect(confirmationToasts(sent)).toHaveLength(1);

    // 查看 re-opens the pane-less session in the focused pane — the pending
    // dialogs pop there, and resolving them ends the wait cycle.
    await host.handleWebviewMessage({
      command: "toastAction",
      toastId: "t-1",
      action: { type: "focusSession", host: "local", sessionId: "sess-1" },
    });
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(2);
    });
    for (const id of sent("showConfirmation").map(
      (m) => m.confirmationId as string,
    )) {
      await host.handleWebviewMessage({
        command: "confirmationResponse",
        confirmationId: id,
        approved: true,
      });
    }

    // Close the session's pane again, then a fresh request starts a new
    // cycle and announces again.
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
    });
    await vi.waitFor(() => {
      expect(sent("desktopPanes").at(-1)!.focusedPaneId).toBe("pane-3");
    });
    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: "pane-2",
    });

    agent1.callbacks.onPermissionRequest("req-3", {
      toolName: "Bash",
      toolInput: {},
    });
    expect(confirmationToasts(sent)).toHaveLength(2);
  });

  it("flags the pane-less session for the sidebar green dot without toasting 已完成", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);

    agent1.callbacks.onLoadingChange(true);
    agent1.callbacks.onLoadingChange(false);

    // 2026-09-10 拍板：「已完成」不再弹 toast —— 侧边栏「已完成未读」绿点是
    // 唯一提醒通道。
    expect(sent("showToast")).toHaveLength(0);
    expect(newCompletedFor(sent, "sess-1")).toBe(true);
  });

  it("does not flag the green dot from a loading snapshot replayed mid-restore", async () => {
    const { host, sent } = await readyHost();
    // Hold the restore agent mid-initialize: it exists but is not yet bound to
    // any pane (activateAgentInPane runs after restore + getMessages). This is
    // exactly when agentBridge.restoreSession's re-attach branch replays the
    // settled loading state — for an idle historical session, loading:false
    // without any preceding loading:true.
    let release: () => void;
    h.initializeGate = new Promise<void>((resolve) => (release = resolve));
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-x",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances.length).toBe(before + 1);
    });
    const restoring = lastAgent();
    restoring.sessionId = "sess-x";
    restoring.callbacks.onLoadingChange(false); // replayed snapshot, not a finish

    expect(sent("showToast")).toHaveLength(0);
    expect(newCompletedFor(sent, "sess-x")).toBe(false);

    // Once the restore finishes and binds the pane, still no toast/dot.
    release!();
    await vi.waitFor(() => {
      expect(
        sent("desktopPanes")
          .at(-1)
          ?.panes?.some((p) => p.sessionId === "sess-x"),
      ).toBe(true);
    });
    expect(sent("showToast")).toHaveLength(0);
    expect(newCompletedFor(sent, "sess-x")).toBe(false);
  });

  it("never flags the green dot for a turn the user aborted, and a new turn resets that", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);

    await host.handleWebviewMessage({
      command: "abortMessage",
      paneId: "pane-1",
    });
    agent1.callbacks.onLoadingChange(false);
    expect(sent("showToast")).toHaveLength(0);
    expect(newCompletedFor(sent, "sess-1")).toBe(false);

    // A new turn clears the abort marker — its finish flags the dot normally.
    agent1.callbacks.onLoadingChange(true);
    agent1.callbacks.onLoadingChange(false);
    expect(sent("showToast")).toHaveLength(0);
    expect(newCompletedFor(sent, "sess-1")).toBe(true);
  });

  it("delivers a pane-less session's pending confirmation via setInitialState when re-bound from the sidebar", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);
    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });
    // A pane-less session keeps the request pending — no dialog yet, just the
    // sidebar 等待确认 dot.
    expect(sent("showConfirmation")).toHaveLength(0);

    // Sidebar click re-binds the session to the focused pane: the pending
    // confirmation rides on setInitialState (the navigation guarantee that
    // replaces the removed toast 查看 entry point).
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    const state = sent("setInitialState").at(-1) as {
      pendingConfirmations?: Array<{ confirmationId: string }>;
    };
    expect(state.pendingConfirmations).toHaveLength(1);
  });

  it("查看 on the toast re-opens the pane-less session and re-pops its dialog", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = seedSession(store, "sess-1", "任务A");
    await sendToBackground(host);
    agent1.callbacks.onPermissionRequest("req-1", {
      toolName: "Bash",
      toolInput: {},
    });
    // A pane-less session keeps the request pending — no dialog yet, just the toast.
    expect(sent("showConfirmation")).toHaveLength(0);
    expect(confirmationToasts(sent)).toHaveLength(1);

    await host.handleWebviewMessage({
      command: "toastAction",
      toastId: "t-1",
      action: { type: "focusSession", host: "local", sessionId: "sess-1" },
    });

    // The pane-less session is activated into the focused pane.
    await vi.waitFor(() => {
      const layout = sent("desktopPanes").at(-1)!;
      expect(layout.panes.some((p) => p.sessionId === "sess-1")).toBe(true);
    });
    // The pending dialog is re-posted for the freshly focused pane. It lands
    // after the pane's state push (activation re-pulls a page first), so it
    // follows the toast handler rather than this test's await.
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(1);
    });
    expect(sent("showConfirmation").at(-1)?.paneId).toBe("pane-2");
  });
});

// ---------------------------------------------------------------------------
// configuration / status / external links
// ---------------------------------------------------------------------------

describe("configuration and status", () => {
  it("getConfiguration replies with user preferences only (no host-storage keys)", async () => {
    const { host, store, sent } = createHost();
    store.setConfiguration({ serverUrl: "https://console.example.com" });

    await host.handleWebviewMessage({ command: "getConfiguration" });

    const payload = sent("configurationResponse").at(-1)!.configurationData;
    // 本地存储的键不进配置回包：服务地址随 authStatusResponse 下发；凭证管道已
    // 移除（spec sso-auth「IDE 宿主不再有直连免登录旁路」）。
    expect(payload).not.toHaveProperty("serverUrl");
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("fastModel");
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("headers");
    expect(payload).not.toHaveProperty("baseURL");
  });

  it("updateConfiguration writes only user preferences, never host-storage keys", async () => {
    const { host, store, sent } = await readyHost();
    store.setConfiguration({ serverUrl: "https://console.example.com" });

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { language: "English" },
    });

    // 用户偏好落 settings.json，宿主的本地存储（服务地址）原样不动。
    expect(store.getConfiguration()).toEqual({
      serverUrl: "https://console.example.com",
    });
    expect(sent("configurationUpdated")).toHaveLength(1);
    const payload = sent("configurationResponse").at(-1)!.configurationData;
    expect(payload).not.toHaveProperty("serverUrl");
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("fastModel");
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("headers");
    expect(payload).not.toHaveProperty("baseURL");
  });

  /**
   * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）：
   *
   * `autoMemoryEnabled` / `autoMemoryFrequency` 都是可选参数，任何一环漏传都不会
   * 编译报错，只在 SDK 侧静默回落到 settings.json / 默认值——开关看起来保存成功
   * 却不起作用。**PR-2 后这一环不再是 `updateConfig` 覆盖层**（那会永久遮蔽
   * settings.json），而是 `updateUserSettings` 落会话进程的用户级 settings.json：
   * 关闭状态（false）与轮次必须真的出现在发给 CLI 的参数里（不能被 `||` / 缺字段
   * 吞掉），且不得转而走 `updateConfig`。完整语义见下面
   * 「user preference save path and rebuild timing」describe。
   */
  it("updateConfiguration forwards the auto-memory toggle to the CLI, not as an updateConfig overlay", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { autoMemoryEnabled: false, autoMemoryFrequency: 5 },
    });

    // 关闭状态必须原样落到会话进程的 settings.json（fake 的 `||` 会静默变 true）。
    expect(
      h.clientRequests
        .filter((r) => r.method === "updateUserSettings")
        .map((r) => r.params),
    ).toEqual([{ autoMemoryEnabled: false, autoMemoryFrequency: 5 }]);
    expect(lastAgent().updateConfig).not.toHaveBeenCalled();
  });

  it("updateConfiguration forwards the server URL preference to the CLI (lands in env.WAVE_SERVER_URL)", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: {
        serverUrl: "https://codechat.codewave-test.163yun.com",
      },
    });

    // 设置页载荷里的服务端地址是**用户偏好**，落会话进程用户级 settings.json 的
    // `env.WAVE_SERVER_URL`；宿主本地存储里那个 serverUrl（只用于拼更新 feed）不经
    // 本载荷，别混淆两条路径。
    expect(
      h.clientRequests
        .filter((r) => r.method === "updateUserSettings")
        .map((r) => r.params),
    ).toEqual([{ serverUrl: "https://codechat.codewave-test.163yun.com" }]);
    expect(lastAgent().updateConfig).not.toHaveBeenCalled();
  });

  it("updateConfiguration forwards the completion model / switch to the CLI (top-level keys)", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: {
        completionModel: "qwen2.5-coder",
        completionEnabled: false,
      },
    });

    // 与对话模型不同：补全模型/开关是配置文件里的**用户偏好键**（顶层
    // completionModel / completionEnabled，spec ui/code-completion.md 故事 4–5），
    // 故走 updateUserSettings；`false` 不得被吞掉。
    expect(
      h.clientRequests
        .filter((r) => r.method === "updateUserSettings")
        .map((r) => r.params),
    ).toEqual([{ completionModel: "qwen2.5-coder", completionEnabled: false }]);
    expect(lastAgent().updateConfig).not.toHaveBeenCalled();
  });

  it("updateConfiguration drops a blank completion model (clearing the dropdown writes nothing)", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { completionModel: "  " },
    });

    // 空载荷 = 不改该键：写一个空模型名会让「显示未设置 ≡ 生效值」分叉。
    // （本宿主对空 patch 仍发一次 `updateUserSettings`——CLI 侧把空 patch 当
    // 「无差异保存」只回读、不落盘，故这里断言的是**载荷里没有该键**。）
    expect(
      h.clientRequests
        .filter((r) => r.method === "updateUserSettings")
        .map((r) => r.params),
    ).toEqual([{}]);
  });

  it("getStatus replies with app version, session id and workdir", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: "getStatus" });

    expect(sent("statusResponse")[0]).toMatchObject({
      version: "0.19.7",
      sessionId: "sess-1",
      workdir: "/work/a",
    });
  });

  it("getStatus keeps the session root workdir after bash cd drifts the working directory", async () => {
    const { host, sent } = await readyHost();
    // The agent ran `cd src` — the CLI broadcast workdirChange, which drifts
    // the agent's currentWorkdir. The /status popup must still report the
    // session root, not the subdir the agent cd'd into.
    const agent = lastAgent();
    agent.currentWorkdir = "/work/a/src";
    agent.callbacks.onWorkdirChange("/work/a/src");

    await host.handleWebviewMessage({ command: "getStatus" });

    expect(sent("statusResponse")[0]).toMatchObject({ workdir: "/work/a" });
  });

  it("openExternal allows https URLs (FR-008)", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "openExternal",
      url: "https://example.com",
    });
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
    // The browser coming forward is its own feedback — no toast on success.
    expect(sent("showToast")).toHaveLength(0);
  });

  it("openExternal reports a failure the user can see", async () => {
    const { host, sent } = await readyHost();
    vi.mocked(shell.openExternal).mockRejectedValueOnce(
      new Error("no browser"),
    );
    await host.handleWebviewMessage({
      command: "openExternal",
      url: "https://example.com",
    });
    expect(sent("showToast").at(-1)?.toast.message).toBe(
      "打开外部链接失败：no browser",
    );
  });

  it("openExternal refuses unexpected schemes", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "openExternal",
      url: "file:///etc/passwd",
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(sent("showToast").at(-1)?.toast.message).toBe(
      "打开外部链接失败：链接无效",
    );
  });
});

// ---------------------------------------------------------------------------
// 用户偏好保存路径与重建时机
// (agent-config.md「设置实时重载」/「用户偏好的保存路径与重建时机」、
//  desktop-account-and-settings.md「设置页反馈语义」)
// ---------------------------------------------------------------------------

describe("user preference save path and rebuild timing", () => {
  /** 覆盖两个会话无关的用户设置 RPC（默认 handleClientRequest 对未知名返回 {}）。 */
  function stubUserSettingsRpc(handlers: {
    get?: Record<string, unknown>;
    update?: Record<string, unknown>;
  }) {
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) => {
      if (m === "getUserSettings") return handlers.get ?? {};
      if (m === "updateUserSettings") return handlers.update ?? params ?? {};
      return orig(m, params);
    };
    return () => {
      h.handleClientRequest = orig;
    };
  }

  const rpcParams = (method: string) =>
    h.clientRequests.filter((r) => r.method === method).map((r) => r.params);

  /** 池内第 i 个 agent 的可变视图（isStreaming / queuedMessages 是模拟实例字段）。 */
  type MutableAgent = {
    isStreaming: boolean;
    queuedMessages: Array<{ id: string; text: string }>;
    updateConfig: ReturnType<typeof vi.fn>;
    abortMessage: ReturnType<typeof vi.fn>;
  };
  const agentAt = (index: number) =>
    h.agentInstances[index] as unknown as MutableAgent;

  /** 打开第二个 pane（新 agent 聚焦），返回新 pane 的 agent。 */
  async function openSecondPane(host: ReturnType<typeof createHost>["host"]) {
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => expect(h.agentInstances).toHaveLength(before + 1));
    return agentAt(before);
  }

  it("saving user preferences writes settings.json in the session process and never rebuilds", async () => {
    const { host, store, sent } = await readyHost();
    const agent = agentAt(0);
    // 会话正在流式输出且有待发送消息：保存用户偏好不得打断它。
    agent.isStreaming = true;
    agent.queuedMessages = [{ id: "q1", text: "排队消息" }];
    const readBack = {
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    };
    const restore = stubUserSettingsRpc({ update: readBack, get: readBack });
    try {
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: { ...readBack },
      });
    } finally {
      restore();
    }

    // 用户偏好整体经 updateUserSettings 写入会话所在进程（远端即远端机器上的
    // ~/.wave/settings.json），进程内转换 K↔env.WAVE_MAX_INPUT_TOKENS。
    expect(rpcParams("updateUserSettings")).toEqual([readBack]);
    // 不重建任何会话：不下发覆盖层、不中止排队消息、不动流式状态。
    expect(agent.updateConfig).not.toHaveBeenCalled();
    expect(agent.abortMessage).not.toHaveBeenCalled();
    expect(agent.isStreaming).toBe(true);
    // 用户偏好不落桌面本地配置（落点唯一 = settings.json）；设置页也不再送
    // 本地存储键（服务地址），故本地存储保持为空。
    expect(store.getConfiguration()).toEqual({});
    // 回执立即给出：toast + configurationResponse 带会话进程读回的值。
    expect(shownToasts().filter((t) => t.message === "保存成功")).toHaveLength(
      1,
    );
    expect(
      sent("configurationResponse").at(-1)!.configurationData,
    ).toMatchObject(readBack);
    expect(sent("configurationError")).toHaveLength(0);
  });

  it("只带改动过的键的载荷：未提供的键不进 RPC patch（未设置态不落盘）", async () => {
    const { host, sent } = await readyHost();
    const agent = agentAt(0);
    const restore = stubUserSettingsRpc({ update: { language: "en-US" } });
    try {
      // 设置页的 diff 载荷：用户只改了语言（其余键仍处于未设置态）。
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: { language: "en-US" },
      });
    } finally {
      restore();
    }

    // 宿主不得给缺失键补默认值，否则「省略」会被翻译成一次写入——正是
    // 「进设置页随手保存一次，把系统环境里的 WAVE_MAX_INPUT_TOKENS 钉成
    // 200000」的成因（spec agent-config 边界说明「省略键 = 不改该键」）。
    // 断言键集而非仅取值：带 `undefined` 的键在 JSON 序列化时会被丢掉，只比取值
    // 的话「host 里又写回 `configData.contextLength ?? 200`」这类回归看不出来。
    const patch = rpcParams("updateUserSettings")[0] as object;
    expect(Object.keys(patch)).toEqual(["language"]);
    expect(patch).toEqual({ language: "en-US" });
    expect(agent.updateConfig).not.toHaveBeenCalled();
    expect(
      sent("configurationResponse").at(-1)!.configurationData,
    ).toMatchObject({ language: "en-US" });
  });

  it("空载荷（一个字都没改）→ RPC patch 为空键集，只回读不落盘", async () => {
    const { host, sent } = await readyHost();
    const restore = stubUserSettingsRpc({ update: {}, get: {} });
    try {
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: {},
      });
    } finally {
      restore();
    }

    // patch 里一个键都没有（CLI 侧「patch 为空只回读、不落盘」），回执照发。
    expect(rpcParams("updateUserSettings")).toEqual([{}]);
    expect(Object.keys(rpcParams("updateUserSettings")[0] as object)).toEqual(
      [],
    );
    expect(shownToasts().filter((t) => t.message === "保存成功")).toHaveLength(
      1,
    );
    // 回执照发（末尾一条；首次是启动时的窗口级推送）
    expect(
      sent("configurationResponse").at(-1)!.configurationData,
    ).toBeDefined();
    expect(sent("configurationError")).toHaveLength(0);
  });

  it("a no-diff save is still just a receipt: no rebuild, no queue drain", async () => {
    const { host } = await readyHost();
    const agent = agentAt(0);
    agent.queuedMessages = [{ id: "q1", text: "排队消息" }];
    const data = {
      language: "zh-CN",
      contextLength: 128,
      autoMemoryEnabled: true,
      autoMemoryFrequency: 10,
    };
    const restore = stubUserSettingsRpc({ update: data, get: data });
    try {
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: data,
      });
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: data,
      });
    } finally {
      restore();
    }

    expect(rpcParams("updateUserSettings")).toHaveLength(2);
    expect(agent.updateConfig).not.toHaveBeenCalled();
    expect(agent.abortMessage).not.toHaveBeenCalled();
    expect(shownToasts().filter((t) => t.message === "保存成功")).toHaveLength(
      2,
    );
  });

  it("settings page values come from the session process, not host-private storage", async () => {
    const { host, store, sent } = await readyHost();
    const prefs = {
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    };
    // 本地存储里放一份「不该出现在设置页」的服务地址（真实来源是 auth 域）。
    store.setConfiguration({ serverUrl: "https://console.example.com" });
    const restore = stubUserSettingsRpc({ get: prefs });
    try {
      await host.handleWebviewMessage({ command: "getConfiguration" });
    } finally {
      restore();
    }

    expect(h.clientRequests.some((r) => r.method === "getUserSettings")).toBe(
      true,
    );
    // 回包 = 会话进程读到的用户偏好，**不含**宿主本地存储键。
    expect(sent("configurationResponse").at(-1)!.configurationData).toEqual(
      prefs,
    );
    // 宿主本地存储里没有第二份用户偏好副本。
    expect(store.getConfiguration()).toEqual({
      serverUrl: "https://console.example.com",
    });
  });

  it("plugin change never rebuilds: busy sessions keep running, one pending toast (no prompt)", async () => {
    const { host, sent } = await readyHost();
    const pane1 = agentAt(0);
    pane1.isStreaming = true;
    const pane2 = await openSecondPane(host);

    await host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "user",
    });

    // 变更落盘只产生一次「待应用」信号 —— 一次强引导弹窗（spec plugin
    // 「插件变更提示」），不是一句会被忽略的 toast。
    expect(pendingPluginPrompts()).toBe(1);
    // 不重建任何会话：正在生成的回合不被打断、排队消息不清空。
    expect(pane1.updateConfig).not.toHaveBeenCalled();
    expect(pane2.updateConfig).not.toHaveBeenCalled();
    expect(pane1.isStreaming).toBe(true);
    // 重建确认框已整体废弃（spec「重建确认框已废止」）。
    expect(sent("desktopRebuildPrompt")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// update checks (FR-010)
// ---------------------------------------------------------------------------

describe("checkForUpdates without a serverUrl (logged out)", () => {
  it("performs no update check and prompts login on a manual check", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: "checkForUpdates" });

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    const toasts = shownToasts().filter((n) =>
      n.message.includes("登录后可检查更新"),
    );
    expect(toasts).toHaveLength(1);
  });

  it("stays silent on the automatic startup check when logged out", async () => {
    // 未登录（无 serverUrl）→ 不执行任何更新检查（2026-09-09 拍板），自动检查
    // 静默：既无 toast 也不触碰 electron-updater。
    await readyHost();
    expect(shownToasts()).toHaveLength(0);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("checkForUpdates with a configured serverUrl", () => {
  const SERVER = "https://codechat.example.com";

  // Like readyHost() but the serverUrl is in place BEFORE webviewReady, so the
  // one-shot automatic check takes the electron-updater path too.
  async function readyHostWithServerUrl() {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    ctx.store.setConfiguration({ serverUrl: SERVER });
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });
    return ctx;
  }

  it("routes the check through electron-updater against the codechat feed", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: `${SERVER}/api/downloads/desktop/${
        process.platform === "win32" ? "win" : "mac"
      }/`,
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    // The electron-updater path is authoritative when logged in — no GitHub fallback.
  });

  it("announces an update via desktopAccountInfo, not a toast (S0 → S1 更新按钮)", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0", files: [], path: "wave-0.20.0.dmg" });
    }

    // 更新按钮状态机输入：idle（S1）。toast 更新链路已删除。
    const push = ctx.sent("desktopAccountInfo").at(-1);
    expect(push.update).toEqual({
      available: true,
      version: "0.20.0",
      status: "idle",
    });
    expect(shownToasts().some((t) => t.message.includes("发现新版本"))).toBe(
      false,
    );
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("desktopUpdateDownload starts the download and pushes downloading (S2 → S3)", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "idle",
    });

    await ctx.host.handleWebviewMessage({ command: "desktopUpdateDownload" });

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "downloading",
    });
    // 重复 desktopUpdateDownload（按钮已 disabled，防御性兜底）不再触发第二次下载。
    await ctx.host.handleWebviewMessage({ command: "desktopUpdateDownload" });
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("update-downloaded pushes ready; a re-check must not downgrade it (S4)", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }
    await ctx.host.handleWebviewMessage({ command: "desktopUpdateDownload" });
    for (const cb of auListeners["update-downloaded"] ?? []) {
      cb({ version: "0.20.0", files: [], path: "wave-0.20.0.dmg" });
    }
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "ready",
    });

    // 下载中/就绪后再查一次更新：ready 不被降级回 idle。
    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "ready",
    });
  });

  it("desktopUpdateRestart resets the state and quits to install (S4/S5 → S6)", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }

    await ctx.host.handleWebviewMessage({ command: "desktopUpdateRestart" });

    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toBeNull();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    // quitAndInstall 直连宿主，不再经 toast action / 原生对话框。
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("a download error resets to idle so the user can retry (场景 8)", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }
    await ctx.host.handleWebviewMessage({ command: "desktopUpdateDownload" });
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "downloading",
    });

    for (const cb of auListeners["error"] ?? []) {
      cb(new Error("download failed"));
    }

    // 回退 idle（版本保留）→ 卡片按钮恢复「更新」可重试；不再弹手动下载页 toast。
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      available: true,
      version: "0.20.0",
      status: "idle",
    });
    expect(
      shownToasts().filter((n) => n.message.includes("0.20.0")),
    ).toHaveLength(0);
  });

  it("a ready-state error is ignored — restart stays the user's call", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }
    for (const cb of auListeners["update-downloaded"] ?? []) {
      cb({ version: "0.20.0" });
    }
    for (const cb of auListeners["error"] ?? []) {
      cb(new Error("Code signature did not pass validation"));
    }

    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toMatchObject({
      status: "ready",
    });
    expect(shownToasts().some((t) => t.message.includes("发现新版本"))).toBe(
      false,
    );
  });

  it("runs an automatic check once after the first webviewReady (logged in)", async () => {
    await readyHostWithServerUrl();
    await vi.waitFor(() => {
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces a manual check failure via a toast when nothing was announced", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({ command: "checkForUpdates" });

    const toasts = shownToasts().filter((n) =>
      n.message.includes("检查更新失败"),
    );
    expect(toasts).toHaveLength(1);
    expect(ctx.sent("desktopAccountInfo").at(-1)?.update).toBeNull();
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null);
  });

  it('says "already latest" via a toast when the feed has no update', async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.7", files: [], path: "wave-0.19.7.dmg" },
      isUpdateAvailable: false,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });

    // The one-shot automatic check stays silent on no-update; only the manual
    // check announces it.
    const toasts = shownToasts().filter((n) => n.message.includes("已是最新"));
    expect(toasts).toHaveLength(1);
  });

  it("pane-scoped setInitialState omits the window-level fields", async () => {
    // 回归锁：分屏下渲染设置页的是 root 实例，而 root 不消费带 paneId 的快照
    // （forThisPane）——theme/updateChannel/configurationData 一旦进了 pane 快照
    // 就永远送不到设置页（「接收 Beta 版更新」重启后回落的根因）。它们只走
    // pushAppLevelState 的未打标签消息。
    const { sent } = await readyHostWithServerUrl();
    const snapshot = sent("setInitialState")[0];
    expect(snapshot).not.toHaveProperty("updateChannel");
    expect(snapshot).not.toHaveProperty("theme");
    expect(snapshot).not.toHaveProperty("configurationData");
  });

  it("broadcasts the persisted preferences at startup (重启后保持)", async () => {
    // 窗口级数据走未打标签的消息：启动时与「用户切换」同一条通道下发一次，设置页
    // 才能显示已落盘的真实值（spec desktop-shell「接收 Beta 版更新」场景 3：
    // 持久化并重启后保持）。
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    ctx.store.setConfiguration({ serverUrl: SERVER });
    h.authServerUrl = SERVER;
    ctx.store.setUpdateChannel("beta");
    ctx.store.setThemeSource("dark");
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });

    const channels = ctx.sent("desktopUpdateChannel");
    expect(channels[channels.length - 1]).toMatchObject({ channel: "beta" });
    const themes = ctx.sent("desktopThemeSource");
    expect(themes[themes.length - 1]).toMatchObject({ source: "dark" });
    // 未打标签（窗口级）——root 实例才收得到
    expect(themes[themes.length - 1]).not.toHaveProperty("paneId");
    expect(channels[channels.length - 1]).not.toHaveProperty("paneId");
    // 服务地址随**认证响应**窗口级下发（不是配置回包）：账户卡片的「控制台 /
    // 帮助文档」在设置页打开前就可用。
    const auths = ctx.sent("authStatusResponse");
    expect(auths[auths.length - 1]).toMatchObject({ serverUrl: SERVER });
    expect(auths[auths.length - 1]).not.toHaveProperty("paneId");
    // 全局配置同样窗口级下发，但只承载用户偏好（模型 / 服务地址都不在里面）。
    const config = ctx.sent("configurationResponse");
    expect(config[config.length - 1]).not.toHaveProperty("paneId");
    expect(config[config.length - 1].configurationData).not.toHaveProperty(
      "serverUrl",
    );
  });

  it("setUpdateChannel persists, broadcasts and re-checks against the beta feed", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const ctx = await readyHostWithServerUrl();
    const platformDir = process.platform === "win32" ? "win" : "mac";
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1); // 启动自动检查（stable）
    expect(autoUpdater.setFeedURL).toHaveBeenLastCalledWith({
      provider: "generic",
      url: `${SERVER}/api/downloads/desktop/${platformDir}/`,
    });

    await ctx.host.handleWebviewMessage({
      command: "setUpdateChannel",
      channel: "beta",
    });

    expect(ctx.store.getUpdateChannel()).toBe("beta");
    const broadcasts = ctx.sent("desktopUpdateChannel");
    expect(broadcasts[broadcasts.length - 1]).toMatchObject({
      channel: "beta",
    });
    // 切换即时重查（spec 场景 3）→ 命中 desktop-beta feed
    expect(autoUpdater.setFeedURL).toHaveBeenLastCalledWith({
      provider: "generic",
      url: `${SERVER}/api/downloads/desktop-beta/${platformDir}/`,
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("manual stable check reports 正式版发布后将自动更新 when the feed lags the installed version", async () => {
    // app.getVersion() = 0.19.7；stable feed 只到 0.19.0（曾接收测试版、正式未
    // 追平）→ 不降级、不改查 beta feed，提示等待正式发布（spec 场景 5）。
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.0", files: [], path: "wave-0.19.0.dmg" },
      isUpdateAvailable: false,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });

    const toasts = shownToasts().filter((n) =>
      n.message.includes("正式版发布后将自动更新"),
    );
    expect(toasts).toHaveLength(1);
    expect(shownToasts().some((n) => n.message.includes("已是最新"))).toBe(
      false,
    );
  });

  it("beta manual check on no-update says 当前已是最新版本", async () => {
    // beta feed 与已装版本相同（同为 0.19.7）→ 无更新；beta 通道不触发「正式
    // 版发布后将自动更新」等待提示。
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.7", files: [], path: "wave-0.19.7.dmg" },
      isUpdateAvailable: false,
    } as never);
    const ctx = await readyHostWithServerUrl();

    await ctx.host.handleWebviewMessage({
      command: "setUpdateChannel",
      channel: "beta",
    });

    const toasts = shownToasts().filter((n) => n.message.includes("已是最新"));
    expect(toasts).toHaveLength(1);
  });

  it("setUpdateChannel falls back to stable for malformed input", async () => {
    const { host, store } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });

    await host.handleWebviewMessage({
      command: "setUpdateChannel",
      channel: "neon",
    });
    expect(store.getUpdateChannel()).toBe("stable");
  });
});

// ---------------------------------------------------------------------------
// periodic update polling (spec desktop-shell「桌面端自动更新」场景 11)
// ---------------------------------------------------------------------------

describe("periodic update polling", () => {
  const SERVER = "https://codechat.example.com";
  const POLL_MS = 60 * 60 * 1000;
  const pollIntervalField = DesktopHost as unknown as {
    updatePollIntervalMs: number;
  };

  /** Shrink the poll interval for a test; returns a restore fn for the finally. */
  function setPollInterval(ms: number): () => void {
    const original = pollIntervalField.updatePollIntervalMs;
    pollIntervalField.updatePollIntervalMs = ms;
    return () => {
      pollIntervalField.updatePollIntervalMs = original;
    };
  }

  // Like readyHost() but the serverUrl is in place BEFORE webviewReady so both
  // the one-shot startup check and the poll timer take the updater path.
  async function readyHostWithServerUrl() {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    ctx.store.setConfiguration({ serverUrl: SERVER });
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });
    return ctx;
  }

  it("defaults the interval to 1 hour (spec 场景 11 首版取值)", () => {
    expect(pollIntervalField.updatePollIntervalMs).toBe(POLL_MS);
  });

  it("re-checks on each interval and stops after dispose", async () => {
    const restore = setPollInterval(POLL_MS);
    vi.useFakeTimers();
    try {
      const ctx = await readyHostWithServerUrl();
      // 启动那次「只跑一次」检查已经跑过（与轮询相互独立）。
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(POLL_MS);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(POLL_MS);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);

      // dispose 后轮询停止：不得留下悬挂定时器再触发检查。
      await ctx.host.dispose();
      vi.advanceTimersByTime(POLL_MS * 5);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it("does not fire before the interval elapses and never doubles the startup check", async () => {
    const restore = setPollInterval(POLL_MS);
    vi.useFakeTimers();
    try {
      await readyHostWithServerUrl();
      // 启动检查只跑一次（updateCheckTriggered 语义不变），轮询间隔未到不触发。
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(POLL_MS - 1);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it("a repeat webviewReady does not stack a second poll timer", async () => {
    const restore = setPollInterval(POLL_MS);
    vi.useFakeTimers();
    try {
      const ctx = await readyHostWithServerUrl();
      await ctx.host.handleWebviewMessage({ command: "webviewReady" });
      // 启动检查仍只一次；重复 ready 不得叠加出第二个轮询定时器。
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(POLL_MS);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it("polling stays silent on a failed check (like the startup check)", async () => {
    const restore = setPollInterval(POLL_MS);
    vi.useFakeTimers();
    try {
      await readyHostWithServerUrl();
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(
        new Error("ECONNREFUSED"),
      );

      // 异步推进并 flush：轮询触发的检查链路完整跑完。
      await vi.advanceTimersByTimeAsync(POLL_MS);

      // 非手动检查失败不 toast（场景 5：自动检查静默）。
      expect(
        shownToasts().filter((n) => n.message.includes("检查更新失败")),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });
});

describe("account card (desktopAccountInfo)", () => {
  /**
   * 生效套餐（计费结论形态甲，codechat `GET /api/v1/account` → `billing`）：本月不
   * 限额、本周 1 分，2027-03-01 到期 —— 只用于断言宿主原样透传，不做卡片侧解读。
   */
  const planBilling = {
    mode: "plan",
    plan: {
      monthUsed: 0,
      monthLimit: null,
      weekUsed: 1,
      weekLimit: 100,
      expireDate: "2027-03-01",
    },
  };

  /** getAuthStatus/getAccountInfo/login return rich payloads (email + usage). */
  function stubAccountRpc(
    user: { id: string; email: string },
    account: { billing: unknown; apiQuota: unknown },
    authenticated: boolean,
  ): () => void {
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) => {
      if (m === "getAuthStatus")
        return {
          isAuthenticated: authenticated,
          user,
          serverUrl: h.authServerUrl,
        };
      if (m === "getAccountInfo") return account;
      if (m === "login") return { user };
      return orig(m, params);
    };
    return () => {
      h.handleClientRequest = orig;
    };
  }

  const accountPollField = DesktopHost as unknown as {
    accountPollIntervalMs: number;
  };

  /** Shrink the usage poll interval for a test; returns a restore fn. */
  function setAccountPollInterval(ms: number): () => void {
    const original = accountPollField.accountPollIntervalMs;
    accountPollField.accountPollIntervalMs = ms;
    return () => {
      accountPollField.accountPollIntervalMs = original;
    };
  }

  it("pushes the account card on webviewReady with the auth user and usage", async () => {
    const restore = stubAccountRpc(
      { id: "u1", email: "alice@example.com" },
      {
        billing: planBilling,
        apiQuota: { limit: null, used: 1.15314 },
      },
      true,
    );
    const { sent } = await readyHost();

    await vi.waitFor(() => {
      const card = sent("desktopAccountInfo").at(-1);
      expect(card).toMatchObject({
        isAuthenticated: true,
        user: { id: "u1", email: "alice@example.com" },
        billing: planBilling,
        apiQuota: { limit: null, used: 1.15314 },
      });
    });
    restore();
  });

  it("keeps the last successful usage when the getAccountInfo RPC fails (spec 场景 9)", async () => {
    const restoreStub = stubAccountRpc(
      { id: "u1", email: "alice@example.com" },
      {
        billing: planBilling,
        apiQuota: { limit: null, used: 1 },
      },
      true,
    );
    const { host, sent } = await readyHost();
    await vi.waitFor(() => {
      expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
        billing: planBilling,
      });
    });

    // The next usage query fails (401/网络) — the card keeps the last data.
    const restore = failRpc("getAccountInfo", "Account query failed (401)");
    await host.dispose();
    restore();
    // Re-seed via a fresh webviewReady on a new host: pushInitialState's usage
    // refresh now fails, but the card must keep the previously cached usage.
    const restore2 = failRpc("getAccountInfo", "Account query failed (401)");
    h.authStatusResults = [true];
    await host.handleWebviewMessage({ command: "webviewReady" });
    restore2();

    await vi.waitFor(() => {
      const card = sent("desktopAccountInfo").at(-1);
      expect(card).toMatchObject({
        isAuthenticated: true,
        billing: planBilling,
        apiQuota: { limit: null, used: 1 },
      });
    });
    restoreStub();
  });

  it("seeds the account card on login and fetches usage", async () => {
    const restore = stubAccountRpc(
      { id: "u1", email: "carol@example.com" },
      {
        billing: planBilling,
        apiQuota: { limit: null, used: 0 },
      },
      false,
    );
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({ command: "login" });

    await vi.waitFor(() => {
      const card = sent("desktopAccountInfo").at(-1);
      expect(card).toMatchObject({
        isAuthenticated: true,
        user: { id: "u1", email: "carol@example.com" },
        billing: planBilling,
      });
    });
    restore();
  });

  it("登录进行中再点「登录」不会起第二轮授权（PM 3500343150983424）", async () => {
    const orig = h.handleClientRequest;
    let loginCalls = 0;
    let releaseLogin: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    h.handleClientRequest = async (m: string, params?: unknown) => {
      if (m === "login") {
        loginCalls += 1;
        await gate;
        return { user: { id: "u1", email: "a@b.com" } };
      }
      if (m === "getAccountInfo") return { billing: null, apiQuota: null };
      return orig(m, params);
    };
    const { host, sent } = await readyHost();

    // 授权还没回到本地回调时又点了一次：第二次不应再起一套登录流程
    // （新的回调 server + 又一次全量 agent 重建）。
    const first = host.handleWebviewMessage({ command: "login" });
    const second = host.handleWebviewMessage({ command: "login" });
    await vi.waitFor(() => expect(loginCalls).toBe(1));

    releaseLogin();
    await Promise.all([first, second]);

    expect(loginCalls).toBe(1);
    expect(sent("loginResponse")).toHaveLength(1);
    h.handleClientRequest = orig;
  });

  it("clears the account card on logout", async () => {
    const restore = stubAccountRpc(
      { id: "u1", email: "bob@example.com" },
      {
        billing: planBilling,
        apiQuota: { limit: null, used: 0 },
      },
      true,
    );
    const { host, sent } = await readyHost();
    await vi.waitFor(() => {
      expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
        isAuthenticated: true,
      });
    });

    await host.handleWebviewMessage({ command: "logout" });

    await vi.waitFor(() => {
      const card = sent("desktopAccountInfo").at(-1);
      expect(card).toMatchObject({
        isAuthenticated: false,
        user: null,
        billing: null,
        apiQuota: null,
      });
    });
    restore();
  });

  it("pushes the newly focused pane's host account (spec 场景 8)", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.upsertSession({
      sessionId: "sess-remote",
      title: "remote",
      host: "prod",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1,
      lastActiveAt: 1,
    });
    h.existingPaths.add("/work/a");
    // getAuthStatus 按 FIFO 消费（mock 客户端不区分主机），顺序 = 开场聚焦本地
    // （refreshAuthStatus）→ webviewReady（pushInitialState，本地）→ 打开远端会话
    // （该主机未缓存 → 按需查一次，未登录）→ 聚焦回本地分屏 → 聚焦远端分屏。
    h.authStatusResults = [true, true, false, true, false];

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-remote",
    });
    const panes = (
      sent("desktopPanes").at(-1) as {
        panes: Array<{ paneId: string; host: string }>;
      }
    ).panes;
    expect(panes[1]).toMatchObject({ host: "prod" });
    // 远端会话的恢复是异步的（spawn agent → restoreSession）；它会在落地时聚焦
    // 该分屏并同步卡片。先等它落定，后面的聚焦断言才只反映聚焦切换本身。
    await vi.waitFor(() => {
      const last = sent("setInitialState")
        .filter((m) => m.paneId === panes[1].paneId)
        .at(-1) as { isRestoring?: boolean; session?: { id?: string } };
      expect(last).toMatchObject({
        isRestoring: false,
        session: { id: "sess-remote" },
      });
    });

    // 本地 pane：卡片保持已登录（本地缓存）
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[0].paneId,
    });
    await vi.waitFor(() => {
      expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
        isAuthenticated: true,
      });
    });

    // prod pane：卡片跟随为未登录
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[1].paneId,
    });
    await vi.waitFor(() => {
      expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
        isAuthenticated: false,
      });
    });
  });

  /**
   * 「没查过」不等于「未登录」：升级重启后第一次接触远端主机，如果是打开一个远端
   * 会话（而不是在主机选择器里切到该主机），缓存里并没有该主机的条目 —— 卡片据此
   * 推的未登录快照会让左下角永久停在登录按钮（用量轮询直接跳过未登录条目），必须
   * 真的查一次该主机。
   */
  it("打开远端会话时须查询该主机，未缓存不得推成未登录", async () => {
    const restore = stubAccountRpc(
      { id: "u1", email: "alice@example.com" },
      {
        billing: planBilling,
        apiQuota: { limit: null, used: 1 },
      },
      true,
    );
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, send, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.upsertSession({
      sessionId: "sess-remote",
      title: "remote",
      host: "prod",
      workdir: "/work/b",
      cwd: "/work/b",
      createdAt: 1,
      lastActiveAt: 1,
    });
    h.existingPaths.add("/work/a");
    h.existingPaths.add("/work/b");

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await host.handleWebviewMessage({ command: "webviewReady" });

    // 只看打开远端会话之后的卡片（此前那些属于本地主机）。
    send.mockClear();
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/b",
      sessionId: "sess-remote",
    });

    await vi.waitFor(() => {
      expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
        isAuthenticated: true,
        user: { id: "u1", email: "alice@example.com" },
        billing: planBilling,
      });
    });
    // 这条路径上任何一次未登录快照都会点着左下角的登录按钮（远端确实已登录）。
    expect(
      sent("desktopAccountInfo").filter((c) => c.isAuthenticated !== true),
    ).toEqual([]);
    restore();
  });

  /**
   * 首次查询恰好失败（远端 daemon 正在被 CLI 升级重启）时，「没查过」仍只是未知
   * —— 卡片不得回落成未登录；用量轮询会重查未知主机并自愈，否则用户必须手动切一
   * 次主机才看得到账号。
   */
  it("首次查询失败时卡片不回落成未登录，并由轮询自愈", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, send, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.upsertSession({
      sessionId: "sess-remote",
      title: "remote",
      host: "prod",
      workdir: "/work/b",
      cwd: "/work/b",
      createdAt: 1,
      lastActiveAt: 1,
    });
    h.existingPaths.add("/work/a");
    h.existingPaths.add("/work/b");
    // 两台主机都已登录：只有「未知」才会让卡片显示登录按钮。
    h.authStatusResults = Array(8).fill(true);

    let queries = 0;
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) => {
      if (m === "getAuthStatus") {
        queries += 1;
        // 第 1 次 = webviewReady（本地，成功）；第 2 次 = 打开远端会话那次（失败，
        // 模拟远端 daemon 正被 CLI 升级重启）。
        if (queries === 2) throw new Error("remote daemon restarting");
      }
      return orig(m, params);
    };
    const restoreInterval = setAccountPollInterval(20);

    try {
      await host.handleWebviewMessage({ command: "desktopReady" });
      await host.handleWebviewMessage({
        command: "desktopSelectRecentWorkdir",
        path: "/work/a",
      });
      await host.handleWebviewMessage({ command: "webviewReady" });

      send.mockClear();
      await host.handleWebviewMessage({
        command: "desktopSelectSession",
        workdir: "/work/b",
        sessionId: "sess-remote",
      });
      await vi.waitFor(() => {
        expect(queries).toBeGreaterThanOrEqual(2);
      });
      // 查询失败 → 该主机仍是未知，不得推未登录快照。
      expect(
        sent("desktopAccountInfo").filter((c) => c.isAuthenticated !== true),
      ).toEqual([]);

      // 轮询重查未知主机 → 卡片自愈为已登录。
      await vi.waitFor(
        () => {
          expect(queries).toBeGreaterThanOrEqual(3);
          expect(sent("desktopAccountInfo").at(-1)).toMatchObject({
            isAuthenticated: true,
          });
        },
        { timeout: 3000 },
      );
    } finally {
      h.handleClientRequest = orig;
      restoreInterval();
    }
  });
});

// ---------------------------------------------------------------------------
// misc commands
// ---------------------------------------------------------------------------

describe("misc commands", () => {
  it("newSession spawns a fresh session without clearing the old one (FR-031)", async () => {
    const { host } = await readyHost();
    fireUserMessage(lastAgent()); // make the active session non-empty
    const oldAgent = lastAgent();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "newSession" });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(oldAgent.clearMessages).not.toHaveBeenCalled();
    expect(oldAgent.destroy).not.toHaveBeenCalled();
    expect(oldAgent.abortMessage).not.toHaveBeenCalled();
  });

  it("newSession destroys the spawned agent when another session claims the pane mid-spawn", async () => {
    const { host, sent } = await readyHost();
    const active = lastAgent();
    fireUserMessage(active); // the active session is non-empty, so newSession spawns
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });

    const spawnPromise = host.handleWebviewMessage({ command: "newSession" });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(2);
    });
    const spawned = lastAgent();

    // Mid-spawn the user picks a historical session whose restore lands first
    // and rebinds the pane. The original spawn then has no pane to bind to —
    // it must be destroyed instead of orphaned in the agent pool.
    h.initializeGate = null;
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-other",
    });
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)).toMatchObject({
        isRestoring: false,
        session: { id: "sess-other" },
      });
    });

    resolveInit();
    await spawnPromise;

    expect(spawned.destroy).toHaveBeenCalledTimes(1);
  });

  it("newSession on an empty active session spawns a fresh session (replaces the blank agent)", async () => {
    const { host, sent } = await readyHost();
    const blank = lastAgent();
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({ command: "newSession" });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    // The blank agent is replaced by the fresh one, not leaked into the pool.
    expect(blank.destroy).toHaveBeenCalled();
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: lastAgent().sessionId },
    });
  });

  it("newSession with no recent workdirs releases the pane to the blank state instead of dropping the click (scenario 10)", async () => {
    const { host, store, sent } = await readyHost();
    const realAgent = lastAgent();
    fireUserMessage(realAgent); // a real session — must stay re-selectable
    store.removeRecentWorkdir({ host: "local", path: "/work/a" });
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "newSession" });

    // No workdir to spawn at: no new agent, and the real session is not
    // discarded (it remains re-selectable from the sidebar).
    expect(h.agentInstances).toHaveLength(before);
    expect(realAgent.destroy).not.toHaveBeenCalled();
    // The pane is released to the blank new-session state (workdir picker
    // shows the "选择工作目录…" placeholder).
    const initialState = sent("setInitialState").at(-1);
    expect(initialState?.session).toBeUndefined();
    expect(initialState?.messages).toEqual([]);
    expect(sent("desktopWorkdirState").at(-1)?.workdir).toBeUndefined();
    expect(sent("desktopPanes").at(-1)?.panes[0].sessionId).toBeUndefined();
  });

  it("intercepts a message sent in the released blank pane with the workdir hint (scenario 10)", async () => {
    const { host, store, sent } = await readyHost();
    fireUserMessage(lastAgent());
    store.removeRecentWorkdir({ host: "local", path: "/work/a" });
    await host.handleWebviewMessage({ command: "newSession" });

    await host.handleWebviewMessage({ command: "sendMessage", text: "hi" });

    const hints = sent("appendMessage").filter((m) =>
      JSON.stringify(m).includes("请先选择工作目录"),
    );
    expect(hints).toHaveLength(1);
    expect(lastAgent().sendMessage).not.toHaveBeenCalled();
  });

  it("clearChat is a no-op after desktop /clear removal (2026-09-05)", async () => {
    const { host, send } = await readyHost();
    const agent = lastAgent();
    fireUserMessage(agent);
    const before = h.agentInstances.length;
    const sendsBefore = send.mock.calls.length;

    await host.handleWebviewMessage({ command: "clearChat" });

    // Desktop /clear was removed end-to-end: the webview no longer intercepts
    // /clear nor sends clearChat, so the host must not clear messages, spawn a
    // new agent, or push anything in response.
    expect(agent.clearMessages).not.toHaveBeenCalled();
    // The CLI's list is untouched (the host keeps none of its own to clear).
    expect(agent.daemonMessages).toHaveLength(1);
    expect(h.agentInstances).toHaveLength(before);
    expect(send.mock.calls.length).toBe(sendsBefore);
  });

  it("restoreSession forwards to the agent and refreshes the session tree", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: "sess-x",
      title: "x",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1000,
      lastActiveAt: 1000,
    });

    await host.handleWebviewMessage({
      command: "restoreSession",
      sessionId: "sess-x",
    });

    // Restore runs in the background now — the agent spawn + restoreSession
    // land after the handler returns.
    await vi.waitFor(() => {
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-x");
      // The daemon reuses the live agent for the session being restored —
      // initialize must carry the restoreSessionId (dedupe on re-attach).
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ restoreSessionId: "sess-x" }),
      );
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("compact forwards custom instructions", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "compact",
      customInstructions: "keep it short",
    });
    expect(lastAgent().compact).toHaveBeenCalledWith("keep it short");
  });

  it("requestSlashCommands asks the machine for the desktop set", async () => {
    // 宿主不再自持本地命令表：它只把入口标识带上去，由服务端拼 SDK 那半与本入口
    // 那半（spec ui/slash-commands.md「弹窗里的宿主命令只有一份表」）。
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    expect(lastAgent().getSlashCommands).toHaveBeenCalledWith("desktop");

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain("review");
    expect(names).toContain("remote-control");
  });

  it("requestSlashCommands filters by text", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "rewind",
    });

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(["rewind"]);
  });

  it("requestSlashCommands includes plan in the merged list", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain("plan");
  });

  it("requestSlashCommands keeps skillSource on skill commands only", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    const resp = sent("slashCommandsResponse")[0];
    const commands = resp.commands as Array<{
      name: string;
      skillSource?: "builtin" | "user" | "project" | "plugin";
    }>;
    // Skill command keeps its source for the popup tag…
    const review = commands.find((c) => c.name === "review");
    expect(review?.skillSource).toBe("builtin");
    // …while local/system commands never carry a source tag.
    const config = commands.find((c) => c.name === "config");
    expect(config?.skillSource).toBeUndefined();
  });

  it("requestSlashCommands flags local commands runOnSelect, /btw excepted", async () => {
    // webview 靠这条标记决定「发回宿主执行」还是「插入命令名等参数」——它不再
    // 自带命令名名单，所以每条本地指令的标记必须由宿主给全。
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    const resp = sent("slashCommandsResponse")[0];
    const commands = resp.commands as Array<{
      name: string;
      runOnSelect?: boolean;
      skillSource?: string;
    }>;
    // /btw 要让用户接着补问题，唯一不标的本地指令
    expect(commands.find((c) => c.name === "btw")?.runOnSelect).toBeUndefined();
    for (const name of ["status", "remote-control", "plan"]) {
      expect(commands.find((c) => c.name === name)?.runOnSelect).toBe(true);
    }
    // SDK 命令一律不带（技能 / 自定义 / 插件命令都走插入文本）
    expect(
      commands.find((c) => c.name === "review")?.runOnSelect,
    ).toBeUndefined();
  });

  it("/plan outside plan mode switches to plan mode without sending a message", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.permissionMode = "default";

    await host.handleWebviewMessage({ command: "planCommand" });

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(
      sent("showToast").some((m) => m.toast.message.includes("已启用规划模式")),
    ).toBe(true);
  });

  it("/plan with a description outside plan mode starts the plan query", async () => {
    const { host } = await readyHost();
    const agent = lastAgent();
    agent.permissionMode = "default";

    await host.handleWebviewMessage({
      command: "planCommand",
      args: "Add user auth",
    });

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).toHaveBeenCalledWith("Add user auth");
  });

  it("/plan open is treated as a bare /plan (no external editor)", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.permissionMode = "default";

    await host.handleWebviewMessage({
      command: "planCommand",
      args: "open",
    });

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(
      sent("showToast").some((m) => m.toast.message.includes("已启用规划模式")),
    ).toBe(true);
  });

  it("/plan inside plan mode pushes the current plan file to the Plan pane", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.permissionMode = "plan";
    agent.getPlanFile.mockResolvedValueOnce({
      path: "/tmp/plan.md",
      content: "# 当前方案",
    });

    await host.handleWebviewMessage({ command: "planCommand" });

    expect(agent.setPermissionMode).not.toHaveBeenCalled();
    expect(agent.getPlanFile).toHaveBeenCalled();
    expect(sent("planContent")[0]).toMatchObject({
      content: "# 当前方案",
    });
  });

  it("/plan with no plan file yet does not open the Plan pane", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.permissionMode = "plan";
    agent.getPlanFile.mockResolvedValueOnce({ path: null, content: null });

    await host.handleWebviewMessage({ command: "planCommand" });

    expect(agent.getPlanFile).toHaveBeenCalled();
    expect(sent("planContent")).toHaveLength(0);
  });

  it("updateQueuedMessage notifies the webview when the message is gone", async () => {
    const { host, sent } = await readyHost();
    lastAgent().updateQueuedMessageById.mockResolvedValueOnce(false);

    await host.handleWebviewMessage({
      command: "updateQueuedMessage",
      id: "q1",
      text: "new",
    });

    expect(sent("updateQueuedMessageMissing")[0]).toMatchObject({ id: "q1" });
  });

  it("getMcpServers replies with the agent server list", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: "getMcpServers" });
    expect(sent("mcpServersResponse")[0]).toMatchObject({ servers: [] });
  });

  it("getSkillMetadata replies with the agent skill list", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: "getSkillMetadata" });
    expect(sent("skillMetadataResponse")[0]).toMatchObject({
      skills: [
        {
          name: "deep-research",
          description: "Deep research",
          type: "builtin",
        },
      ],
    });
  });

  it("getHooksByScope replies with the CLI-resolved absolute configPath", async () => {
    // 桌面「用户级钩子 → 编辑」把该路径交给右侧文件面板打开；面板按 OS 绝对
    // 路径 stat，无法展开 `~`（webview 自造 `~/.wave/settings.json` 会报
    // 「文件不存在：~/.wave/settings.json」）。故路径必须由 CLI 侧解析后回带。
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.getHooksByScope = vi.fn(async () => ({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
      configPath: "/home/u/.wave/settings.json",
    }));

    await host.handleWebviewMessage({
      command: "getHooksByScope",
      scope: "user",
    });

    expect(sent("hooksResponse")[0]).toMatchObject({
      scope: "user",
      configPath: "/home/u/.wave/settings.json",
    });
  });

  it("deleteHook replies with the refreshed hooks and configPath", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.deleteHook = vi.fn(async () => undefined);
    agent.getHooksByScope = vi.fn(async () => ({
      hooks: {},
      configPath: "/home/u/.wave/settings.json",
    }));

    await host.handleWebviewMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse",
    });

    expect(sent("hooksResponse")[0]).toMatchObject({
      hooks: {},
      configPath: "/home/u/.wave/settings.json",
    });
  });

  it("connectMcpServer failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    lastAgent().connectMcpServer.mockRejectedValueOnce(
      new Error("server not found"),
    );

    await host.handleWebviewMessage({
      command: "connectMcpServer",
      serverName: "srv",
    });

    expect(
      shownToasts().some((t) => t.message.includes("连接 MCP 服务器失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("disconnectMcpServer failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    lastAgent().disconnectMcpServer.mockRejectedValueOnce(
      new Error("not connected"),
    );

    await host.handleWebviewMessage({
      command: "disconnectMcpServer",
      serverName: "srv",
    });

    expect(
      shownToasts().some((t) => t.message.includes("断开 MCP 服务器失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  // -- 设置页反馈语义（2026-09-09 设计师走查拍板：设置页不得自建提示，保存类
  //    成功/失败与删除类成功均经宿主全局 toast 提示；删除写操作无 live agent 时
  //    不得静默成功——见 desktop-account-and-settings「设置页反馈语义」） --

  it("deleteSkill success surfaces a global toast with the skill name", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.deleteSkill = vi.fn(async () => undefined);

    await host.handleWebviewMessage({ command: "deleteSkill", name: "demo" });

    expect(agent.deleteSkill).toHaveBeenCalledWith("demo");
    expect(shownToasts().some((t) => t.message === "已删除技能「demo」")).toBe(
      true,
    );
    expect(sent("skillMetadataResponse")).toHaveLength(1);
  });

  it("deleteSkill without a live agent surfaces a failure toast, not a silent no-op", async () => {
    const { host, sent } = await readyHost();

    // 该 pane 未绑定任何 agent（正常 UI 不会发出，宿主须防御直接命令调用）
    await host.handleWebviewMessage({
      command: "deleteSkill",
      name: "demo",
      paneId: "no-such-pane",
    });

    expect(shownToasts().some((t) => t.message.includes("删除技能失败"))).toBe(
      true,
    );
    expect(sent("skillMetadataResponse")).toHaveLength(0);
  });

  it("deleteSkill failure surfaces a failure toast and skips the list refresh", async () => {
    const { host, sent } = await readyHost();
    lastAgent().deleteSkill = vi.fn(async () => {
      throw new Error("permission denied");
    });

    await host.handleWebviewMessage({ command: "deleteSkill", name: "demo" });

    expect(
      shownToasts().some(
        (t) =>
          t.message.includes("删除技能失败") &&
          t.message.includes("permission denied"),
      ),
    ).toBe(true);
    // 删除没成功就不能回发「已刷新」的列表（否则 webview 会以为删掉了）
    expect(sent("skillMetadataResponse")).toHaveLength(0);
  });

  it("deleteSubagent success surfaces a global toast with the subagent name", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.deleteSubagent = vi.fn(async () => undefined);
    agent.getSubagentConfigurations = vi.fn(async () => []);

    await host.handleWebviewMessage({ command: "deleteSubagent", name: "sde" });

    expect(agent.deleteSubagent).toHaveBeenCalledWith("sde");
    expect(shownToasts().some((t) => t.message === "已删除子代理「sde」")).toBe(
      true,
    );
    expect(sent("subagentConfigurationsResponse")).toHaveLength(1);
  });

  it("deleteSubagent without a live agent surfaces a failure toast, not a silent no-op", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "deleteSubagent",
      name: "sde",
      paneId: "no-such-pane",
    });

    expect(
      shownToasts().some((t) => t.message.includes("删除子代理失败")),
    ).toBe(true);
    expect(sent("subagentConfigurationsResponse")).toHaveLength(0);
  });

  it("deleteSubagent failure surfaces a failure toast and skips the list refresh", async () => {
    const { host, sent } = await readyHost();
    lastAgent().deleteSubagent = vi.fn(async () => {
      throw new Error("no such file");
    });

    await host.handleWebviewMessage({ command: "deleteSubagent", name: "sde" });

    expect(
      shownToasts().some(
        (t) =>
          t.message.includes("删除子代理失败") &&
          t.message.includes("no such file"),
      ),
    ).toBe(true);
    expect(sent("subagentConfigurationsResponse")).toHaveLength(0);
  });

  it("deleteHook success surfaces a global toast with the hook name", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.deleteHook = vi.fn(async () => undefined);
    agent.getHooksByScope = vi.fn(async () => ({
      hooks: {},
      configPath: null,
    }));

    await host.handleWebviewMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse",
    });

    expect(agent.deleteHook).toHaveBeenCalledWith("user", "PreToolUse");
    expect(
      shownToasts().some((t) => t.message === "已删除钩子「PreToolUse」"),
    ).toBe(true);
    expect(sent("hooksResponse")).toHaveLength(1);
  });

  it("deleteHook without a live agent surfaces a failure toast, not a silent no-op", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse",
      paneId: "no-such-pane",
    });

    expect(shownToasts().some((t) => t.message.includes("删除钩子失败"))).toBe(
      true,
    );
    expect(sent("hooksResponse")).toHaveLength(0);
  });

  it("deleteHook failure surfaces a failure toast and skips the list refresh", async () => {
    const { host, sent } = await readyHost();
    lastAgent().deleteHook = vi.fn(async () => {
      throw new Error("invalid hook name");
    });

    await host.handleWebviewMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse",
    });

    expect(
      shownToasts().some(
        (t) =>
          t.message.includes("删除钩子失败") &&
          t.message.includes("invalid hook name"),
      ),
    ).toBe(true);
    expect(sent("hooksResponse")).toHaveLength(0);
  });

  it("removeMcpServer success surfaces a global toast with the server name", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.removeMcpServer = vi.fn(async () => undefined);

    await host.handleWebviewMessage({
      command: "removeMcpServer",
      scope: "user",
      serverName: "files",
    });

    expect(agent.removeMcpServer).toHaveBeenCalledWith("user", "files");
    expect(
      shownToasts().some((t) => t.message === "已移除 MCP 服务器「files」"),
    ).toBe(true);
    expect(sent("mcpServersResponse")).toHaveLength(1);
  });

  it("removeMcpServer without a live agent surfaces a failure toast, not a silent no-op", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "removeMcpServer",
      scope: "user",
      serverName: "files",
      paneId: "no-such-pane",
    });

    expect(
      shownToasts().some((t) => t.message.includes("移除 MCP 服务器失败")),
    ).toBe(true);
    expect(sent("mcpServersResponse")).toHaveLength(0);
  });

  it("removeMcpServer failure surfaces a failure toast and skips the list refresh", async () => {
    const { host, sent } = await readyHost();
    lastAgent().removeMcpServer = vi.fn(async () => {
      throw new Error("mcp.json is read-only");
    });

    await host.handleWebviewMessage({
      command: "removeMcpServer",
      scope: "user",
      serverName: "files",
    });

    expect(
      shownToasts().some(
        (t) =>
          t.message.includes("移除 MCP 服务器失败") &&
          t.message.includes("mcp.json is read-only"),
      ),
    ).toBe(true);
    expect(sent("mcpServersResponse")).toHaveLength(0);
  });

  it("updateConfiguration success surfaces a 保存成功 toast", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { language: "English" },
    });

    expect(shownToasts().some((t) => t.message === "保存成功")).toBe(true);
  });

  it("updateConfiguration failure surfaces a 保存失败 toast with the reason", async () => {
    const { host } = await readyHost();
    // 保存路径不再经 updateConfig 重建会话，失败来自用户偏好落盘（settings.json）。
    const restore = failRpc("updateUserSettings", "disk full");
    try {
      await host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: { language: "English" },
      });
    } finally {
      restore();
    }

    expect(shownToasts().some((t) => t.message.startsWith("保存失败："))).toBe(
      true,
    );
  });

  it("setAgentsContent success surfaces a 保存成功 toast and replies agentsContentSaved ok", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "setAgentsContent",
      scope: "user",
      content: "# User Memory",
    });

    expect(shownToasts().some((t) => t.message === "保存成功")).toBe(true);
    expect(sent("agentsContentSaved")[0]).toMatchObject({
      scope: "user",
      ok: true,
    });
  });

  it("setAgentsContent failure surfaces a 保存失败 toast and replies agentsContentSaved ok:false", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("setAgentsContent", "disk full");
    try {
      await host.handleWebviewMessage({
        command: "setAgentsContent",
        scope: "user",
        content: "# User Memory",
      });
    } finally {
      restore();
    }

    expect(shownToasts().some((t) => t.message.startsWith("保存失败："))).toBe(
      true,
    );
    expect(sent("agentsContentSaved")[0]).toMatchObject({
      scope: "user",
      ok: false,
    });
  });

  it("getAgentsContent project scope reads the focused pane session's workdir, not the webview-sent path", async () => {
    const { host, sent } = await readyHost();
    // readyHost binds pane-1 to a session whose agent currentWorkdir is /work/a.
    const orig = h.handleClientRequest;
    const seen: Array<{ method: string; params: unknown }> = [];
    h.handleClientRequest = (method, params) => {
      if (method === "getAgentsContent") {
        seen.push({ method, params });
        return { content: "# from the bound session" };
      }
      return orig(method, params);
    };
    try {
      await host.handleWebviewMessage({
        command: "getAgentsContent",
        scope: "project",
        // The settings full-page runs on the root webview instance, which has
        // no session of its own — it used to forward the head of the window's
        // recents here, so reads hit the wrong (non-current) project.
        workdir: "/work/recents-head",
      });
    } finally {
      h.handleClientRequest = orig;
    }

    expect(seen).toEqual([
      {
        method: "getAgentsContent",
        params: { scope: "project", workdir: "/work/a" },
      },
    ]);
    expect(sent("agentsContentResponse")[0]).toMatchObject({
      scope: "project",
      content: "# from the bound session",
    });
  });

  it("setAgentsContent project scope writes to the focused pane session's workdir, not the webview-sent path", async () => {
    const { host, sent } = await readyHost();
    const orig = h.handleClientRequest;
    const seen: Array<{ method: string; params: unknown }> = [];
    h.handleClientRequest = (method, params) => {
      if (method === "setAgentsContent") {
        seen.push({ method, params });
        return { ok: true };
      }
      return orig(method, params);
    };
    try {
      await host.handleWebviewMessage({
        command: "setAgentsContent",
        scope: "project",
        content: "# new project rules",
        workdir: "/work/recents-head",
      });
    } finally {
      h.handleClientRequest = orig;
    }

    expect(seen).toEqual([
      {
        method: "setAgentsContent",
        params: {
          scope: "project",
          content: "# new project rules",
          workdir: "/work/a",
        },
      },
    ]);
    expect(shownToasts().some((t) => t.message === "保存成功")).toBe(true);
    expect(sent("agentsContentSaved")[0]).toMatchObject({
      scope: "project",
      ok: true,
    });
  });

  it("listPlugins failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("listPlugins", "plugin service down");
    try {
      await host.handleWebviewMessage({ command: "listPlugins" });
    } finally {
      restore();
    }
    expect(
      shownToasts().some((t) => t.message.includes("获取插件列表失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("plugin mutations reuse the anchor pinned when the list was fetched", async () => {
    const { host, store } = await readyHost();
    h.clientRequests.length = 0;
    await host.handleWebviewMessage({ command: "listPlugins" });
    expect(h.clientRequests).toContainEqual({
      method: "listPlugins",
      params: { workdir: "/work/a" },
    });

    // 看完列表后又切到另一个工程（真机上这一步会先关闭整页，这里直接验证宿主侧
    // 的不变量）：写操作必须沿用列表那一次的锚点…
    store.addRecentWorkdir({ host: "local", path: "/work/b" });
    h.existingPaths.add("/work/b");
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/b",
    });
    h.clientRequests.length = 0;

    await host.handleWebviewMessage({
      command: "setPluginScope",
      pluginId: "demo",
      scope: "user",
    });

    // …而不是「此刻的当前工程」（/work/b），否则记录会写进另一条对话的工程。
    expect(h.clientRequests).toContainEqual({
      method: "setPluginScope",
      params: { pluginId: "demo", scope: "user", workdir: "/work/a" },
    });
  });

  it("plugin mutation failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("enablePlugin", "plugin service down");
    try {
      await host.handleWebviewMessage({
        command: "enablePlugin",
        pluginId: "demo",
        scope: "user",
      });
    } finally {
      restore();
    }
    expect(shownToasts().some((t) => t.message.includes("插件操作失败"))).toBe(
      true,
    );
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("refreshMarketplaces pulls the checkouts, then re-pushes both lists with the refreshed flag", async () => {
    // spec 插件市场场景 5/2：打开插件市场视图 → 后台只刷各市场检出（不升级插件），
    // 完成后把两份最新列表推给已打开的视图（带 refreshed 标记收起「检查更新中…」）。
    const { host, sent } = await readyHost();
    const orig = h.handleClientRequest;
    const seen: Array<{ method: string; params: unknown }> = [];
    h.handleClientRequest = (method, params) => {
      if (method === "refreshMarketplaces") {
        seen.push({ method, params });
        return null;
      }
      return orig(method, params);
    };
    try {
      await host.handleWebviewMessage({ command: "refreshMarketplaces" });
    } finally {
      h.handleClientRequest = orig;
    }

    expect(seen).toEqual([
      { method: "refreshMarketplaces", params: { workdir: "/work/a" } },
    ]);
    expect(sent("listMarketplacesResponse")[0]).toMatchObject({
      refreshed: true,
    });
    expect(sent("listPluginsResponse")[0]).toMatchObject({ refreshed: true });
    // 刷新不升级插件：不出现任何市场更新调用
    expect(
      h.clientRequests.filter((r) => r.method === "updateMarketplace"),
    ).toHaveLength(0);
  });

  it("refreshMarketplaces failure stays silent but still re-pushes the current lists", async () => {
    // spec 插件市场场景 9：刷新失败静默记日志（不弹 toast），列表仍按刷新前的清单呈现。
    const { host, sent } = await readyHost();
    const restore = failRpc("refreshMarketplaces", "network down");
    try {
      await host.handleWebviewMessage({ command: "refreshMarketplaces" });
    } finally {
      restore();
    }

    expect(shownToasts()).toHaveLength(0);
    expect(sent("listMarketplacesResponse")[0]).toMatchObject({
      refreshed: true,
    });
    expect(sent("listPluginsResponse")[0]).toMatchObject({ refreshed: true });
  });

  it("getProjectSettings failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("getProjectSettings", "settings down");
    try {
      await host.handleWebviewMessage({ command: "getProjectSettings" });
    } finally {
      restore();
    }
    expect(
      shownToasts().some((t) => t.message.includes("获取项目设置失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("setBuiltinPluginEnabled failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("setBuiltinPluginEnabled", "settings down");
    try {
      await host.handleWebviewMessage({
        command: "setBuiltinPluginEnabled",
        pluginId: "builtin-review",
        enabled: true,
        scope: "user",
      });
    } finally {
      restore();
    }
    expect(
      shownToasts().some((t) => t.message.includes("修改项目设置失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("setBuiltinPluginEnabled only notifies — it never rebuilds a session inline", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) =>
      m === "setBuiltinPluginEnabled"
        ? { enabledPlugins: { "sdd@builtin": true } }
        : orig(m, params);
    try {
      await host.handleWebviewMessage({
        command: "setBuiltinPluginEnabled",
        pluginId: "sdd@builtin",
        enabled: true,
        scope: "project",
      });
      // 落盘 + 开关翻转回执完成后只给一次「待应用」信号，本次不重建任何会话
      // （spec plugin「插件变更的就地重载」场景 1）。
      expect(sent("projectSettings")).toHaveLength(1);
      expect(pendingPluginPrompts()).toBe(1);
      expect(agent.updateConfig).not.toHaveBeenCalled();
      expect(sent("desktopRebuildPrompt")).toHaveLength(0);
    } finally {
      h.handleClientRequest = orig;
    }
  });

  it("/reload-plugins asks the CLI to swap plugins into its live sessions and reports success", async () => {
    const { host } = await readyHost();
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) =>
      m === "reloadPlugins"
        ? { plugins: ["sdd@builtin"], failures: [] }
        : orig(m, params);
    try {
      await host.handleWebviewMessage({ command: "reloadPlugins" });
    } finally {
      h.handleClientRequest = orig;
    }
    // 一次 RPC 覆盖该 CLI 进程内的全部 live 会话——宿主只发这一条。
    expect(
      h.clientRequests.filter((r) => r.method === "reloadPlugins"),
    ).toHaveLength(1);
    expect(shownToasts().at(-1)?.message).toBe("插件已重载。");
  });

  it("/reload-plugins reports the plugins that failed to load", async () => {
    const { host } = await readyHost();
    const orig = h.handleClientRequest;
    h.handleClientRequest = (m: string, params?: unknown) =>
      m === "reloadPlugins"
        ? { plugins: [], failures: [{ path: "/p/bad", error: "boom" }] }
        : orig(m, params);
    try {
      await host.handleWebviewMessage({ command: "reloadPlugins" });
    } finally {
      h.handleClientRequest = orig;
    }
    // 失败清单如实回显，不回滚已成功的那部分（spec 场景 11）。
    expect(shownToasts().at(-1)?.message).toBe(
      "插件已重载。部分插件加载失败：/p/bad: boom",
    );
  });

  it("/reload-plugins failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("reloadPlugins", "cli down");
    try {
      await host.handleWebviewMessage({ command: "reloadPlugins" });
    } finally {
      restore();
    }
    expect(shownToasts().at(-1)?.message).toContain("插件重载失败");
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("listMarketplaces failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("listMarketplaces", "marketplace down");
    try {
      await host.handleWebviewMessage({ command: "listMarketplaces" });
    } finally {
      restore();
    }
    expect(
      shownToasts().some((t) => t.message.includes("获取市场列表失败")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("marketplace mutation failure surfaces as a toast, not a chat message", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("addMarketplace", "marketplace down");
    try {
      await host.handleWebviewMessage({
        command: "addMarketplace",
        input: { name: "m", url: "https://m" },
      });
    } finally {
      restore();
    }
    expect(shownToasts().some((t) => t.message.includes("市场操作失败"))).toBe(
      true,
    );
    expect(sent("appendMessage")).toHaveLength(0);
  });

  // 插件市场操作成功提示（spec plugin「插件市场操作提示」2026-09-16 原型文案口径）：
  // 桌面端走 showToast，只断言文案逐字，不约束颜色/图标/位置等视觉形态。
  // 插件变更类操作还会追加一次「待应用」提示（spec plugin「插件变更的就地重载」
  // 场景 1），故断言用「包含」而非「最后一条」。
  describe("plugin marketplace success toasts", () => {
    /** 已弹出的所有 toast 文案，按顺序。 */
    function toastMessages(): string[] {
      return shownToasts().map((t) => t.message);
    }

    /** 覆盖某个 RPC 的返回值（提示文案要从回包/刷新后的列表里取名字与版本）。 */
    function rpcResult(method: string, result: unknown): () => void {
      const orig = h.handleClientRequest;
      h.handleClientRequest = (m: string, params?: unknown) =>
        m === method ? result : orig(m, params);
      return () => {
        h.handleClientRequest = orig;
      };
    }

    it("addMarketplace reports the marketplace name returned by the SDK", async () => {
      const { host } = await readyHost();
      const restore = rpcResult("addMarketplace", { name: "团队市场" });
      try {
        await host.handleWebviewMessage({
          command: "addMarketplace",
          input: "owner/repo",
        });
      } finally {
        restore();
      }
      expect(shownToasts().at(-1)?.message).toBe("已添加市场「团队市场」");
    });

    it("removeMarketplace reports the removed marketplace name", async () => {
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "removeMarketplace",
        name: "团队市场",
      });
      expect(shownToasts().at(-1)?.message).toBe("已移除市场「团队市场」");
    });

    it("updateMarketplace reports the market name and the upgraded count", async () => {
      const { host } = await readyHost();
      const restore = rpcResult("updateMarketplace", { updated: 3 });
      try {
        await host.handleWebviewMessage({
          command: "updateMarketplace",
          name: "团队市场",
        });
      } finally {
        restore();
      }
      expect(toastMessages()).toContain("「团队市场」已更新 3 个插件");
      // 批量更新也是插件变更 ⇒ 追加一次「待应用」弹窗。
      expect(pendingPluginPrompts()).toBe(1);
    });

    it("updateMarketplace with nothing to upgrade reports 已是最新", async () => {
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "updateMarketplace",
        name: "团队市场",
      });
      expect(shownToasts().at(-1)?.message).toBe("「团队市场」已是最新");
    });

    it("installPlugin reports the plugin name and the chosen scope", async () => {
      const { host } = await readyHost();
      const restore = rpcResult("listPlugins", {
        plugins: [{ id: "demo@团队市场", name: "demo", version: "1.0.0" }],
      });
      try {
        await host.handleWebviewMessage({
          command: "installPlugin",
          pluginId: "demo@团队市场",
          scope: "project",
        });
      } finally {
        restore();
      }
      expect(toastMessages()).toContain("已安装「demo」（作用域：project）");
      expect(pendingPluginPrompts()).toBe(1);
    });

    it("uninstallPlugin reports the plugin name taken from the plugin id", async () => {
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "uninstallPlugin",
        pluginId: "demo@团队市场",
      });
      expect(toastMessages()).toContain("已卸载「demo」");
    });

    it("uninstallPlugin forwards the scope picked in the dialog", async () => {
      // spec plugin A-015：卸载作用于弹窗里选中的作用域
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "uninstallPlugin",
        pluginId: "demo@团队市场",
        scope: "project",
      });
      expect(h.clientRequests).toContainEqual({
        method: "uninstallPlugin",
        params: expect.objectContaining({
          pluginId: "demo@团队市场",
          scope: "project",
        }),
      });
    });

    it("updatePlugin reports the version from the refreshed plugin list", async () => {
      const { host } = await readyHost();
      const restore = rpcResult("listPlugins", {
        plugins: [{ id: "demo@团队市场", name: "demo", version: "1.2.0" }],
      });
      try {
        await host.handleWebviewMessage({
          command: "updatePlugin",
          pluginId: "demo@团队市场",
        });
      } finally {
        restore();
      }
      expect(toastMessages()).toContain("已更新「demo」至 v1.2.0");
    });

    it("setPluginScope reports the target scope", async () => {
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "setPluginScope",
        pluginId: "demo@团队市场",
        scope: "local",
      });
      expect(toastMessages()).toContain("已更新「demo」的作用域：local");
    });

    it("enable/disable report no result toast, but still emit the pending hint", async () => {
      const { host } = await readyHost();
      await host.handleWebviewMessage({
        command: "enablePlugin",
        pluginId: "demo@团队市场",
        scope: "user",
      });
      await host.handleWebviewMessage({
        command: "disablePlugin",
        pluginId: "demo@团队市场",
        scope: "user",
      });
      // 原型没给启用/禁用定义结果文案，但它是插件变更 ⇒ 每次变更各一次「待应用」
      // 信号（两个信号都落到同一个弹窗上，webview 侧布尔态不叠加）。
      expect(toastMessages()).toEqual([]);
      expect(pendingPluginPrompts()).toBe(2);
    });
  });

  it("listRewindCheckpoints replies with the agent checkpoints", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: "listRewindCheckpoints" });
    expect(lastAgent().listRewindCheckpoints).toHaveBeenCalled();
    expect(sent("rewindCheckpoints")[0]).toMatchObject({
      checkpoints: [{ id: "u1", content: "hello" }],
    });
  });

  it("getConfiguredModels replies with the agent model list for this pane", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: "getConfiguredModels" });
    expect(lastAgent().getConfiguredModels).toHaveBeenCalled();
    expect(sent("configuredModels")[0]).toMatchObject({
      models: ["gpt-4", "claude"],
      currentModel: "gpt-4",
      paneId: expect.any(String),
    });
  });

  it("setModel forwards the picked model to the pane agent", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: "setModel", model: "claude" });
    expect(lastAgent().setModel).toHaveBeenCalledWith("claude");
  });

  it("askBtw replies with the agent answer and echoed question", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "askBtw",
      question: "weather?",
    });
    expect(lastAgent().askBtw).toHaveBeenCalledWith("weather?");
    expect(sent("btwResponse")[0]).toMatchObject({
      question: "weather?",
      answer: "**Sunny** weather",
    });
  });

  it("askBtw posts btwError when the agent is missing", async () => {
    // A host that never spawned an agent (no workdir picked) has no pane agent.
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "askBtw",
      question: "weather?",
    });
    expect(sent("btwError")[0]).toMatchObject({
      question: "weather?",
      error: expect.any(String),
    });
  });

  it("requestSlashCommands includes btw in the merged list", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain("btw");
  });

  it("dispose destroys the agent and the client", async () => {
    const { host } = await readyHost();
    await host.dispose();
    expect(lastAgent().destroy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sidebar session tree (FR-020)
// ---------------------------------------------------------------------------

describe("session tree", () => {
  const makeIndexEntry = (
    sessionId: string,
    workdir: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    sessionId,
    title: `Session ${sessionId}`,
    workdir,
    cwd: workdir,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  });

  it("derives groups from the session index (not recents) on webviewReady", async () => {
    const { host, store, sent } = createHost();
    // /work/only-recent is in recents but has no sessions -> must NOT appear as a group.
    // /work/only-index has sessions but is not in recents -> still a group.
    store.addRecentWorkdir({ host: "local", path: "/work/only-recent" });
    store.upsertSession(makeIndexEntry("s1", "/work/a", { createdAt: 1000 }));
    store.upsertSession(makeIndexEntry("s2", "/work/a", { createdAt: 2000 }));
    store.upsertSession(
      makeIndexEntry("s3", "/work/only-index", { createdAt: 3000 }),
    );

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(1);
    });
    const tree = sent("desktopSessionTree").at(-1);
    // Groups ordered by latest session createdAt desc; sessions within a group desc.
    expect(tree?.groups).toEqual([
      {
        host: "local",
        workdir: "/work/only-index",
        sessions: [expect.objectContaining({ sessionId: "s3" })],
      },
      {
        host: "local",
        workdir: "/work/a",
        sessions: [
          expect.objectContaining({ sessionId: "s2" }),
          expect.objectContaining({ sessionId: "s1" }),
        ],
      },
    ]);
    // Fresh-launch auto new-session (spec「会话管理」scenario 2) spawns ONE agent
    // at the most recent directory — /work/only-recent — even though that dir
    // has no index entries; the sidebar tree itself still derives groups from
    // the desktop session index, so /work/only-recent must not appear as a group.
    expect(h.agentInstances).toHaveLength(1);
    expect(lastAgent().currentWorkdir).toBe("/work/only-recent");
  });

  it("shows every session in a group, not a capped subset", async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    for (let i = 0; i < 7; i++) {
      store.upsertSession(
        makeIndexEntry(`s${i}`, "/work/a", { createdAt: Date.now() + i }),
      );
    }

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(1);
    });
    const groups = sent("desktopSessionTree").at(-1)?.groups as Array<{
      sessions: Array<{ sessionId: string }>;
    }>;
    expect(groups[0].sessions).toHaveLength(7);
    // Sorted by createdAt desc — the newest first.
    expect(groups[0].sessions[0].sessionId).toBe("s6");
  });

  it("keeps creation order when activity bumps lastActiveAt", async () => {
    const { host, store, sent } = createHost();
    store.upsertSession(
      makeIndexEntry("s1", "/work/a", { createdAt: 1000, lastActiveAt: 1000 }),
    );
    store.upsertSession(
      makeIndexEntry("s2", "/work/a", { createdAt: 2000, lastActiveAt: 2000 }),
    );

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });
    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(1);
    });

    // Activity on the older session must not move it above the newer one.
    store.touchSession("s1", Date.now() + 5000);
    await host.handleWebviewMessage({ command: "webviewReady" });

    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(2);
    });
    const groups = sent("desktopSessionTree").at(-1)?.groups as Array<{
      sessions: Array<{ sessionId: string }>;
    }>;
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
  });

  it("re-registering an existing session keeps its original createdAt", async () => {
    const { store } = await readyHost();
    store.upsertSession(
      makeIndexEntry("sess-x", "/work/a", {
        createdAt: 1000,
        lastActiveAt: 1000,
      }),
    );

    // The live agent re-registers the same session (sessionIdChange after
    // restore) — creation time must survive while activity time still bumps.
    // A message event marks it as a real conversation first; the id change then
    // re-registers it in the index.
    fireUserMessage(lastAgent());
    fireSessionId(lastAgent(), "sess-x");

    const entry = store.getSessionIndex().find((e) => e.sessionId === "sess-x");
    expect(entry?.createdAt).toBe(1000);
    expect(entry?.lastActiveAt).toBeGreaterThan(1000);
  });

  it("desktopSelectSession on a historical session spawns a fresh agent and restores (FR-031)", async () => {
    const { host } = await readyHost();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-x",
    });

    // Spawn + restore run behind the sweep overlay — both resolve in the background.
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-x");
    });
  });

  it("desktopSelectSession in another directory switches workdir first", async () => {
    const { host, store } = await readyHost();
    store.addRecentWorkdir({ host: "local", path: "/work/b" });
    h.existingPaths.add("/work/b");
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/b",
      sessionId: "sess-y",
    });

    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: "/work/b" }),
      );
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-y");
    });
  });

  it("desktopSelectSession with a gone directory drops the index entry and the recent", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession(makeIndexEntry("sess-z", "/gone"));

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/gone",
      sessionId: "sess-z",
    });

    // The probe + cleanup run in the background behind the optimistic switch.
    await vi.waitFor(() => {
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "sess-z"),
      ).toBe(false);
      expect(store.getRecentWorkdirs()).not.toEqual(
        expect.arrayContaining([{ host: "local", path: "/gone" }]),
      );
      expect(lastAgent().restoreSession).not.toHaveBeenCalled();
      expect(
        shownToasts().some((t) =>
          t.message.includes("已从最近列表与会话列表移除"),
        ),
      ).toBe(true);
      expect(
        sent("appendMessage").filter((m) =>
          JSON.stringify(m).includes("已从最近列表与会话列表移除"),
        ),
      ).toHaveLength(0);
    });
  });

  it("refreshes the tree when a turn ends (touchSessionInIndex)", async () => {
    const { sent } = await readyHost();
    // readyHost leaves the index empty -> no tree posts yet. Seed a session so
    // refreshSessionTree actually emits (an empty index is a no-op post). The
    // sessionIdChange registration only fires for sessions with content.
    seedConversation(lastAgent(), "sess-1");
    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBeGreaterThanOrEqual(1);
    });
    const before = sent("desktopSessionTree").length;

    lastAgent().callbacks.onLoadingChange(false);

    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBe(before + 1);
    });
  });

  it("refreshes the tree when a new session starts (registerSessionInIndex)", async () => {
    const { sent } = await readyHost();
    // readyHost leaves the index empty -> no tree posts yet.
    expect(sent("desktopSessionTree")).toHaveLength(0);

    seedConversation(lastAgent(), "sess-2");

    await vi.waitFor(() => {
      expect(sent("desktopSessionTree").length).toBe(1);
    });
  });

  it("desktopDeleteSession removes from index and refreshes tree", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession(makeIndexEntry("del-1", "/work/a"));
    store.upsertSession(makeIndexEntry("del-2", "/work/a"));

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "del-1",
    });

    await vi.waitFor(() => {
      const tree = sent("desktopSessionTree").at(-1);
      const sessions =
        (tree?.groups as Array<{ sessions: Array<{ sessionId: string }> }>)?.[0]
          ?.sessions ?? [];
      expect(sessions.some((s) => s.sessionId === "del-1")).toBe(false);
      expect(sessions.some((s) => s.sessionId === "del-2")).toBe(true);
    });
  });

  it("desktopDeleteSession on the live session destroys it and returns to a fresh session (FR-031)", async () => {
    const { host, store } = await readyHost();
    lastAgent().callbacks.onSessionIdChange("live-1");
    const doomed = lastAgent();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "live-1",
    });

    expect(doomed.destroy).toHaveBeenCalled();
    expect(store.getSessionIndex().some((e) => e.sessionId === "live-1")).toBe(
      false,
    );
    // A fresh session replaced the deleted active one.
    expect(h.agentInstances).toHaveLength(before + 1);
  });

  it("repro: 终止并删除唯一会话后再次新建对话立即生效（用户反馈「点不动」）", async () => {
    const { host, store } = await readyHost();
    const doomed = lastAgent();
    seedConversation(doomed, "live-1");
    doomed.isStreaming = true;

    // 终止（mock 的 abortMessage 不改变流式态，手动复位模拟真实行为）
    await host.handleWebviewMessage({ command: "abortMessage" });
    doomed.isStreaming = false;

    // 删除唯一会话：pane 释放 → 自动补一个空白新会话（agent C）
    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "live-1",
    });
    await vi.waitFor(() => {
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "live-1"),
      ).toBe(false);
    });
    expect(doomed.destroy).toHaveBeenCalled();

    // 再次新建对话：必须立即生效（不再被空白 agent 的 no-op 守卫拦截），
    // 空白 agent C 被替换销毁，不留孤儿
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({ command: "newSession" });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
  });

  it("desktopDeleteSession on the active session does not clobber a session selected while destroy is in flight", async () => {
    const { host, store, sent } = await readyHost();
    fireSessionId(lastAgent(), "live-1");
    const doomed = lastAgent();
    store.upsertSession(makeIndexEntry("hist-b", "/work/a"));

    // Destroy is slow in the real CLI (telemetry shutdown, MCP/LSP cleanup),
    // so the delete handler stays in flight while the user clicks another session.
    let releaseDestroy: () => void = () => {};
    doomed.destroy.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseDestroy = () => resolve(undefined);
        }),
    );

    const deletePromise = host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "live-1",
    });
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "hist-b",
    });

    releaseDestroy();
    await deletePromise;

    const states = sent("setInitialState");
    const last = states.at(-1);
    expect(last?.session).toMatchObject({ id: "hist-b" });
    expect(last?.messages).toHaveLength(1);
  });

  it("desktopSelectSession on a historical session activates only after restore (no empty-state flash)", async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(makeIndexEntry("hist-1", "/work/a"));
    send.mockClear();

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "hist-1",
    });

    // Optimistic switch: the very first setInitialState already targets the
    // selected session and raises the sweep overlay — no interim empty state.
    const states = sent("setInitialState");
    expect(states[0]?.isRestoring).toBe(true);
    expect(states[0]?.session).toMatchObject({ id: "hist-1" });
    expect(states[0]?.messages).toHaveLength(0);

    // Restore completes in the background: overlay drops, transcript lands.
    await vi.waitFor(() => {
      const last = sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "hist-1" });
      expect(last?.messages).toHaveLength(1);
    });
  });

  it("selecting another session while a restore is in flight supersedes it and discards the stale agent", async () => {
    const { host, sent } = await readyHost();
    const before = h.agentInstances.length;

    // Real stdio startup takes seconds — gate initialize so both restores stay
    // in flight until the second selection has landed.
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-A",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    const staleAgent = lastAgent();
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-B",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 2);
    });
    const winningAgent = lastAgent();

    resolveInit();

    // The superseded restore aborts at the token check and its freshly spawned
    // agent is destroyed, while the winning restore lands in the pane.
    await vi.waitFor(() => {
      expect(staleAgent.destroy).toHaveBeenCalled();
      expect(sent("setInitialState").at(-1)).toMatchObject({
        isRestoring: false,
        session: { id: "sess-B" },
      });
    });
    expect(staleAgent.restoreSession).not.toHaveBeenCalled();
    expect(winningAgent.destroy).not.toHaveBeenCalled();
    expect(winningAgent.restoreSession).toHaveBeenCalledWith("sess-B");
  });

  it("a failed restore drops the overlay, keeps the previous agent, and pushes a system message", async () => {
    const { host, sent } = await readyHost();
    const agent1 = lastAgent(); // sess-1 bound to the sole pane
    const before = h.agentInstances.length;

    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });
    const selectPromise = host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-bad",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    // Parked at initialize — restoreSession hasn't run yet; make it fail.
    const restoreAgent = lastAgent();
    restoreAgent.restoreSession.mockRejectedValueOnce(new Error("boom"));

    resolveInit();
    await selectPromise;

    // The overlay clears and the previous session's state falls back.
    await vi.waitFor(() => {
      const last = sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "sess-1" });
    });
    expect(restoreAgent.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
    expect(agent1.restoreSession).not.toHaveBeenCalled();
    const sysMsgs = sent("appendMessage").filter((m) =>
      JSON.stringify(m).includes("恢复会话失败"),
    );
    expect(sysMsgs).toHaveLength(1);
  });

  it("a restore failing with not-found-on-disk removes the entry and toasts (no raw error in chat)", async () => {
    const { host, store, sent } = await readyHost();
    const agent1 = lastAgent(); // sess-1 bound to the sole pane
    const before = h.agentInstances.length;
    store.upsertSession(makeIndexEntry("gone-2", "/work/a"));

    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });
    const selectPromise = host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "gone-2",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    const restoreAgent = lastAgent();
    restoreAgent.restoreSession.mockRejectedValueOnce(
      new Error("Session gone-2 not found on disk"),
    );

    resolveInit();
    await selectPromise;

    await vi.waitFor(() => {
      // Index entry dropped — the sidebar must not keep a permanently broken
      // session that re-fails on every click (spec「会话记录在磁盘上不存在或中段
      // 损坏」).
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "gone-2"),
      ).toBe(false);
      // A toast explains, and the raw engine error never reaches the chat.
      expect(
        shownToasts().some((t) =>
          t.message.includes("会话记录在磁盘上不存在或已损坏"),
        ),
      ).toBe(true);
      expect(
        sent("appendMessage").filter((m) =>
          JSON.stringify(m).includes("not found on disk"),
        ),
      ).toHaveLength(0);
      expect(
        sent("appendMessage").filter((m) =>
          JSON.stringify(m).includes("恢复会话失败"),
        ),
      ).toHaveLength(0);
      // The pane falls back to the previous agent, not a stuck overlay.
      const last = sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "sess-1" });
    });
    expect(restoreAgent.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
  });

  it("a slow remote directory probe does not delay the pane switch (spec: 动画先于连接建立)", async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(
      makeIndexEntry("rem-1", "/work/remote", { host: "ssh.example" }),
    );
    send.mockClear();

    // The probe rides the host's daemon tunnel (`listDirectories` RPC) — it
    // must not gate the "selected" feedback: park it on the gate and prove
    // the optimistic switch happens first.
    h.dirListGate = true;

    const selectPromise = host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/remote",
      sessionId: "rem-1",
    });

    // The pane switches and the sweep overlay raises while the probe is still
    // in flight.
    await vi.waitFor(() => {
      const first = sent("setInitialState")[0];
      expect(first?.isRestoring).toBe(true);
      expect(first?.session).toMatchObject({ id: "rem-1" });
    });
    await vi.waitFor(() => {
      expect(h.clientRequests.some((r) => r.method === "listDirectories")).toBe(
        true,
      );
    });

    h.dirListRelease?.({ resolvedPath: "/work/remote", dirs: [] });
    h.dirListGate = false;
    await selectPromise;
    await vi.waitFor(() => {
      const last = sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "rem-1" });
      expect(last?.messages).toHaveLength(1);
    });
  });

  it("a vanished remote directory is cleaned up in the background after the switch", async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(
      makeIndexEntry("gone-1", "/work/remote", { host: "ssh.example" }),
    );
    send.mockClear();
    h.dirListResults.push(new Error("目录不存在或不可读：/work/remote"));

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/remote",
      sessionId: "gone-1",
    });

    // The optimistic overlay still raises; once the probe reports the directory
    // is gone, the restore is cancelled, the stale index entry removed, and a
    // system message explains — all behind the switch, never in front of it.
    await vi.waitFor(() => {
      const states = sent("setInitialState");
      expect(states.some((s) => s?.isRestoring === true)).toBe(true);
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "gone-1"),
      ).toBe(false);
      const toasts = shownToasts().filter((t) =>
        t.message.includes("目录不存在"),
      );
      expect(toasts).toHaveLength(1);
      expect(
        sent("appendMessage").filter((m) =>
          JSON.stringify(m).includes("目录不存在"),
        ),
      ).toHaveLength(0);
      expect(states.at(-1)?.isRestoring).toBe(false);
    });
  });

  it("keeps the session index entry when the remote host is unreachable", async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(
      makeIndexEntry("down-1", "/work/remote", { host: "ssh.example" }),
    );
    send.mockClear();
    // A dead host is a transport failure, not a vanished directory — the
    // probe must NOT clean up the session (desktop-sessions.md「远端主机不可
    // 达时不得删除会话/最近目录」).
    h.dirListResults.push(
      new Error("ssh: connect to host ssh.example port 22: Connection refused"),
    );

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/remote",
      sessionId: "down-1",
    });

    await vi.waitFor(() => {
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "down-1"),
      ).toBe(true);
      expect(
        shownToasts().some((t) =>
          t.message.includes("无法连接主机 ssh.example"),
        ),
      ).toBe(true);
      expect(shownToasts().some((t) => t.message.includes("目录不存在"))).toBe(
        false,
      );
      // Overlay drops and the previous session's state falls back.
      expect(sent("setInitialState").at(-1)).toMatchObject({
        isRestoring: false,
        session: { id: "sess-1" },
      });
    });
  });

  it("keeps a recent workdir when its remote host is unreachable", async () => {
    const { host, store, send } = await readyHost();
    store.addRecentWorkdir({ host: "ssh.example", path: "/work/remote" });
    send.mockClear();
    h.dirListResults.push(new Error("host down"));

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      host: "ssh.example",
      path: "/work/remote",
    });

    expect(
      store.getRecentWorkdirs().some((r) => r.path === "/work/remote"),
    ).toBe(true);
    expect(
      shownToasts().some((t) => t.message.includes("无法连接主机 ssh.example")),
    ).toBe(true);
    expect(
      shownToasts().some((t) => t.message.includes("已从最近列表移除")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /resume disk session picker (desktop-sessions.md「跨客户端会话来源」)
// ---------------------------------------------------------------------------

describe("/resume disk sessions", () => {
  const diskSession = (id: string, workdir: string) => ({
    id,
    workdir,
    firstMessage: "历史会话的第一条消息",
    createdAt: 1000,
    lastActiveAt: 2000,
    branch: "main",
  });

  it("lists every project on disk (sessions the app never created) and replies with them", async () => {
    const { host, sent } = await readyHost();
    h.allSessions = [
      diskSession("cli-1", "/other/project"),
      diskSession("cli-2", "/another/project"),
    ];

    await host.handleWebviewMessage({
      command: "desktopListResumeSessions",
      requestId: "req-1",
    });

    const reply = sent("desktopResumeSessions").at(-1);
    expect(reply).toMatchObject({ requestId: "req-1" });
    expect(reply?.sessions).toEqual(h.allSessions);
    // The disk list, not the desktop-owned index (FR-024).
    expect(h.clientRequests.some((r) => r.method === "listAllSessions")).toBe(
      true,
    );
  });

  it("surfaces an RPC failure as a toast plus an error reply (never a silent empty list)", async () => {
    const { host, sent } = await readyHost();
    const restore = failRpc("listAllSessions", "listAllSessions failed");

    await host.handleWebviewMessage({
      command: "desktopListResumeSessions",
      requestId: "req-2",
    });
    restore();

    expect(sent("desktopResumeSessions").at(-1)).toMatchObject({
      requestId: "req-2",
      error: "listAllSessions failed",
    });
    expect(
      shownToasts().some((t) =>
        t.message.includes("无法读取会话列表：listAllSessions failed"),
      ),
    ).toBe(true);
  });

  it("switches to an index-outside session at its own workdir and registers it", async () => {
    const { host, store } = await readyHost();
    h.existingPaths.add("/other/project");
    expect(store.getSessionIndex().some((e) => e.sessionId === "cli-1")).toBe(
      false,
    );

    await host.handleWebviewMessage({
      command: "desktopResumeSession",
      sessionId: "cli-1",
      workdir: "/other/project",
    });

    // Spawn + restore run behind the sweep overlay.
    await vi.waitFor(() => {
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: "/other/project" }),
      );
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("cli-1");
      // Registering the foreign session makes it durable in the sidebar/board.
      const entry = store
        .getSessionIndex()
        .find((e) => e.sessionId === "cli-1");
      expect(entry?.workdir).toBe("/other/project");
    });
  });

  it("resumes an indexed session at its own cwd, never at the group's repo root", async () => {
    const { host, store } = await readyHost();
    // Indexed worktree session: the sidebar group is the repo root while the
    // session itself lives in the worktree. The index entry is what this app
    // has been maintaining, so it wins over whatever workdir a caller passes.
    store.upsertSession({
      sessionId: "wt-1",
      title: "Worktree session",
      host: "local",
      workdir: "/repo",
      cwd: "/repo/.wave/worktrees/feat",
      createdAt: 1000,
      lastActiveAt: 2000,
      worktree: {
        path: "/repo/.wave/worktrees/feat",
        branch: "wave-worktree-feat",
        baseBranch: "main",
        repoRoot: "/repo",
      },
    });
    h.existingPaths.add("/repo");
    h.existingPaths.add("/repo/.wave/worktrees/feat");

    await host.handleWebviewMessage({
      command: "desktopResumeSession",
      sessionId: "wt-1",
      workdir: "/repo",
    });

    await vi.waitFor(() => {
      // Spawned at the entry's own cwd (the worktree), not at the workdir the
      // caller passed — otherwise the resumed conversation would land in the
      // repo root even though its transcript lives in the worktree.
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: "/repo/.wave/worktrees/feat" }),
      );
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("wt-1");
    });
  });

  it("groups a resumed worktree session under its repo root (no index entry)", async () => {
    const { host, store, sent } = await readyHost();
    const worktreePath = "/repo/.wave/worktrees/feat";
    h.existingPaths.add(worktreePath);
    // The CLI derives the repo root from the session root; the desktop has no
    // entry for a session it never created, so this is its only source.
    h.sessionRepoRootReply = "/repo";

    await host.handleWebviewMessage({
      command: "desktopResumeSession",
      sessionId: "cli-wt-1",
      workdir: worktreePath,
    });

    await vi.waitFor(() => {
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("cli-wt-1");
      const entry = store
        .getSessionIndex()
        .find((e) => e.sessionId === "cli-wt-1");
      // Sidebar group = repo root (what a new worktree conversation shows),
      // while the session still runs inside the worktree itself.
      expect(entry?.workdir).toBe("/repo");
      expect(entry?.cwd).toBe(worktreePath);
      expect(sent("desktopSessionTree").at(-1)?.groups).toEqual([
        expect.objectContaining({ workdir: "/repo" }),
      ]);
    });
  });

  it("refuses a session whose directory is gone (no switch, no index change)", async () => {
    const { host, store } = await readyHost();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopResumeSession",
      sessionId: "cli-1",
      workdir: "/gone",
    });

    expect(
      shownToasts().some((t) =>
        t.message.includes("该会话的目录已不存在：/gone"),
      ),
    ).toBe(true);
    expect(h.agentInstances).toHaveLength(before);
    expect(store.getSessionIndex().some((e) => e.sessionId === "cli-1")).toBe(
      false,
    );
  });

  it("refuses the switch when the conversation's host is unreachable", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    const before = h.agentInstances.length;
    // An unreachable host says nothing about the directory — the probe must not
    // be read as "missing" (desktop-sessions.md「远端主机不可达时不得删除会话」).
    h.dirListResults.push(new Error("host down"));

    await host.handleWebviewMessage({
      command: "desktopResumeSession",
      sessionId: "cli-1",
      workdir: "/work/remote",
    });

    expect(
      shownToasts().some((t) =>
        t.message.includes("无法连接主机 prod，会话未切换，可稍后重试"),
      ),
    ).toBe(true);
    expect(shownToasts().some((t) => t.message.includes("目录已不存在"))).toBe(
      false,
    );
    expect(h.agentInstances).toHaveLength(before);
    expect(
      sent("setInitialState").some((s) => s?.session?.id === "cli-1"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// session switch shortcut (FR-038)
// ---------------------------------------------------------------------------

describe("session switch shortcut (FR-038)", () => {
  const entry = (sessionId: string, workdir: string, createdAt: number) => ({
    sessionId,
    title: `Session ${sessionId}`,
    workdir,
    cwd: workdir,
    createdAt,
    lastActiveAt: createdAt,
  });

  // Seeds s1/s2 in /work/a + s3 in /work/b (all dirs exist), then runs the
  // ready flow so the tree is derived. Flattened order: s3 (the /work/b group
  // leads — its session is the latest created overall), then s2, s1.
  async function hostWithTree() {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    h.existingPaths.add("/work/b");
    ctx.store.upsertSession(entry("s1", "/work/a", 1000));
    ctx.store.upsertSession(entry("s2", "/work/a", 2000));
    ctx.store.upsertSession(entry("s3", "/work/b", 3000));
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });
    return ctx;
  }

  it("cycles through the flattened tree across directories and wraps around", async () => {
    const { host, sent } = await hostWithTree();

    // Restores are optimistic (fire-and-forget) — wait for each one to fully
    // land (overlay dropped, session active) before the next press, otherwise
    // the token guard supersedes the in-flight restore by design.
    const waitActive = async (sessionId: string) => {
      await vi.waitFor(() => {
        const last = sent("setInitialState").at(-1);
        expect(last?.isRestoring).toBe(false);
        expect(last?.session).toMatchObject({ id: sessionId });
      });
    };

    // No current session: next lands on the first entry (s3, leading group).
    await host.activateAdjacentSession(1);
    await waitActive("s3");
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/b" }),
    );

    // s3 → s2: the cycle crosses directory groups (back to /work/a).
    await host.activateAdjacentSession(1);
    await waitActive("s2");
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );

    // s2 → s1.
    await host.activateAdjacentSession(1);
    await waitActive("s1");

    // s1 is the last entry: next wraps to s3, whose agent is still live —
    // activated in place, no new spawn and no restore.
    const before = h.agentInstances.length;
    await host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s3",
      });
    });

    // s3 is the first entry: prev wraps to the last entry (s1, also live).
    await host.activateAdjacentSession(-1);
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s1",
      });
    });
  });

  it("drops the frozen cycle order when the session changes outside the cycle", async () => {
    const { host, sent } = await hostWithTree();
    await host.activateAdjacentSession(1); // s3, snapshot frozen at [s3, s2, s1]
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)?.isRestoring).toBe(false);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s3",
      });
    });

    // Clicking s2 (outside the cycle) drops the frozen snapshot — the next
    // press re-derives from the (creation-ordered, stable) tree.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "s2",
    });
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)?.isRestoring).toBe(false);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s2",
      });
    });

    // The stale snapshot would cycle onto the already-current s2 (a no-op);
    // the fresh order [s3, s2, s1] starts after s2 and lands on s1 instead.
    await host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("s1");
    });
  });

  it("deleting a session drops it from the cycle — Ctrl+Tab must not resurrect it", async () => {
    const { host, store, sent } = await hostWithTree();
    await host.activateAdjacentSession(1); // s3, snapshot frozen at [s3, s2, s1]
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)?.isRestoring).toBe(false);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s3",
      });
    });

    // Delete s2 — a historical session that is NOT the focused pane's current
    // one. The frozen snapshot (whose invalidation only fires on a current
    // session change) must not keep it selectable.
    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "s2",
    });
    await vi.waitFor(() => {
      expect(store.getSessionIndex().some((e) => e.sessionId === "s2")).toBe(
        false,
      );
    });

    // Continue cycling: the fresh order [s3, s1] steps from s3 to s1. The
    // stale snapshot would instead step onto the deleted s2 and re-restore it.
    await host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)?.isRestoring).toBe(false);
      expect(sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s1",
      });
    });

    // The deleted session was never restored or re-registered.
    expect(
      h.agentInstances.some((a) =>
        (a.restoreSession as ReturnType<typeof vi.fn>).mock.calls.some(
          ([id]) => id === "s2",
        ),
      ),
    ).toBe(false);
    expect(store.getSessionIndex().some((e) => e.sessionId === "s2")).toBe(
      false,
    );
  });

  it("deleting a session mid-restore cancels the restore (spec 恢复加载期间删除会话)", async () => {
    const { host, store, sent } = await hostWithTree();
    // Park the restore's agent at initialize so the delete can land mid-flight.
    let releaseInit: () => void = () => {};
    h.initializeGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const before = h.agentInstances.length;

    await host.activateAdjacentSession(1); // starts restoring s3, parked
    await vi.waitFor(() => {
      expect(h.agentInstances.length).toBe(before + 1);
    });

    // Delete s3 while its restore is still in flight.
    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "s3",
    });
    await vi.waitFor(() => {
      expect(store.getSessionIndex().some((e) => e.sessionId === "s3")).toBe(
        false,
      );
    });

    releaseInit();
    // The restore completes past initialize but must discard the agent and
    // never land the deleted session (it stays on the pane's previous agent).
    await vi.waitFor(() => {
      const restoredAgent = h.agentInstances.at(-1);
      expect(restoredAgent?.destroy).toHaveBeenCalled();
      expect(store.getSessionIndex().some((e) => e.sessionId === "s3")).toBe(
        false,
      );
    });
    expect(sent("setInitialState").at(-1)?.session?.id).not.toBe("s3");
  });

  it("is a no-op on an empty tree", async () => {
    const { host } = createHost();
    await host.activateAdjacentSession(1);
    await host.activateAdjacentSession(-1);
    expect(h.agentInstances).toHaveLength(0);
  });

  it("is a no-op when the tree holds only the current session", async () => {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    ctx.store.upsertSession(entry("s1", "/work/a", 1000));
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });

    await ctx.host.activateAdjacentSession(1); // activates s1
    // Settle first: until the restore lands, the pane still shows the fresh
    // agent (sessionId sess-1) and a press would restart the restore.
    await vi.waitFor(() => {
      expect(ctx.sent("setInitialState").at(-1)?.isRestoring).toBe(false);
      expect(ctx.sent("setInitialState").at(-1)?.session).toMatchObject({
        id: "s1",
      });
    });
    const before = h.agentInstances.length;
    const restores = lastAgent().restoreSession.mock.calls.length;

    await ctx.host.activateAdjacentSession(1);
    await ctx.host.activateAdjacentSession(-1);
    expect(h.agentInstances).toHaveLength(before);
    expect(lastAgent().restoreSession.mock.calls.length).toBe(restores);
  });

  it("treats a fresh unregistered session as outside the tree (next → first entry)", async () => {
    const { host, store } = await readyHost(); // active agent, empty index/tree
    store.upsertSession(entry("s9", "/work/a", 5000));
    store.upsertSession(entry("s8", "/work/a", 4000));
    // Re-derive the tree (webviewReady refreshes it without a new agent).
    await host.handleWebviewMessage({ command: "webviewReady" });

    await host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("s9");
    });
  });

  it("drops a stale-directory entry encountered while cycling (same as clicking it)", async () => {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    ctx.store.upsertSession(entry("s1", "/work/a", 1000));
    ctx.store.upsertSession(entry("s2", "/gone", 3000)); // /gone leads the tree
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });
    // The fresh-launch auto new-session agent is bound to the pane at /work/a;
    // cycling must drop the stale /gone entry WITHOUT spawning any restore agent.
    const autoAgents = h.agentInstances.length;
    expect(autoAgents).toBe(1);

    await ctx.host.activateAdjacentSession(1);
    // 目录探测在遮罩后面异步跑（本地也是 existsSync 之后的一个微任务），断言要
    // 等它落地，不能赌微任务顺序。
    await vi.waitFor(() => {
      expect(
        ctx.store.getSessionIndex().some((e) => e.sessionId === "s2"),
      ).toBe(false);
    });
    expect(h.agentInstances).toHaveLength(autoAgents);
    expect(
      shownToasts().some((t) =>
        t.message.includes("已从最近列表与会话列表移除"),
      ),
    ).toBe(true);
    expect(
      ctx
        .sent("appendMessage")
        .filter((m) =>
          JSON.stringify(m).includes("已从最近列表与会话列表移除"),
        ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// worktree flow (FR-022..FR-025)
// ---------------------------------------------------------------------------

describe("worktree flow", () => {
  const worktree = {
    name: "gentle-pike-147",
    path: "/work/a/.wave/worktrees/gentle-pike-147",
    branch: "worktree-gentle-pike-147",
    baseBranch: "main",
    repoRoot: "/work/a",
    isNew: true,
  };

  it("desktopListGitBranches pushes the branch list", async () => {
    const { host, sent } = await readyHost();
    h.branchesResult = { branches: ["main", "dev"], current: "main" };

    await host.handleWebviewMessage({
      command: "desktopListGitBranches",
      workdir: "/work/a",
    });

    const msg = sent("desktopGitBranches").at(-1);
    expect(msg).toMatchObject({
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "main" },
    });
  });

  it("desktopListGitBranches on a non-git dir pushes result null", async () => {
    const { host, sent } = await readyHost();
    h.branchesResult = null;

    await host.handleWebviewMessage({
      command: "desktopListGitBranches",
      workdir: "/work/a",
    });

    const msg = sent("desktopGitBranches").at(-1);
    expect(msg).toMatchObject({ workdir: "/work/a", result: null });
  });

  it("desktopCreateWorktree destroys the empty agent it replaces instead of leaking it in the pool", async () => {
    const { host } = await readyHost();
    const replaced = lastAgent(); // the fresh empty agent bound to the pane
    expect(await replaced.getMessages()).toEqual([]);
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });

    expect(lastAgent()).not.toBe(replaced);
    expect(replaced.destroy).toHaveBeenCalledTimes(1);
  });

  it("desktopListGitBranches arriving before the stdio client is ready waits for init instead of replying null", async () => {
    // Fresh-launch sequence: the webview's branch query (mount effect) lands
    // before webviewReady has spawned the stdio client. It must await the
    // client init, otherwise the reply is null and the webview never re-queries
    // — the branch/worktree controls stay hidden until the user re-picks a
    // workdir.
    const { host, sent } = createHost();
    h.branchesResult = { branches: ["main", "dev"], current: "main" };

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopListGitBranches",
      workdir: "/work/a",
    });

    const msg = sent("desktopGitBranches").at(-1);
    expect(msg).toMatchObject({
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "main" },
    });
  });

  it("desktopCreateWorktree switches workdir into the worktree", async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "dev",
    });

    expect(h.clientRequests).toContainEqual({
      method: "createWorktree",
      params: { workdir: "/work/a", baseBranch: "dev", name: undefined },
    });
    expect(h.agentInstances).toHaveLength(before + 1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: worktree.path,
        worktreeName: worktree.name,
        isNewWorktree: true,
      }),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: worktree.path,
    });
    // FR-023: recents record the repo root, never the ephemeral worktree path.
    expect(store.getRecentWorkdirs()).toEqual(
      expect.arrayContaining([{ host: "local", path: "/work/a" }]),
    );
    expect(store.getRecentWorkdirs()).not.toEqual(
      expect.arrayContaining([{ host: "local", path: worktree.path }]),
    );
    // The ack ends the webview's "worktree 创建中" state on the pane that
    // started the creation.
    expect(sent("desktopWorktreeCreated").at(-1)).toMatchObject({
      paneId: "pane-1",
    });
  });

  it("desktopCreateWorktree with a first message forwards it after the switch", async () => {
    const { host } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "main",
      text: "hello worktree",
    });

    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: worktree.path }),
    );
    expect(lastAgent().sendMessage).toHaveBeenCalledWith(
      "hello worktree",
      undefined,
      false,
    );
  });

  it("desktopCreateWorktree acks before the first message's AI turn finishes", async () => {
    const { host, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });

    const done = host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "main",
      text: "hello worktree",
    });
    // Pause agent initialization so we can swap in a sendMessage that stays
    // open — mirroring the real RPC, which resolves only when the whole AI
    // turn finishes (InteractionService awaits sendAIMessage).
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(2);
    });
    const spawned = lastAgent();
    let releaseSend!: () => void;
    const sendHeld = new Promise<void>((r) => {
      releaseSend = r;
    });
    spawned.sendMessage = vi.fn(async () => {
      await sendHeld;
    });

    h.initializeGate = null;
    resolveInit();
    // The worktree is created and the session is live — the ack must already
    // be out even though the forwarded first message is still in flight.
    await vi.waitFor(() => {
      expect(sent("desktopWorktreeCreated").at(-1)).toMatchObject({
        paneId: "pane-1",
      });
    });
    expect(spawned.sendMessage).toHaveBeenCalledWith(
      "hello worktree",
      undefined,
      false,
    );

    releaseSend();
    await done;
  });

  it("desktopCreateWorktree on an existing worktree (isNew: false) does not mark it new", async () => {
    const { host } = await readyHost();
    h.worktreeResult = { ...worktree, isNew: false };
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      name: worktree.name,
    });

    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: worktree.path,
        worktreeName: worktree.name,
        isNewWorktree: false,
      }),
    );
  });

  it("new session after a worktree session starts in the repo root, not the worktree path (FR-005)", async () => {
    const { host, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });
    fireUserMessage(lastAgent());

    await host.handleWebviewMessage({ command: "newSession" });

    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: "/work/a",
    });
  });

  it("new session in a new pane (Cmd/Ctrl+Click) after a worktree session spawns at the repo root", async () => {
    const { host, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });
    // After the worktree session activates, host.workdir is the worktree path,
    // but recents[0] is still the repo root — a new pane must spawn at the repo
    // root, never at the worktree path.
    fireUserMessage(lastAgent());

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: "/work/a",
    });
  });

  it("a repeat webviewReady while the new pane's agent is still mid-spawn does not spawn a worktree-path agent (no leak via this.workdir)", async () => {
    const { host, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });
    // After the worktree session activates, host.workdir follows it = the worktree path.
    fireUserMessage(lastAgent());

    // Real stdio startup takes seconds — gate the next spawn's initialize() so
    // the new pane stays empty (agent created but not yet bound) while the
    // webview re-fires webviewReady when the pane mounts.
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });
    const spawnPromise = host.handleWebviewMessage({
      command: "desktopNewSessionInPane",
    });
    // Let handleNewSessionInNewPane progress into the awaiting initialize().
    await vi.waitFor(() => {
      expect(
        (
          h.agentInstances.at(-1) as {
            initialize?: { mock?: { calls: unknown[][] } };
          }
        )?.initialize?.mock?.calls?.length,
      ).toBeGreaterThan(0);
    });
    const agentCountBefore = h.agentInstances.length;
    // The focused pane is the new empty pane (no agent yet), but pane-1 still
    // holds the worktree agent — handleWebviewReady must NOT read !this.activeAgent
    // as "no agent at all" and spawn yet another agent at this.workdir (worktree).
    // Fire (don't await): a repeat webviewReady's spawn would also hit the gate and hang.
    void host.handleWebviewMessage({ command: "webviewReady" });
    // Flush microtasks so the repeat webviewReady's spawnAgent progresses past the
    // cached ensureClient to createAgent, which would push a new instance if the leak path fires.
    await new Promise((r) => setImmediate(r));
    expect(h.agentInstances).toHaveLength(agentCountBefore);

    resolveInit(); // let the original repo-root spawn finish
    await spawnPromise;
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: "/work/a",
    });
  });

  it("desktopCreateWorktree failure pushes a system message and keeps the workdir", async () => {
    const { host, sent } = await readyHost();
    h.worktreeError = new Error("branch already exists");
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "dev",
      text: "never sent",
    });

    expect(h.agentInstances).toHaveLength(before);
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: "/work/a",
    });
    const sysMsgs = sent("appendMessage").filter((m) =>
      JSON.stringify(m).includes("创建 worktree 失败"),
    );
    expect(sysMsgs).toHaveLength(1);
    // Failure also ends the "worktree 创建中" state.
    expect(sent("desktopWorktreeCreated").at(-1)).toMatchObject({
      paneId: "pane-1",
    });
  });

  it("registers the worktree session under the repo root with cwd = worktree path", async () => {
    const { host, store } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });
    seedConversation(lastAgent(), "sess-wt");

    const entry = store
      .getSessionIndex()
      .find((e) => e.sessionId === "sess-wt");
    expect(entry).toMatchObject({
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch,
        repoRoot: worktree.repoRoot,
      },
    });
  });

  it("desktopSelectSession on a worktree session switches to entry.cwd", async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: worktree.repoRoot,
      sessionId: "sess-wt",
    });

    expect(h.agentInstances).toHaveLength(before + 1);
    await vi.waitFor(() => {
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: worktree.path }),
      );
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-wt");
    });
  });

  it("restoring a worktree session keeps it grouped under the repo root", async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: worktree.repoRoot,
      sessionId: "sess-wt",
    });
    // The real CLI emits sessionIdChange after restore — it must not clobber
    // the index entry or pollute recents with the ephemeral worktree path.
    lastAgent().callbacks.onSessionIdChange("sess-wt");

    const entry = store
      .getSessionIndex()
      .find((e) => e.sessionId === "sess-wt");
    expect(entry).toMatchObject({
      workdir: worktree.repoRoot,
      cwd: worktree.path,
    });
    expect(entry?.worktree?.repoRoot).toBe(worktree.repoRoot);
    expect(store.getRecentWorkdirs()).not.toEqual(
      expect.arrayContaining([{ host: "local", path: worktree.path }]),
    );
  });

  it("desktopSelectSession with a gone worktree drops the index entry only", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });
    // worktree.path NOT added to existingPaths — removed externally.

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: worktree.repoRoot,
      sessionId: "sess-wt",
    });

    // The probe + cleanup run in the background behind the optimistic switch.
    await vi.waitFor(() => {
      expect(
        store.getSessionIndex().some((e) => e.sessionId === "sess-wt"),
      ).toBe(false);
      // Repo root stays in recents — only the stale index entry is dropped.
      expect(store.getRecentWorkdirs()).toEqual(
        expect.arrayContaining([{ host: "local", path: "/work/a" }]),
      );
      expect(lastAgent().restoreSession).not.toHaveBeenCalled();
      expect(
        shownToasts().some((t) => t.message.includes("worktree 目录不存在")),
      ).toBe(true);
      expect(
        sent("appendMessage").filter((m) =>
          JSON.stringify(m).includes("worktree 目录不存在"),
        ),
      ).toHaveLength(0);
    });
  });

  it("desktopGetWorktreeChanges answers with the worktree's loss summary", async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeChangesResult = { files: 2, commits: 1 };
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });

    await host.handleWebviewMessage({
      command: "desktopGetWorktreeChanges",
      sessionId: "sess-wt",
      requestId: "req-1",
    });

    expect(h.clientRequests).toContainEqual({
      method: "getWorktreeChanges",
      params: { path: worktree.path, baseBranch: "main" },
    });
    expect(sent("desktopWorktreeChanges")).toEqual([
      expect.objectContaining({
        sessionId: "sess-wt",
        requestId: "req-1",
        changes: { files: 2, commits: 1 },
      }),
    ]);
  });

  it("desktopGetWorktreeChanges reports null when the check fails", async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeChangesError = new Error("Host unreachable");
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });

    await host.handleWebviewMessage({
      command: "desktopGetWorktreeChanges",
      sessionId: "sess-wt",
      requestId: "req-2",
    });

    // Unknown, not clean: the webview falls back to a generic warning and the
    // deletion itself is never blocked by an unreachable host.
    expect(sent("desktopWorktreeChanges")).toEqual([
      expect.objectContaining({ requestId: "req-2", changes: null }),
    ]);
  });

  it("desktopGetWorktreeChanges answers null for a non-worktree session", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: "sess-plain",
      title: "plain",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await host.handleWebviewMessage({
      command: "desktopGetWorktreeChanges",
      sessionId: "sess-plain",
      requestId: "req-3",
    });

    expect(
      h.clientRequests.some((r) => r.method === "getWorktreeChanges"),
    ).toBe(false);
    expect(sent("desktopWorktreeChanges")).toEqual([
      expect.objectContaining({ requestId: "req-3", changes: null }),
    ]);
  });

  it("desktopDeleteSession on a worktree session requests removeWorktree", async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "sess-wt",
    });

    expect(store.getSessionIndex().some((e) => e.sessionId === "sess-wt")).toBe(
      false,
    );
    expect(h.clientRequests).toContainEqual({
      method: "removeWorktree",
      params: {
        path: worktree.path,
        branch: worktree.branch,
        repoRoot: worktree.repoRoot,
      },
    });
  });

  it("logs a failed removeWorktree request instead of swallowing it", async () => {
    const { host, store } = await readyHost();
    h.removeWorktreeError = new Error("Host unreachable");
    store.upsertSession({
      sessionId: "sess-wt-fail",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "sess-wt-fail",
    });

    // consoleSpies[1] is the console.warn spy installed in beforeEach — the
    // request failing here used to be an empty catch, leaving no trace at all
    // of why a worktree directory survived the session delete.
    await vi.waitFor(() => expect(consoleSpies[1]).toHaveBeenCalled());
    const logged = consoleSpies[1].mock.calls
      .map((c) => c.join(" "))
      .join("\n");
    expect(logged).toContain(worktree.path);
    expect(logged).toContain("Host unreachable");
  });

  it("desktopDeleteSession refreshes the tree without waiting for worktree removal", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: "sess-wt-slow",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });
    // A second surviving session keeps the tree non-empty after the delete,
    // so refreshSessionTree actually posts an update.
    store.upsertSession({
      sessionId: "sess-keep",
      title: "keep",
      workdir: worktree.repoRoot,
      cwd: worktree.repoRoot,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    // Block the removeWorktree RPC — the delete must not wait for it. If the
    // handler awaited removal, the await below would hang until test timeout.
    let releaseRemoval: () => void = () => {};
    h.removeWorktreeGate = new Promise<void>((resolve) => {
      releaseRemoval = () => resolve();
    });

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "sess-wt-slow",
    });

    expect(
      store.getSessionIndex().some((e) => e.sessionId === "sess-wt-slow"),
    ).toBe(false);
    const tree = sent("desktopSessionTree").at(-1);
    expect(JSON.stringify(tree).includes("sess-wt-slow")).toBe(false);
    // Removal was still kicked off in the background.
    expect(h.clientRequests).toContainEqual({
      method: "removeWorktree",
      params: {
        path: worktree.path,
        branch: worktree.branch,
        repoRoot: worktree.repoRoot,
      },
    });
    releaseRemoval();
  });

  it("desktopDeleteSession on the live worktree session switches back to the repo root first", async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "main",
    });
    seedConversation(lastAgent(), "live-wt");

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "live-wt",
    });

    // Agent moved back to the repo root before the worktree was removed.
    expect(lastAgent().initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      workdir: "/work/a",
    });
    expect(h.clientRequests).toContainEqual({
      method: "removeWorktree",
      params: {
        path: worktree.path,
        branch: worktree.branch,
        repoRoot: worktree.repoRoot,
      },
    });
    expect(store.getSessionIndex().some((e) => e.sessionId === "live-wt")).toBe(
      false,
    );
  });

  it("desktopDeleteSession removes the worktree only after the agent is destroyed", async () => {
    const { host, store } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
      baseBranch: "main",
    });
    const wtAgent = lastAgent();
    seedConversation(wtAgent, "live-wt");

    // Gate the agent's destroy so the ordering is observable: removeWorktree
    // must not be requested until destroy resolves. This reproduces the race
    // where a fast `git worktree remove` deletes the agent's cwd before the
    // slow Agent.destroy() reaches saveSession (which realpath's the workdir).
    let releaseDestroy = () => {};
    wtAgent.destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDestroy = () => resolve();
        }),
    );

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "live-wt",
    });

    // destroy is still pending — removeWorktree must NOT have been requested yet.
    expect(h.clientRequests.some((r) => r.method === "removeWorktree")).toBe(
      false,
    );

    releaseDestroy();
    // destroy resolves → the chained removeWorktree runs now.
    await vi.waitFor(() => {
      expect(h.clientRequests).toContainEqual({
        method: "removeWorktree",
        params: {
          path: worktree.path,
          branch: worktree.branch,
          repoRoot: worktree.repoRoot,
        },
      });
    });

    expect(store.getSessionIndex().some((e) => e.sessionId === "live-wt")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// theme switching & preference (FR-018/FR-019 + 设置页「主题」三态)
// ---------------------------------------------------------------------------

describe("theme", () => {
  it("pushes the resolved effective theme at startup as a window-level message", async () => {
    // 主题（生效值 + 选中态）是窗口级数据：随 pushAppLevelState 未打标签下发，
    // 渲染设置页的 root 实例才收得到（FR-018 首帧应用 + FR-019）。
    const { sent } = await readyHost();
    const changes = sent("desktopThemeChange");
    expect(changes[changes.length - 1]).toMatchObject({ effective: "light" });
    expect(changes[changes.length - 1]).not.toHaveProperty("paneId");
    const sources = sent("desktopThemeSource");
    expect(sources[sources.length - 1]).toMatchObject({ source: "system" });
  });

  it("getInitialEffectiveTheme follows the OS appearance (FR-019)", async () => {
    const { host } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });
    // Light OS → light.
    expect(host.getInitialEffectiveTheme()).toBe("light");

    nativeTheme.__setSystemDark(true);
    expect(host.getInitialEffectiveTheme()).toBe("dark");
  });

  it("posts desktopThemeChange when the OS appearance flips", async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });

    nativeTheme.__setSystemDark(true);
    const changes = sent("desktopThemeChange");
    expect(changes[changes.length - 1]).toMatchObject({ effective: "dark" });
  });

  it("dispose unsubscribes from nativeTheme updates", async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.dispose();

    const before = sent("desktopThemeChange").length;
    nativeTheme.__setSystemDark(true);
    expect(sent("desktopThemeChange").length).toBe(before);
  });

  it("applies a persisted theme preference at construction (首帧即按所选主题)", async () => {
    // 预置磁盘偏好（固定深色），再启动 host —— 构造时须应用到 nativeTheme，
    // 使首帧与启动时的窗口级广播都呈现深色，即使系统外观为浅色。
    new ConfigStore(STORE_PATH).setThemeSource("dark");
    const { host, sent } = await readyHost();

    expect(host.getInitialEffectiveTheme()).toBe("dark");
    const changes = sent("desktopThemeChange");
    expect(changes[changes.length - 1]).toMatchObject({ effective: "dark" });
    const sources = sent("desktopThemeSource");
    expect(sources[sources.length - 1]).toMatchObject({ source: "dark" });
  });

  it("setThemeSource persists, applies to nativeTheme and broadcasts both messages", async () => {
    const { host, store, sent } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });

    await host.handleWebviewMessage({
      command: "setThemeSource",
      source: "light",
    });
    expect(store.getThemeSource()).toBe("light");
    expect(nativeTheme.themeSource).toBe("light");
    const sourceMessages = sent("desktopThemeSource");
    expect(sourceMessages[sourceMessages.length - 1]).toMatchObject({
      source: "light",
    });
    const changes = sent("desktopThemeChange");
    expect(changes[changes.length - 1]).toMatchObject({ effective: "light" });

    // 固定浅色时不跟随系统外观（spec 场景 4）
    nativeTheme.__setSystemDark(true);
    expect(host.getInitialEffectiveTheme()).toBe("light");

    // 切回「跟随系统」→ 恢复 OS 外观驱动（此时系统为暗色）
    await host.handleWebviewMessage({
      command: "setThemeSource",
      source: "system",
    });
    expect(store.getThemeSource()).toBe("system");
    expect(host.getInitialEffectiveTheme()).toBe("dark");
    const sourcesBack = sent("desktopThemeSource");
    expect(sourcesBack[sourcesBack.length - 1]).toMatchObject({
      source: "system",
    });
  });

  it("setThemeSource ignores malformed sources (falls back to system)", async () => {
    const { host, store } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });

    await host.handleWebviewMessage({
      command: "setThemeSource",
      source: "neon",
    });
    expect(store.getThemeSource()).toBe("system");
    expect(nativeTheme.themeSource).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// multi-session parallel (FR-031)
// ---------------------------------------------------------------------------

describe("context usage across conversation switches", () => {
  const entry = (sessionId: string, createdAt: number) => ({
    sessionId,
    title: `Session ${sessionId}`,
    host: "local",
    workdir: "/work/a",
    cwd: "/work/a",
    createdAt,
    lastActiveAt: createdAt,
  });

  /** desktopReady + webviewReady with a ready-to-select index of /work/a. */
  async function hostWithTree(
    ...sessions: Array<{ sessionId: string; createdAt: number }>
  ) {
    const ctx = createHost();
    ctx.store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    for (const s of sessions)
      ctx.store.upsertSession(entry(s.sessionId, s.createdAt));
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });
    return ctx;
  }

  it("keeps the usage of a restored session whose replay landed mid-restore (no pane bound yet)", async () => {
    const ctx = await hostWithTree({ sessionId: "sess-x", createdAt: 3000 });
    // Hold the restore mid-initialize: the spawned agent exists but is not yet
    // bound to any pane — exactly when the CLI's usage replay lands
    // (runPaneRestore restores the session, then activates it in the pane).
    let release: () => void;
    h.initializeGate = new Promise<void>((resolve) => (release = resolve));

    await ctx.host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-x",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances.length).toBeGreaterThan(0);
    });
    const restoring = lastAgent();
    restoring.callbacks.onContextUsage(37); // replay while the pane is still empty

    expect(ctx.sent("contextUsage")).toHaveLength(0); // nothing to show yet

    // The pane-less replay must not be dropped: once the restore finishes and
    // binds the pane, the ring shows 37% without waiting for a new turn.
    release!();
    await vi.waitFor(() => {
      expect(ctx.sent("contextUsage").at(-1)).toEqual(
        expect.objectContaining({ percent: 37, paneId: "pane-1" }),
      );
    });
  });

  it("re-activating a pool-resident session replays its last known usage", async () => {
    const ctx = await hostWithTree(
      { sessionId: "s3", createdAt: 3000 },
      { sessionId: "s1", createdAt: 1000 },
    );

    // Activate s3 (spawn + restore), then report live usage from its pane.
    await ctx.host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      const last = ctx.sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "s3" });
    });
    const agent3 = lastAgent();
    agent3.callbacks.onContextUsage(45);
    expect(ctx.sent("contextUsage").at(-1)).toEqual(
      expect.objectContaining({ percent: 45 }),
    );

    // Switch to s1 (a second agent), leaving s3 live in the pool.
    await ctx.host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      const last = ctx.sent("setInitialState").at(-1);
      expect(last?.isRestoring).toBe(false);
      expect(last?.session).toMatchObject({ id: "s1" });
    });

    // Switching back to s3 activates the live agent in place — no CLI round
    // trip fires a usage push, so the host must replay the cached percent.
    const before = ctx.sent("contextUsage").length;
    await ctx.host.activateAdjacentSession(1);
    await vi.waitFor(() => {
      expect(ctx.sent("contextUsage").length).toBeGreaterThan(before);
    });
    expect(ctx.sent("contextUsage").at(-1)).toEqual(
      expect.objectContaining({ percent: 45 }),
    );
  });
});

describe("multi-session parallel (FR-031)", () => {
  /** Give the active agent content + register its session in the index. */
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const treeSessions = (tree: Record<string, unknown> | undefined) =>
    (
      (tree?.groups as Array<{
        sessions: Array<{
          sessionId: string;
          running: boolean;
          waitingConfirmation?: boolean;
          newCompleted?: boolean;
        }>;
      }>) ?? []
    ).flatMap((g) => g.sessions);

  it("desktopSelectSession on a live agent activates it without spawning or restoring", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    expect(h.agentInstances).toHaveLength(before);
    expect(agent1.restoreSession).not.toHaveBeenCalled();
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: "sess-1" },
    });
  });

  it("desktopSelectSession on the current session is a no-op", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const states = sent("setInitialState").length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    expect(h.agentInstances).toHaveLength(1);
    expect(sent("setInitialState")).toHaveLength(states);
  });

  it("switching back to a directory starts a fresh session instead of reviving its old one (场景 22)", async () => {
    const { host, store, sent } = await readyHost();
    const first = seedActiveSession("sess-1");
    store.addRecentWorkdir({ host: "local", path: "/work/b" });
    h.existingPaths.add("/work/b");

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/b",
    });
    expect(h.agentInstances).toHaveLength(2);

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });

    // 选目录 = 新对话：sess-1 的 agent 仍在池中存活，但分屏绑的是新会话，
    // 不是当初在 /work/a 的那条（回到旧会话只经侧边栏会话树）。
    expect(h.agentInstances).toHaveLength(3);
    const third = lastAgent();
    expect(third).not.toBe(first);
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: third.sessionId },
    });
    expect(first.destroy).not.toHaveBeenCalled();
  });

  it("keeps the running dot on background sessions in the tree", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    agent1.isStreaming = true;
    agent1.callbacks.onLoadingChange(true);

    await host.handleWebviewMessage({ command: "newSession" });
    expect(agent1.destroy).not.toHaveBeenCalled();
    const agent2 = seedActiveSession("sess-2");
    agent2.isStreaming = true;
    agent2.callbacks.onLoadingChange(true);

    const sessions = treeSessions(sent("desktopSessionTree").at(-1));
    expect(sessions.find((s) => s.sessionId === "sess-1")?.running).toBe(true);
    expect(sessions.find((s) => s.sessionId === "sess-2")?.running).toBe(true);

    // Background turn end: no endStreaming for the view, but the dot clears.
    agent1.isStreaming = false;
    agent1.callbacks.onLoadingChange(false);
    expect(sent("endStreaming")).toHaveLength(0);
    const after = treeSessions(sent("desktopSessionTree").at(-1));
    expect(after.find((s) => s.sessionId === "sess-1")?.running).toBe(false);
    expect(after.find((s) => s.sessionId === "sess-2")?.running).toBe(true);
  });

  it("flags a pane-less background session new-completed when its turn ends, then clears it once opened", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    // pane-1 now shows sess-2; sess-1 keeps running with no pane.
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");

    agent1.callbacks.onLoadingChange(true);
    agent1.callbacks.onLoadingChange(false);

    const flagged = treeSessions(sent("desktopSessionTree").at(-1));
    expect(flagged.find((s) => s.sessionId === "sess-1")?.newCompleted).toBe(
      true,
    );
    // The session in the focused pane is being watched — no unread dot.
    expect(flagged.find((s) => s.sessionId === "sess-2")?.newCompleted).toBe(
      false,
    );

    // Opening the session into the focused pane clears the flag for real — the
    // tree must stop advertising an unread completion the user just saw.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    const cleared = treeSessions(sent("desktopSessionTree").at(-1));
    expect(cleared.find((s) => s.sessionId === "sess-1")?.newCompleted).toBe(
      false,
    );
  });

  it("does not flag a turn finished in a session visible in a non-focused pane", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    const agent2 = seedActiveSession("sess-2"); // bound to pane-1, focused

    // Show sess-1 in a second pane: pane-2 takes focus, sess-2 stays visible
    // in pane-1 but is no longer focused. Its completion is still on screen,
    // so no unread dot is needed.
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    expect(
      sent("desktopPanes")
        .at(-1)
        ?.panes?.some((p) => p.sessionId === "sess-1" && p.paneId === "pane-2"),
    ).toBe(true);

    agent2.callbacks.onLoadingChange(true);
    agent2.callbacks.onLoadingChange(false);

    const after = treeSessions(sent("desktopSessionTree").at(-1));
    expect(after.find((s) => s.sessionId === "sess-2")?.newCompleted).toBe(
      false,
    );
    expect(after.find((s) => s.sessionId === "sess-1")?.newCompleted).toBe(
      false,
    );
  });

  it("does not re-light the new-completed dot for a session the user opened then left", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");

    agent1.callbacks.onLoadingChange(true);
    agent1.callbacks.onLoadingChange(false);
    const flagged = treeSessions(sent("desktopSessionTree").at(-1));
    expect(flagged.find((s) => s.sessionId === "sess-1")?.newCompleted).toBe(
      true,
    );

    // View sess-1, then leave it for sess-2: sess-1 returns to the background
    // but must not re-light — its flag was cleared when opened, not merely
    // hidden by the webview for as long as the session stays in view.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    const after = treeSessions(sent("desktopSessionTree").at(-1));
    expect(after.find((s) => s.sessionId === "sess-1")?.newCompleted).toBe(
      false,
    );
  });

  it("flags a background session waiting-confirmation in the tree until resolved", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");

    // Background permission request: no dialog, but the tree flags the session.
    agent1.callbacks.onPermissionRequest("req-bg", {
      toolName: "Edit",
      toolInput: { file_path: "/x.ts" },
    });
    expect(sent("showConfirmation")).toHaveLength(0);
    const flagged = treeSessions(sent("desktopSessionTree").at(-1));
    expect(
      flagged.find((s) => s.sessionId === "sess-1")?.waitingConfirmation,
    ).toBe(true);
    expect(
      flagged.find((s) => s.sessionId === "sess-2")?.waitingConfirmation,
    ).toBe(false);

    // Switching back surfaces the pending confirmation via initial state;
    // responding clears the tree flag.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    const state = sent("setInitialState").at(-1) as {
      pendingConfirmations?: Array<{ confirmationId: string }>;
    };
    expect(state.pendingConfirmations).toHaveLength(1);
    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId: state.pendingConfirmations![0].confirmationId,
      approved: true,
    });

    const cleared = treeSessions(sent("desktopSessionTree").at(-1));
    expect(
      cleared.find((s) => s.sessionId === "sess-1")?.waitingConfirmation,
    ).toBe(false);
  });

  it("flags the active session waiting-confirmation alongside the dialog", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");

    lastAgent().callbacks.onPermissionRequest("req-1", {
      toolName: "Edit",
      toolInput: { file_path: "/x.ts" },
    });
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(1);
    });
    const flagged = treeSessions(sent("desktopSessionTree").at(-1));
    expect(
      flagged.find((s) => s.sessionId === "sess-1")?.waitingConfirmation,
    ).toBe(true);

    const confirmationId = sent("showConfirmation")[0].confirmationId as string;
    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId,
      approved: true,
    });
    const cleared = treeSessions(sent("desktopSessionTree").at(-1));
    expect(
      cleared.find((s) => s.sessionId === "sess-1")?.waitingConfirmation,
    ).toBe(false);
  });

  it("gates background agent view callbacks until the session is activated", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");

    const appends = sent("appendMessage").length;
    // 屏外会话的副本随切走丢掉了；它这一轮新产出的消息留在 CLI 的显示流里。
    agent1.daemonMessages = [{ id: "m-sess-1" }, { id: "bg-1" }];
    agent1.callbacks.onAssistantMessageAdded({ id: "bg-1" });
    expect(sent("appendMessage")).toHaveLength(appends);
    // 宿主替它留着的只有「收到过消息」这一位状态，没有列表。
    expect("messages" in agent1).toBe(false);

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    expect(sent("setInitialState").at(-1)?.messages).toEqual([
      { id: "m-sess-1" },
      { id: "bg-1" },
    ]);
  });

  it("pushes isCompacting from the activated session so the compaction hint does not leak across sessions", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");
    // Switch back to sess-1, then start a compaction on it (active session).
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    agent1.isCompacting = true;
    agent1.callbacks.onCompactionStateChange(true);
    expect(sent("compactionStateChange").at(-1)).toMatchObject({
      isCompacting: true,
    });

    // Switch to sess-2 (not compacting): the pushed initial state must not
    // inherit sess-1's compaction hint.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    expect(sent("setInitialState").at(-1)).toMatchObject({
      isCompacting: false,
    });

    // Switch back to sess-1 (still compacting): the hint must reappear from
    // the agent's cached flag.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    expect(sent("setInitialState").at(-1)).toMatchObject({
      isCompacting: true,
    });
  });

  it("forwards compactionContentUpdate so the webview can render the streaming tail", async () => {
    const { sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");

    agent1.callbacks.onCompactionContentUpdate("streaming summary");
    expect(sent("compactionContentUpdate").at(-1)).toMatchObject({
      content: "streaming summary",
    });
  });

  it("forwards planFileUpdated to the pane so an open Plan pane refreshes live", async () => {
    const { sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");

    agent1.callbacks.onPlanFileUpdated("## v2\n- 新步骤");

    const msg = sent("planFileUpdated").at(-1);
    expect(msg).toMatchObject({ content: "## v2\n- 新步骤" });
    // Scoped to the owning pane: the refresh must not leak to other panes.
    expect(msg?.paneId).toBeTruthy();
  });

  it("never evicts idle agents — the pool is unbounded until session deletion", async () => {
    const { host } = await readyHost();
    const agents = [seedActiveSession("sess-1")];
    // Spawn well beyond the old pool cap; each new session needs a non-empty active one.
    for (let i = 2; i <= 10; i++) {
      await host.handleWebviewMessage({ command: "newSession" });
      agents.push(seedActiveSession(`sess-${i}`));
    }

    for (const a of agents) expect(a.destroy).not.toHaveBeenCalled();

    // Switching back to the oldest session still reuses its live agent.
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });
    expect(h.agentInstances).toHaveLength(before);
    expect(agents[0].restoreSession).not.toHaveBeenCalled();
  });

  it("dispose destroys every live agent in the pool", async () => {
    const { host } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    const agent2 = seedActiveSession("sess-2");

    await host.dispose();

    expect(agent1.destroy).toHaveBeenCalled();
    expect(agent2.destroy).toHaveBeenCalled();
  });
});

describe("split-view panes (FR-032~036)", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{ paneId: string; sessionId?: string; width?: number }>;
          focusedPaneId: string;
        },
    );

  it("webviewReady pushes an initial single-pane layout", async () => {
    const { sent } = await readyHost();
    const layouts = panePushes(sent);
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts.at(-1)?.panes).toHaveLength(1);
    expect(layouts.at(-1)?.focusedPaneId).toBe(layouts.at(-1)?.panes[0].paneId);
  });

  it("desktopOpenPane appends a pane, restores the session into it and focuses it", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-old",
    });

    // A new agent was spawned + restored for the dropped session. The restore
    // runs behind the sweep overlay, so settle it before asserting.
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-old");
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[1].sessionId).toBe("sess-old");
      expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    });
    // The restored pane received its initial state, tagged with its paneId.
    const init = sent("setInitialState").at(-1);
    expect(init?.paneId).toBe(panePushes(sent).at(-1)!.panes[1].paneId);
  });

  it("desktopOpenPane on a worktree session spawns the agent at entry.cwd, not the repo root", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-1");
    const worktree = {
      path: "/work/a/.wave/worktrees/gentle-pike-147",
      branch: "worktree-gentle-pike-147",
      repoRoot: "/work/a",
    };
    // The sidebar groups worktree sessions under the repo root, so the webview
    // sends the repo root as workdir while the session files live at cwd.
    store.upsertSession({
      sessionId: "sess-wt",
      title: "wt",
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: "main",
        repoRoot: worktree.repoRoot,
      },
    });
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: worktree.repoRoot,
      sessionId: "sess-wt",
    });

    // Spawning at the repo root makes restoreSession look in the wrong project
    // store — it throws and the pane stays a new session.
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
      expect(lastAgent().initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: worktree.path }),
      );
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("sess-wt");
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-wt");
    });
    // The ephemeral worktree path must not leak into recents.
    expect(store.getRecentWorkdirs()).not.toEqual(
      expect.arrayContaining([{ host: "local", path: worktree.path }]),
    );
  });

  it("desktopOpenPane with insertionIndex inserts the pane at that position and focuses it", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
      insertionIndex: 1,
    });

    // The newest restore (sess-3) settles last and owns the focus.
    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => p.sessionId)).toEqual([
        "sess-1",
        "sess-3",
        "sess-2",
      ]);
      expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    });
  });

  it("desktopOpenPane clamps an out-of-range insertionIndex and appends on a non-number", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      insertionIndex: 99,
    });
    await vi.waitFor(() => {
      expect(
        panePushes(sent)
          .at(-1)!
          .panes.map((p) => p.sessionId),
      ).toEqual(["sess-1", "sess-2"]);
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
      insertionIndex: "bogus",
    });
    await vi.waitFor(() => {
      expect(
        panePushes(sent)
          .at(-1)!
          .panes.map((p) => p.sessionId),
      ).toEqual(["sess-1", "sess-2", "sess-3"]);
    });
  });

  it("desktopOpenPane for an already-visible session focuses its pane instead of duplicating", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // The first open must finish binding sess-2 to its pane, otherwise the
    // second open would not see it as visible and would spawn a duplicate.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });

    expect(h.agentInstances).toHaveLength(before);
    expect(panePushes(sent).at(-1)?.panes).toHaveLength(2);
  });

  it("desktopFocusPane switches focus and pushes the layout", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // Settle the restore first — its activation would otherwise re-focus the
    // restored pane after the explicit focus below.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const panes = panePushes(sent).at(-1)!.panes;

    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[0].paneId,
    });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(panes[0].paneId);
  });

  it("desktopFocusPane ignores unknown pane ids", async () => {
    const { host, sent } = await readyHost();
    const layouts = panePushes(sent).length;

    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: "pane-nope",
    });

    expect(panePushes(sent)).toHaveLength(layouts);
  });

  it("desktopFocusPane surfaces the newly focused host connect failure as a toast", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();
    // pane-1's picker is pinned to prod (no agent bound yet), so focusing back
    // onto it must establish the prod client again — and fail here.
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    await vi.waitFor(() => {
      expect(shownToasts().length).toBe(0); // eager connect succeeded, no toast
    });
    // Open a local pane-2 so focus can move away from pane-1.
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-9",
    });
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes).toHaveLength(2);
    });
    const pane1 = panePushes(sent)
      .at(-1)!
      .panes.find((p) => p.sessionId !== "sess-2")!;
    // Drop the prod tunnel: the cached client is released, and since no prod
    // agent is bound to a pane, no auto-reconnect competes for the retry.
    h.closedHandlers.at(-1)?.();
    vi.mocked(connectRemoteDaemon).mockRejectedValueOnce(
      new Error("tunnel down"),
    );

    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: pane1.paneId,
    });

    await vi.waitFor(() => {
      expect(
        shownToasts().some((t) => t.message.includes("连接主机 prod 失败")),
      ).toBe(true);
    });
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("desktopClosePane removes the pane without destroying its agent, and moves focus to a neighbor", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // Settle the restore before closing: an in-flight restore is discarded
    // (its agent destroyed) on close — the "agent survives" contract applies
    // to pane-bound agents only.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const agent2 = lastAgent();
    const focusedPane = panePushes(sent).at(-1)!.focusedPaneId;

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: focusedPane,
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    // Focus moved to the remaining pane; both agents stay alive.
    expect(layout.focusedPaneId).toBe(layout.panes[0].paneId);
    expect(agent1.destroy).not.toHaveBeenCalled();
    expect(agent2.destroy).not.toHaveBeenCalled();
  });

  it("desktopClosePane destroys a message-less agent on the closed pane", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1"); // pane-1 keeps a real conversation
    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    const spawned = lastAgent(); // the fresh empty agent bound to pane-2

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: layout.panes[1].paneId,
    });

    const after = panePushes(sent).at(-1)!;
    expect(after.panes).toHaveLength(1);
    expect(spawned.destroy).toHaveBeenCalledTimes(1);
    expect(agent1.destroy).not.toHaveBeenCalled();
  });

  it("desktopNewSessionInPane destroys the spawned agent when its pane is closed mid-spawn", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });

    const spawnPromise = host.handleWebviewMessage({
      command: "desktopNewSessionInPane",
    });
    const newPaneId = await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes).toHaveLength(2);
      return layout.panes[1].paneId;
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(2);
    });
    const spawned = lastAgent();

    // Mid-spawn the user closes the new pane. When initialize finishes, the
    // agent has no pane to bind to — it must be destroyed, not orphaned.
    h.initializeGate = null;
    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: newPaneId,
    });

    resolveInit();
    await spawnPromise;

    expect(spawned.destroy).toHaveBeenCalledTimes(1);
  });

  it("desktopClosePane on the last remaining pane is a no-op", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const onlyPane = panePushes(sent).at(-1)!.panes[0].paneId;
    const layouts = panePushes(sent).length;

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: onlyPane,
    });

    expect(panePushes(sent)).toHaveLength(layouts);
    expect(panePushes(sent).at(-1)?.panes).toHaveLength(1);
  });

  it("a pane-bound agent survives any number of later sessions", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    // Pin sess-2 in a second pane (pane-1 keeps sess-1). Settle the restore
    // first: while it is in flight its bindAgentToPane steals focus, which
    // would redirect the newSession loop below into pane-1.
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const paneAgent = lastAgent();
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    // Focus pane-1 so the spawn loop only replaces ITS agent, leaving the
    // sess-2 pane bound.
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: firstPane.paneId,
    });
    for (let i = 3; i <= 10; i++) {
      await host.handleWebviewMessage({ command: "newSession" });
      seedActiveSession(`sess-${i}`);
    }

    // No eviction: the sess-2 pane is untouched and its agent stays alive.
    expect(paneAgent.destroy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[1].sessionId).toBe("sess-2");
    });
  });

  it("desktopDeleteSession closes the focused pane showing it instead of resetting to a fresh session", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // The delete resolves the target + bound pane through the registered
    // session, so the restore must have re-keyed the agent first.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const agent2 = lastAgent();
    const spawned = h.agentInstances.length;
    // pane-2 (sess-2) is focused after the drop.

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "sess-2",
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    expect(layout.focusedPaneId).toBe(layout.panes[0].paneId);
    expect(agent2.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
    // The pane closed — no fresh session was spawned to fill it.
    expect(h.agentInstances).toHaveLength(spawned);
  });

  it("desktopDeleteSession closes a non-focused pane showing the deleted session", async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const agent2 = lastAgent();
    // Focus pane-1 so sess-2 lives in a background pane.
    const firstPane = panePushes(sent).at(-1)!.panes[0];
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: firstPane.paneId,
    });

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "sess-2",
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    expect(layout.focusedPaneId).toBe(firstPane.paneId);
    expect(agent2.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
  });

  it("host pushes carry the paneId of the pane they belong to", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    const panes = panePushes(sent).at(-1)!.panes;

    // Send a message scoped to the first pane while the second is focused.
    await host.handleWebviewMessage({
      command: "sendMessage",
      text: "hello",
      paneId: panes[0].paneId,
    });

    // It reached pane-1's agent, not the focused pane's.
    const [firstAgent, secondAgent] = h.agentInstances as Array<
      ReturnType<typeof lastAgent>
    >;
    expect(firstAgent.sendMessage).toHaveBeenCalledWith(
      "hello",
      undefined,
      false,
    );
    expect(secondAgent.sendMessage).not.toHaveBeenCalled();

    // Mirror the real agent: a user message fires onUserMessageAdded, and the
    // resulting appendMessage push is tagged with the owning pane's id.
    firstAgent.callbacks.onUserMessageAdded({
      id: "u-1",
      role: "user",
      blocks: [],
    });
    const append = sent("appendMessage").at(-1);
    expect(append?.paneId).toBe(panes[0].paneId);
  });
});

describe("pane rows (two-row layout)", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{
            paneId: string;
            sessionId?: string;
            width?: number;
            row: number;
          }>;
          rowHeights?: number[];
          focusedPaneId: string;
        },
    );

  const lastSystemMessage = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("appendMessage")
      .map(
        (m) =>
          m.message as {
            role: string;
            blocks: Array<{ type: string; content: string }>;
          },
      )
      // 宿主自己插的提示一律是 assistant 文本行；造数据用的用户消息不能混进来
      // （宿主不保留消息内容，测试里「会话有内容」也只能靠消息事件表达）。
      .filter(
        (msg) => msg.role === "assistant" && msg.blocks?.[0]?.type === "text",
      )
      .at(-1);

  it("webviewReady pushes a single-row layout without rowHeights", async () => {
    const { sent } = await readyHost();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].row).toBe(0);
    expect(layout.rowHeights).toBeUndefined();
  });

  it("desktopOpenPane with newRow: below splits the layout into two rows", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-2", 1],
      ]);
      expect(layout.rowHeights).toEqual([0.5, 0.5]);
      expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    });
  });

  it("desktopOpenPane with newRow: above pushes existing panes into the bottom row", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "above",
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-2", 0],
        ["sess-1", 1],
      ]);
      expect(layout.rowHeights).toEqual([0.5, 0.5]);
    });
  });

  it("desktopOpenPane with newRow refuses the split when the window is too short", async () => {
    const { host, sent } = await readyHost(1280, 500);
    seedActiveSession("sess-1");
    const spawned = h.agentInstances.length;
    const appends = sent("appendMessage").length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });

    // No new pane, no agent spawn, and a toast explains the refusal.
    expect(h.agentInstances).toHaveLength(spawned);
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.rowHeights).toBeUndefined();
    expect(
      shownToasts().some((t) => t.message === "窗口高度不足，无法拆分为两行"),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(appends);
  });

  it("desktopShowHint relays a webview hint to the global toast stack", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopShowHint",
      text: "空间不足，无法添加更多分屏",
    });

    expect(
      shownToasts().some((t) => t.message === "空间不足，无法添加更多分屏"),
    ).toBe(true);
    // The hint must never become a chat message.
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("desktopOpenPane without a target row spills into a fresh second row when the single row is full", async () => {
    // chatArea = 900 - 240 = 660px: one pane fits (660), two would not (330).
    const { host, sent } = await readyHost(900, 800);
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-2", 1],
      ]);
      expect(layout.rowHeights).toEqual([0.5, 0.5]);
      expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    });
  });

  it("desktopOpenPane without a target row overflows into the other row when the focused row is full", async () => {
    // chatArea = 1200 - 240 = 960px: row 0 with two panes is full (960/3 =
    // 320 < 360), row 1 with one pane still fits a second (960/2 = 480).
    const { host, sent } = await readyHost(1200, 800);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
      newRow: "below",
    });
    // Layout: row0 [sess-1, sess-2], row1 [sess-3]. Focus the top row.
    const sess1Pane = panePushes(sent)
      .at(-1)!
      .panes.find((p) => p.sessionId === "sess-1")!;
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: sess1Pane.paneId,
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-4",
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-2", 0],
        ["sess-3", 1],
        ["sess-4", 1],
      ]);
      // Row 0 keeps its ratios; row 1 splits evenly.
      expect(layout.panes[0].width).toBeCloseTo(0.5);
      expect(layout.panes[1].width).toBeCloseTo(0.5);
      expect(layout.panes[2].width).toBeCloseTo(0.5);
      expect(layout.panes[3].width).toBeCloseTo(0.5);
    });
  });

  it("desktopOpenPane without a target row refuses with a hint when the full single row cannot split", async () => {
    const { host, sent } = await readyHost(900, 500);
    seedActiveSession("sess-1");
    const spawned = h.agentInstances.length;
    const appends = sent("appendMessage").length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });

    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
    expect(
      shownToasts().some((t) => t.message === "空间不足，无法添加更多分屏"),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(appends);
  });

  it("desktopOpenPane without a target row refuses with a hint when both rows are full", async () => {
    // chatArea = 660px: each row fits exactly one pane.
    const { host, sent } = await readyHost(900, 800);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    const sess1Pane = panePushes(sent)
      .at(-1)!
      .panes.find((p) => p.sessionId === "sess-1")!;
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: sess1Pane.paneId,
    });
    const spawned = h.agentInstances.length;
    const appends = sent("appendMessage").length;

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
    });

    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(2);
    expect(
      shownToasts().some((t) => t.message === "窗口宽度不足，无法添加更多分屏"),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(appends);
  });

  it("desktopOpenPane with a named target row squeezes into a narrow row like a pane move", async () => {
    // chatArea = 660px: one pane fits, two would be 330px each — below the
    // min width. A drag drop names its target row and is always honored.
    const { host, sent } = await readyHost(900, 800);
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      row: 0,
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-2", 0],
      ]);
    });
    expect(lastSystemMessage(sent)).toBeUndefined();
  });

  it("desktopOpenPane with newRow targets the derived row when two rows already exist", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
      newRow: "above",
    });

    // Rows already exist, so "above" just means row 0 — no second split.
    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-3", 0],
        ["sess-2", 1],
      ]);
      expect(layout.rowHeights).toEqual([0.5, 0.5]);
    });
  });

  it("desktopOpenPane with row inserts the pane into the given row and rebalances only that row", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
      row: 1,
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-1", 0],
        ["sess-2", 1],
        ["sess-3", 1],
      ]);
      // Row 0 keeps its untouched width; row 1 splits evenly.
      expect(layout.panes[0].width).toBeUndefined();
      expect(layout.panes[1].width).toBeCloseTo(0.5);
      expect(layout.panes[2].width).toBeCloseTo(0.5);
    });
  });

  it("desktopMovePane with newRow moves the pane alone into a fresh row", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    const first = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({
      command: "desktopMovePane",
      paneId: first.paneId,
      newRow: "below",
    });

    // The opened session binds asynchronously (fire-and-forget restore) — wait
    // for the binding push so the layout assertion sees the final row state.
    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-2", 0],
        ["sess-1", 1],
      ]);
    });
    const layout = panePushes(sent).at(-1)!;
    // The remaining top-row pane re-expands to the full row width.
    expect(layout.panes[0].width).toBeCloseTo(1);
    expect(layout.panes[1].width).toBeUndefined();
    expect(layout.rowHeights).toEqual([0.5, 0.5]);
  });

  it("desktopMovePane with newRow is a no-op for a single pane", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const onlyPane = panePushes(sent).at(-1)!.panes[0];
    const pushes = panePushes(sent).length;

    await host.handleWebviewMessage({
      command: "desktopMovePane",
      paneId: onlyPane.paneId,
      newRow: "below",
    });

    expect(panePushes(sent)).toHaveLength(pushes);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
  });

  it("desktopMovePane with toRow/toIndex moves the pane across rows and rebalances both rows", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
    });
    // Layout: row0 [sess-1], row1 [sess-2, sess-3].
    const sess3Pane = await vi.waitFor(() => {
      const pane = panePushes(sent)
        .at(-1)!
        .panes.find((p) => p.sessionId === "sess-3");
      if (!pane) throw new Error("sess-3 pane not bound yet");
      return pane;
    });

    await host.handleWebviewMessage({
      command: "desktopMovePane",
      paneId: sess3Pane.paneId,
      toRow: 0,
      toIndex: 0,
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => [p.sessionId, p.row])).toEqual([
        ["sess-3", 0],
        ["sess-1", 0],
        ["sess-2", 1],
      ]);
      expect(layout.panes[0].width).toBeCloseTo(0.5);
      expect(layout.panes[1].width).toBeCloseTo(0.5);
      // The abandoned row re-expands to full width.
      expect(layout.panes[2].width).toBeCloseTo(1);
    });
  });

  it("desktopMovePane with toIndex alone reorders within its own row", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
    });
    const sess3Pane = await vi.waitFor(() => {
      const pane = panePushes(sent)
        .at(-1)!
        .panes.find((p) => p.sessionId === "sess-3");
      if (!pane) throw new Error("sess-3 pane not bound yet");
      return pane;
    });

    await host.handleWebviewMessage({
      command: "desktopMovePane",
      paneId: sess3Pane.paneId,
      toIndex: 0,
    });

    await vi.waitFor(() => {
      const layout = panePushes(sent).at(-1)!;
      expect(layout.panes.map((p) => p.sessionId)).toEqual([
        "sess-3",
        "sess-1",
        "sess-2",
      ]);
      expect(layout.panes.every((p) => p.row === 0)).toBe(true);
      expect(layout.rowHeights).toBeUndefined();
    });
  });

  it("desktopResizePanes applies widths only to the addressed row", async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-3",
    });
    // Layout: row0 [sess-1], row1 [sess-2, sess-3].

    await host.handleWebviewMessage({
      command: "desktopResizePanes",
      widths: [0.3, 0.7],
      row: 1,
    });

    let layout = panePushes(sent).at(-1)!;
    expect(layout.panes[0].width).toBeUndefined(); // row 0 untouched
    expect(layout.panes[1].width).toBeCloseTo(0.3);
    expect(layout.panes[2].width).toBeCloseTo(0.7);

    // A length that doesn't match the row's pane count is ignored.
    await host.handleWebviewMessage({
      command: "desktopResizePanes",
      widths: [0.5, 0.5],
      row: 0,
    });
    layout = panePushes(sent).at(-1)!;
    expect(layout.panes[0].width).toBeUndefined();
  });

  it("desktopResizePaneRows normalizes pixel heights into rowHeights", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });

    await host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: [300, 500],
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.rowHeights![0]).toBeCloseTo(0.375);
    expect(layout.rowHeights![1]).toBeCloseTo(0.625);
  });

  it("desktopResizePaneRows ignores malformed payloads and single-row layouts", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    // The pane binds asynchronously — settle it before counting pushes, so a
    // late restore binding push can't be miscounted as an ignored payload.
    await vi.waitFor(() => {
      expect(
        panePushes(sent)
          .at(-1)!
          .panes.some((p) => p.sessionId === "sess-2"),
      ).toBe(true);
    });

    await host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: [300, 500],
    });
    const pushes = panePushes(sent).length;

    await host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: [600],
    });
    await host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: [0, 800],
    });
    await host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: "bogus",
    });

    expect(panePushes(sent)).toHaveLength(pushes);
    expect(panePushes(sent).at(-1)!.rowHeights![0]).toBeCloseTo(0.375);

    // Single-row layout: the command is meaningless and ignored.
    const solo = await readyHost();
    const soloPushes = panePushes(solo.sent).length;
    await solo.host.handleWebviewMessage({
      command: "desktopResizePaneRows",
      heights: [400, 400],
    });
    expect(panePushes(solo.sent)).toHaveLength(soloPushes);
  });

  it("closing the last pane of a row collapses the layout back to one row", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    const bottomPane = panePushes(sent).at(-1)!.panes[1];

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: bottomPane.paneId,
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    expect(layout.panes[0].row).toBe(0);
    expect(layout.rowHeights).toBeUndefined();
  });

  it("closing every top-row pane promotes the bottom row to row 0", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
      newRow: "below",
    });
    await vi.waitFor(() => {
      expect(
        panePushes(sent)
          .at(-1)!
          .panes.some((p) => p.sessionId === "sess-2"),
      ).toBe(true);
    });
    const topPane = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: topPane.paneId,
    });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-2");
    expect(layout.panes[0].row).toBe(0);
    expect(layout.rowHeights).toBeUndefined();
  });
});

describe("desktopNewSessionInPane (new session side-by-side)", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{
            paneId: string;
            sessionId?: string;
            width?: number;
            row: number;
          }>;
          rowHeights?: number[];
          focusedPaneId: string;
        },
    );

  it("opens a fresh session in a new pane next to the current one", async () => {
    const { host, sent } = await readyHost();
    const original = seedActiveSession("sess-1");
    const spawned = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    expect(layout.panes[1].sessionId).not.toBe("sess-1"); // fresh session, its own id
    expect(layout.panes.map((p) => p.row)).toEqual([0, 0]);
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    // The original pane keeps its agent; the new pane gets a fresh empty one.
    expect(h.agentInstances).toHaveLength(spawned + 1);
    expect(lastAgent()).not.toBe(original);
    expect(lastAgent().currentWorkdir).toBe("/work/a");
    // 新分屏拿到的是一个空会话（CLI 那边整份列表就是空的）。
    expect(await lastAgent().getMessages()).toEqual([]);
  });

  it("focuses the sole empty pane instead of adding another one", async () => {
    const { host, sent } = await readyHost();
    const spawned = h.agentInstances.length;
    const focusBefore = sent("focusInput").length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
    const focus = sent("focusInput");
    expect(focus).toHaveLength(focusBefore + 1);
    expect((focus.at(-1) as { paneId?: string }).paneId).toBe("pane-1");
  });

  it("opens a blank pane without spawning when no recent workdirs exist (scenario 10)", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-1");
    store.removeRecentWorkdir({ host: "local", path: "/work/a" });
    const spawned = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    // The new pane is blank: no session, no agent — workdir to be picked later.
    expect(layout.panes[1].sessionId).toBeUndefined();
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    expect(h.agentInstances).toHaveLength(spawned);
    expect(sent("setInitialState").at(-1)?.session).toBeUndefined();
  });

  it("focuses the sole empty pane even when no recent workdirs exist (scenario 10)", async () => {
    const { host, store, sent } = await readyHost();
    store.removeRecentWorkdir({ host: "local", path: "/work/a" });
    const spawned = h.agentInstances.length;
    const focusBefore = sent("focusInput").length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    // The empty-pane lookup runs before the empty-recents early return, so the
    // entry still lands on the blank pane instead of silently dead-ending.
    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
    const focus = sent("focusInput");
    expect(focus).toHaveLength(focusBefore + 1);
    expect((focus.at(-1) as { paneId?: string }).paneId).toBe("pane-1");
  });

  it("reuses an empty non-focused pane instead of opening a third", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    // First call: pane-1 is busy, so a fresh empty pane-2 appears (focused).
    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
    const pane1 = panePushes(sent).at(-1)!.panes[0];
    const pane2 = panePushes(sent).at(-1)!.panes[1];
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: pane1.paneId,
    });
    const spawned = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    expect(h.agentInstances).toHaveLength(spawned);
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.focusedPaneId).toBe(pane2.paneId);
    expect((sent("focusInput").at(-1) as { paneId?: string }).paneId).toBe(
      pane2.paneId,
    );
  });

  it("overflows into a second row when the single row is full", async () => {
    // chatArea = 900 - 240 = 660px: one pane fits, two would not.
    const { host, sent } = await readyHost(900, 800);
    seedActiveSession("sess-1");

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes.map((p) => p.row)).toEqual([0, 1]);
    expect(layout.rowHeights).toEqual([0.5, 0.5]);
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    expect(await lastAgent().getMessages()).toEqual([]);
  });

  it("refuses with a hint when the full single row cannot split", async () => {
    const { host, sent } = await readyHost(900, 500);
    seedActiveSession("sess-1");
    const spawned = h.agentInstances.length;
    const appends = sent("appendMessage").length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
    expect(
      shownToasts().some((t) => t.message === "空间不足，无法添加更多分屏"),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(appends);
  });

  it("still opens a new pane while the current one is streaming", async () => {
    const { host, sent } = await readyHost();
    const agent = seedActiveSession("sess-1");
    agent.isStreaming = true;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(agent.isStreaming).toBe(true); // untouched, keeps generating in the background
  });

  it("exposes the same flow through newSessionInNewPane() for the menu accelerator", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");

    await host.newSessionInNewPane();

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
  });
});

describe("input focus on conversation switch", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{ paneId: string; sessionId?: string }>;
          focusedPaneId: string;
        },
    );

  it("desktopSelectSession on a live session focuses the input", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({ command: "newSession" });
    seedActiveSession("sess-2");
    const paneId = panePushes(sent).at(-1)!.focusedPaneId;
    const before = sent("focusInput").length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    const focus = sent("focusInput");
    expect(focus.length).toBeGreaterThan(before);
    expect(focus.at(-1)).toMatchObject({ paneId });
  });

  it("desktopSelectSession on a historical session focuses the input after restore", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const paneId = panePushes(sent).at(-1)!.focusedPaneId;
    const before = sent("focusInput").length;

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "hist-1",
    });

    await vi.waitFor(() => {
      expect(lastAgent().restoreSession).toHaveBeenCalledWith("hist-1");
      const focus = sent("focusInput");
      expect(focus.length).toBeGreaterThan(before);
      expect(focus.at(-1)).toMatchObject({ paneId });
    });
  });

  it("activateAdjacentSession (switch shortcut) focuses the input", async () => {
    const { host, sent, store } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    store.upsertSession({
      sessionId: "s1",
      title: "Session s1",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    store.upsertSession({
      sessionId: "s2",
      title: "Session s2",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 2000,
      lastActiveAt: 2000,
    });
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });
    const before = sent("focusInput").length;

    await host.activateAdjacentSession(1);

    await vi.waitFor(() => {
      const focus = sent("focusInput");
      expect(focus.length).toBeGreaterThan(before);
      expect(focus.at(-1)).toMatchObject({
        paneId: panePushes(sent).at(-1)!.focusedPaneId,
      });
    });
  });

  it("selecting a session already visible in another pane focuses that pane input", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // Settle the restore — its activation would otherwise re-focus pane-2
    // after the select below focuses pane-1.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    // pane-2 (sess-2) is focused; sess-1 stays visible in pane-1.
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(firstPane.paneId);
    expect(sent("focusInput").at(-1)).toMatchObject({
      paneId: firstPane.paneId,
    });
  });

  it("desktopOpenPane on an already-visible session focuses that pane input", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    expect(sent("focusInput").at(-1)).toMatchObject({
      paneId: firstPane.paneId,
    });
  });

  it("desktopClosePane on the focused pane focuses the neighbor input", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    const [firstPane, secondPane] = panePushes(sent).at(-1)!.panes;

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: secondPane.paneId,
    });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(firstPane.paneId);
    expect(sent("focusInput").at(-1)).toMatchObject({
      paneId: firstPane.paneId,
    });
  });

  it("desktopFocusPane (pane mousedown) does not steal input focus", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    // The restore's activation ends with a focusInput — settle it first so the
    // baseline count below is stable.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const firstPane = panePushes(sent).at(-1)!.panes[0];
    const before = sent("focusInput").length;

    // A click anywhere in an unfocused pane (e.g. selecting message text)
    // refocuses the pane but must not yank the caret into the input.
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: firstPane.paneId,
    });

    expect(sent("focusInput")).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------
// per-session input drafts (desktop-sessions.md 会话管理 scenario 11/12)
// ---------------------------------------------------------------------------

describe("input drafts per session (desktop-sessions.md scenario 11/12)", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const makeEntry = (
    sessionId: string,
    workdir: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    sessionId,
    title: `Session ${sessionId}`,
    workdir,
    cwd: workdir,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  });

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{ paneId: string; sessionId?: string }>;
          focusedPaneId: string;
        },
    );

  const lastState = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("setInitialState").at(-1) as Record<string, unknown> | undefined;

  // The optimistic overlay push (isRestoring: true) and the post-restore push
  // both carry the target session — only the latter has the restore settled.
  const waitForSettledSession = async (
    sent: ReturnType<typeof createHost>["sent"],
    sessionId: string,
  ) => {
    await vi.waitFor(() => {
      const state = lastState(sent);
      expect(state?.session).toMatchObject({ id: sessionId });
      expect(state?.isRestoring).toBeFalsy();
    });
  };

  it("typing in A, switching to B shows B empty, switching back restores the text (scenario 11)", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-A");
    await host.handleWebviewMessage({
      command: "updateInputContent",
      sessionId: "sess-A",
      content: "1",
    });

    // Switch to a historical B — its own (empty) draft shows, not A's text.
    store.upsertSession(makeEntry("sess-B", "/work/a"));
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-B",
    });
    await waitForSettledSession(sent, "sess-B");
    expect(lastState(sent)?.inputContent).toBe("");

    // Switch back — the unsent '1' comes back with the conversation.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-A",
    });
    await waitForSettledSession(sent, "sess-A");
    expect(lastState(sent)?.inputContent).toBe("1");
  });

  it("a debounced save tagged with the old session lands after the switch without polluting the new session (scenario 12)", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-A");
    await host.handleWebviewMessage({
      command: "updateInputContent",
      sessionId: "sess-A",
      content: "1",
    });

    store.upsertSession(makeEntry("sess-B", "/work/a"));
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-B",
    });
    await waitForSettledSession(sent, "sess-B");

    // Type '2' in B, then A's pending debounce fires — it is still tagged with
    // sess-A, so it must not clobber B's draft.
    await host.handleWebviewMessage({
      command: "updateInputContent",
      sessionId: "sess-B",
      content: "2",
    });
    await host.handleWebviewMessage({
      command: "updateInputContent",
      sessionId: "sess-A",
      content: "1",
    });

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-A",
    });
    await waitForSettledSession(sent, "sess-A");
    expect(lastState(sent)?.inputContent).toBe("1");

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-B",
    });
    await waitForSettledSession(sent, "sess-B");
    expect(lastState(sent)?.inputContent).toBe("2");
  });

  it("an untagged update falls back to the pane-current session", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-A");
    // Session-less hosts (VSCE-style) omit the tag — lands on the current pane session.
    await host.handleWebviewMessage({
      command: "updateInputContent",
      content: "legacy draft",
    });

    store.upsertSession(makeEntry("sess-B", "/work/a"));
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-B",
    });
    await waitForSettledSession(sent, "sess-B");
    expect(lastState(sent)?.inputContent).toBe("");

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-A",
    });
    await waitForSettledSession(sent, "sess-A");
    expect(lastState(sent)?.inputContent).toBe("legacy draft");
  });

  it("rewindToMessage stores the rewound draft under the session", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-A");

    await host.handleWebviewMessage({
      command: "rewindToMessage",
      messageId: "u1",
    });

    await vi.waitFor(() => {
      expect(lastAgent().rewindToMessage).toHaveBeenCalledWith("u1");
      expect(lastState(sent)?.inputContent).toBe("rewound draft");
    });
  });

  it("rewindToMessage with a requestId replies and then re-pulls the list", async () => {
    const { host, sent } = await readyHost();
    const agent = seedActiveSession("sess-A");
    // Compaction can leave the same id twice; the CLI cuts at the LAST
    // occurrence of the anchor.
    agent.daemonMessages = [
      { id: "u1" },
      { id: "a1" },
      { id: "u2" },
      { id: "u3" },
      { id: "u2" },
      { id: "a3" },
    ];
    // The rewind is the CLI's own truncation — mirror it daemon-side, so the
    // snapshot below can only show the cut list by having gone and asked.
    agent.rewindToMessage.mockImplementationOnce(async () => {
      agent.daemonMessages = [
        { id: "u1" },
        { id: "a1" },
        { id: "u2" },
        { id: "u3" },
      ];
      return { inputContent: "rewound draft" };
    });
    agent.getMessages.mockClear();

    await host.handleWebviewMessage({
      command: "rewindToMessage",
      messageId: "u2",
      requestId: "rewind-1",
    });

    await vi.waitFor(() => {
      expect(lastAgent().rewindToMessage).toHaveBeenCalledWith("u2");
      expect(lastState(sent)?.inputContent).toBe("rewound draft");
    });

    // The reply carries the attribution key and the outcome — never a list.
    const reply = sent("rewindResult").at(-1) as Record<string, unknown>;
    expect(reply).toMatchObject({
      requestId: "rewind-1",
      messageId: "u2",
      ok: true,
    });
    expect(reply.messages).toBeUndefined();
    // The snapshot that follows carries the post-rewind list, pulled fresh from
    // the CLI (spec 场景 5: 宿主不自己截, 交给回执 + 重拉).
    await vi.waitFor(() => {
      expect(lastState(sent)?.messages).toHaveLength(4);
    });
    expect(agent.getMessages).toHaveBeenCalled();
    expect(
      (lastState(sent)!.messages as Array<{ id: string }>).map((m) => m.id),
    ).toEqual(["u1", "a1", "u2", "u3"]);
    expect(lastState(sent)).not.toMatchObject({ keepMessages: true });
  });

  it("rewindResult reports failure when the rewind throws", async () => {
    const { host, sent } = await readyHost();
    const agent = seedActiveSession("sess-A");
    agent.rewindToMessage.mockRejectedValueOnce(new Error("disk full"));

    await host.handleWebviewMessage({
      command: "rewindToMessage",
      messageId: "u1",
      requestId: "rewind-2",
    });

    await vi.waitFor(() => {
      const reply = sent("rewindResult").at(-1) as Record<string, unknown>;
      expect(reply).toMatchObject({
        requestId: "rewind-2",
        messageId: "u1",
        ok: false,
      });
      expect(typeof reply.error).toBe("string");
    });
  });

  it("closing a pane keeps the session draft — reopening the session elsewhere restores it", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-A");
    await host.handleWebviewMessage({
      command: "updateInputContent",
      sessionId: "sess-A",
      content: "1",
    });

    // A second pane with its own fresh session and draft.
    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes).toHaveLength(2);
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBeDefined();
    });
    const [, pane2] = panePushes(sent).at(-1)!.panes;
    const sess2 = pane2.sessionId!;
    await host.handleWebviewMessage({
      command: "updateInputContent",
      paneId: pane2.paneId,
      sessionId: sess2,
      content: "2",
    });

    // Close pane-2 — only a pane-scoped `new:` draft would die with it.
    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: pane2.paneId,
    });

    // Reopen the closed pane's session: its draft survived the close.
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: sess2,
    });
    await waitForSettledSession(sent, sess2);
    expect(lastState(sent)?.inputContent).toBe("2");
  });

  it("an unbound pane draft stays pane-scoped and never leaks into the session that binds later", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-A");
    const before = h.agentInstances.length;

    // Park the spawn so the new pane exists in the unbound welcome state.
    let resolveInit!: () => void;
    h.initializeGate = new Promise<void>((r) => {
      resolveInit = r;
    });
    const openPromise = host.handleWebviewMessage({
      command: "desktopNewSessionInPane",
    });
    await vi.waitFor(() => {
      expect(h.agentInstances).toHaveLength(before + 1);
    });
    const newPane = panePushes(sent).at(-1)!.panes[1];

    // Untagged draft typed while the pane has no session yet → pane-scoped key.
    await host.handleWebviewMessage({
      command: "updateInputContent",
      paneId: newPane.paneId,
      content: "fresh pane draft",
    });

    resolveInit();
    await openPromise;

    // The session that binds later starts clean — the pane-scoped text is not inherited.
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBeDefined();
    });
    const states = sent("setInitialState").filter(
      (s) => s?.paneId === newPane.paneId,
    );
    expect(states.at(-1)?.session).toBeDefined();
    expect(states.at(-1)?.inputContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// native menu actions (spec: desktop-split-view-multi-chat §原生菜单)
// ---------------------------------------------------------------------------

describe("native menu actions", () => {
  const seedActiveSession = (sessionId: string) =>
    seedConversation(lastAgent(), sessionId);

  const panePushes = (sent: ReturnType<typeof createHost>["sent"]) =>
    sent("desktopPanes").map(
      (m) =>
        m as {
          panes: Array<{ paneId: string; sessionId?: string }>;
          focusedPaneId: string;
        },
    );

  it("newSessionInFocusedPane resets the focused pane to a new session", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const agentsBefore = h.agentInstances.length;

    await host.newSessionInFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe("sess-1");
  });

  it("newSessionInFocusedPane spawns a new session even while the active agent streams", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const streaming = lastAgent();
    streaming.isStreaming = true;
    const agentsBefore = h.agentInstances.length;

    await host.newSessionInFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    expect(streaming.destroy).not.toHaveBeenCalled();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe("sess-1");
  });

  it("closeFocusedPane closes the focused pane and keeps its agent alive", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const left = lastAgent();
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(2);
    // Settle the restore before closing: an in-flight restore is discarded on
    // close, while a pane-bound agent survives (asserted below).
    await vi.waitFor(() => {
      expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe("sess-2");
    });
    const right = lastAgent();

    await host.closeFocusedPane();

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe("sess-1");
    expect(left.destroy).not.toHaveBeenCalled();
    expect(right.destroy).not.toHaveBeenCalled();
  });

  it("closeFocusedPane on the sole pane with a session resets it to a new session", async () => {
    const { host, sent } = await readyHost();
    seedActiveSession("sess-1");
    const old = lastAgent();
    const agentsBefore = h.agentInstances.length;

    await host.closeFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    expect(old.destroy).not.toHaveBeenCalled();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe("sess-1");
  });

  it("closeFocusedPane on the sole pane with an empty new session is a no-op", async () => {
    const { host, sent } = await readyHost();
    const agentsBefore = h.agentInstances.length;
    const pushesBefore = panePushes(sent).length;

    await host.closeFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore);
    expect(panePushes(sent).length).toBe(pushesBefore);
  });

  it("onMenuStateChange fires on pushPanes with enabled states, not on stream toggles", async () => {
    const { host } = await readyHost();
    const fn = vi.fn();
    host.onMenuStateChange = fn;

    // Stream toggles don't change menu enablement — 新对话 stays available
    // while streaming, same as the sidebar button.
    const agent = lastAgent();
    agent.isStreaming = true;
    agent.callbacks.onLoadingChange(true);
    agent.isStreaming = false;
    agent.callbacks.onLoadingChange(false);
    expect(fn).not.toHaveBeenCalled();

    seedActiveSession("sess-1");
    expect(fn).toHaveBeenLastCalledWith({
      canNewSession: true,
      canClosePane: true,
    });

    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    expect(fn).toHaveBeenLastCalledWith({
      canNewSession: true,
      canClosePane: true,
    });
  });
});

// ---------------------------------------------------------------------------
// SSH remote hosts (spec: desktop-sessions.md 「SSH 远程主机」)
// ---------------------------------------------------------------------------

const sshConfigPath = () => path.join(os.homedir(), ".ssh", "config");
const seedSshConfig = (content: string) =>
  h.files.set(sshConfigPath(), content);

/** Give an agent content + fire its sessionId so it registers in the index. */
function registerAgentInIndex(agent: ReturnType<typeof lastAgent>) {
  seedConversation(agent, agent.sessionId as string, "hi");
}

/** Flatten the sidebar session tree into a sessionId → running-marker lookup. */
function treeSessions(tree: Record<string, unknown> | undefined) {
  return (
    (tree?.groups as Array<{
      sessions: Array<{ sessionId: string; running: boolean }>;
    }>) ?? []
  ).flatMap((g) => g.sessions);
}

describe("SSH remote hosts", () => {
  it("desktopSelectHost with an unknown host is rejected with a toast", async () => {
    const { host, sent } = await readyHost();
    const statesBefore = sent("desktopWorkdirState").length;

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "unknown",
    });

    expect(
      shownToasts().some((t) => t.message.includes("未知主机：unknown")),
    ).toBe(true);
    // A picker refusal must not insert a message that hides the selectors.
    expect(sent("appendMessage")).toHaveLength(0);
    // No workdir state re-send — the picker stays put.
    expect(sent("desktopWorkdirState").length).toBe(statesBefore);
    expect(vi.mocked(connectRemoteDaemon)).not.toHaveBeenCalled();
  });

  it("desktopSelectHost surfaces an eager-connect failure as a toast, not a chat message", async () => {
    seedSshConfig("Host prod\n");
    vi.mocked(connectRemoteDaemon).mockRejectedValueOnce(
      new Error("tunnel down"),
    );
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await vi.waitFor(() => {
      expect(
        shownToasts().some((t) => t.message.includes("连接主机 prod 失败")),
      ).toBe(true);
    });
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("desktopSelectHost switches the picker to a host from ~/.ssh/config and shows its recents", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "prod", path: "/remote/repo" });

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    // The host's client is established eagerly so auth failures surface early.
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledWith(
        "prod",
        expect.any(String),
      );
    });
    const state = sent("desktopWorkdirState").at(-1);
    expect(state).toMatchObject({
      command: "desktopWorkdirState",
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: ["/remote/repo"],
    });
  });

  it("desktopSelectHost re-pushes the machine's own recent workdirs after the local cache", async () => {
    // spec core/recent-workdirs.md：本地缓存（configStore，按 host 分组）先发——
    // 它同步可得，也是旧版机器唯一的来源；机器那份读到后补推一次，桌面端与远控
    // Web 页从此共用同一份列表。
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.machineRecentWorkdirs = ["/machine/alpha", "/machine/beta"];
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "prod", path: "/remote/repo" });

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await vi.waitFor(() => {
      expect(sent("desktopWorkdirState").at(-1)?.recentWorkdirs).toEqual([
        "/machine/alpha",
        "/machine/beta",
      ]);
    });
    // 先发的那一份仍是本地缓存，不是被机器列表提前顶替。
    expect(sent("desktopWorkdirState")[0]?.recentWorkdirs).toEqual([
      "/remote/repo",
    ]);
  });

  it("desktopSelectHost keeps the local cache when the machine has no getRecentWorkdirs", async () => {
    // 旧版电脑：方法不存在，宿主拿到的是 `{}`。此时**不能**把列表清空——本地缓存
    // 那份是唯一的回退。
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "prod", path: "/remote/repo" });

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await vi.waitFor(() => {
      expect(
        h.clientRequests.some((r) => r.method === "getRecentWorkdirs"),
      ).toBe(true);
    });
    expect(
      sent("desktopWorkdirState").every(
        (state) =>
          JSON.stringify(state.recentWorkdirs) ===
          JSON.stringify(["/remote/repo"]),
      ),
    ).toBe(true);
  });

  it("writing a picked workdir records it on the machine that owns it", async () => {
    // 谁让用户选目录谁写（spec core/recent-workdirs.md）：远控 Web 页在 shim 里
    // 写，桌面端在这里写——两边落到同一台机器的同一份文件。
    await readyHost(); // 选 /work/a（本地）

    await vi.waitFor(() => {
      expect(h.clientRequests).toContainEqual({
        method: "rememberRecentWorkdir",
        params: { workdir: "/work/a" },
      });
    });
  });

  it("desktopSelectHost clears the stale workdir so the picker defaults to the new host's first recent", async () => {
    // After 新对话 on 本地 the webview's state.workdir holds /work/a. Switching
    // host must not leave that stale local path selected — the picker has to
    // fall back to the new host's first recent directory instead (spec
    // scenario 23). Regression: effectiveWorkdir = state.workdir ?? recents[0]
    // resolved to the old host's directory.
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = await readyHost(); // activates local /work/a
    store.addRecentWorkdir({ host: "prod", path: "/remote/repo" });

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    // The host no longer reports the local path as the current workdir, so the
    // webview falls back to prod's recents[0].
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      host: "prod",
      workdir: undefined,
      recentWorkdirs: ["/remote/repo"],
    });
    // ...and it explicitly clears the webview's stale state.workdir for this
    // pane; otherwise the `state.workdir ?? recents[0]` fallback keeps /work/a.
    const clear = sent("updateWorkdir").at(-1);
    expect(clear).toMatchObject({ workdir: undefined });
    expect(clear?.paneId).toBe("pane-1");
  });

  it("desktopSelectHost re-pushes the pane layout so the webview host label refreshes", async () => {
    // The webview derives a pane's host from the authoritative `desktopPanes`
    // push, not from desktopWorkdirState — a stale pane layout keeps the host
    // selector on 本地 no matter what host was selected (regression: clicking
    // an SSH host in a new conversation appeared to do nothing).
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    const panes = sent("desktopPanes").at(-1) as {
      panes: Array<{ host: string }>;
    };
    expect(panes.panes[0]).toMatchObject({ host: "prod" });
  });

  it("desktopSelectHost re-queries the auth status on the selected host", async () => {
    // lastIsAuthenticated is cached at webview-ready against the then-current
    // host (本地, logged out). Without a re-query on the selected host, the
    // welcome page keeps showing 登录 even when that host is already logged in.
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    h.authStatusResults = [false, true]; // 本地 logged out, prod logged in

    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await vi.waitFor(() => {
      const response = sent("authStatusResponse").at(-1);
      expect(response).toMatchObject({ isAuthenticated: true });
    });
  });

  it("desktopFocusPane re-queries the auth status on the newly focused pane's host", async () => {
    // The more-menu login/logout entry targets the focused pane's host, and the
    // cached auth state belongs to the previously focused pane — so switching
    // panes must re-query the newly focused pane's host instead of reusing the
    // stale cache (spec scenario 6).
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    store.upsertSession({
      sessionId: "sess-remote",
      title: "remote",
      host: "prod",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: 1,
      lastActiveAt: 1,
    });
    h.existingPaths.add("/work/a");
    // FIFO: webview-ready 本地 (logged out) → focus 本地 pane (logged out) →
    // focus prod pane (logged in).
    h.authStatusResults = [false, false, true];

    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });
    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-remote",
    });
    const panes = (
      sent("desktopPanes").at(-1) as {
        panes: Array<{ paneId: string; host: string }>;
      }
    ).panes;
    expect(panes[1]).toMatchObject({ host: "prod" });

    // desktopOpenPane already focused the remote pane. Switch back to 本地 and
    // then to prod again — each focus must re-query the newly focused pane's
    // host rather than reusing the state cached at webview-ready.
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[0].paneId,
    });
    await host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: panes[1].paneId,
    });

    const authQueries = h.clientRequests.filter(
      (r) => r.method === "getAuthStatus",
    );
    expect(authQueries.length).toBeGreaterThanOrEqual(3);
    await vi.waitFor(() => {
      const response = sent("authStatusResponse").at(-1);
      expect(response).toMatchObject({ isAuthenticated: true });
    });
  });

  it("desktopSelectHost releases a bound message-less agent so the picker host takes effect", async () => {
    // After 新对话 the pane is bound to a fresh empty agent; its host pins the
    // pane label to 本地 no matter what host is picked. Switching host must
    // release it (regression: with an existing local conversation, clicking an
    // SSH host in the new-session picker appeared to do nothing).
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    const panes = sent("desktopPanes").at(-1) as {
      panes: Array<{ host: string }>;
    };
    expect(panes.panes[0]).toMatchObject({ host: "prod" });
  });

  it("desktopSelectHost destroys the message-less agent it releases from the pane", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host } = await readyHost();
    const released = lastAgent(); // the fresh empty agent bound to the pane

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    expect(released.destroy).toHaveBeenCalledTimes(1);
  });

  it("desktopAddHost appends the block, auto-selects the new host and eagerly connects", async () => {
    const { host, sent } = createHost();

    await host.handleWebviewMessage({
      command: "desktopAddHost",
      connectionString: "ssh user@newhost -p 2222",
    });

    const config = h.files.get(sshConfigPath()) as string;
    expect(config).toContain("\nHost newhost\n    User user\n    Port 2222\n");
    // The success notice is a window-global toast — never a chat message, or the
    // new-session picker (host/workdir selectors) would be hidden by the
    // visible-message state the append would create.
    expect(
      shownToasts().some((t) => t.message.includes("已添加主机：newhost")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledWith(
        "newhost",
        expect.any(String),
      );
    });
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      command: "desktopWorkdirState",
      host: "newhost",
      hosts: ["newhost"],
    });
  });

  it("desktopAddHost surfaces an eager-connect failure as a toast, not a chat message", async () => {
    vi.mocked(connectRemoteDaemon).mockRejectedValueOnce(
      new Error("tunnel down"),
    );
    const { host, sent } = createHost();

    await host.handleWebviewMessage({
      command: "desktopAddHost",
      connectionString: "ssh user@newhost -p 2222",
    });

    await vi.waitFor(() => {
      expect(
        shownToasts().some((t) => t.message.includes("连接主机 newhost 失败")),
      ).toBe(true);
    });
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("desktopAddHost also re-queries the auth status on the auto-selected host", async () => {
    const { host, sent } = createHost();
    h.authStatusResults = [true, true]; // webview-ready 本地 + newhost 都 logged in

    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({
      command: "desktopAddHost",
      connectionString: "ssh user@newhost -p 2222",
    });

    await vi.waitFor(() => {
      const response = sent("authStatusResponse").at(-1);
      expect(response).toMatchObject({ isAuthenticated: true });
    });
  });

  it("desktopAddHost with an unparsable connection string reports the error and keeps the host", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopAddHost",
      connectionString: "ssh -i key.pem user@host",
    });

    expect(
      shownToasts().some((t) => t.message.includes("无法解析连接串")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({ host: "local" });
  });

  it("desktopSelectRemotePath validates the directory and activates a remote session", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });

    // Validation now rides the host's listDirectories RPC (ssh shell retired).
    expect(
      h.clientRequests.some(
        (r) =>
          r.method === "listDirectories" &&
          (r.params as { dir?: string })?.dir === "/remote/repo",
      ),
    ).toBe(true);
    const agent = lastAgent();
    expect(agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/remote/repo" }),
    );
    expect(store.getRecentWorkdirs()).toEqual(
      expect.arrayContaining([{ host: "prod", path: "/remote/repo" }]),
    );
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({
      host: "prod",
      recentWorkdirs: ["/remote/repo"],
    });

    // Session index + tree group are tagged with the remote host.
    registerAgentInIndex(agent);
    const index = store.getSessionIndex();
    expect(index.find((e) => e.cwd === "/remote/repo")?.host).toBe("prod");
    await vi.waitFor(() => {
      const tree = sent("desktopSessionTree").at(-1) as {
        groups?: Array<{ host: string }>;
      };
      expect(tree?.groups?.some((g) => g.host === "prod")).toBe(true);
    });
  });

  it("desktopSelectRemotePath rejects a directory that does not exist on the host", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();
    // The bridge's explicit "missing dir" verdict — not a transport failure.
    h.dirListResults.push(new Error("目录不存在或不可读：/gone"));

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/gone",
    });

    expect(
      shownToasts().some((t) => t.message.includes("远端目录不存在：/gone")),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
    expect(h.agentInstances.length).toBe(1); // the local ready agent only
    expect(sent("desktopWorkdirState").at(-1)).toMatchObject({ host: "local" });
  });

  it("desktopSelectRecentWorkdir drops a vanished directory with a toast", async () => {
    const { host, store, sent } = await readyHost();
    store.addRecentWorkdir({ host: "local", path: "/gone" });

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/gone",
    });

    // The stale entry is removed from recents; the notice is a toast so the
    // new-session picker stays visible.
    expect(store.getRecentWorkdirs()).not.toEqual(
      expect.arrayContaining([{ host: "local", path: "/gone" }]),
    );
    expect(
      shownToasts().some((t) =>
        t.message.includes("目录不存在：/gone，已从最近列表移除"),
      ),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
  });

  it("local and remote sessions in the same path stay separate agents", async () => {
    seedSshConfig("Host prod\n");
    h.existingPaths.add("/repo");
    const { host, store, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/repo",
    });
    const remoteAgent = lastAgent();
    fireUserMessage(remoteAgent); // the user chatted in the remote session, so it must survive

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/repo",
      host: "local",
    });
    const localAgent = lastAgent();

    expect(localAgent).not.toBe(remoteAgent);
    // readyHost's /work/a agent + one per path-host combination.
    expect(h.agentInstances.length).toBe(3);
    expect(remoteAgent.destroy).not.toHaveBeenCalled();
    expect(localAgent.destroy).not.toHaveBeenCalled();
    expect(store.getRecentWorkdirs()).toEqual(
      expect.arrayContaining([
        { host: "prod", path: "/repo" },
        { host: "local", path: "/repo" },
      ]),
    );

    registerAgentInIndex(remoteAgent);
    registerAgentInIndex(localAgent);
    const index = store.getSessionIndex();
    expect(
      index.find((e) => e.cwd === "/repo" && e.host === "prod"),
    ).toBeDefined();
    expect(
      index.find((e) => e.cwd === "/repo" && e.host === "local"),
    ).toBeDefined();

    // Picking the same remote path again starts a NEW session — selecting a
    // directory never reopens the one already open there (scenario 22), and the
    // two sessions in the same path stay separate processes either way.
    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/repo",
    });
    expect(h.agentInstances.length).toBe(4);
    const third = lastAgent();
    expect(third).not.toBe(remoteAgent);
    expect(third).not.toBe(localAgent);
    const panes = sent("desktopPanes").at(-1) as {
      panes: Array<{ sessionId: string; host: string }>;
    };
    expect(panes.panes[0]).toMatchObject({
      sessionId: third.sessionId,
      host: "prod",
    });
    expect(panes.panes[0].sessionId).not.toBe(remoteAgent.sessionId);
    // The sessions it replaced keep running — a directory pick never destroys
    // anything.
    expect(remoteAgent.destroy).not.toHaveBeenCalled();
    expect(localAgent.destroy).not.toHaveBeenCalled();
  });

  it("选同一目录再次打开时必须新开会话，不复用池中该目录的旧会话（场景 22）", async () => {
    const { host, sent } = await readyHost();
    const first = lastAgent(); // pane-1, /work/a
    registerAgentInIndex(first); // has content → stays alive in the pool when replaced
    h.existingPaths.add("/work/b");

    // The user picks another directory, then comes back to the first one.
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/b",
    });
    const second = lastAgent();
    expect(second).not.toBe(first);

    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });

    // 回到 /work/a 是「新对话」，不是「回到刚才那条对话」。
    expect(h.agentInstances.length).toBe(3);
    const third = lastAgent();
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/work/a" }),
    );
    const panes = sent("desktopPanes").at(-1) as {
      panes: Array<{ sessionId?: string }>;
    };
    expect(panes.panes[0].sessionId).toBe(third.sessionId);
    expect(panes.panes[0].sessionId).not.toBe(first.sessionId);
    // 旧会话仍在池中存活，只是不再显示在这个分屏。
    expect(first.destroy).not.toHaveBeenCalled();
  });

  it("desktopListRemoteDir replies with the resolved path and subdirectory list", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();
    h.dirListResults.push({
      resolvedPath: "/remote/repo/src",
      dirs: ["app", "lib"],
    });

    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "prod",
      path: "/remote/repo/src",
      requestId: "r9",
    });

    // The listing rides the host's daemon tunnel — the same host-agnostic
    // RPC the Web page uses (remote-control 场景 3), no ssh shell runs.
    expect(
      h.clientRequests.some(
        (r) =>
          r.method === "listDirectories" &&
          (r.params as { dir?: string })?.dir === "/remote/repo/src",
      ),
    ).toBe(true);
    expect(sent("desktopRemoteDirList")).toEqual([
      {
        command: "desktopRemoteDirList",
        host: "prod",
        requestId: "r9",
        resolvedPath: "/remote/repo/src",
        dirs: ["app", "lib"],
      },
    ]);
  });

  it("desktopListRemoteDir returns a retryable error in the reply on failure", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();
    h.dirListResults.push(new Error("目录不存在或不可读：/gone"));

    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "prod",
      path: "/gone",
      requestId: "r10",
    });

    expect(sent("desktopRemoteDirList")).toEqual([
      {
        command: "desktopRemoteDirList",
        host: "prod",
        requestId: "r10",
        error: "目录不存在或不可读：/gone",
      },
    ]);
    // No session side effects — the browser stays put for a retry.
    expect(h.agentInstances.length).toBe(1);
  });

  it("desktopListRemoteDir ignores local-host, empty-path and empty-requestId messages", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "local",
      path: "/x",
      requestId: "r1",
    });
    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "prod",
      path: "",
      requestId: "r2",
    });
    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "prod",
      path: "/x",
      requestId: "",
    });

    expect(h.clientRequests.some((r) => r.method === "listDirectories")).toBe(
      false,
    );
    expect(sent("desktopRemoteDirList")).toEqual([]);
  });

  it("a live remote session switch does not wait for the workflow-runs RPC", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    const { host, store, send, sent } = await readyHost();

    // Start a remote session — a live agent in the pool, bound to the pane.
    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    const remoteAgent = lastAgent();
    registerAgentInIndex(remoteAgent); // pool + index, keyed by host prod
    const remoteSessionId = remoteAgent.sessionId as string;

    // Park the remote session in the background (a closed pane also keeps its
    // agent running): activate a local historical session so the pane binds to
    // a different agent while the remote one stays live in the pool.
    store.upsertSession({
      sessionId: "sess-local",
      title: "Local history",
      workdir: "/work/a",
      cwd: "/work/a",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-local",
    });
    // Wait for the restore to fully settle — startPaneRestore pushes an
    // optimistic overlay (isRestoring: true) before the local agent binds, and
    // selecting the remote session while the pane is still bound to it would
    // early-return as "already shown".
    await vi.waitFor(() => {
      expect(sent("setInitialState").at(-1)).toMatchObject({
        session: { id: "sess-local" },
        isRestoring: false,
      });
    });
    expect(lastAgent()).not.toBe(remoteAgent);

    send.mockClear();

    // A congested SSH hop (the streaming session floods the connection with
    // notification lines) makes the workflow-runs round trip slow — it must
    // not delay the title + message switch to the live session.
    let resolveRuns!: (runs: unknown[]) => void;
    remoteAgent.getWorkflowRuns.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRuns = resolve;
        }),
    );

    const selectPromise = host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/remote/repo",
      sessionId: remoteSessionId,
    });

    // The switch lands immediately from cached state; the fresh workflow runs
    // refresh in the background and arrive afterwards.
    await vi.waitFor(() => {
      const first = sent("setInitialState")[0];
      expect(first?.session).toMatchObject({ id: remoteSessionId });
      expect(first?.messages).toHaveLength(1);
    });
    expect(remoteAgent.getWorkflowRuns).toHaveBeenCalled();

    resolveRuns([{ runId: "run-1" }]);
    await selectPromise;
    await vi.waitFor(() => {
      expect(sent("updateWorkflowRuns").at(-1)?.runs).toEqual([
        { runId: "run-1" },
      ]);
    });
  });

  it("a dropped tunnel releases the host entry so the next access re-attaches", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host } = createHost();

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const first = (await vi.mocked(connectRemoteDaemon).mock.results[0]
      .value) as Awaited<ReturnType<typeof connectRemoteDaemon>>;

    // The ssh tunnel died (network blip / host reboot) — the daemon keeps
    // running remotely, so the local host entry is released and the tunnel torn
    // down; a later access re-attaches through a fresh tunnel (spec scenario 10).
    h.closedHandlers[0]();
    expect(first.tunnel.kill).toHaveBeenCalledTimes(1);

    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(2);
    });
    // A fresh client registered its own disconnect handler.
    expect(h.closedHandlers).toHaveLength(2);
  });

  it("a dropped tunnel detaches host agents without destroying them and auto-reconnects the pane (真后台)", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    const { host, sent } = await readyHost();

    // A remote session is live in the pool and bound to the pane.
    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const remoteAgent = lastAgent();
    registerAgentInIndex(remoteAgent);
    remoteAgent.isStreaming = true;
    remoteAgent.callbacks.onLoadingChange(true);
    const sessionId = remoteAgent.sessionId as string;
    expect(
      treeSessions(sent("desktopSessionTree").at(-1)).find(
        (s) => s.sessionId === sessionId,
      )?.running,
    ).toBe(true);

    h.closedHandlers[0]();

    // The session keeps running on the remote daemon — the pool agent is
    // released, never destroyed (destroy would kill the background task).
    expect(remoteAgent.destroy).not.toHaveBeenCalled();
    // The pane auto-reconnects through a fresh tunnel (spec: SSH 远程会话自动重连
    // scenario 1): a new agent re-attaches the same session and re-binds the
    // pane, without the user re-selecting it from the sidebar.
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(2);
    });
    expect(h.closedHandlers).toHaveLength(2); // the fresh client registered its own handler
    const reconnected = lastAgent();
    expect(reconnected).not.toBe(remoteAgent);
    expect(reconnected.sessionId).toBe(sessionId);
    await vi.waitFor(() => {
      const panes = sent("desktopPanes").at(-1) as {
        panes: Array<{ sessionId?: string; host: string }>;
      };
      expect(panes.panes[0].sessionId).toBe(sessionId);
      expect(panes.panes[0].host).toBe("prod");
    });
    // The transcript is pulled into the re-attached pane (消息 catch-up: spec
    // scenario 3 — messages produced while detached must be visible). The host
    // keeps no copy of its own, so the proof is the snapshot the pane got.
    await vi.waitFor(() => {
      const pushed = sent("setInitialState").flatMap(
        (m) => (m.messages as Array<{ id?: string }>) ?? [],
      );
      expect(pushed.some((m) => m.id === "restored-u1")).toBe(true);
    });
    expect("messages" in reconnected).toBe(false);
  });

  it("auto-reconnect re-roots the session at its stable root, not the bash-cd'd subdir", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    const { host, store } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const remoteAgent = lastAgent();
    // No index entry: a message-less session is never registered (FR-024), so
    // the reconnect target has no `entry.cwd` to fall back on.
    expect(
      store
        .getSessionIndex()
        .find((e) => e.sessionId === remoteAgent.sessionId),
    ).toBeUndefined();
    // The agent ran `cd src` — the CLI broadcast workdirChange, drifting its
    // currentWorkdir while sessionCwd stays the initialize-time root.
    remoteAgent.currentWorkdir = "/remote/repo/src";
    remoteAgent.callbacks.onWorkdirChange("/remote/repo/src");
    expect(remoteAgent.sessionCwd).toBe("/remote/repo");

    h.closedHandlers[0]();

    // The reconnect spawns the replacement at the session root — rooting it at
    // the drifted subdir would silently re-home the session a level down.
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(2);
    });
    const reconnected = lastAgent();
    expect(reconnected).not.toBe(remoteAgent);
    expect(reconnected.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: "/remote/repo" }),
    );
  });

  it("auto-reconnect gives up after the backoff cap, leaving the pane as a new session with a final message", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const remoteAgent = lastAgent();
    registerAgentInIndex(remoteAgent);
    const sessionId = remoteAgent.sessionId as string;

    // The initial attach (above) succeeded; every reconnect attempt fails —
    // the tunnel cannot be re-established while the network is still down.
    // Once-mocks expire so they can't leak into later tests.
    for (let i = 0; i < 5; i++) {
      vi.mocked(connectRemoteDaemon).mockRejectedValueOnce(
        new Error("tunnel down"),
      );
    }
    // Shrink the backoff so all five attempts finish in milliseconds.
    (
      DesktopHost as unknown as { autoReconnectBaseDelayMs: number }
    ).autoReconnectBaseDelayMs = 1;
    h.closedHandlers[0]();

    // The sequence caps out: five retries, then a final give-up message.
    await vi.waitFor(() => {
      expect(
        sent("appendMessage").some((m) =>
          JSON.stringify(m).includes("自动重连失败（已尝试 5 次）"),
        ),
      ).toBe(true);
    });
    // 5 reconnect attempts on top of the original attach.
    expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(6);
    // The pane is back to the new-session state on the same host — the session
    // still exists remotely, detached (spec scenario 10: no ghost running marker).
    await vi.waitFor(() => {
      const panes = sent("desktopPanes").at(-1) as {
        panes: Array<{ sessionId?: string; host: string }>;
      };
      expect(panes.panes[0].sessionId).toBeUndefined();
      expect(panes.panes[0].host).toBe("prod");
    });
    const sessions = treeSessions(sent("desktopSessionTree").at(-1));
    expect(sessions.find((s) => s.sessionId === sessionId)?.running).toBe(
      false,
    );
  });

  it("auto-reconnect waits out the post-resume network grace before attempting, then re-attaches (sleep-wake)", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const remoteAgent = lastAgent();
    registerAgentInIndex(remoteAgent);
    const sessionId = remoteAgent.sessionId as string;

    // The system woke from sleep (resume fired) and the stale tunnel is then
    // detected dead — the reconnect must NOT burn its first attempt on the
    // still-recovering network: it waits out the grace period first (spec
    // scenario 2/11), then re-attaches the same session.
    (
      DesktopHost as unknown as { autoReconnectResumeGraceMs: number }
    ).autoReconnectResumeGraceMs = 40;
    (
      DesktopHost as unknown as { autoReconnectBaseDelayMs: number }
    ).autoReconnectBaseDelayMs = 1;
    powerMonitor.__resume();
    const t0 = Date.now();
    h.closedHandlers[0]();

    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(2);
    });
    // The attempt only started after the grace period elapsed.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    const reconnected = lastAgent();
    expect(reconnected).not.toBe(remoteAgent);
    expect(reconnected.sessionId).toBe(sessionId);
    await vi.waitFor(() => {
      const panes = sent("desktopPanes").at(-1) as {
        panes: Array<{ sessionId?: string; host: string }>;
      };
      expect(panes.panes[0].sessionId).toBe(sessionId);
    });
  });

  it("dispose unsubscribes from powerMonitor resume events", async () => {
    const { host } = createHost();
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.dispose();

    expect(powerMonitor.off).toHaveBeenCalledWith(
      "resume",
      expect.any(Function),
    );
    powerMonitor.__resume(); // must not throw / leak — no listeners left
  });

  it("a user action supersedes the auto-reconnect (retries stop, the half-spawned agent is discarded)", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    h.existingPaths.add("/remote/repo");
    h.existingPaths.add("/remote/other");
    const { host, store, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/remote/repo",
    });
    await vi.waitFor(() => expect(h.closedHandlers).toHaveLength(1));
    const remoteAgent = lastAgent();
    registerAgentInIndex(remoteAgent);

    // Park the auto-reconnect's first spawn so the user can act first.
    // [0] = readyHost's local agent, [1] = the remote session agent,
    // [2] = the reconnect's agent (parked on the gate).
    let releaseInitialize!: () => void;
    h.initializeGate = new Promise<void>(
      (resolve) => (releaseInitialize = resolve),
    );
    h.closedHandlers[0]();
    await vi.waitFor(() => expect(h.agentInstances.length).toBe(3)); // reconnect's agent spawned, parked

    // The user picks a different remote session while the reconnect is in flight.
    store.upsertSession({
      sessionId: "other-1",
      title: "Other remote",
      host: "prod",
      workdir: "/remote/other",
      cwd: "/remote/other",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    const selectPromise = host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/remote/other",
      sessionId: "other-1",
    });
    await vi.waitFor(() => expect(h.agentInstances.length).toBe(4)); // user's restore spawned, parked

    releaseInitialize();
    await selectPromise;

    // The user's selection wins: the pane binds the other session…
    await vi.waitFor(() => {
      const panes = sent("desktopPanes").at(-1) as {
        panes: Array<{ sessionId?: string; host: string }>;
      };
      expect(panes.panes[0].sessionId).toBe("other-1");
      expect(panes.panes[0].host).toBe("prod");
    });
    // …the reconnect's half-spawned agent is discarded…
    const reconnectAgent = h.agentInstances[2] as unknown as {
      destroy: ReturnType<typeof vi.fn>;
    };
    await vi.waitFor(() => expect(reconnectAgent.destroy).toHaveBeenCalled());
    // …and the sequence stops: no further tunnel attempts beyond the reconnect's first.
    await vi.waitFor(() => {
      expect(vi.mocked(connectRemoteDaemon)).toHaveBeenCalledTimes(2);
    });
  });

  it("re-attaching a session re-surfaces approvals the daemon held while detached", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = await readyHost();
    h.existingPaths.add("/remote/repo");
    store.upsertSession({
      sessionId: "rem-1",
      title: "Remote history",
      host: "prod",
      workdir: "/remote/repo",
      cwd: "/remote/repo",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    // The daemon held this approval while no client was attached (spec
    // scenarios 4/5) — attach must resurface it as a normal dialog.
    h.pendingPermissionRequests = [
      {
        requestId: "req-9",
        sessionId: "rem-1",
        context: {
          toolName: BASH_TOOL_NAME,
          toolInput: { command: "npm run build" },
        },
      },
    ];

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/remote/repo",
      sessionId: "rem-1",
    });

    // The restore (spawn + transcript replay) runs behind the overlay, then the
    // held approval resurfaced as the same dialog a live session would show.
    await vi.waitFor(() => {
      expect(sent("showConfirmation")).toHaveLength(1);
    });
    expect(sent("showConfirmation")[0]).toMatchObject({
      toolName: BASH_TOOL_NAME,
      confirmationType: "命令执行待确认",
    });
    expect(
      h.clientRequests.some((r) => r.method === "listPendingPermissions"),
    ).toBe(true);

    // Approving the resurfaced dialog resumes the task on the daemon.
    const confirmationId = sent("showConfirmation")[0].confirmationId as string;
    await host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId,
      approved: true,
    });
    expect(lastAgent().sendPermissionResponse).toHaveBeenCalledWith("req-9", {
      behavior: "allow",
    });
  });
});

// ---------------------------------------------------------------------------
// Remote preview: SSH port forwarding (spec scenarios 15-18)
// ---------------------------------------------------------------------------

describe("remote preview port forwarding", () => {
  type HostWithFwd = DesktopHost & {
    portForwardManager: {
      acquire: ReturnType<typeof vi.fn>;
      releaseSession: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      forwardAuthCallback: ReturnType<typeof vi.fn>;
    };
  };

  it("desktopForwardPort acquires on the pane host and posts the rewritten URL", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    const fwd = (host as unknown as HostWithFwd).portForwardManager;

    await host.handleWebviewMessage({
      command: "desktopForwardPort",
      host: "prod",
      requestId: "r1",
      url: "http://localhost:5173/app",
      sessionId: "s1",
    });

    expect(fwd.acquire).toHaveBeenCalledWith(
      "prod",
      "http://localhost:5173/app",
      "s1",
    );
    expect(sent("desktopForwardPortResult")).toEqual([
      {
        command: "desktopForwardPortResult",
        paneId: "pane-1",
        requestId: "r1",
        url: "http://127.0.0.1:5173/app",
        originalUrl: "http://localhost:5173/app",
      },
    ]);
  });

  it("desktopForwardPort defaults the host to the pane host when omitted", async () => {
    const { host, sent } = await readyHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;

    await host.handleWebviewMessage({
      command: "desktopForwardPort",
      requestId: "r1",
      url: "http://localhost:5173/app",
    });

    expect(fwd.acquire).toHaveBeenCalledWith(
      "local",
      "http://localhost:5173/app",
      undefined,
    );
    expect(sent("desktopForwardPortResult")).toHaveLength(1);
  });

  it("desktopForwardPort failure posts the error instead of the URL", async () => {
    const { host, sent } = createHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;
    fwd.acquire.mockRejectedValueOnce(new Error("转发建立超时"));

    await host.handleWebviewMessage({
      command: "desktopForwardPort",
      host: "prod",
      requestId: "r2",
      url: "http://localhost:5173/app",
    });

    expect(sent("desktopForwardPortResult")).toEqual([
      {
        command: "desktopForwardPortResult",
        paneId: "pane-1",
        requestId: "r2",
        error: "转发建立超时",
      },
    ]);
  });

  it("closing a pane keeps its session's tunnel alive", async () => {
    const { host, sent } = await readyHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      const panes = sent("desktopPanes").at(-1) as
        | { panes: Array<{ sessionId?: string }> }
        | undefined;
      expect(panes?.panes[1].sessionId).toBe("sess-2");
    });
    const layout = sent("desktopPanes").at(-1) as {
      panes: Array<{ paneId: string }>;
    };

    // A session-bound tunnel exists before the pane closes.
    await host.handleWebviewMessage({
      command: "desktopForwardPort",
      host: "prod",
      requestId: "r1",
      url: "http://localhost:5173/app",
      sessionId: "sess-1",
    });

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: layout.panes[1].paneId,
    });

    // Pane closed but the session stays in the tree — the tunnel survives
    // (scenario 18); only deleting the session releases it.
    expect(fwd.releaseSession).not.toHaveBeenCalled();
    expect(fwd.acquire).toHaveBeenCalledWith(
      "prod",
      "http://localhost:5173/app",
      "sess-1",
    );
  });

  it("desktopDeleteSession releases the deleted session's tunnels", async () => {
    const { host } = createHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;

    await host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: "s1",
    });

    expect(fwd.releaseSession).toHaveBeenCalledWith("s1");
  });

  it("dispose tears down the port forward manager", async () => {
    const { host } = createHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;

    await host.dispose();

    expect(fwd.dispose).toHaveBeenCalled();
  });

  // Remote SSO login (spec scenario 8): the daemon's callback server listens on
  // the remote 127.0.0.1, so the desktop must forward the callback port over
  // SSH and open the REWRITTEN auth URL in the browser — opening the raw URL
  // redirects to an empty local port and the login hangs.
  const remoteAuthUrl =
    "https://sso.example.test/login?client_id=x&callback_url=http%3A%2F%2F127.0.0.1%3A8765";
  const forwardedAuthUrl =
    "https://sso.example.test/login?client_id=x&callback_url=http%3A%2F%2F127.0.0.1%3A3456";
  async function selectRemoteHost(): Promise<DesktopHost> {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    return host;
  }

  it("remote authUrl forwards the callback port and opens the rewritten URL", async () => {
    const host = await selectRemoteHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;
    fwd.forwardAuthCallback.mockResolvedValue({
      authUrl: forwardedAuthUrl,
      close: vi.fn(),
    });

    h.authUrlHandler?.({ url: remoteAuthUrl });

    await vi.waitFor(() =>
      expect(fwd.forwardAuthCallback).toHaveBeenCalledWith(
        "prod",
        remoteAuthUrl,
      ),
    );
    expect(shell.openExternal).toHaveBeenCalledWith(forwardedAuthUrl);
  });

  it("handleLogin closes the callback tunnel once the login settles", async () => {
    const host = await selectRemoteHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;
    const close = vi.fn();
    fwd.forwardAuthCallback.mockResolvedValue({
      authUrl: forwardedAuthUrl,
      close,
    });
    h.authUrlHandler?.({ url: remoteAuthUrl });
    await vi.waitFor(() => expect(fwd.forwardAuthCallback).toHaveBeenCalled());

    await host.handleWebviewMessage({ command: "login" });

    // No orphan ssh process: the tunnel dies with the login request.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("authUrl forward failure surfaces an error and does not open the browser", async () => {
    const host = await selectRemoteHost();
    const fwd = (host as unknown as HostWithFwd).portForwardManager;
    fwd.forwardAuthCallback.mockRejectedValue(
      new Error("ssh: command not found"),
    );

    h.authUrlHandler?.({ url: remoteAuthUrl });

    await vi.waitFor(() => expect(fwd.forwardAuthCallback).toHaveBeenCalled());
    await vi.waitFor(() => expect(shell.openExternal).not.toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// file panel (spec 文件面板 scenarios: local/remote reads, truncation, images)
// ---------------------------------------------------------------------------

describe("file panel", () => {
  function seedLocalFile(p: string, content: string | Buffer) {
    h.files.set(p, content);
    h.existingPaths.add(p);
  }

  // ── 目录树（spec desktop-file-panel.md「文件面板工作区目录树」）──

  it("desktopListDirectory lists one level through the host's client and echoes the path", async () => {
    const { host, sent } = await readyHost();
    h.dirEntriesResults.push({
      resolvedPath: "/work/a",
      entries: [
        { name: "src", type: "dir" },
        { name: "README.md", type: "file" },
      ],
      total: 2,
    });

    await host.handleWebviewMessage({
      command: "desktopListDirectory",
      path: "/work/a",
    });

    // Ordering / junk filtering / the per-level cap all live behind this RPC,
    // so the host is a pass-through — local and remote cannot drift.
    expect(
      h.clientRequests.some(
        (r) =>
          r.method === "listDirectoryEntries" &&
          (r.params as { dir?: string })?.dir === "/work/a",
      ),
    ).toBe(true);
    expect(sent("desktopDirEntries")).toEqual([
      {
        command: "desktopDirEntries",
        paneId: "pane-1",
        path: "/work/a",
        entries: [
          { name: "src", type: "dir" },
          { name: "README.md", type: "file" },
        ],
        total: 2,
      },
    ]);
  });

  it("desktopListDirectory replies a retryable error instead of an empty level", async () => {
    const { host, sent } = await readyHost();
    h.dirEntriesResults.push(new Error("目录不存在或不可读：/gone"));

    await host.handleWebviewMessage({
      command: "desktopListDirectory",
      path: "/gone",
    });

    // No `entries: []` — an empty level would render as 「空目录」, which is a
    // different fact from "we could not read it".
    expect(sent("desktopDirEntries")).toEqual([
      {
        command: "desktopDirEntries",
        paneId: "pane-1",
        path: "/gone",
        error: "目录不存在或不可读：/gone",
      },
    ]);
  });

  it("desktopListDirectory on a remote pane lists through that host's connection", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    h.dirEntriesResults.push({
      resolvedPath: "/remote/repo/src",
      entries: [{ name: "main.ts", type: "file" }],
      total: 1,
    });

    await host.handleWebviewMessage({
      command: "desktopListDirectory",
      path: "/remote/repo/src",
    });

    // The remote level comes over the daemon tunnel, not an ssh shell of its own
    // — the same channel the session's own RPCs use (scenario 8).
    expect(
      h.clientRequests.some(
        (r) =>
          r.method === "listDirectoryEntries" &&
          (r.params as { dir?: string })?.dir === "/remote/repo/src",
      ),
    ).toBe(true);
    expect(sent("desktopDirEntries")).toEqual([
      {
        command: "desktopDirEntries",
        paneId: "pane-1",
        path: "/remote/repo/src",
        entries: [{ name: "main.ts", type: "file" }],
        total: 1,
      },
    ]);
  });

  it("openFile reads a local text file and pushes desktopFileContent", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/src.ts", "const x = 1;\nconst y = 2;\n");

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/src.ts",
      startLine: 2,
      endLine: 2,
    });

    expect(sent("desktopFileContent")).toEqual([
      {
        command: "desktopFileContent",
        paneId: "pane-1",
        fileView: {
          path: "/work/a/src.ts",
          host: "local",
          content: "const x = 1;\nconst y = 2;\n",
          truncated: false,
          totalLines: 2,
          startLine: 2,
          endLine: 2,
          // 整份文件读到 + 路径在会话工作目录内 → 面板内可编辑（保存要用这个
          // hash 做乐观并发校验）。
          contentHash: createHash("sha256")
            .update("const x = 1;\nconst y = 2;\n")
            .digest("hex"),
          editable: true,
        },
      },
    ]);
  });

  it("openFile truncates text files past the line cap and still reports the total", async () => {
    const { host, sent } = await readyHost();
    const content = `${"a\n".repeat(REMOTE_FILE_MAX_LINES)}b`; // 2001 lines
    seedLocalFile("/work/a/big.log", content);

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/big.log",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      truncated: true,
      totalLines: REMOTE_FILE_MAX_LINES + 1,
    });
    expect(fv.content).toBe(`a\n`.repeat(REMOTE_FILE_MAX_LINES - 1) + "a");
  });

  it("openFile truncates files past the byte cap without a line count", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/huge.txt", "x".repeat(REMOTE_FILE_MAX_BYTES + 5));

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/huge.txt",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({ truncated: true });
    expect(fv.totalLines).toBeUndefined();
    expect((fv.content as string).length).toBe(REMOTE_FILE_MAX_BYTES);
  });

  it("openFile inlines a local image as base64", async () => {
    const { host, sent } = await readyHost();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    seedLocalFile("/work/a/icon.png", png);

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/icon.png",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/work/a/icon.png",
      host: "local",
      imageBase64: `data:image/png;base64,${png.toString("base64")}`,
    });
  });

  it("openFile reports NUL-containing files as binary without a system message", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/font.bin", "abc\x00def");
    const msgsBefore = sent("appendMessage").length;

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/font.bin",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/work/a/font.bin",
      host: "local",
      error: "二进制文件无法在面板中显示",
    });
    expect(sent("appendMessage").length).toBe(msgsBefore);
  });

  it("openFile pushes a panel error for a missing file (no system message)", async () => {
    const { host, sent } = await readyHost();
    const msgsBefore = sent("appendMessage").length;

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/nope.ts",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/work/a/nope.ts",
      host: "local",
      error: "文件不存在：/work/a/nope.ts",
      // 「路径已不在」标出来，面板才好把标签标成不可用而不是给一条错误横幅
      // （spec desktop-file-panel.md 场景 13）。
      missing: true,
    });
    expect(sent("appendMessage").length).toBe(msgsBefore);
  });

  it("openFile rejects directories with a panel error", async () => {
    const { host, sent } = await readyHost();
    h.existingPaths.add("/work/a/subdir");
    h.dirPaths.add("/work/a/subdir");

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/subdir",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({ error: "无法在面板中显示目录" });
  });

  it("previewImage routes an image through the file panel", async () => {
    const { host, sent } = await readyHost();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    seedLocalFile("/work/a/logo.png", png);

    await host.handleWebviewMessage({
      command: "previewImage",
      path: "/work/a/logo.png",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/work/a/logo.png",
      imageBase64: `data:image/png;base64,${png.toString("base64")}`,
    });
  });

  it("openFile on a remote pane reads via ssh and maps the result", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/remote/src.ts",
      startLine: 5,
      endLine: 10,
    });

    expect(vi.mocked(readRemoteFile)).toHaveBeenCalledWith(
      "prod",
      "/remote/src.ts",
    );
    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/remote/src.ts",
      host: "prod",
      content: "remote content",
      startLine: 5,
      endLine: 10,
    });
  });

  it("openFile on a remote pane maps an image result to base64", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    vi.mocked(readRemoteFile).mockResolvedValueOnce({
      type: "image",
      mime: "image/png",
      imageBase64: "data:image/png;base64,aGVsbG8=",
    });

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/remote/pic.png",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/remote/pic.png",
      host: "prod",
      imageBase64: "data:image/png;base64,aGVsbG8=",
    });
  });

  it("openFile on a remote pane maps ssh read failures to a panel error", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    vi.mocked(readRemoteFile).mockRejectedValueOnce(
      new Error("远端文件不存在：/remote/nope.ts"),
    );

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/remote/nope.ts",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({
      path: "/remote/nope.ts",
      host: "prod",
      error: "远端文件不存在：/remote/nope.ts",
      // 远端 exit 3 也归到「路径已不在」（remoteCli.ts 的措辞）。
      missing: true,
    });
  });

  it("desktopOpenFileExternal opens the path in the OS default app", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopOpenFileExternal",
      path: "/work/a/src.ts",
    });

    expect(shell.openPath).toHaveBeenCalledWith("/work/a/src.ts");
  });

  it("desktopOpenFileExternal reports open failures as a system message", async () => {
    const { host, sent } = await readyHost();
    vi.mocked(shell.openPath).mockResolvedValueOnce("no app registered");

    await host.handleWebviewMessage({
      command: "desktopOpenFileExternal",
      path: "/work/a/src.ts",
    });

    expect(
      sent("appendMessage").some((m) =>
        JSON.stringify(m).includes("打开文件失败: no app registered"),
      ),
    ).toBe(true);
  });

  // ---- 面板内编辑与保存（spec desktop-file-panel.md「文件面板内编辑与保存」）----
  // 路径与相邻用例一样用原样字符串：mock 的 key 就是消息里的 path，宿主内部
  // 的 realpath / path.resolve 只用于两端比较，不参与 key 匹配。

  const sha = (text: string | Buffer) =>
    createHash("sha256").update(text).digest("hex");

  const saveFile = (
    host: Awaited<ReturnType<typeof readyHost>>["host"],
    msg: Record<string, unknown>,
  ) =>
    host.handleWebviewMessage({
      command: "desktopSaveFile",
      requestId: "save-1",
      ...msg,
    } as Parameters<typeof host.handleWebviewMessage>[0]);

  it("desktopSaveFile writes the draft atomically and replies with the new hash", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/src.ts", "alpha one");

    await saveFile(host, {
      path: "/work/a/src.ts",
      content: "alpha two",
      contentHash: sha("alpha one"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "saved",
        contentHash: sha("alpha two"),
      },
    ]);
    expect(h.files.get("/work/a/src.ts")).toBe("alpha two");
    // 同目录临时文件已经 rename 掉，不留在磁盘上。
    expect([...h.files.keys()].some((p) => p.includes("wave-save"))).toBe(
      false,
    );
  });

  it("desktopSaveFile refuses a panel that has no hash for the file", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/big.log", "alpha");

    await saveFile(host, {
      path: "/work/a/big.log",
      content: "beta",
      contentHash: undefined,
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "denied",
        message: "该文件不支持在面板内编辑",
      },
    ]);
    expect(h.files.get("/work/a/big.log")).toBe("alpha");
  });

  it("desktopSaveFile refuses a remote pane (remote panels stay read-only)", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });

    await saveFile(host, {
      path: "/remote/src.ts",
      content: "beta",
      contentHash: sha("alpha"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "denied",
        message: "远端会话的文件不能在面板内保存",
      },
    ]);
  });

  it("desktopSaveFile refuses a path outside the session workdir", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/etc/passwd", "alpha");

    await saveFile(host, {
      path: "/etc/passwd",
      content: "beta",
      contentHash: sha("alpha"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "denied",
        message: "该文件在会话工作目录之外，不能保存",
      },
    ]);
    expect(h.files.get("/etc/passwd")).toBe("alpha");
  });

  it("a symlink inside the workdir is neither editable nor writable", async () => {
    const { host, sent } = await readyHost();
    // workdir 里放一个指向外部的软链：两端 realpath 一比就露馅。
    seedLocalFile("/work/a/link.ts", "alpha");
    seedLocalFile("/tmp/evil.ts", "alpha");
    h.realpaths.set("/work/a/link.ts", "/tmp/evil.ts");

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/link.ts",
    });

    expect(
      (
        sent("desktopFileContent").at(-1) as {
          fileView: Record<string, unknown>;
        }
      ).fileView,
    ).toMatchObject({ editable: false });

    await saveFile(host, {
      path: "/work/a/link.ts",
      content: "beta",
      contentHash: sha("alpha"),
    });

    expect(sent("desktopFileSaveResult").at(-1)).toMatchObject({
      status: "denied",
      message: "该文件在会话工作目录之外，不能保存",
    });
    expect(h.files.get("/tmp/evil.ts")).toBe("alpha");
  });

  it("desktopSaveFile reports a disappeared file as a conflict", async () => {
    const { host, sent } = await readyHost();

    await saveFile(host, {
      path: "/work/a/gone.ts",
      content: "beta",
      contentHash: sha("alpha"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "conflict",
        message: "文件已被删除，无法保存",
      },
    ]);
  });

  it("desktopSaveFile refuses to overwrite a disk copy that moved on", async () => {
    const { host, sent } = await readyHost();
    // 面板读到的是 "alpha one"，磁盘已经是 agent 改过的 "alpha two"。
    seedLocalFile("/work/a/src.ts", "alpha two");

    await saveFile(host, {
      path: "/work/a/src.ts",
      content: "alpha mine",
      contentHash: sha("alpha one"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "conflict",
        message: "文件已在磁盘上更新",
        // 冲突时回磁盘上的 hash：webview 拿它当「覆盖」的基底。
        contentHash: sha("alpha two"),
      },
    ]);
    expect(h.files.get("/work/a/src.ts")).toBe("alpha two");
  });

  it("desktopSaveFile surfaces a write failure and leaves no temp file behind", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/src.ts", "alpha one");
    h.writeFileError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });

    await saveFile(host, {
      path: "/work/a/src.ts",
      content: "alpha two",
      contentHash: sha("alpha one"),
    });

    expect(sent("desktopFileSaveResult")).toEqual([
      {
        command: "desktopFileSaveResult",
        paneId: "pane-1",
        requestId: "save-1",
        status: "error",
        message: "保存失败：没有写入权限",
      },
    ]);
    expect(h.files.get("/work/a/src.ts")).toBe("alpha one");
    expect([...h.files.keys()].some((p) => p.includes("wave-save"))).toBe(
      false,
    );
  });

  it("openFile marks a file outside the workdir as read-only", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/tmp/notes.txt", "alpha");

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/tmp/notes.txt",
    });

    expect(
      (
        sent("desktopFileContent").at(-1) as {
          fileView: Record<string, unknown>;
        }
      ).fileView,
    ).toMatchObject({ editable: false });
  });

  it("openFile marks a truncated file as read-only (no write-back of a partial read)", async () => {
    const { host, sent } = await readyHost();
    seedLocalFile("/work/a/huge.txt", "x".repeat(REMOTE_FILE_MAX_BYTES + 5));

    await host.handleWebviewMessage({
      command: "openFile",
      path: "/work/a/huge.txt",
    });

    const fv = (
      sent("desktopFileContent").at(-1) as { fileView: Record<string, unknown> }
    ).fileView;
    expect(fv).toMatchObject({ truncated: true, editable: false });
    expect(fv.contentHash).toBeUndefined();
  });
});

// spec: docs/specs/desktop/desktop-preview.md「本地 HTML 文件预览」— the host
// re-hosts a .html file on the (mocked) loopback server and replies with its
// URL keyed by requestId; errors reply with `error` so the webview falls back
// to the file panel (scenario 4). Remote sessions are content-level: bytes
// land in a userData cache dir keyed by host + parent-dir hash, which becomes
// the serve root (scenario 3).
describe("html preview (desktopPreviewFile)", () => {
  it("local file: serves the file's own directory and replies with the URL", async () => {
    const { host, sent } = await readyHost();
    h.files.set("/work/a/report.html", "<html>ok</html>");
    h.existingPaths.add("/work/a/report.html");

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/work/a/report.html",
      requestId: "req-1",
    });

    // The root is the file's parent dir (relative css/js/img resolve).
    expect(htmlPreviewMock.acquire).toHaveBeenCalledWith(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );
    expect(sent("desktopPreviewFileResult")).toEqual([
      {
        command: "desktopPreviewFileResult",
        paneId: "pane-1",
        requestId: "req-1",
        url: "http://127.0.0.1:45000/report.html",
      },
    ]);
  });

  it("missing local file replies with an error (webview falls back)", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/work/a/nope.html",
      requestId: "req-2",
    });

    expect(htmlPreviewMock.acquire).not.toHaveBeenCalled();
    expect(sent("desktopPreviewFileResult")).toEqual([
      {
        command: "desktopPreviewFileResult",
        paneId: "pane-1",
        requestId: "req-2",
        error: "文件不存在：/work/a/nope.html",
      },
    ]);
  });

  it("a directory path is not previewable (isFile gate)", async () => {
    const { host, sent } = await readyHost();
    h.existingPaths.add("/work/a/site");
    h.dirPaths.add("/work/a/site");

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/work/a/site",
      requestId: "req-dir",
    });

    expect(htmlPreviewMock.acquire).not.toHaveBeenCalled();
    expect(sent("desktopPreviewFileResult").at(-1)).toMatchObject({
      requestId: "req-dir",
      error: "文件不存在：/work/a/site",
    });
  });

  it("remote file: reads via ssh, caches under host+dir-hash, serves the cache dir", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    vi.mocked(readRemoteFile).mockResolvedValueOnce({
      type: "text",
      mime: "text/html",
      contentBase64: Buffer.from("<html>remote</html>").toString("base64"),
      truncated: false,
    });

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/remote/site/report.html",
      requestId: "req-3",
    });

    expect(vi.mocked(readRemoteFile)).toHaveBeenCalledWith(
      "prod",
      "/remote/site/report.html",
    );
    // The bytes landed in the userData cache (content-level re-hosting);
    // the dir segment is the sha1 of the remote parent directory.
    const dirHash = createHash("sha1")
      .update("/remote/site")
      .digest("hex")
      .slice(0, 10);
    // userData lives on the local disk, so the cache path is built with the
    // platform separator (the host does the same via path.join).
    const cacheDir = path.join(
      "/tmp/wave-desktop-test-userData",
      "html-preview-cache",
      "prod",
      dirHash,
    );
    expect(h.files.get(path.join(cacheDir, "report.html"))).toBe(
      "<html>remote</html>",
    );
    // The release key stays the clicked path, not the cache path.
    expect(htmlPreviewMock.acquire).toHaveBeenCalledWith(
      "pane-1",
      cacheDir,
      path.join(cacheDir, "report.html"),
      "/remote/site/report.html",
    );
    expect(sent("desktopPreviewFileResult").at(-1)).toMatchObject({
      requestId: "req-3",
      url: "http://127.0.0.1:45000/report.html",
    });
  });

  it("remote same-basename files in different dirs use distinct cache dirs", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    vi.mocked(readRemoteFile).mockResolvedValue({
      type: "text",
      mime: "text/html",
      contentBase64: Buffer.from("x").toString("base64"),
      truncated: false,
    });

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/remote/a/index.html",
      requestId: "r1",
    });
    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/remote/b/index.html",
      requestId: "r2",
    });

    const roots = htmlPreviewMock.acquire.mock.calls.map((c) => c[1]);
    expect(roots[0]).not.toBe(roots[1]);
  });

  it("remote binary or oversized files reply with an error", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, sent } = createHost();
    await host.handleWebviewMessage({
      command: "desktopSelectHost",
      host: "prod",
    });
    vi.mocked(readRemoteFile).mockResolvedValueOnce({
      type: "image",
      mime: "image/png",
      imageBase64: "data:image/png;base64,aGVsbG8=",
    });

    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/remote/pic.png",
      requestId: "req-4",
    });

    expect(htmlPreviewMock.acquire).not.toHaveBeenCalled();
    expect(sent("desktopPreviewFileResult").at(-1)).toMatchObject({
      requestId: "req-4",
      error: "该文件不是可预览的 HTML 文本",
    });

    vi.mocked(readRemoteFile).mockResolvedValueOnce({
      type: "text",
      mime: "text/html",
      contentBase64: Buffer.from("x").toString("base64"),
      truncated: true,
    });
    await host.handleWebviewMessage({
      command: "desktopPreviewFile",
      path: "/remote/big.html",
      requestId: "req-5",
    });
    expect(sent("desktopPreviewFileResult").at(-1)).toMatchObject({
      requestId: "req-5",
      error: "文件过大，无法预览",
    });
  });

  it("desktopPreviewFileRelease forwards pane + path to the server", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopPreviewFileRelease",
      path: "/work/a/report.html",
    });

    expect(htmlPreviewMock.release).toHaveBeenCalledWith(
      "pane-1",
      "/work/a/report.html",
    );
  });

  it("release without a path is ignored (no crash)", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopPreviewFileRelease",
    });

    expect(htmlPreviewMock.release).not.toHaveBeenCalled();
  });
});

describe("desktopGetWorkspaceDiff (diff panel)", () => {
  it("asks the CLI on the pane's host and echoes paneId + requestId", async () => {
    const { host, send } = await readyHost();
    h.workspaceDiffResult = {
      kind: "ok",
      base: {
        label: "origin/main",
        sha: "base123",
        kind: "default-branch",
        ref: "refs/remotes/origin/main",
      },
      scope: {
        kind: "commit",
        sha: "abc",
        shortSha: "abc",
        subject: "one commit",
      },
      commits: [],
      files: [],
    };

    await host.handleWebviewMessage({
      command: "desktopGetWorkspaceDiff",
      commit: "abc",
      requestId: 7,
    });

    // The workdir and the selected commit travel in one request; the diff runs
    // wherever the session's CLI runs, so a remote pane needs no ssh here.
    expect(h.clientRequests).toContainEqual({
      method: "getWorkspaceDiff",
      params: { workdir: "/work/a", commit: "abc" },
    });
    // A reply that lost its requestId can never be dropped as stale, and one
    // without a paneId cannot be routed — both silently freeze the panel.
    const reply = send.mock.calls
      .map(([, msg]) => msg as Record<string, unknown>)
      .find((msg) => msg.command === "desktopWorkspaceDiff");
    expect(reply).toMatchObject({ requestId: 7 });
    expect(typeof reply?.paneId).toBe("string");
    expect(reply?.result).toMatchObject({ scope: { kind: "commit" } });
  });

  it("omits the commit for a whole-range query", async () => {
    const { host } = await readyHost();
    h.workspaceDiffResult = { kind: "ok", base: null, commits: [], files: [] };

    await host.handleWebviewMessage({ command: "desktopGetWorkspaceDiff" });

    expect(h.clientRequests).toContainEqual({
      method: "getWorkspaceDiff",
      params: { workdir: "/work/a" },
    });
  });

  it("keeps measuring the session's workspace after a bash `cd`", async () => {
    const { host } = await readyHost();
    h.workspaceDiffResult = { kind: "ok", base: null, commits: [], files: [] };
    const agent = lastAgent();
    // The shell moved into a subdirectory (and could have moved into a nested
    // repo / worktree); the panel must stay on the session's workspace.
    agent.currentWorkdir = "/work/a/packages/webview";

    await host.handleWebviewMessage({ command: "desktopGetWorkspaceDiff" });

    expect(h.clientRequests).toContainEqual({
      method: "getWorkspaceDiff",
      params: { workdir: "/work/a" },
    });
  });

  it("follows the session into a worktree (EnterWorktree is a real relocation)", async () => {
    const { host } = await readyHost();
    h.workspaceDiffResult = { kind: "ok", base: null, commits: [], files: [] };
    const agent = lastAgent();
    agent.sessionCwd = "/work/a";
    agent.currentWorkdir = "/work/a/.wave/worktrees/feat";
    agent.workspaceRoot = "/work/a/.wave/worktrees/feat";

    await host.handleWebviewMessage({ command: "desktopGetWorkspaceDiff" });

    expect(h.clientRequests).toContainEqual({
      method: "getWorkspaceDiff",
      params: { workdir: "/work/a/.wave/worktrees/feat" },
    });
  });

  it("forwards the uncommitted viewing range to the CLI", async () => {
    const { host } = await readyHost();
    h.workspaceDiffResult = { kind: "ok", base: null, commits: [], files: [] };

    await host.handleWebviewMessage({
      command: "desktopGetWorkspaceDiff",
      scope: "uncommitted",
    });

    expect(h.clientRequests).toContainEqual({
      method: "getWorkspaceDiff",
      params: { workdir: "/work/a", scope: "uncommitted" },
    });
  });

  it("passes a transient git state through to the panel", async () => {
    const { host, send } = await readyHost();
    h.workspaceDiffResult = { kind: "transient", operation: "rebase" };

    await host.handleWebviewMessage({ command: "desktopGetWorkspaceDiff" });

    const reply = send.mock.calls
      .map(([, msg]) => msg as Record<string, unknown>)
      .find((msg) => msg.command === "desktopWorkspaceDiff");
    expect(reply?.result).toEqual({ kind: "transient", operation: "rebase" });
  });

  it("turns a failed diff request into the non-repo placeholder", async () => {
    const { host, send } = await readyHost();
    h.workspaceDiffError = new Error("Host unreachable");

    await host.handleWebviewMessage({ command: "desktopGetWorkspaceDiff" });

    const reply = send.mock.calls
      .map(([, msg]) => msg as Record<string, unknown>)
      .find((msg) => msg.command === "desktopWorkspaceDiff");
    expect(reply?.result).toEqual({ kind: "not-a-repo" });
  });
});

describe("notifyFullScreen (desktopFullScreen)", () => {
  it("pushes the window fullscreen state to the webview (window-global, no paneId)", async () => {
    const { host, sent } = await readyHost();

    host.notifyFullScreen(true);
    expect(sent("desktopFullScreen").at(-1)).toMatchObject({
      fullScreen: true,
    });

    host.notifyFullScreen(false);
    expect(sent("desktopFullScreen").at(-1)).toMatchObject({
      fullScreen: false,
    });
  });
});

// ---------------------------------------------------------------------------
// session rename (spec session-management.md「会话自定义标题（重命名）」)
// ---------------------------------------------------------------------------

describe("renameSession", () => {
  const entry = (
    sessionId: string,
    workdir: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    sessionId,
    title: "旧标题",
    workdir,
    cwd: workdir,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  });

  /** readyHost + one live session bound to the sole pane under pool key s1. */
  async function readyWithLiveSession(workdir = "/work/a") {
    const ctx = await readyHost();
    const agent = lastAgent();
    agent.currentWorkdir = workdir;
    fireSessionId(agent, "s1");
    ctx.store.upsertSession(entry("s1", workdir));
    return { ...ctx, agent };
  }

  it("writes through the session's host with its workdir, updates the index and pushes the new title", async () => {
    const { host, store, sent } = await readyWithLiveSession();

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "  我的标题  ",
      requestId: "r1",
    });

    // 权威存储是会话文件：写盘经拥有该会话的主机、带上会话所在目录。
    expect(h.clientRequests).toContainEqual({
      method: "renameSession",
      params: { sessionId: "s1", workdir: "/work/a", title: "我的标题" },
    });
    // 索引同步（侧边栏/看板/恢复后的头部都读它）。
    expect(
      store.getSessionIndex().find((e) => e.sessionId === "s1")?.title,
    ).toBe("我的标题");
    // 结果回传：ok + 原样带回顾问的 requestId/sessionId。
    expect(sent("sessionRenamed").at(-1)).toMatchObject({
      requestId: "r1",
      sessionId: "s1",
      title: "我的标题",
      ok: true,
    });
    // 侧边栏与会话看板的快照刷新也带上新标题。
    const tree = sent("desktopSessionTree").at(-1);
    const titles = (
      tree?.groups as Array<{ sessions: Array<{ title: string }> }>
    )?.flatMap((g) => g.sessions.map((s) => s.title));
    expect(titles).toContain("我的标题");
  });

  it("pushes the new title into every pane showing that session (header contract)", async () => {
    const { host, sent } = await readyWithLiveSession();

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "新标题",
      requestId: "r1",
    });

    const pushed = sent("updateCurrentSession").at(-1);
    expect(pushed).toMatchObject({
      session: { id: "s1", customTitle: "新标题" },
    });
    expect(typeof pushed?.paneId).toBe("string");
  });

  it("renames a session that is only in the index (not live) via its recorded workdir", async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession(entry("index-only", "/work/index", { host: "local" }));

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "index-only",
      title: "仅索引",
      requestId: "r2",
    });

    expect(h.clientRequests).toContainEqual({
      method: "renameSession",
      params: {
        sessionId: "index-only",
        workdir: "/work/index",
        title: "仅索引",
      },
    });
    expect(
      store.getSessionIndex().find((e) => e.sessionId === "index-only")?.title,
    ).toBe("仅索引");
    expect(sent("sessionRenamed").at(-1)).toMatchObject({ ok: true });
  });

  it("replies ok:false for a blank title without touching the disk", async () => {
    const { host, store, sent } = await readyWithLiveSession();
    const before = store
      .getSessionIndex()
      .find((e) => e.sessionId === "s1")?.title;

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "   ",
      requestId: "r3",
    });

    expect(h.clientRequests.some((r) => r.method === "renameSession")).toBe(
      false,
    );
    expect(
      store.getSessionIndex().find((e) => e.sessionId === "s1")?.title,
    ).toBe(before);
    expect(sent("sessionRenamed").at(-1)).toMatchObject({
      requestId: "r3",
      ok: false,
    });
  });

  it("replies ok:false and keeps the old index title when the write fails (never index-only success)", async () => {
    const { host, store, sent } = await readyWithLiveSession();
    const restore = failRpc("renameSession", "EACCES: permission denied");
    try {
      await host.handleWebviewMessage({
        command: "renameSession",
        sessionId: "s1",
        title: "写不进去",
        requestId: "r4",
      });
    } finally {
      restore();
    }

    const reply = sent("sessionRenamed").at(-1);
    expect(reply).toMatchObject({ requestId: "r4", ok: false });
    expect(reply?.error).toContain("EACCES");
    // 只写了本地索引会造成两端不一致 —— 失败时索引必须保持旧值。
    expect(
      store.getSessionIndex().find((e) => e.sessionId === "s1")?.title,
    ).toBe("旧标题");
  });

  it("replies ok:false with an actionable error when the session's workdir is unknown", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "ghost",
      title: "无家可归",
      requestId: "r5",
    });

    expect(h.clientRequests.some((r) => r.method === "renameSession")).toBe(
      false,
    );
    const reply = sent("sessionRenamed").at(-1);
    expect(reply).toMatchObject({ requestId: "r5", ok: false });
    expect(reply?.error).toBeTruthy();
  });

  // Regression: a session that ran `cd <subdir>` drifts the agent's
  // currentWorkdir (the CLI broadcasts workdirChange). Re-registering it on
  // rename must keep the sidebar group anchored to the session root, or the
  // renamed conversation "promotes" itself into a new subdir-named group.
  it("keeps the sidebar group when a bash cd drifted the working directory before the rename", async () => {
    const { host, store, sent, agent } = await readyWithLiveSession();
    // The agent ran `cd src` — mirror what the real StdioAgent does on
    // workdirChange: overwrite the field, then fire the notification.
    agent.currentWorkdir = "/work/a/src";
    agent.callbacks.onWorkdirChange("/work/a/src");

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "改个名",
      requestId: "r-drift",
    });

    const entry = store.getSessionIndex().find((e) => e.sessionId === "s1");
    expect(entry?.workdir).toBe("/work/a");
    expect(entry?.cwd).toBe("/work/a");
    const tree = sent("desktopSessionTree").at(-1);
    const groups = (tree?.groups as Array<{ workdir: string }>) ?? [];
    expect(groups.map((g) => g.workdir)).toEqual(["/work/a"]);
  });

  // The same drift on a remote (ssh) session: the group key is (host, workdir),
  // so the root must be negotiated per host just like a local one.
  it("keeps the sidebar group for a remote session after a bash cd drift", async () => {
    seedSshConfig("Host prod\n  HostName 10.0.0.1\n");
    const { host, store, sent } = await readyHost();
    store.upsertSession(entry("sess-remote", "/work/a", { host: "prod" }));
    // Open the remote session in a pane: spawns the agent under the 'prod' key
    // (the only way it reaches the re-registration path below).
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-remote",
    });
    // Wait for the restore to settle — the agent is only re-keyed to the
    // restored sessionId once spawn + restoreSession + getMessages are done.
    const paneId = (
      sent("desktopPanes").at(-1) as { panes: Array<{ paneId: string }> }
    ).panes.at(-1)!.paneId;
    await vi.waitFor(() => {
      expect(
        sent("setInitialState")
          .filter((m) => m.paneId === paneId)
          .at(-1),
      ).toMatchObject({
        isRestoring: false,
        session: { id: "sess-remote" },
      });
    });
    // The agent now live on 'prod' — cd inside the remote session drifts its cwd.
    const agent = lastAgent();
    agent.currentWorkdir = "/work/a/src";
    agent.callbacks.onWorkdirChange("/work/a/src");

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "sess-remote",
      title: "远端改个名",
      requestId: "r-drift-remote",
    });

    expect(sent("sessionRenamed").at(-1)).toMatchObject({ ok: true });
    const entryAfter = store
      .getSessionIndex()
      .find((e) => e.sessionId === "sess-remote");
    expect(entryAfter?.host).toBe("prod");
    expect(entryAfter?.workdir).toBe("/work/a");
    expect(entryAfter?.cwd).toBe("/work/a");
    const tree = sent("desktopSessionTree").at(-1);
    const groups =
      (tree?.groups as Array<{ host: string; workdir: string }>) ?? [];
    expect(groups).toEqual([
      expect.objectContaining({ host: "prod", workdir: "/work/a" }),
    ]);
  });

  // A worktree session's sidebar group is the repo root while its own files
  // live at the worktree path — a cd drift must not disturb either.
  it("keeps the worktree session grouped under the repo root after a bash cd drift", async () => {
    const { host, store, sent } = await readyHost();
    const agent = lastAgent();
    const worktree = {
      path: "/work/wt-1",
      branch: "wave/wt-1",
      baseBranch: "main",
      repoRoot: "/work/a",
    };
    // Register the worktree session the way spawnAgent does: the agent starts
    // at the worktree path and the host maps it to its worktree info.
    agent.currentWorkdir = "/work/wt-1";
    agent.sessionCwd = "/work/wt-1";
    fireSessionId(agent, "s1");
    store.upsertSession(
      entry("s1", "/work/a", { cwd: "/work/wt-1", worktree }),
    );
    // cd inside the worktree drifts the agent's cwd.
    agent.currentWorkdir = "/work/wt-1/src";
    agent.callbacks.onWorkdirChange("/work/wt-1/src");

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "worktree 改个名",
      requestId: "r-drift-wt",
    });

    const entryAfter = store
      .getSessionIndex()
      .find((e) => e.sessionId === "s1");
    expect(entryAfter?.workdir).toBe("/work/a");
    expect(entryAfter?.cwd).toBe("/work/wt-1");
    const tree = sent("desktopSessionTree").at(-1);
    const groups = (tree?.groups as Array<{ workdir: string }>) ?? [];
    expect(groups.map((g) => g.workdir)).toEqual(["/work/a"]);
  });
});

// ---------------------------------------------------------------------------
// 目录三口径：工作根（`workspaceRoot`）/ 会漂移的 `currentWorkdir` / 会话稳定根
//
// 判据：**用户眼前的项目**（文件面板目录树 / 差异面板 / `@` 文件搜索）用工作根
// `workspaceRoot` —— 起点是会话目录，EnterWorktree / ExitWorktree 才让它换；**终端
// 这类跟着 shell 走的**用被 bash `cd` 漂移的 `currentWorkdir`；**会话所属的项目**
// （项目级配置、会话元信息）用 initialize 时的 cwd（`sessionCwd`）。会话内 bash `cd`
// 只漂移中间那个——锚错会让项目级设置读写到嵌套子目录，或让用户眼前的面板换项目。
// ---------------------------------------------------------------------------

describe("项目根口径（sessionCwd / workspaceRoot vs 漂移的 currentWorkdir）", () => {
  /** 让分屏的会话「跑过一次 cd」：像真 StdioAgent 那样先覆盖字段、再发通知。 */
  function driftAgentTo(
    agent: ReturnType<typeof lastAgent>,
    dir: string,
  ): void {
    agent.currentWorkdir = dir;
    agent.callbacks.onWorkdirChange(dir);
  }

  /** 某个 RPC 每次调用带上的 workdir，按调用顺序。 */
  function rpcWorkdirs(method: string): unknown[] {
    return h.clientRequests
      .filter((r) => r.method === method)
      .map((r) => (r.params as { workdir?: string }).workdir);
  }

  it("项目级配置 RPC 一律以会话稳定根为项目根", async () => {
    const { host } = await readyHost();
    const agent = lastAgent();
    driftAgentTo(agent, "/work/a/src");
    expect(agent.sessionCwd).toBe("/work/a");

    await host.handleWebviewMessage({ command: "getProjectSettings" });
    await host.handleWebviewMessage({
      command: "getHooksConfig",
      scope: "project",
    });
    await host.handleWebviewMessage({
      command: "getMcpConfig",
      scope: "project",
    });
    await host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    await host.handleWebviewMessage({
      command: "getAgentsContent",
      scope: "project",
    });
    await host.handleWebviewMessage({
      command: "setAgentsContent",
      scope: "project",
      content: "# 项目规则",
    });

    // 六条 RPC 都读到项目根，而不是 agent 漂移后的子目录。
    for (const method of [
      "getProjectSettings",
      "getHooksConfig",
      "getMcpConfig",
      "setBuiltinPluginEnabled",
      "getAgentsContent",
      "setAgentsContent",
    ]) {
      expect(rpcWorkdirs(method)).toEqual(["/work/a"]);
    }
  });

  it("会话元信息（updateCurrentSession / setInitialState）以会话稳定根为项目目录", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    driftAgentTo(agent, "/work/a/src");

    // sessionId 变更（rekey）后的推送。
    fireSessionId(agent, "s1");
    expect(sent("updateCurrentSession").at(-1)?.session?.workdir).toBe(
      "/work/a",
    );

    // 分屏重新就绪时的整块重推。
    await host.handleWebviewMessage({ command: "webviewReady" });
    expect(sent("setInitialState").at(-1)?.session?.workdir).toBe("/work/a");
  });

  it("重命名后的会话推送同样保持会话稳定根", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    fireSessionId(agent, "s1");
    driftAgentTo(agent, "/work/a/src");

    await host.handleWebviewMessage({
      command: "renameSession",
      sessionId: "s1",
      title: "改个名",
      requestId: "r-project-root",
    });

    expect(sent("sessionRenamed").at(-1)).toMatchObject({ ok: true });
    expect(sent("updateCurrentSession").at(-1)?.session?.workdir).toBe(
      "/work/a",
    );
  });
});

// ---------------------------------------------------------------------------
// Deep link (wave://clone) — spec docs/specs/desktop/desktop-deep-link.md
// ---------------------------------------------------------------------------

describe("deep link clone", () => {
  const REPO = "https://git.example.com/team/repo.git";

  function cloneLink(): string {
    const params = [`repo=${encodeURIComponent(REPO)}`];
    params.push(`prompt=${encodeURIComponent("实现 spec")}`);
    return `wave://clone?${params.join("&")}`;
  }

  /**
   * Script both dialogs. `responses` are consumed in call order by
   * showMessageBox (confirm / login / 目录已存在 warnings); showOpenDialog
   * answers `picked` once and reports "cancelled" afterwards.
   */
  function scriptDialogs(responses: number[], picked?: string): void {
    const queue = [...responses];
    type MessageResult = Awaited<ReturnType<typeof dialog.showMessageBox>>;
    type OpenResult = Awaited<ReturnType<typeof dialog.showOpenDialog>>;
    vi.mocked(dialog.showMessageBox).mockImplementation(
      async () =>
        ({ response: queue.shift() ?? 0 }) as unknown as MessageResult,
    );
    vi.mocked(dialog.showOpenDialog).mockImplementation(
      async () =>
        ({
          canceled: picked === undefined,
          filePaths: picked === undefined ? [] : [picked],
        }) as unknown as OpenResult,
    );
  }

  /** Requests only this flow can make (the CLI owns both). */
  function deepLinkRequests(method: string) {
    return h.clientRequests.filter((request) => request.method === method);
  }

  // Restore the electron mock's defaults so no later suite inherits a script.
  afterEach(() => {
    type MessageResult = Awaited<ReturnType<typeof dialog.showMessageBox>>;
    type OpenResult = Awaited<ReturnType<typeof dialog.showOpenDialog>>;
    vi.mocked(dialog.showMessageBox).mockImplementation(
      async () => ({ response: 0 }) as unknown as MessageResult,
    );
    vi.mocked(dialog.showOpenDialog).mockImplementation(
      async () => ({ canceled: true, filePaths: [] }) as unknown as OpenResult,
    );
  });

  it("拒绝不支持的唤起动作：只给可读提示，不弹对话框、不发起任何工作", async () => {
    const { host, sent } = await readyHost();
    h.clientRequests.length = 0;

    await host.handleDeepLink(`wave://open?repo=${encodeURIComponent(REPO)}`);

    expect(sent("showToast").at(-1)?.toast.message).toContain(
      "不支持的唤起动作",
    );
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(deepLinkRequests("installGitCredentialHelper")).toHaveLength(0);
  });

  it("链接里的未知参数一律不读取：带了 token 也仍要求本机登录", async () => {
    const { host } = await readyHost();
    h.authStatusResults = Array(4).fill(false);
    h.clientRequests.length = 0;
    scriptDialogs([1]); // 登录引导 → 取消

    await host.handleDeepLink(
      `wave://clone?repo=${encodeURIComponent(REPO)}&token=${encodeURIComponent("sso-abc")}`,
    );

    // 凭据不能由一条任何网页都能构造的链接安装（契约见 deepLink.ts），所以
    // 本机没登录时唯一的出路仍是登录引导；`saveAuthToken` 这个 RPC 也随之
    // 从协议里删掉了，这条断言是防止它被重新接回来的回归闸。
    expect(deepLinkRequests("saveAuthToken")).toHaveLength(0);
    expect(vi.mocked(dialog.showMessageBox).mock.calls[0][1].message).toContain(
      "需要先登录",
    );
    expect(h.agentInstances).toHaveLength(1);
  });

  it("本机未登录时先引导登录，用户取消即结束（不弹确认框、不 clone）", async () => {
    const { host } = await readyHost();
    h.authStatusResults = Array(4).fill(false);
    scriptDialogs([1]); // 登录引导 → 取消

    await host.handleDeepLink(cloneLink());

    // 链接不携带凭据 ⇒ 没有第二条认证路径，登录被拒就不该再问「要不要 clone」。
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dialog.showMessageBox).mock.calls[0][1].message).toContain(
      "需要先登录",
    );
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(deepLinkRequests("installGitCredentialHelper")).toHaveLength(0);
    expect(h.agentInstances).toHaveLength(1);
  });

  it("未登录时登录引导先于确认框；登录完成后继续走确认框", async () => {
    const { host } = await readyHost();
    h.authStatusResults = Array(4).fill(false);
    h.clientRequests.length = 0;
    scriptDialogs([0, 1]); // 登录引导 → 登录；确认框 → 取消

    await host.handleDeepLink(cloneLink());

    expect(deepLinkRequests("login")).toHaveLength(1);
    // 第二个对话框是 clone 确认框（不是又一次登录引导）。
    expect(vi.mocked(dialog.showMessageBox).mock.calls[1][1].message).toContain(
      "是否克隆以下仓库",
    );
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it("目标目录已存在时提示另选，不 clone、不新建会话", async () => {
    const { host } = await readyHost();
    h.authStatusResults = Array(4).fill(true);
    h.existingPaths.add(path.join("/work", "repo"));
    scriptDialogs([0, 1], "/work"); // 确认 → 继续；目录已存在 → 取消

    await host.handleDeepLink(cloneLink());

    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    // 目录校验发生在准备凭据之前 —— 没有 clone 起手，也没有新会话。
    expect(deepLinkRequests("installGitCredentialHelper")).toHaveLength(0);
    expect(h.agentInstances).toHaveLength(1);
  });

  it("同一条链接被重复触发时只处理一次", async () => {
    const { host } = await readyHost();
    h.authStatusResults = Array(4).fill(true);
    scriptDialogs([1]); // 确认框 → 取消
    const link = cloneLink();

    await host.handleDeepLink(link);
    await host.handleDeepLink(link);

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// /remote-control 弹窗（手机接管本机会话）
// ---------------------------------------------------------------------------

describe("remoteControl（/remote-control 弹窗）", () => {
  it("转发本分屏子进程的快照，并原样带回 requestId", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "remoteControl",
      action: "status",
      requestId: "rc1",
    });

    // 目标就是本分屏自己的 `wave --stdio` 子进程（会话在哪个进程里，就由哪个
    // 进程连 relay），所以断言落在这一分屏的 agent 上。
    expect(lastAgent().remoteControlStatus).toHaveBeenCalledTimes(1);
    expect(sent("remoteControlResponse")).toMatchObject([
      {
        requestId: "rc1",
        snapshot: {
          state: "online",
          pageUrl: "https://relay.example/remote/?host=h1",
        },
      },
    ]);
  });

  it("connect/disconnect 打到同一个子进程并把新状态回给弹窗", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "remoteControl",
      action: "connect",
      name: "笔记本",
      requestId: "rc2",
    });
    await host.handleWebviewMessage({
      command: "remoteControl",
      action: "disconnect",
      requestId: "rc3",
    });

    expect(lastAgent().remoteControlConnect).toHaveBeenCalledWith("笔记本");
    expect(lastAgent().remoteControlDisconnect).toHaveBeenCalledTimes(1);
    expect(sent("remoteControlResponse")).toMatchObject([
      { requestId: "rc2", snapshot: { state: "connecting" } },
      { requestId: "rc3", snapshot: { state: "off" } },
    ]);
  });

  it("RPC 失败报 error 字段，不伪造 state:error 快照", async () => {
    const { host, sent } = await readyHost();
    lastAgent().remoteControlStatus.mockRejectedValueOnce(
      new Error(
        "Remote control is not enabled on this process (set enableRemoteControl: true).",
      ),
    );

    await host.handleWebviewMessage({
      command: "remoteControl",
      action: "status",
      requestId: "rc4",
    });

    const reply = sent("remoteControlResponse").at(-1);
    expect(reply).toMatchObject({ requestId: "rc4" });
    expect(reply?.snapshot).toBeUndefined();
    expect(reply?.error).toContain("enableRemoteControl");
  });

  it("没有绑定会话的分屏如实回报，而不是抛出去打断宿主", async () => {
    const { host, sent } = createHost();

    await host.handleWebviewMessage({
      command: "remoteControl",
      action: "status",
      requestId: "rc5",
      paneId: "pane-nonexistent",
    });

    const reply = sent("remoteControlResponse").at(-1);
    expect(reply).toMatchObject({ requestId: "rc5" });
    expect(reply?.snapshot).toBeUndefined();
    expect(reply?.error).toBeTruthy();
  });

  it("本分屏的斜杠命令清单里带 /remote-control", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    expect(
      sent("slashCommandsResponse")
        .at(-1)
        ?.commands.find((c) => c.id === "remote-control"),
    ).toMatchObject({ name: "remote-control" });
  });
});

// spec: docs/specs/desktop/desktop-artifacts.md「数据来源单一」「写动作的口径」——
// 创作集的账号级数据由主进程经 stdio RPC 交给 CLI 进程（HTTP 与登录 token 只在
// 那边），宿主只转发结果；分类是本机数据，写 configStore 并按账号隔离。
describe("创作集（desktop-artifacts）", () => {
  it("列表：把 CLI 返回的行原样下发给页面", async () => {
    const { host, sent } = await readyHost();
    h.artifactResponses.set("artifactGalleryList", {
      ok: true,
      data: { rows: [{ slug: "a", title: "页面 A", rel: "mine" }] },
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactsList",
      requestId: "list-1",
    });

    expect(h.clientRequests.at(-1)).toMatchObject({
      method: "artifactGalleryList",
    });
    expect(sent("desktopArtifactsList").at(-1)).toMatchObject({
      requestId: "list-1",
      items: [{ slug: "a", title: "页面 A", rel: "mine" }],
    });
  });

  it("列表鉴权失败 → authRequired（不伪装成空列表）", async () => {
    const { host, sent } = await readyHost();
    h.artifactResponses.set("artifactGalleryList", {
      ok: false,
      error: "authentication failed (HTTP 401)",
      authRequired: true,
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactsList",
      requestId: "list-2",
    });

    const reply = sent("desktopArtifactsList").at(-1);
    expect(reply).toMatchObject({ requestId: "list-2", authRequired: true });
    expect(reply?.items).toBeUndefined();
  });

  it("分享回显与保存：slug 与范围原样过 RPC", async () => {
    const { host, sent } = await readyHost();
    h.artifactResponses.set("artifactShareView", {
      ok: true,
      data: {
        mode: "users",
        pinnedVersion: 2,
        sharedUsers: [{ userId: "u1", email: "x@corp.com" }],
        versions: [{ version: 2 }, { version: 1 }],
      },
    });
    h.artifactResponses.set("artifactShareSave", {
      ok: true,
      data: { userIds: ["u1", "u2"] },
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactShareView",
      requestId: "view-1",
      slug: "a",
    });
    expect(sent("desktopArtifactShareView").at(-1)).toMatchObject({
      requestId: "view-1",
      slug: "a",
      mode: "users",
      pinnedVersion: 2,
      sharedUsers: [{ userId: "u1", email: "x@corp.com" }],
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactShareSave",
      requestId: "save-1",
      slug: "a",
      mode: "users",
      userIds: ["u1", "u2"],
      pinnedVersion: 2,
    });
    expect(h.clientRequests.at(-1)).toMatchObject({
      method: "artifactShareSave",
      params: {
        slug: "a",
        mode: "users",
        userIds: ["u1", "u2"],
        pinnedVersion: 2,
      },
    });
    expect(sent("desktopArtifactShareSave").at(-1)).toMatchObject({
      requestId: "save-1",
      slug: "a",
      userIds: ["u1", "u2"],
    });
  });

  it("成员检索与撤销：失败原因原样下发", async () => {
    const { host, sent } = await readyHost();
    h.artifactResponses.set("artifactMembersSearch", {
      ok: true,
      data: { members: [{ userId: "u1", email: "x@corp.com" }] },
    });
    h.artifactResponses.set("artifactRevoke", {
      ok: false,
      error: "not found",
      notFound: true,
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactMembersSearch",
      requestId: "m-1",
      search: "x",
      limit: 20,
    });
    expect(sent("desktopArtifactMembersSearch").at(-1)).toMatchObject({
      requestId: "m-1",
      members: [{ userId: "u1", email: "x@corp.com" }],
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactRevoke",
      requestId: "rv-1",
      slug: "a",
    });
    expect(sent("desktopArtifactRevoke").at(-1)).toMatchObject({
      requestId: "rv-1",
      slug: "a",
      notFound: true,
    });
  });

  it("分类存取走本机 userData，读写同一个命名空间", async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "desktopArtifactCategoriesSave",
      requestId: "cat-1",
      categories: [{ id: "cat-1", name: "运营" }],
      assignments: { a: "cat-1" },
    });
    expect(sent("desktopArtifactCategoriesSaved").at(-1)).toMatchObject({
      requestId: "cat-1",
      ok: true,
    });

    await host.handleWebviewMessage({
      command: "desktopArtifactCategoriesGet",
      requestId: "cat-2",
    });
    expect(sent("desktopArtifactCategories").at(-1)).toMatchObject({
      requestId: "cat-2",
      categories: [{ id: "cat-1", name: "运营" }],
      assignments: { a: "cat-1" },
    });
    // 分类不产生任何网络/RPC 请求
    expect(h.clientRequests.some((r) => r.method.startsWith("artifact"))).toBe(
      false,
    );
  });

  it("模板新建：只把提示词预填进当前会话，不新开会话", async () => {
    const { host, sent } = await readyHost();
    const agentsBefore = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: "desktopArtifactsNewFromTemplate",
      prompt: "帮我做一个网页小游戏：玩法是【】",
    });

    expect(sent("prefillPrompt").at(-1)).toMatchObject({
      paneId: "pane-1",
      prompt: "帮我做一个网页小游戏：玩法是【】",
    });
    // 不再 spawn 新 agent —— 原实现先建会话再预填，提示词要等 agent 初始化
    // 2-3s 才出现，而且总是落到新对话（PM 3500350535448832 / 3500351963339008）。
    expect(h.agentInstances.length).toBe(agentsBefore);
  });
});

describe("getMessageStats（renderer 内存曲线的消息量）", () => {
  /** 渲染进程节流上报的那一条 desktop 命令（webview 只在桌面端发）。 */
  const reportStats = (
    host: ReturnType<typeof createHost>["host"],
    paneId: string,
    messages: number,
    blocks: number,
  ) =>
    host.handleWebviewMessage({
      command: "desktopReportMessageStats",
      paneId,
      messages,
      blocks,
    });

  it("读渲染进程上报的数量——宿主没有数组可数，所以没有上报就没有数字", async () => {
    const { host } = await readyHost();
    const agent = lastAgent();
    agent.latestTotalTokens = 152000;
    fireSessionId(agent, "sess-1");

    // 绑定着一条真实会话，但渲染进程还没报过：数量未知，不是 0。
    expect(host.getMessageStats()).toEqual([]);

    await reportStats(host, "pane-1", 2, 4);

    expect(host.getMessageStats()).toEqual([
      {
        paneId: "pane-1",
        sessionId: "sess-1",
        messages: 2,
        blocks: 4,
        tokens: 152000,
      },
    ]);
  });

  it("闭合的 pane 的上报值随即丢弃，不留在曲线里", async () => {
    const { host, sent } = await readyHost();
    const first = lastAgent();
    seedConversation(first, "sess-a");
    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
    const second = lastAgent();
    seedConversation(second, "sess-b");
    second.latestTotalTokens = 40000;

    const layout = () =>
      sent("desktopPanes").at(-1)!.panes as Array<{ paneId: string }>;
    const [paneA, paneB] = layout();
    await reportStats(host, paneA.paneId, 7, 11);
    await reportStats(host, paneB.paneId, 2, 1);

    await host.handleWebviewMessage({
      command: "desktopClosePane",
      paneId: paneA.paneId,
    });
    // A real conversation, so closing its pane only unbinds it.
    expect(first.destroy).not.toHaveBeenCalled();

    expect(host.getMessageStats()).toEqual([
      {
        paneId: paneB.paneId,
        sessionId: "sess-b",
        messages: 2,
        blocks: 1,
        tokens: 40000,
      },
    ]);
  });

  it("reports nothing before a pane has an agent", async () => {
    const { host } = createHost();

    expect(host.getMessageStats()).toEqual([]);
  });
});

describe("宿主不保留消息内容，用的时候现取", () => {
  /**
   * 让 CLI 侧长出一条有 `count` 条消息的会话：`daemonMessages` 是 CLI 手里的
   * 那份真列表（`getMessages` 的取数源），宿主编排里除了「收到过消息事件」的
   * 标记一个字段都不留。
   */
  const growConversation = (sessionId: string, count: number) => {
    const agent = lastAgent();
    const list = Array.from({ length: count }, (_, i) => ({
      id: `${sessionId}-m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      blocks: [{ type: "text", content: `${sessionId}-${i}` }],
    }));
    agent.daemonMessages = list;
    fireSessionId(agent, sessionId);
    // 一条真实的消息事件（CLI 已经把它算进上面那份列表里）——宿主只靠它知道
    // 「这条会话有内容」，测试也照这条链路造数。
    agent.callbacks.onUserMessageAdded(list[0]);
    return agent;
  };

  const ids = (messages: unknown) =>
    (messages as Array<{ id: string }>).map((m) => m.id);

  it("切走再切回的快照来自一次现取，不是宿主残留的副本", async () => {
    const { host, sent } = await readyHost();
    const agent = growConversation("sess-1", 3);
    // 切走：分屏换成新会话，sess-1 退回池里继续跑。
    await host.handleWebviewMessage({ command: "newSession" });
    // 屏外这段时间里 CLI 那边长出了新消息（后台那一轮跑完了）。
    (agent.daemonMessages as unknown[]).push({
      id: "sess-1-late",
      role: "user",
      blocks: [{ type: "text", content: "后台那一轮" }],
    });
    agent.getMessages.mockClear();

    await host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "sess-1",
    });

    await vi.waitFor(() => {
      expect(agent.getMessages).toHaveBeenCalled();
    });
    // 快照里带着屏外期间新增的那条 —— 只有从 CLI 现取才拿得到它（宿主那份如果
    // 还是切走时的旧副本，这里只会是 3 条）。
    await vi.waitFor(() => {
      expect(ids(sent("setInitialState").at(-1)!.messages)).toEqual([
        "sess-1-m0",
        "sess-1-m1",
        "sess-1-m2",
        "sess-1-late",
      ]);
    });
    // 每次切回都现取一次（没有可复用的缓存），且取的是整份列表。
    expect(agent.getMessages).toHaveBeenCalledWith();
  });

  it("收到过消息事件但当前没有消息可数的会话，不会被当空脚手架销毁", async () => {
    const { host } = await readyHost();
    const live = lastAgent();
    // 一条真实的消息事件（侧边栏索引里还没有它：sessionIdChange 带登记是另一
    // 条路，这里只留事件标记），随后 CLI 的列表是空的（刚压缩完 / 宿主还没拉）。
    live.callbacks.onUserMessageAdded({
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "hi" }],
    });
    live.daemonMessages = [];

    // 让它真的拉一次，确认「此刻拉到的确实是空列表」——就地按列表长度判断空
    // 脚手架的写法会在这里把活会话删掉。
    await host.handleWebviewMessage({ command: "webviewReady" });
    expect(ids((await live.getMessages()) as unknown)).toEqual([]);

    const before = h.agentInstances.length;
    await host.handleWebviewMessage({ command: "newSession" });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(live.destroy).not.toHaveBeenCalled();
  });

  it("宿主侧没有任何消息数组可读", async () => {
    const { host, sent } = await readyHost();
    const agent = growConversation("sess-1", 2);
    agent.getMessages.mockClear();

    // 类型层面：`StdioAgent.messages` / `refreshMessages` 与宿主侧的
    // `droppedMessageCopies` / `getOffscreenVolume` 都已删除；运行时它们也不该
    // 存在（存在就说明有人又把副本加了回来）。
    expect("messages" in agent).toBe(false);
    expect("refreshMessages" in agent).toBe(false);
    expect("droppedMessageCopies" in host).toBe(false);
    expect("getOffscreenVolume" in host).toBe(false);

    // 行为层面：推给渲染进程的那份列表来自一次 pull，宿主自己不持有 —— 同一个
    // pane 上再推一次，仍要重新问 CLI 一遍。
    await host.handleWebviewMessage({ command: "webviewReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });
    expect(agent.getMessages.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(ids(sent("setInitialState").at(-1)!.messages)).toEqual([
      "sess-1-m0",
      "sess-1-m1",
    ]);
  });

  it("屏外期间到达的消息只打标记、不推给任何 pane", async () => {
    const { host, sent } = await readyHost();
    const first = growConversation("sess-1", 2);
    // 切走：分屏换成新会话，sess-1 成了没有分屏的屏外会话。
    await host.handleWebviewMessage({ command: "newSession" });
    const appendsBefore = sent("appendMessage").length;

    first.callbacks.onUserMessageAdded({
      id: "u-late",
      role: "user",
      blocks: [{ type: "text", content: "后台还在跑" }],
    });

    // 这条会话不在任何 pane 里 —— 没有 appendMessage 可推（推了也没有接收者，
    // 而且宿主手里没有列表可以拿它续写）。
    expect(sent("appendMessage")).toHaveLength(appendsBefore);
  });
});

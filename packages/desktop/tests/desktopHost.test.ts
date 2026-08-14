import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserWindow } from "electron";
import * as os from "os";
import * as path from "path";
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
  agentInstances: [] as Array<Record<string, unknown>>,
  clientRequests: [] as Array<{ method: string; params: unknown }>,
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
      case "getAuthStatus":
        return {
          isAuthenticated: h.authStatusResults.shift() ?? false,
          serverUrl: "",
        };
      case "getPromptHistory":
      case "searchPromptHistory":
        return { history: [] };
      case "searchFiles":
        return { files: [] };
      case "writeArtifactFile": {
        // Remote daemon writes to ITS artifacts dir and returns a remote path.
        const name = (params as { name?: string } | undefined)?.name ?? "file";
        return { path: `/remote/tmp/wave-artifacts/${name}` };
      }
      case "listPlugins":
        return { plugins: [] };
      case "listMarketplaces":
        return { marketplaces: [] };
      case "listGitBranches": {
        if (!h.branchesResult) throw new Error("not a git repository");
        return h.branchesResult;
      }
      case "createWorktree": {
        if (h.worktreeError) throw h.worktreeError;
        if (!h.worktreeResult) throw new Error("createWorktree not stubbed");
        return h.worktreeResult;
      }
      case "removeWorktree":
        if (h.removeWorktreeGate)
          return h.removeWorktreeGate.then(() => ({ removed: true }));
        return { removed: true };
      case "listPendingPermissions":
        return { requests: h.pendingPermissionRequests };
      default:
        return {};
    }
  },
  // Sequential getAuthStatus results, consumed FIFO by the stdio mock. Empty
  // means "logged out" — pushInitialState queries once at webview-ready.
  authStatusResults: [] as boolean[],
  // Per-workdir listSessions results, keyed by directory (FR-020 session tree).
  dirSessions: new Map<string, unknown[]>(),
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
  // When set, the removeWorktree RPC awaits this promise (simulates a slow
  // multi-second git worktree remove in the shared stdio process).
  removeWorktreeGate: null as Promise<void> | null,
  // When set, agent.initialize awaits this promise (simulates the multi-second
  // stdio startup so a real webview re-fires webviewReady while the new pane's
  // agent is still mid-spawn and not yet bound to the pane).
  initializeGate: null as Promise<void> | null,
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
    writeFile: vi.fn(async (p: string, data: string | Buffer) => {
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
      return { isDirectory: () => h.dirPaths.has(p) } as unknown as Awaited<
        ReturnType<typeof import("fs").promises.stat>
      >;
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

vi.mock("../src/main/stdio/notificationRouter", () => ({
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
}));

vi.mock("../src/main/stdio/stdioAgent", () => ({
  StdioAgent: class {
    sessionId: string | undefined;
    workingDirectory: string | undefined;
    sessionCwd: string | undefined;
    latestTotalTokens = 0;
    messages: unknown[] = [];
    tasks: unknown[] = [];
    backgroundTasks: unknown[] = [];
    queuedMessages: unknown[] = [];
    isStreaming = false;
    isCommandRunning = false;
    isCompacting = false;
    callbacks: Record<string, (...args: never[]) => void>;

    initialize = vi.fn(async function (
      this: {
        workingDirectory?: string;
        sessionCwd?: string;
        sessionId?: string;
      },
      params: { workdir?: string },
    ) {
      this.workingDirectory = params.workdir;
      this.sessionCwd = params.workdir;
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
      // to the session and holds its history daemon-side. The desktop cache is
      // NOT filled here; the host must pull it via getMessages().
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
    // Mirror the real flow: messages clear first, then a fresh sessionId fires
    // through the sessionIdChange notification.
    clearMessages = vi.fn(async function (this: {
      messages: unknown[];
      daemonMessages?: unknown[];
      sessionId?: string;
      callbacks: Record<string, (id: string) => void>;
    }) {
      this.messages = [];
      this.daemonMessages = [];
      const newId = `sess-${++h.agentCounter}`;
      this.sessionId = newId;
      this.callbacks.onSessionIdChange(newId);
    });
    compact = vi.fn(async () => undefined);
    rewindToMessage = vi.fn(async () => ({ inputContent: "rewound draft" }));
    askBtw = vi.fn(async () => "**Sunny** weather");
    getFullMessageThread = vi.fn(async function (this: {
      messages?: unknown[];
    }) {
      return { messages: this.messages ?? [], sessionIds: [] };
    });
    getMessages = vi.fn(async function (this: {
      daemonMessages?: unknown[];
      messages?: unknown[];
    }) {
      // Mirrors StdioAgent.getMessages: pull the daemon's authoritative list
      // into the cache. A restored session's history lives daemon-side until
      // this pull — without it, a re-attached session opens with no messages.
      this.messages = this.daemonMessages ?? this.messages ?? [];
      return this.messages;
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
    sendPermissionResponse = vi.fn();
    getBackgroundTaskOutput = vi.fn(async () => null);
    stopBackgroundTask = vi.fn(async () => true);
    getWorkflowRuns = vi.fn(async () => []);
    stopWorkflowRun = vi.fn(async () => true);
    getMcpServers = vi.fn(async () => []);
    connectMcpServer = vi.fn(async () => true);
    disconnectMcpServer = vi.fn(async () => true);
    getSlashCommands = vi.fn(async () => [
      { id: "review", name: "review", description: "Code review" },
    ]);

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
  resolveWaveBinary: vi.fn(() => "/mock/wave"),
  ensureCliUpToDate: vi.fn(async () => "/mock/wave"),
  getCliVersion: vi.fn(() => "0.19.7"),
}));

vi.mock("../src/main/updateChecker", () => ({
  checkForUpdate: vi.fn(async () => null),
}));

// electron-updater — the auto-update service for logged-in (serverUrl) installs.
// The on() mock records listeners so tests can fire update-available /
// update-downloaded to assert the host's system-message wiring.
const auListeners: Record<string, Array<(info: unknown) => void>> = {};
vi.mock("electron-updater", () => ({
  autoUpdater: {
    checkForUpdates: vi.fn(async () => null),
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
    remotePathExists: vi.fn(async () => true),
    listRemoteDirs: vi.fn(async () => ({
      resolvedPath: "/remote/repo",
      dirs: ["a", "b"],
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
import { checkForUpdate } from "../src/main/updateChecker";
import { autoUpdater } from "electron-updater";
import {
  ensureRemoteDaemon,
  connectRemoteDaemon,
  remotePathExists,
  listRemoteDirs,
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
  actionLabel?: string;
  action?: { type: string; url?: string };
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
              actionLabel?: string;
              action?: { type: string; url?: string };
            };
          }
        ).toast,
    );
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
  h.agentInstances.length = 0;
  h.clientRequests.length = 0;
  h.authStatusResults.length = 0;
  h.authUrlHandler = null;
  h.dirSessions.clear();
  h.worktreeResult = null;
  h.worktreeError = null;
  h.branchesResult = null;
  h.removeWorktreeGate = null;
  h.initializeGate = null;
  h.agentCounter = 0;
  h.closedHandlers.length = 0;
  h.pendingPermissionRequests = [];
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
  it("falls back to the most recent workdir before any agent activates (fresh launch)", async () => {
    // Fresh launch: recents list a directory (the webview picker shows it as
    // the default workdir) but no agent has been spawned yet, so host-side
    // this.workdir is unset. @file suggestions must still search that default
    // directory instead of returning an empty list.
    const { host, store } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({ command: "webviewReady" });

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

  it("stays anchored to the session root after bash cd drifts the working directory", async () => {
    const { host, sent } = await readyHost();
    const first = lastAgent();
    first.messages = [{ id: "m-1" }];
    fireSessionId(first, "sess-1");
    await host.handleWebviewMessage({
      command: "desktopOpenPane",
      workdir: "/work/a",
      sessionId: "sess-2",
    });
    await vi.waitFor(() => {
      expect(
        (sent("desktopPanes").at(-1)?.panes as Array<{ sessionId?: string }>)[1]
          ?.sessionId,
      ).toBe("sess-2");
    });
    const panes = sent("desktopPanes").at(-1)!.panes as Array<{
      paneId: string;
    }>;

    // The agent ran `cd src` — the CLI broadcast workdirChange, drifting the
    // agent's workingDirectory.
    first.workingDirectory = "/work/a/src";
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
    expect(last.configurationData).toBeDefined();

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
    vi.mocked(ensureCliUpToDate).mockRejectedValueOnce(
      new Error("install failed"),
    );
    const { resolveWaveBinary } = await import(
      "../src/main/stdio/binaryResolver"
    );
    vi.mocked(resolveWaveBinary).mockImplementationOnce(() => {
      throw new Error("no binary");
    });

    const { host, store, sent } = createHost();
    store.addRecentWorkdir({ host: "local", path: "/work/a" });
    h.existingPaths.add("/work/a");
    await host.handleWebviewMessage({ command: "desktopReady" });
    await host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/work/a",
    });

    const toasts = shownToasts().filter((t) =>
      t.message.includes("初始化失败"),
    );
    expect(toasts).toHaveLength(1);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("初始化失败"),
      ),
    ).toHaveLength(0);
  });

  it("surfaces the local CLI upgrade progress as a toast, not a chat message", async () => {
    const { ensureCliUpToDate } = await import(
      "../src/main/stdio/binaryResolver"
    );
    vi.mocked(ensureCliUpToDate).mockImplementationOnce(
      async (_target, onInstall) => {
        onInstall?.("正在升级 wave-code 到 v1.0.7，请稍候…");
        return "/mock/wave";
      },
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
      shownToasts().some((t) => t.message.includes("正在升级 wave-code")),
    ).toBe(true);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("正在升级 wave-code"),
      ),
    ).toHaveLength(0);
  });

  it("surfaces a CLI upgrade failure as a toast, not a chat message", async () => {
    const { ensureCliUpToDate } = await import(
      "../src/main/stdio/binaryResolver"
    );
    vi.mocked(ensureCliUpToDate).mockRejectedValueOnce(
      new Error("install failed"),
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
      shownToasts().some((t) => t.message.includes("wave-code CLI 升级失败")),
    ).toBe(true);
    expect(
      sent("appendMessage").filter((m) =>
        JSON.stringify(m).includes("wave-code CLI 升级失败"),
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

  it("restoreSession pulls the transcript via getMessages (re-attach regression)", async () => {
    const { host } = await readyHost();

    await host.handleWebviewMessage({
      command: "restoreSession",
      sessionId: "sess-x",
    });

    // The daemon emits no transcript on restore — the host must pull it, or a
    // re-attached session (remote or local) opens with an empty message list.
    await vi.waitFor(() => {
      expect(lastAgent().getMessages).toHaveBeenCalled();
    });
  });

  it("onMessagesChange never pushes the full list — each message arrives once via appendMessage", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // Contract: the desktop does not subscribe to messagesChange at all (the
    // agent keeps its own cache, fed by incremental appends below).
    expect(agent.callbacks.onMessagesChange).toBeUndefined();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);

    expect(sent("updateMessages")).toHaveLength(0);
    expect(sent("appendMessage")).toEqual([
      expect.objectContaining({ message: userMsg }),
    ]);
  });

  it("mirrors an error block under the LATEST user message — new assistant message, not the stale one from a previous turn", async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    const assistantMsg = {
      id: "a1",
      role: "assistant",
      blocks: [{ type: "text", content: "好的" }],
    };
    const latestUserMsg = {
      id: "u2",
      role: "user",
      blocks: [{ type: "text", content: "帮我执行 X" }],
    };
    agent.messages = [userMsg, assistantMsg, latestUserMsg];

    agent.callbacks.onErrorBlockAdded("插件执行失败");

    // The error belongs below the LATEST user message: appending to the
    // previous turn's assistant would surface it above the newest message
    // and accumulate there across repeated errors.
    expect(agent.messages).toHaveLength(4);
    const errorMessage = agent.messages[3] as {
      role: string;
      blocks: Array<{ type: string; content: string }>;
    };
    expect(errorMessage.role).toBe("assistant");
    expect(errorMessage.blocks).toEqual([
      { type: "error", content: "插件执行失败" },
    ]);
    // Previous turn's assistant message is left untouched.
    expect(
      (agent.messages[1] as { blocks: unknown[] }).blocks,
    ).toHaveLength(1);
    expect(sent("updateErrorBlock")).toEqual([
      expect.objectContaining({ error: "插件执行失败" }),
    ]);
  });

  it("streaming content deltas are mirrored into the agent cache so a session switch shows the full assistant reply", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);
    // The assistant message arrives empty — its content only exists as
    // streaming deltas afterwards. The cache must accumulate them, otherwise a
    // session switch (setInitialState) renders a blank reply.
    const assistantMsg = { id: "a1", role: "assistant", blocks: [] };
    agent.messages = [...agent.messages, assistantMsg];
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

    // Re-push pane state (what a session switch does) — the cached list must
    // carry the full accumulated text, not the initial empty block.
    await host.handleWebviewMessage({ command: "webviewReady" });
    const messages = sent("setInitialState").at(-1)?.messages as Array<{
      id: string;
      blocks: Array<{ type: string; content: string; stage?: string }>;
    }>;
    expect(messages.find((m) => m.id === "a1")?.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        content: "Hello world",
        stage: "end",
      }),
    ]);
  });

  it("reasoning deltas are mirrored into the agent cache too", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);
    const assistantMsg = { id: "a1", role: "assistant", blocks: [] };
    agent.messages = [...agent.messages, assistantMsg];
    agent.callbacks.onAssistantMessageAdded(assistantMsg);
    agent.callbacks.onAssistantReasoningUpdated({
      messageId: "a1",
      chunk: "思考中",
      stage: "streaming",
    });
    agent.callbacks.onAssistantReasoningUpdated({
      messageId: "a1",
      chunk: "…",
      stage: "end",
    });
    agent.callbacks.onAssistantContentUpdated({
      messageId: "a1",
      chunk: "结论",
      stage: "end",
    });

    await host.handleWebviewMessage({ command: "webviewReady" });
    const messages = sent("setInitialState").at(-1)?.messages as Array<{
      id: string;
      blocks: Array<{ type: string; content: string; stage?: string }>;
    }>;
    const blocks = messages.find((m) => m.id === "a1")?.blocks ?? [];
    expect(blocks.find((b) => b.type === "reasoning")).toEqual(
      expect.objectContaining({ content: "思考中…", stage: "end" }),
    );
    expect(blocks.find((b) => b.type === "text")).toEqual(
      expect.objectContaining({ content: "结论", stage: "end" }),
    );
  });

  it("tool block updates are mirrored into the agent cache", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "你好" }],
    };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);
    const assistantMsg = { id: "a1", role: "assistant", blocks: [] };
    agent.messages = [...agent.messages, assistantMsg];
    agent.callbacks.onAssistantMessageAdded(assistantMsg);
    agent.callbacks.onToolBlockUpdated({
      messageId: "a1",
      id: "tool-1",
      name: "read_file",
      stage: "start",
      parameters: '{"path":',
      parametersChunk: '"/a.txt"}',
    });
    agent.callbacks.onToolBlockUpdated({
      messageId: "a1",
      id: "tool-1",
      stage: "end",
      result: "file content",
      success: true,
    });

    await host.handleWebviewMessage({ command: "webviewReady" });
    const messages = sent("setInitialState").at(-1)?.messages as Array<{
      id: string;
      blocks: Array<{
        type: string;
        id?: string;
        name?: string;
        stage?: string;
        parameters?: string;
        result?: string;
        success?: boolean;
      }>;
    }>;
    const toolBlock = messages
      .find((m) => m.id === "a1")
      ?.blocks.find((b) => b.type === "tool");
    expect(toolBlock).toMatchObject({
      id: "tool-1",
      name: "read_file",
      stage: "end",
      parameters: '{"path":"/a.txt"}',
      result: "file content",
      success: true,
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
    agent.messages = [userMsg];
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
    agent.messages = [userMsg, second];
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

  it("setInitialState backfills session.firstMessage from the index after compaction truncated the messages", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();

    // First user message establishes the index title (same as the sidebar).
    const userMsg = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "帮我重构登录模块" }],
    };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);

    // Compaction truncates the agent's message list to the compact boundary,
    // so a re-pushed pane state can no longer derive the title from messages.
    agent.messages = [
      {
        id: "c1",
        role: "assistant",
        blocks: [{ type: "compact", content: "对话摘要" }],
      },
    ];
    agent.callbacks.onCompactBlockAdded("对话摘要");

    await host.handleWebviewMessage({ command: "webviewReady" });

    expect(sent("setInitialState").at(-1)?.session).toMatchObject({
      id: "sess-1",
      firstMessage: "帮我重构登录模块",
    });
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
// configuration / status / external links
// ---------------------------------------------------------------------------

describe("configuration and status", () => {
  it("getConfiguration replies with the stored configuration", async () => {
    const { host, store, sent } = createHost();
    store.setConfiguration({ apiKey: "k", model: "m" });

    await host.handleWebviewMessage({ command: "getConfiguration" });

    expect(sent("configurationResponse")[0]).toMatchObject({
      configurationData: { apiKey: "k", model: "m" },
    });
  });

  it("updateConfiguration persists, reconfigures the agent and notifies the webview", async () => {
    const { host, store, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { apiKey: "new-key", model: "new-model" },
    });

    expect(store.getConfiguration()).toMatchObject({
      apiKey: "new-key",
      model: "new-model",
    });
    expect(lastAgent().updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "new-key", model: "new-model" }),
    );
    expect(sent("configurationUpdated")).toHaveLength(1);
    expect(sent("configurationResponse")).toHaveLength(1);
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
    // the agent's workingDirectory. The /status popup must still report the
    // session root, not the subdir the agent cd'd into.
    const agent = lastAgent();
    agent.workingDirectory = "/work/a/src";
    agent.callbacks.onWorkdirChange("/work/a/src");

    await host.handleWebviewMessage({ command: "getStatus" });

    expect(sent("statusResponse")[0]).toMatchObject({ workdir: "/work/a" });
  });

  it("openExternal allows https URLs (FR-008)", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "openExternal",
      url: "https://example.com",
    });
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("openExternal refuses unexpected schemes", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "openExternal",
      url: "file:///etc/passwd",
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update checks (FR-010)
// ---------------------------------------------------------------------------

describe("checkForUpdates", () => {
  it("manual check announces a newer version as a toast with a download-page action", async () => {
    vi.mocked(checkForUpdate).mockResolvedValueOnce({
      latestVersion: "0.20.0",
      currentVersion: "0.19.7",
      downloadUrl: "https://github.com/release",
    });
    const { host } = await readyHost();

    await host.handleWebviewMessage({ command: "checkForUpdates" });

    const toasts = shownToasts().filter((n) => n.message.includes("0.20.0"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("0.19.7");
    expect(toasts[0].actionLabel).toBe("打开下载页");
    expect(toasts[0].action).toEqual({
      type: "openDownloadPage",
      url: "https://github.com/release",
    });
  });

  it('manual check says "already latest" via a toast when no update exists', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: "checkForUpdates" });

    const toasts = shownToasts().filter((n) => n.message.includes("已是最新"));
    expect(toasts).toHaveLength(1);
  });

  it("runs an automatic check once after the first webviewReady", async () => {
    await readyHost();
    await vi.waitFor(() => {
      expect(checkForUpdate).toHaveBeenCalledTimes(1);
    });
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
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("announces the update via a toast on update-available", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-available"] ?? []) {
      cb({ version: "0.20.0" });
    }

    const toasts = shownToasts().filter((n) => n.message.includes("0.20.0"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("正在后台下载");
    // Informational only — no action button; the user acts once downloaded.
    expect(toasts[0].action).toBeUndefined();
  });

  it("shows a restart-install toast once the update is downloaded, and quitAndInstall fires on its action", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["update-downloaded"] ?? []) {
      cb({ version: "0.20.0" });
    }

    const toasts = shownToasts().filter((n) =>
      n.message.includes("已下载完成"),
    );
    expect(toasts).toHaveLength(1);
    expect(toasts[0].actionLabel).toBe("重启安装");
    expect(toasts[0].action).toEqual({ type: "quitAndInstall" });
    // No native confirm dialog anymore (spec: the toast button installs directly).
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    // The webview echoes the action back; the host performs it.
    await host.handleWebviewMessage({
      command: "toastAction",
      toastId: "x",
      action: { type: "quitAndInstall" },
    });
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("opens the download page when the toast action is openDownloadPage", async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: "toastAction",
      toastId: "x",
      action: { type: "openDownloadPage", url: "https://github.com/release" },
    });
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/release",
    );
  });

  it("falls back to the manual checker exactly once when electron-updater fails", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    vi.mocked(checkForUpdate).mockResolvedValue({
      latestVersion: "0.20.0",
      currentVersion: "0.19.7",
      downloadUrl: "https://github.com/release",
    });
    const { host } = await readyHostWithServerUrl();

    // electron-updater emits 'error' and then rejects the check — both signal
    // the same failure. The host must fall back once, not twice.
    await host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["error"] ?? []) {
      cb(new Error("ECONNREFUSED"));
    }

    await vi.waitFor(() =>
      expect(checkForUpdate).toHaveBeenCalledWith("0.19.7", SERVER),
    );
    const toasts = shownToasts().filter((n) => n.message.includes("0.20.0"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].action).toEqual({
      type: "openDownloadPage",
      url: "https://github.com/release",
    });
    // Restore the default implementation — this persistent mock leaks into the
    // next test's one-shot automatic check otherwise (it would announce a fake
    // update and mutate that test's agent message list).
    vi.mocked(checkForUpdate).mockResolvedValue(null);
  });

  it("degrades to the manual checker when the background download errors", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.7", files: [], path: "wave-0.19.7.dmg" },
      isUpdateAvailable: false,
    } as never);
    vi.mocked(checkForUpdate).mockResolvedValue({
      latestVersion: "0.20.0",
      currentVersion: "0.19.7",
      downloadUrl: "https://codechat.example.com/api/downloads/manifest.json",
    });
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });
    for (const cb of auListeners["error"] ?? []) {
      cb(new Error("download failed"));
    }

    await vi.waitFor(() =>
      expect(checkForUpdate).toHaveBeenCalledWith("0.19.7", SERVER),
    );
    const toasts = shownToasts().filter((n) => n.message.includes("0.20.0"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].action).toEqual({
      type: "openDownloadPage",
      url: "https://codechat.example.com/api/downloads/manifest.json",
    });
    vi.mocked(checkForUpdate).mockResolvedValue(null);
  });

  it('says "already latest" via a toast without a GitHub round trip when the feed has no update', async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.7", files: [], path: "wave-0.19.7.dmg" },
      isUpdateAvailable: false,
    } as never);
    const { host } = await readyHostWithServerUrl();

    await host.handleWebviewMessage({ command: "checkForUpdates" });

    expect(checkForUpdate).not.toHaveBeenCalled();
    // The one-shot automatic check stays silent on no-update; only the manual
    // check announces it.
    const toasts = shownToasts().filter((n) => n.message.includes("已是最新"));
    expect(toasts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// misc commands
// ---------------------------------------------------------------------------

describe("misc commands", () => {
  it("newSession spawns a fresh session without clearing the old one (FR-031)", async () => {
    const { host } = await readyHost();
    lastAgent().messages = [{ id: "m1" }]; // make the active session non-empty
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
    active.messages = [{ id: "m1" }]; // the active session is non-empty, so newSession spawns
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
    realAgent.messages = [{ id: "m1" }]; // a real session — must stay re-selectable
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
    lastAgent().messages = [{ id: "m1" }];
    store.removeRecentWorkdir({ host: "local", path: "/work/a" });
    await host.handleWebviewMessage({ command: "newSession" });

    await host.handleWebviewMessage({ command: "sendMessage", text: "hi" });

    const hints = sent("appendMessage").filter((m) =>
      JSON.stringify(m).includes("请先选择工作目录"),
    );
    expect(hints).toHaveLength(1);
    expect(lastAgent().sendMessage).not.toHaveBeenCalled();
  });

  it("clearChat clears the active session in place instead of spawning a new agent", async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();
    agent.messages = [{ id: "m1" }];
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "clearChat" });

    expect(agent.clearMessages).toHaveBeenCalled();
    expect(h.agentInstances).toHaveLength(before);
    // The pane gets the cleared list pushed and follows the new session id.
    expect(sent("updateMessages").at(-1)?.messages).toEqual([]);
    expect(sent("updateCurrentSession").at(-1)).toMatchObject({
      session: { id: agent.sessionId },
    });
  });

  it("clearChat does not register the cleared empty session in the sidebar index", async () => {
    const { host, store } = await readyHost();
    const agent = lastAgent();
    agent.messages = [{ id: "m1" }];

    await host.handleWebviewMessage({ command: "clearChat" });

    expect(agent.sessionId).toBeDefined();
    expect(
      store.getSessionIndex().find((e) => e.sessionId === agent.sessionId),
    ).toBeUndefined();
  });

  it("registers the cleared session in the index on the first user message after clear", async () => {
    const { host, store } = await readyHost();
    const agent = lastAgent();
    agent.messages = [{ id: "m1" }];
    await host.handleWebviewMessage({ command: "clearChat" });
    const newId = agent.sessionId;
    expect(
      store.getSessionIndex().find((e) => e.sessionId === newId),
    ).toBeUndefined();

    const userMessage = {
      id: "u1",
      role: "user",
      blocks: [{ type: "text", content: "清空后的第一条消息" }],
    };
    agent.messages = [userMessage];
    agent.callbacks.onUserMessageAdded(userMessage);

    expect(
      store.getSessionIndex().find((e) => e.sessionId === newId),
    ).toBeDefined();
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

  it("requestSlashCommands merges SDK and local commands", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "",
    });

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain("review");
    expect(names).toContain("config");
    expect(names).toContain("clear");
  });

  it("requestSlashCommands filters by text", async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({
      command: "requestSlashCommands",
      filterText: "cle",
    });

    const resp = sent("slashCommandsResponse")[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(["clear"]);
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
    // No agent was created — the tree comes from the desktop index.
    expect(h.agentInstances).toHaveLength(0);
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
    lastAgent().messages = [{ id: "m1" }];
    lastAgent().callbacks.onSessionIdChange("sess-x");

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
    lastAgent().messages = [{ id: "m1" }];
    lastAgent().callbacks.onSessionIdChange("sess-1");
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

    lastAgent().messages = [{ id: "m1" }];
    lastAgent().callbacks.onSessionIdChange("sess-2");

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
    doomed.messages = [
      { id: "m1", role: "user", blocks: [{ type: "text", content: "hi" }] },
    ];
    doomed.callbacks.onUserMessageAdded(doomed.messages[0]);
    fireSessionId(doomed, "live-1");
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

  it("a slow remote directory probe does not delay the pane switch (spec: 动画先于连接建立)", async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(
      makeIndexEntry("rem-1", "/work/remote", { host: "ssh.example" }),
    );
    send.mockClear();

    // remotePathExists is a fresh `ssh test -d` process (no connection reuse),
    // so a slow remote hop must not gate the "selected" feedback: park the
    // probe unresolved and prove the optimistic switch happens first.
    let resolveProbe!: (value: boolean) => void;
    vi.mocked(remotePathExists).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        }),
    );

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
    expect(remotePathExists).toHaveBeenCalled();

    resolveProbe(true);
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
    vi.mocked(remotePathExists).mockResolvedValueOnce(false);

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

    await ctx.host.activateAdjacentSession(1);

    expect(ctx.store.getSessionIndex().some((e) => e.sessionId === "s2")).toBe(
      false,
    );
    expect(h.agentInstances).toHaveLength(0);
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
    expect(replaced.messages).toHaveLength(0);
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
    lastAgent().messages = [{ id: "m1" }];

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
    lastAgent().messages = [{ id: "m1" }];

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
    lastAgent().messages = [{ id: "m1" }];

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
  });

  it("registers the worktree session under the repo root with cwd = worktree path", async () => {
    const { host, store } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: "desktopCreateWorktree",
      workdir: "/work/a",
    });
    lastAgent().messages = [{ id: "m1" }];
    lastAgent().callbacks.onSessionIdChange("sess-wt");

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
    lastAgent().messages = [{ id: "m1" }];
    lastAgent().callbacks.onSessionIdChange("live-wt");

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
    wtAgent.messages = [{ id: "m1" }];
    wtAgent.callbacks.onSessionIdChange("live-wt");

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
// theme switching (FR-016..FR-019)
// ---------------------------------------------------------------------------

describe("theme", () => {
  it("setInitialState carries the resolved effective theme (no in-app preference)", async () => {
    const { sent } = await readyHost();
    expect(sent("setInitialState")[0]).toMatchObject({
      theme: { effective: "light" },
    });
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
});

// ---------------------------------------------------------------------------
// multi-session parallel (FR-031)
// ---------------------------------------------------------------------------

describe("multi-session parallel (FR-031)", () => {
  /** Give the active agent content + register its session in the index. */
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

  const treeSessions = (tree: Record<string, unknown> | undefined) =>
    (
      (tree?.groups as Array<{
        sessions: Array<{
          sessionId: string;
          running: boolean;
          waitingConfirmation?: boolean;
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

  it("switching back to a directory reactivates its live agent instead of spawning", async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession("sess-1");
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

    expect(h.agentInstances).toHaveLength(2);
    expect(sent("setInitialState").at(-1)).toMatchObject({
      session: { id: "sess-1" },
    });
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
    // The cache is fed by the incremental callback itself (no messagesChange
    // snapshot anymore), so start from the pre-bg state and let the callback
    // append.
    agent1.messages = [{ id: "m-sess-1" }];
    agent1.callbacks.onAssistantMessageAdded({ id: "bg-1" });
    expect(sent("appendMessage")).toHaveLength(appends);

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
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
      .filter((msg) => msg.blocks?.[0]?.type === "text")
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
    expect(sent("appendMessage")).toHaveLength(0);
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
    expect(sent("appendMessage")).toHaveLength(0);
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
    expect(sent("appendMessage")).toHaveLength(0);
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
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
    expect(lastAgent().workingDirectory).toBe("/work/a");
    expect(lastAgent().messages).toEqual([]);
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
    expect(lastAgent().messages).toEqual([]);
  });

  it("refuses with a hint when the full single row cannot split", async () => {
    const { host, sent } = await readyHost(900, 500);
    seedActiveSession("sess-1");
    const spawned = h.agentInstances.length;

    await host.handleWebviewMessage({ command: "desktopNewSessionInPane" });

    expect(h.agentInstances).toHaveLength(spawned);
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(1);
    expect(
      shownToasts().some((t) => t.message === "空间不足，无法添加更多分屏"),
    ).toBe(true);
    expect(sent("appendMessage")).toHaveLength(0);
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
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
// per-session input drafts (desktop-app.md 会话管理 scenario 11/12)
// ---------------------------------------------------------------------------

describe("input drafts per session (desktop-app.md scenario 11/12)", () => {
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

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
// SSH remote hosts (spec: desktop-app.md 「SSH 远程主机」)
// ---------------------------------------------------------------------------

const sshConfigPath = () => path.join(os.homedir(), ".ssh", "config");
const seedSshConfig = (content: string) =>
  h.files.set(sshConfigPath(), content);

/** Give an agent content + fire its sessionId so it registers in the index. */
function registerAgentInIndex(agent: ReturnType<typeof lastAgent>) {
  agent.messages = [
    { id: "m1", role: "user", blocks: [{ type: "text", content: "hi" }] },
  ];
  fireSessionId(agent, agent.sessionId as string);
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

    expect(vi.mocked(remotePathExists)).toHaveBeenCalledWith(
      "prod",
      "/remote/repo",
    );
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
    vi.mocked(remotePathExists).mockResolvedValueOnce(false);

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
    remoteAgent.messages = [{ id: "m1" }]; // the user chatted in the remote session, so it must survive

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

    // Activating the same remote path again reuses the remote agent — host
    // equality is part of the reuse key, and the two never collapse.
    await host.handleWebviewMessage({
      command: "desktopSelectRemotePath",
      host: "prod",
      path: "/repo",
    });
    expect(h.agentInstances.length).toBe(3);
    const panes = sent("desktopPanes").at(-1) as {
      panes: Array<{ sessionId: string; host: string }>;
    };
    expect(panes.panes[0]).toMatchObject({ sessionId: "sess-2", host: "prod" });
  });

  it("desktopListRemoteDir replies with the resolved path and subdirectory list", async () => {
    seedSshConfig("Host prod\n");
    const { host, sent } = await readyHost();
    vi.mocked(listRemoteDirs).mockResolvedValueOnce({
      resolvedPath: "/remote/repo/src",
      dirs: ["app", "lib"],
    });

    await host.handleWebviewMessage({
      command: "desktopListRemoteDir",
      host: "prod",
      path: "/remote/repo/src",
      requestId: "r9",
    });

    expect(vi.mocked(listRemoteDirs)).toHaveBeenCalledWith(
      "prod",
      "/remote/repo/src",
    );
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
    vi.mocked(listRemoteDirs).mockRejectedValueOnce(
      new Error("读取远端目录失败：目录不存在或不可读"),
    );

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
        error: "读取远端目录失败：目录不存在或不可读",
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

    expect(vi.mocked(listRemoteDirs)).not.toHaveBeenCalled();
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
    // The transcript was pulled into the re-attached agent (消息 catch-up:
    // spec scenario 3 — messages produced while detached must be visible).
    await vi.waitFor(() => {
      expect(
        reconnected.messages.some(
          (m) => (m as { id?: string }).id === "restored-u1",
        ),
      ).toBe(true);
    });
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
});

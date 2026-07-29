import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';

// ---------------------------------------------------------------------------
// fs mock — ConfigStore persistence + desktopHost's tmpdir/artifact helpers
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  existingPaths: new Set<string>(),
  agentInstances: [] as Array<Record<string, unknown>>,
  clientRequests: [] as Array<{ method: string; params: unknown }>,
  authUrlHandler: null as ((params: unknown) => void) | null,
  // Per-workdir listSessions results, keyed by directory (FR-020 session tree).
  dirSessions: new Map<string, unknown[]>(),
  // FR-052..054: stdio git method stubs. `worktreeError` makes createWorktree
  // reject; `branchesResult: null` simulates a non-git workdir.
  worktreeResult: null as null | { name: string; path: string; branch: string; baseBranch: string; repoRoot: string; isNew: boolean },
  worktreeError: null as Error | null,
  branchesResult: null as null | { branches: string[]; current: string },
  // When set, the removeWorktree RPC awaits this promise (simulates a slow
  // multi-second git worktree remove in the shared stdio process).
  removeWorktreeGate: null as Promise<void> | null,
  // Multi-agent pool: each StdioAgent instance gets a unique sessionId so the
  // host's agents Map keys don't collapse (FR-031).
  agentCounter: 0,
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((p: string) => {
    const data = h.files.get(p);
    if (data === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return data;
  }),
  writeFileSync: vi.fn((p: string, data: string | Buffer) => {
    h.files.set(p, data);
  }),
  renameSync: vi.fn((from: string, to: string) => {
    h.files.set(to, h.files.get(from) ?? '');
    h.files.delete(from);
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn((p: string) => h.existingPaths.has(p)),
  promises: {
    writeFile: vi.fn(async (p: string, data: string | Buffer) => {
      h.files.set(p, data);
    }),
  },
}));

// ---------------------------------------------------------------------------
// stdio layer mocks
// ---------------------------------------------------------------------------

vi.mock('../src/main/stdio/stdioClient', () => ({
  StdioClient: class {
    onNotification = vi.fn();
    removeOnNotification = vi.fn();
    dispose = vi.fn();
    request = vi.fn(async (method: string, params?: unknown) => {
      h.clientRequests.push({ method, params });
      switch (method) {
        case 'listSessions': {
          const workdir = (params as { workdir?: string } | undefined)?.workdir ?? '';
          return { sessions: h.dirSessions.get(workdir) ?? [] };
        }
        case 'getAuthStatus':
          return { isAuthenticated: false, serverUrl: '' };
        case 'getPromptHistory':
        case 'searchPromptHistory':
          return { history: [] };
        case 'searchFiles':
          return { files: [] };
        case 'listPlugins':
          return { plugins: [] };
        case 'listMarketplaces':
          return { marketplaces: [] };
        case 'listGitBranches': {
          if (!h.branchesResult) throw new Error('not a git repository');
          return h.branchesResult;
        }
        case 'createWorktree': {
          if (h.worktreeError) throw h.worktreeError;
          if (!h.worktreeResult) throw new Error('createWorktree not stubbed');
          return h.worktreeResult;
        }
        case 'removeWorktree':
          if (h.removeWorktreeGate) await h.removeWorktreeGate;
          return { removed: true };
        default:
          return {};
      }
    });
  },
}));

vi.mock('../src/main/stdio/notificationRouter', () => ({
  NotificationRouter: class {
    attach = vi.fn();
    registerSession = vi.fn();
    unregisterSession = vi.fn();
    registerGlobal = vi.fn((method: string, handler: (params: unknown) => void) => {
      if (method === 'authUrl') h.authUrlHandler = handler;
    });
  },
}));

vi.mock('../src/main/stdio/stdioAgent', () => ({
  StdioAgent: class {
    sessionId: string | undefined;
    workingDirectory: string | undefined;
    latestTotalTokens = 0;
    messages: unknown[] = [];
    tasks: unknown[] = [];
    backgroundTasks: unknown[] = [];
    queuedMessages: unknown[] = [];
    isStreaming = false;
    isCommandRunning = false;
    callbacks: Record<string, (...args: never[]) => void>;

    initialize = vi.fn(async function (this: { workingDirectory?: string; sessionId?: string }, params: { workdir?: string }) {
      this.workingDirectory = params.workdir;
      this.sessionId = `sess-${++h.agentCounter}`;
    });
    destroy = vi.fn(async () => undefined);
    restoreSession = vi.fn(async function (this: { sessionId?: string; messages?: unknown[] }, sessionId: string) {
      this.sessionId = sessionId;
      // Mirror the real agent: after restore, messages holds the full history.
      this.messages = [{ id: 'restored-u1', role: 'user', blocks: [{ type: 'text', content: '历史会话的第一条消息' }] }];
    });
    updateConfig = vi.fn(async () => undefined);
    sendMessage = vi.fn(async () => undefined);
    bang = vi.fn(async () => undefined);
    abortMessage = vi.fn(async () => undefined);
    clearMessages = vi.fn(async () => undefined);
    compact = vi.fn(async () => undefined);
    rewindToMessage = vi.fn(async () => ({ inputContent: 'rewound draft' }));
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
    getSlashCommands = vi.fn(async () => [{ id: 'review', name: 'review', description: 'Code review' }]);

    constructor(_client: unknown, _router: unknown, callbacks: Record<string, (...args: never[]) => void>) {
      this.callbacks = callbacks;
      h.agentInstances.push(this as unknown as Record<string, unknown>);
    }
  },
}));

vi.mock('../src/main/stdio/binaryResolver', () => ({
  resolveWaveBinary: vi.fn(() => '/mock/wave'),
  ensureCliUpToDate: vi.fn(async () => '/mock/wave'),
  getCliVersion: vi.fn(() => '0.19.7'),
}));

vi.mock('../src/main/updateChecker', () => ({
  checkForUpdate: vi.fn(async () => null),
}));

import { DesktopHost } from '../src/main/desktopHost';
import { ConfigStore } from '../src/main/configStore';
import { HOST_CHANNEL } from '../src/main/channels';
import { shell, nativeTheme } from 'electron';
import { checkForUpdate } from '../src/main/updateChecker';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const STORE_PATH = '/mock-userData/wave-desktop.json';

function createHost(winWidth = 1280) {
  const store = new ConfigStore(STORE_PATH);
  const host = new DesktopHost(store);
  const send = vi.fn();
  const win = {
    webContents: { send },
    isDestroyed: () => false,
    getContentSize: () => [winWidth, 800],
  } as unknown as BrowserWindow;
  host.setMainWindow(win);
  const sent = (command: string) =>
    send.mock.calls
      .filter(([channel, msg]) => channel === HOST_CHANNEL && (msg as { command?: string }).command === command)
      .map(([, msg]) => msg as Record<string, unknown>);
  return { host, store, send, sent };
}

function lastAgent() {
  const agent = h.agentInstances[h.agentInstances.length - 1];
  expect(agent).toBeDefined();
  return agent as Record<string, ReturnType<typeof vi.fn> & Record<string, unknown>> & {
    callbacks: Record<string, (...args: unknown[]) => void>;
  };
}

/** Mirror what the real StdioAgent does on sessionIdChange: set the field, then fire. */
function fireSessionId(agent: ReturnType<typeof lastAgent>, sessionId: string) {
  agent.sessionId = sessionId;
  agent.callbacks.onSessionIdChange(sessionId);
}

async function readyHost(winWidth?: number) {
  const ctx = createHost(winWidth);
  // workdir is never persisted — pick it from recents like the real UI flow.
  ctx.store.addRecentWorkdir('/work/a');
  h.existingPaths.add('/work/a');
  await ctx.host.handleWebviewMessage({ command: 'desktopReady' });
  await ctx.host.handleWebviewMessage({ command: 'desktopSelectRecentWorkdir', path: '/work/a' });
  await ctx.host.handleWebviewMessage({ command: 'webviewReady' });
  return ctx;
}

beforeEach(() => {
  h.files.clear();
  h.existingPaths.clear();
  h.agentInstances.length = 0;
  h.clientRequests.length = 0;
  h.authUrlHandler = null;
  h.dirSessions.clear();
  h.worktreeResult = null;
  h.worktreeError = null;
  h.branchesResult = null;
  h.removeWorktreeGate = null;
  h.agentCounter = 0;
  vi.clearAllMocks();
  nativeTheme.__reset();
});

// ---------------------------------------------------------------------------
// workdir lifecycle (FR-001/002/003)
// ---------------------------------------------------------------------------

describe('workdir lifecycle', () => {
  it('desktopReady always starts fresh: no workdir restored, recents still listed', async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir('/work/a');
    store.addRecentWorkdir('/work/b');

    await host.handleWebviewMessage({ command: 'desktopReady' });

    const states = sent('desktopWorkdirState');
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({
      command: 'desktopWorkdirState',
      workdir: undefined,
      recentWorkdirs: ['/work/b', '/work/a'],
    });
  });

  it('desktopReady posts an empty state when no workdir was ever chosen', async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: 'desktopReady' });

    const states = sent('desktopWorkdirState');
    expect(states[0]).toMatchObject({ workdir: undefined, recentWorkdirs: [] });
  });

  it('desktopRemoveRecentWorkdir removes the entry and reposts state', async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir('/work/a');
    store.addRecentWorkdir('/work/b');

    await host.handleWebviewMessage({ command: 'desktopRemoveRecentWorkdir', path: '/work/a' });

    expect(store.getRecentWorkdirs()).toEqual(['/work/b']);
    const states = sent('desktopWorkdirState');
    expect(states[states.length - 1]).toMatchObject({ recentWorkdirs: ['/work/b'] });
  });

  it('desktopSelectRecentWorkdir drops a stale path and keeps the current agent', async () => {
    const { host, sent, store } = await readyHost();
    const agentBefore = lastAgent();

    await host.handleWebviewMessage({ command: 'desktopSelectRecentWorkdir', path: '/gone' });

    expect(store.getRecentWorkdirs()).not.toContain('/gone');
    expect(lastAgent()).toBe(agentBefore);
    const sysMsgs = sent('appendMessage').filter((m) =>
      JSON.stringify(m).includes('已从最近列表移除'),
    );
    expect(sysMsgs).toHaveLength(1);
  });

});

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

describe('webviewReady / setInitialState', () => {
  it('initializes the stdio client + agent and posts the full initial state', async () => {
    const { sent } = await readyHost();

    const states = sent('setInitialState');
    expect(states.length).toBeGreaterThanOrEqual(1);
    expect(states[states.length - 1]).toMatchObject({
      command: 'setInitialState',
      messages: [],
      isStreaming: false,
      isCommandRunning: false,
      isAuthenticated: false,
      workdir: '/work/a',
    });
    expect(states[states.length - 1].configurationData).toBeDefined();
  });

  it('starts a fresh session on every launch: agent.initialize never carries restoreSessionId', async () => {
    await readyHost();

    const agent = lastAgent();
    for (const [params] of agent.initialize.mock.calls) {
      expect(params).not.toHaveProperty('restoreSessionId');
    }
    expect(agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: '/work/a' }),
    );
  });

  it('posts a system message instead of throwing when initialization fails', async () => {
    const { ensureCliUpToDate } = await import('../src/main/stdio/binaryResolver');
    vi.mocked(ensureCliUpToDate).mockRejectedValueOnce(new Error('install failed'));
    const { resolveWaveBinary } = await import('../src/main/stdio/binaryResolver');
    vi.mocked(resolveWaveBinary).mockImplementationOnce(() => {
      throw new Error('no binary');
    });

    const { host, store, sent } = createHost();
    store.addRecentWorkdir('/work/a');
    h.existingPaths.add('/work/a');
    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'desktopSelectRecentWorkdir', path: '/work/a' });

    const sysMsgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('初始化失败'));
    expect(sysMsgs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// message sending
// ---------------------------------------------------------------------------

describe('sendMessage', () => {
  it('forwards plain text to the agent', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'sendMessage', text: 'hello' });

    expect(lastAgent().sendMessage).toHaveBeenCalledWith('hello', undefined, false);
  });

  it('maps webview image payloads to { path, mimeType }', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({
      command: 'sendMessage',
      text: 'look',
      images: [{ data: '/tmp/a.png', mediaType: 'image/png' }],
    });

    expect(lastAgent().sendMessage).toHaveBeenCalledWith(
      'look',
      [{ path: '/tmp/a.png', mimeType: 'image/png' }],
      false,
    );
  });

  it('routes bang commands to agent.bang without the prefix', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'sendMessage', text: '!ls -la' });

    expect(lastAgent().bang).toHaveBeenCalledWith('ls -la');
    expect(lastAgent().sendMessage).not.toHaveBeenCalled();
  });

  it('replies with a system message when the agent is not initialized', async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: 'sendMessage', text: 'hi' });

    const hints = sent('appendMessage').filter((m) => JSON.stringify(m).includes('请先选择工作目录'));
    expect(hints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// agent → webview notifications
// ---------------------------------------------------------------------------

describe('agent notifications', () => {
  it('onLoadingChange toggles start/endStreaming', async () => {
    const { sent } = await readyHost();
    const { callbacks } = lastAgent();
    callbacks.onLoadingChange(true);
    callbacks.onLoadingChange(false);

    expect(sent('startStreaming')).toHaveLength(1);
    expect(sent('endStreaming')).toHaveLength(1);
  });

  it('restoreSession delivers the restored list via setInitialState, never via updateMessages (FR-031)', async () => {
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({ command: 'restoreSession', sessionId: 'sess-x' });

    const states = sent('setInitialState');
    expect(states.at(-1)?.messages).toEqual([
      { id: 'restored-u1', role: 'user', blocks: [{ type: 'text', content: '历史会话的第一条消息' }] },
    ]);
    expect(sent('updateMessages')).toHaveLength(0);
  });

  it('onMessagesChange never pushes the full list — each message arrives once via appendMessage', async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // Contract: the desktop does not subscribe to messagesChange at all (the
    // agent keeps its own cache). The CLI fires messagesChange first, then
    // the incremental userMessageAdded — pushing both double-appended.
    expect(agent.callbacks.onMessagesChange).toBeUndefined();
    const userMsg = { id: 'u1', role: 'user', blocks: [{ type: 'text', content: '你好' }] };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);

    expect(sent('updateMessages')).toHaveLength(0);
    expect(sent('appendMessage')).toEqual([expect.objectContaining({ message: userMsg })]);
  });

  it('first user message registers the new session in the sidebar tree with a truncated title (FR-024)', async () => {
    const { sent } = await readyHost();
    const agent = lastAgent();
    // The CLI assigns sessionId during initialize() without emitting
    // sessionIdChange, so nothing is in the index yet.
    expect(sent('desktopSessionTree')).toHaveLength(0);

    const longText = 'x'.repeat(40);
    const userMsg = { id: 'u1', role: 'user', blocks: [{ type: 'text', content: longText }] };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);

    const tree = sent('desktopSessionTree').at(-1);
    const sessions = ((tree?.groups as Array<{ sessions: Array<{ sessionId: string; title: string }> }>) ?? []).flatMap(
      (g) => g.sessions,
    );
    expect(sessions).toContainEqual(expect.objectContaining({ sessionId: 'sess-1', title: 'x'.repeat(30) + '...' }));

    // A later message does NOT rewrite the established title.
    const second = { id: 'u2', role: 'user', blocks: [{ type: 'text', content: '另一条消息' }] };
    agent.messages = [userMsg, second];
    agent.callbacks.onUserMessageAdded(second);
    const sessionsAfter = (
      (sent('desktopSessionTree').at(-1)?.groups as Array<{ sessions: Array<{ sessionId: string; title: string }> }>) ?? []
    ).flatMap((g) => g.sessions);
    expect(sessionsAfter.find((s) => s.sessionId === 'sess-1')?.title).toBe('x'.repeat(30) + '...');
  });

  it('setInitialState backfills session.firstMessage from the index after compaction truncated the messages', async () => {
    const { host, sent } = await readyHost();
    const agent = lastAgent();

    // First user message establishes the index title (same as the sidebar).
    const userMsg = { id: 'u1', role: 'user', blocks: [{ type: 'text', content: '帮我重构登录模块' }] };
    agent.messages = [userMsg];
    agent.callbacks.onUserMessageAdded(userMsg);

    // Compaction truncates the agent's message list to the compact boundary,
    // so a re-pushed pane state can no longer derive the title from messages.
    agent.messages = [{ id: 'c1', role: 'assistant', blocks: [{ type: 'compact', content: '对话摘要' }] }];
    agent.callbacks.onCompactBlockAdded('对话摘要');

    await host.handleWebviewMessage({ command: 'webviewReady' });

    expect(sent('setInitialState').at(-1)?.session).toMatchObject({
      id: 'sess-1',
      firstMessage: '帮我重构登录模块',
    });
  });

  it('restoring a historical session backfills its sidebar title from history (FR-024)', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({ sessionId: 'hist-1', title: '', workdir: '/work/a', cwd: '/work/a', lastActiveAt: 1 });

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'hist-1' });

    const tree = sent('desktopSessionTree').at(-1);
    const sessions = ((tree?.groups as Array<{ sessions: Array<{ sessionId: string; title: string }> }>) ?? []).flatMap(
      (g) => g.sessions,
    );
    expect(sessions.find((s) => s.sessionId === 'hist-1')?.title).toBe('历史会话的第一条消息');
  });

  it('onSessionIdChange posts updateCurrentSession (session id is never persisted)', async () => {
    const { sent } = await readyHost();
    const { callbacks } = lastAgent();

    callbacks.onSessionIdChange('sess-2');

    const updates = sent('updateCurrentSession');
    expect(updates[updates.length - 1]).toMatchObject({ session: { id: 'sess-2' } });
  });

  it('onPermissionModeChange posts updatePermissionMode', async () => {
    const { sent } = await readyHost();
    lastAgent().callbacks.onPermissionModeChange('plan');
    expect(sent('updatePermissionMode')[0]).toMatchObject({ mode: 'plan' });
  });

  it('onBackgroundTasksChange posts tasks and refreshes workflow runs', async () => {
    const { sent } = await readyHost();
    lastAgent().callbacks.onBackgroundTasksChange([{ task_id: 't1' }]);

    expect(sent('updateBackgroundTasks')[0]).toMatchObject({ tasks: [{ task_id: 't1' }] });
    await vi.waitFor(() => {
      expect(sent('updateWorkflowRuns')).toHaveLength(1);
    });
  });

  it('authUrl global notification opens the browser (FR-008)', async () => {
    await readyHost();
    h.authUrlHandler?.({ url: 'https://sso.example.com/login' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://sso.example.com/login');
  });
});

// ---------------------------------------------------------------------------
// permission confirmation flow
// ---------------------------------------------------------------------------

describe('permission confirmations', () => {
  async function triggerPermission(sent: ReturnType<typeof createHost>['sent'], toolName = 'Edit') {
    const { callbacks } = lastAgent();
    callbacks.onPermissionRequest('req-1', { toolName, toolInput: { file_path: '/x.ts' } });
    await vi.waitFor(() => {
      expect(sent('showConfirmation')).toHaveLength(1);
    });
    const msg = sent('showConfirmation')[0];
    return msg.confirmationId as string;
  }

  it('maps Edit to the code-modification confirmation type', async () => {
    const { sent } = await readyHost();
    await triggerPermission(sent, 'Edit');
    expect(sent('showConfirmation')[0]).toMatchObject({
      toolName: 'Edit',
      confirmationType: '代码修改待确认',
    });
  });

  it('approval resolves an allow decision', async () => {
    const { host, sent } = await readyHost();
    const confirmationId = await triggerPermission(sent, 'Bash');

    await host.handleWebviewMessage({ command: 'confirmationResponse', confirmationId, approved: true });

    expect(lastAgent().sendPermissionResponse).toHaveBeenCalledWith('req-1', { behavior: 'allow' });
  });

  it('rejection resolves a deny decision and aborts the message', async () => {
    const { host, sent } = await readyHost();
    const confirmationId = await triggerPermission(sent);

    await host.handleWebviewMessage({ command: 'confirmationResponse', confirmationId, approved: false });

    expect(lastAgent().sendPermissionResponse).toHaveBeenCalledWith('req-1', {
      behavior: 'deny',
      message: '用户拒绝了操作',
    });
    expect(lastAgent().abortMessage).toHaveBeenCalled();
  });

  it('ignores responses for unknown confirmation ids', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'confirmationResponse', confirmationId: 'nope', approved: true });
    expect(lastAgent().sendPermissionResponse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// configuration / status / external links
// ---------------------------------------------------------------------------

describe('configuration and status', () => {
  it('getConfiguration replies with the stored configuration', async () => {
    const { host, store, sent } = createHost();
    store.setConfiguration({ apiKey: 'k', model: 'm' });

    await host.handleWebviewMessage({ command: 'getConfiguration' });

    expect(sent('configurationResponse')[0]).toMatchObject({
      configurationData: { apiKey: 'k', model: 'm' },
    });
  });

  it('updateConfiguration persists, reconfigures the agent and notifies the webview', async () => {
    const { host, store, sent } = await readyHost();

    await host.handleWebviewMessage({
      command: 'updateConfiguration',
      configurationData: { apiKey: 'new-key', model: 'new-model' },
    });

    expect(store.getConfiguration()).toMatchObject({ apiKey: 'new-key', model: 'new-model' });
    expect(lastAgent().updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'new-key', model: 'new-model' }),
    );
    expect(sent('configurationUpdated')).toHaveLength(1);
    expect(sent('configurationResponse')).toHaveLength(1);
  });

  it('getStatus replies with app version, session id and workdir', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'getStatus' });

    expect(sent('statusResponse')[0]).toMatchObject({
      version: '0.19.7',
      sessionId: 'sess-1',
      workdir: '/work/a',
    });
  });

  it('openExternal allows https URLs (FR-008)', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'openExternal', url: 'https://example.com' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('openExternal refuses unexpected schemes', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'openExternal', url: 'file:///etc/passwd' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update checks (FR-010)
// ---------------------------------------------------------------------------

describe('checkForUpdates', () => {
  it('manual check announces a newer version in the chat', async () => {
    vi.mocked(checkForUpdate).mockResolvedValueOnce({
      latestVersion: '0.20.0',
      currentVersion: '0.19.7',
      downloadUrl: 'https://github.com/release',
    });
    const { host, sent } = await readyHost();

    await host.handleWebviewMessage({ command: 'checkForUpdates' });

    const msgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('0.20.0'));
    expect(msgs).toHaveLength(1);
  });

  it('manual check says "already latest" when no update exists', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'checkForUpdates' });

    const msgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('已是最新'));
    expect(msgs).toHaveLength(1);
  });

  it('runs an automatic check once after the first webviewReady', async () => {
    await readyHost();
    await vi.waitFor(() => {
      expect(checkForUpdate).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// misc commands
// ---------------------------------------------------------------------------

describe('misc commands', () => {
  it('clearChat spawns a fresh session without clearing the old one (FR-031)', async () => {
    const { host } = await readyHost();
    lastAgent().messages = [{ id: 'm1' }]; // make the active session non-empty
    const oldAgent = lastAgent();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'clearChat' });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(oldAgent.clearMessages).not.toHaveBeenCalled();
    expect(oldAgent.destroy).not.toHaveBeenCalled();
    expect(oldAgent.abortMessage).not.toHaveBeenCalled();
  });

  it('clearChat on an empty active session is a no-op', async () => {
    const { host } = await readyHost();
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({ command: 'clearChat' });
    expect(h.agentInstances).toHaveLength(before);
  });

  it('restoreSession forwards to the agent and refreshes the session tree', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({ sessionId: 'sess-x', title: 'x', workdir: '/work/a', cwd: '/work/a', lastActiveAt: 1000 });

    await host.handleWebviewMessage({ command: 'restoreSession', sessionId: 'sess-x' });

    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-x');
    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('compact forwards custom instructions', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'compact', customInstructions: 'keep it short' });
    expect(lastAgent().compact).toHaveBeenCalledWith('keep it short');
  });

  it('requestSlashCommands merges SDK and local commands', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'requestSlashCommands', filterText: '' });

    const resp = sent('slashCommandsResponse')[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('review');
    expect(names).toContain('config');
    expect(names).toContain('clear');
  });

  it('requestSlashCommands filters by text', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'requestSlashCommands', filterText: 'cle' });

    const resp = sent('slashCommandsResponse')[0];
    const names = (resp.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['clear']);
  });

  it('updateQueuedMessage notifies the webview when the message is gone', async () => {
    const { host, sent } = await readyHost();
    lastAgent().updateQueuedMessageById.mockResolvedValueOnce(false);

    await host.handleWebviewMessage({ command: 'updateQueuedMessage', id: 'q1', text: 'new' });

    expect(sent('updateQueuedMessageMissing')[0]).toMatchObject({ id: 'q1' });
  });

  it('getMcpServers replies with the agent server list', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'getMcpServers' });
    expect(sent('mcpServersResponse')[0]).toMatchObject({ servers: [] });
  });

  it('dispose destroys the agent and the client', async () => {
    const { host } = await readyHost();
    await host.dispose();
    expect(lastAgent().destroy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sidebar session tree (FR-020)
// ---------------------------------------------------------------------------

describe('session tree', () => {
  const makeIndexEntry = (sessionId: string, workdir: string, overrides: Record<string, unknown> = {}) => ({
    sessionId,
    title: `Session ${sessionId}`,
    workdir,
    cwd: workdir,
    lastActiveAt: Date.now(),
    ...overrides,
  });

  it('derives groups from the session index (not recents) on webviewReady', async () => {
    const { host, store, sent } = createHost();
    // /work/only-recent is in recents but has no sessions -> must NOT appear as a group.
    // /work/only-index has sessions but is not in recents -> still a group.
    store.addRecentWorkdir('/work/only-recent');
    store.upsertSession(makeIndexEntry('s1', '/work/a', { lastActiveAt: 1000 }));
    store.upsertSession(makeIndexEntry('s2', '/work/a', { lastActiveAt: 2000 }));
    store.upsertSession(makeIndexEntry('s3', '/work/only-index', { lastActiveAt: 3000 }));

    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'webviewReady' });

    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBeGreaterThanOrEqual(1);
    });
    const tree = sent('desktopSessionTree').at(-1);
    // Groups ordered by latest session lastActiveAt desc; sessions within a group desc.
    expect(tree?.groups).toEqual([
      { workdir: '/work/only-index', sessions: [expect.objectContaining({ sessionId: 's3' })] },
      {
        workdir: '/work/a',
        sessions: [expect.objectContaining({ sessionId: 's2' }), expect.objectContaining({ sessionId: 's1' })],
      },
    ]);
    // No agent was created — the tree comes from the desktop index.
    expect(h.agentInstances).toHaveLength(0);
  });

  it('caps each group at 5 sessions from the index', async () => {
    const { host, store, sent } = createHost();
    store.addRecentWorkdir('/work/a');
    for (let i = 0; i < 7; i++) {
      store.upsertSession(makeIndexEntry(`s${i}`, '/work/a', { lastActiveAt: Date.now() + i }));
    }

    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'webviewReady' });

    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBeGreaterThanOrEqual(1);
    });
    const groups = sent('desktopSessionTree').at(-1)?.groups as Array<{ sessions: Array<{ sessionId: string }> }>;
    expect(groups[0].sessions).toHaveLength(5);
    // Sorted by lastActiveAt desc — the 5 most recent.
    expect(groups[0].sessions[0].sessionId).toBe('s6');
  });

  it('desktopSelectSession on a historical session spawns a fresh agent and restores (FR-031)', async () => {
    const { host } = await readyHost();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-x' });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-x');
  });

  it('desktopSelectSession in another directory switches workdir first', async () => {
    const { host, store } = await readyHost();
    store.addRecentWorkdir('/work/b');
    h.existingPaths.add('/work/b');
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/b', sessionId: 'sess-y' });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: '/work/b' }));
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-y');
  });

  it('desktopSelectSession with a gone directory drops the index entry and the recent', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession(makeIndexEntry('sess-z', '/gone'));

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/gone', sessionId: 'sess-z' });

    expect(store.getSessionIndex().some((e) => e.sessionId === 'sess-z')).toBe(false);
    expect(store.getRecentWorkdirs()).not.toContain('/gone');
    expect(lastAgent().restoreSession).not.toHaveBeenCalled();
    const sysMsgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('已从最近列表与会话列表移除'));
    expect(sysMsgs).toHaveLength(1);
  });

  it('refreshes the tree when a turn ends (touchSessionInIndex)', async () => {
    const { sent } = await readyHost();
    // readyHost leaves the index empty -> no tree posts yet. Seed a session so
    // refreshSessionTree actually emits (an empty index is a no-op post).
    lastAgent().callbacks.onSessionIdChange('sess-1');
    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBeGreaterThanOrEqual(1);
    });
    const before = sent('desktopSessionTree').length;

    lastAgent().callbacks.onLoadingChange(false);

    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBe(before + 1);
    });
  });

  it('refreshes the tree when a new session starts (registerSessionInIndex)', async () => {
    const { sent } = await readyHost();
    // readyHost leaves the index empty -> no tree posts yet.
    expect(sent('desktopSessionTree')).toHaveLength(0);

    lastAgent().callbacks.onSessionIdChange('sess-2');

    await vi.waitFor(() => {
      expect(sent('desktopSessionTree').length).toBe(1);
    });
  });

  it('desktopDeleteSession removes from index and refreshes tree', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession(makeIndexEntry('del-1', '/work/a'));
    store.upsertSession(makeIndexEntry('del-2', '/work/a'));

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'del-1' });

    await vi.waitFor(() => {
      const tree = sent('desktopSessionTree').at(-1);
      const sessions = (tree?.groups as Array<{ sessions: Array<{ sessionId: string }> }>)?.[0]?.sessions ?? [];
      expect(sessions.some((s) => s.sessionId === 'del-1')).toBe(false);
      expect(sessions.some((s) => s.sessionId === 'del-2')).toBe(true);
    });
  });

  it('desktopDeleteSession on the live session destroys it and returns to a fresh session (FR-031)', async () => {
    const { host, store } = await readyHost();
    lastAgent().callbacks.onSessionIdChange('live-1');
    const doomed = lastAgent();
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'live-1' });

    expect(doomed.destroy).toHaveBeenCalled();
    expect(store.getSessionIndex().some((e) => e.sessionId === 'live-1')).toBe(false);
    // A fresh session replaced the deleted active one.
    expect(h.agentInstances).toHaveLength(before + 1);
  });

  it('desktopDeleteSession on the active session does not clobber a session selected while destroy is in flight', async () => {
    const { host, store, sent } = await readyHost();
    fireSessionId(lastAgent(), 'live-1');
    const doomed = lastAgent();
    store.upsertSession(makeIndexEntry('hist-b', '/work/a'));

    // Destroy is slow in the real CLI (telemetry shutdown, MCP/LSP cleanup),
    // so the delete handler stays in flight while the user clicks another session.
    let releaseDestroy: () => void = () => {};
    doomed.destroy.mockImplementation(
      () => new Promise<undefined>((resolve) => { releaseDestroy = () => resolve(undefined); }),
    );

    const deletePromise = host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'live-1' });
    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'hist-b' });

    releaseDestroy();
    await deletePromise;

    const states = sent('setInitialState');
    const last = states.at(-1);
    expect(last?.session).toMatchObject({ id: 'hist-b' });
    expect(last?.messages).toHaveLength(1);
  });

  it('desktopSelectSession on a historical session activates only after restore (no empty-state flash)', async () => {
    const { host, store, send, sent } = await readyHost();
    store.upsertSession(makeIndexEntry('hist-1', '/work/a'));
    send.mockClear();

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'hist-1' });

    const states = sent('setInitialState');
    expect(states).toHaveLength(1);
    expect(states[0]?.session).toMatchObject({ id: 'hist-1' });
    expect(states[0]?.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// session switch shortcut (FR-038)
// ---------------------------------------------------------------------------

describe('session switch shortcut (FR-038)', () => {
  const entry = (sessionId: string, workdir: string, lastActiveAt: number) => ({
    sessionId,
    title: `Session ${sessionId}`,
    workdir,
    cwd: workdir,
    lastActiveAt,
  });

  // Seeds s1/s2 in /work/a + s3 in /work/b (all dirs exist), then runs the
  // ready flow so the tree is derived. Flattened order: s3 (the /work/b group
  // leads — its latest session is the most recent overall), then s2, s1.
  async function hostWithTree() {
    const ctx = createHost();
    ctx.store.addRecentWorkdir('/work/a');
    h.existingPaths.add('/work/a');
    h.existingPaths.add('/work/b');
    ctx.store.upsertSession(entry('s1', '/work/a', 1000));
    ctx.store.upsertSession(entry('s2', '/work/a', 2000));
    ctx.store.upsertSession(entry('s3', '/work/b', 3000));
    await ctx.host.handleWebviewMessage({ command: 'desktopReady' });
    await ctx.host.handleWebviewMessage({ command: 'webviewReady' });
    return ctx;
  }

  it('cycles through the flattened tree across directories and wraps around', async () => {
    const { host, sent } = await hostWithTree();

    // No current session: next lands on the first entry (s3, leading group).
    await host.activateAdjacentSession(1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: '/work/b' }));
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s3');

    // s3 → s2: the cycle crosses directory groups (back to /work/a).
    await host.activateAdjacentSession(1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: '/work/a' }));
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s2');

    // s2 → s1.
    await host.activateAdjacentSession(1);
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s1');

    // s1 is the last entry: next wraps to s3, whose agent is still live —
    // activated in place, no new spawn and no restore.
    const before = h.agentInstances.length;
    await host.activateAdjacentSession(1);
    expect(h.agentInstances).toHaveLength(before);
    expect(sent('setInitialState').at(-1)?.session).toMatchObject({ id: 's3' });

    // s3 is the first entry: prev wraps to the last entry (s1, also live).
    await host.activateAdjacentSession(-1);
    expect(h.agentInstances).toHaveLength(before);
    expect(sent('setInitialState').at(-1)?.session).toMatchObject({ id: 's1' });
  });

  it('drops the frozen cycle order when the session changes outside the cycle', async () => {
    const { host } = await hostWithTree();
    await host.activateAdjacentSession(1); // s3, snapshot frozen at [s3, s2, s1]

    // Clicking s2 (outside the cycle) bumps it to the front of the MRU tree.
    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 's2' });

    // The stale snapshot would cycle onto the already-current s2 (a no-op);
    // the fresh order [s2, s1, s3] lands on s1 instead.
    await host.activateAdjacentSession(1);
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s1');
  });

  it('is a no-op on an empty tree', async () => {
    const { host } = createHost();
    await host.activateAdjacentSession(1);
    await host.activateAdjacentSession(-1);
    expect(h.agentInstances).toHaveLength(0);
  });

  it('is a no-op when the tree holds only the current session', async () => {
    const ctx = createHost();
    ctx.store.addRecentWorkdir('/work/a');
    h.existingPaths.add('/work/a');
    ctx.store.upsertSession(entry('s1', '/work/a', 1000));
    await ctx.host.handleWebviewMessage({ command: 'desktopReady' });
    await ctx.host.handleWebviewMessage({ command: 'webviewReady' });

    await ctx.host.activateAdjacentSession(1); // activates s1
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s1');
    const before = h.agentInstances.length;
    const restores = lastAgent().restoreSession.mock.calls.length;

    await ctx.host.activateAdjacentSession(1);
    await ctx.host.activateAdjacentSession(-1);
    expect(h.agentInstances).toHaveLength(before);
    expect(lastAgent().restoreSession.mock.calls.length).toBe(restores);
  });

  it('treats a fresh unregistered session as outside the tree (next → first entry)', async () => {
    const { host, store } = await readyHost(); // active agent, empty index/tree
    store.upsertSession(entry('s9', '/work/a', 5000));
    store.upsertSession(entry('s8', '/work/a', 4000));
    // Re-derive the tree (webviewReady refreshes it without a new agent).
    await host.handleWebviewMessage({ command: 'webviewReady' });

    await host.activateAdjacentSession(1);
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('s9');
  });

  it('drops a stale-directory entry encountered while cycling (same as clicking it)', async () => {
    const ctx = createHost();
    ctx.store.addRecentWorkdir('/work/a');
    h.existingPaths.add('/work/a');
    ctx.store.upsertSession(entry('s1', '/work/a', 1000));
    ctx.store.upsertSession(entry('s2', '/gone', 3000)); // /gone leads the tree
    await ctx.host.handleWebviewMessage({ command: 'desktopReady' });
    await ctx.host.handleWebviewMessage({ command: 'webviewReady' });

    await ctx.host.activateAdjacentSession(1);

    expect(ctx.store.getSessionIndex().some((e) => e.sessionId === 's2')).toBe(false);
    expect(h.agentInstances).toHaveLength(0);
    const sysMsgs = ctx.sent('appendMessage').filter((m) =>
      JSON.stringify(m).includes('已从最近列表与会话列表移除'),
    );
    expect(sysMsgs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// worktree flow (FR-022..FR-025)
// ---------------------------------------------------------------------------

describe('worktree flow', () => {
  const worktree = {
    name: 'gentle-pike-147',
    path: '/work/a/.wave/worktrees/gentle-pike-147',
    branch: 'worktree-gentle-pike-147',
    baseBranch: 'main',
    repoRoot: '/work/a',
    isNew: true,
  };

  it('desktopListGitBranches pushes the branch list', async () => {
    const { host, sent } = await readyHost();
    h.branchesResult = { branches: ['main', 'dev'], current: 'main' };

    await host.handleWebviewMessage({ command: 'desktopListGitBranches', workdir: '/work/a' });

    const msg = sent('desktopGitBranches').at(-1);
    expect(msg).toMatchObject({ workdir: '/work/a', result: { branches: ['main', 'dev'], current: 'main' } });
  });

  it('desktopListGitBranches on a non-git dir pushes result null', async () => {
    const { host, sent } = await readyHost();
    h.branchesResult = null;

    await host.handleWebviewMessage({ command: 'desktopListGitBranches', workdir: '/work/a' });

    const msg = sent('desktopGitBranches').at(-1);
    expect(msg).toMatchObject({ workdir: '/work/a', result: null });
  });

  it('desktopCreateWorktree switches workdir into the worktree', async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: 'desktopCreateWorktree',
      workdir: '/work/a',
      baseBranch: 'dev',
    });

    expect(h.clientRequests).toContainEqual({
      method: 'createWorktree',
      params: { workdir: '/work/a', baseBranch: 'dev', name: undefined },
    });
    expect(h.agentInstances).toHaveLength(before + 1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({
      workdir: worktree.path,
      worktreeName: worktree.name,
      isNewWorktree: true,
    }));
    expect(sent('desktopWorkdirState').at(-1)).toMatchObject({ workdir: worktree.path });
    // FR-023: recents record the repo root, never the ephemeral worktree path.
    expect(store.getRecentWorkdirs()).toContain('/work/a');
    expect(store.getRecentWorkdirs()).not.toContain(worktree.path);
  });

  it('desktopCreateWorktree with a first message forwards it after the switch', async () => {
    const { host } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: 'desktopCreateWorktree',
      workdir: '/work/a',
      baseBranch: 'main',
      text: 'hello worktree',
    });

    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: worktree.path }));
    expect(lastAgent().sendMessage).toHaveBeenCalledWith('hello worktree', undefined, false);
  });

  it('desktopCreateWorktree on an existing worktree (isNew: false) does not mark it new', async () => {
    const { host } = await readyHost();
    h.worktreeResult = { ...worktree, isNew: false };
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: 'desktopCreateWorktree',
      workdir: '/work/a',
      name: worktree.name,
    });

    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({
      workdir: worktree.path,
      worktreeName: worktree.name,
      isNewWorktree: false,
    }));
  });

  it('new session after a worktree session starts in the repo root, not the worktree path (FR-005)', async () => {
    const { host, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({ command: 'desktopCreateWorktree', workdir: '/work/a' });
    lastAgent().messages = [{ id: 'm1' }]; // non-empty so clearChat is not a no-op

    await host.handleWebviewMessage({ command: 'clearChat' });

    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: '/work/a' }));
    expect(sent('desktopWorkdirState').at(-1)).toMatchObject({ workdir: '/work/a' });
  });

  it('desktopCreateWorktree failure pushes a system message and keeps the workdir', async () => {
    const { host, sent } = await readyHost();
    h.worktreeError = new Error('branch already exists');
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: 'desktopCreateWorktree',
      workdir: '/work/a',
      baseBranch: 'dev',
      text: 'never sent',
    });

    expect(h.agentInstances).toHaveLength(before);
    expect(sent('desktopWorkdirState').at(-1)).toMatchObject({ workdir: '/work/a' });
    const sysMsgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('创建 worktree 失败'));
    expect(sysMsgs).toHaveLength(1);
  });

  it('registers the worktree session under the repo root with cwd = worktree path', async () => {
    const { host, store } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({ command: 'desktopCreateWorktree', workdir: '/work/a' });
    lastAgent().callbacks.onSessionIdChange('sess-wt');

    const entry = store.getSessionIndex().find((e) => e.sessionId === 'sess-wt');
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

  it('desktopSelectSession on a worktree session switches to entry.cwd', async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: 'sess-wt',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({
      command: 'desktopSelectSession',
      workdir: worktree.repoRoot,
      sessionId: 'sess-wt',
    });

    expect(h.agentInstances).toHaveLength(before + 1);
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: worktree.path }));
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-wt');
  });

  it('restoring a worktree session keeps it grouped under the repo root', async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: 'sess-wt',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });
    h.existingPaths.add(worktree.path);

    await host.handleWebviewMessage({
      command: 'desktopSelectSession',
      workdir: worktree.repoRoot,
      sessionId: 'sess-wt',
    });
    // The real CLI emits sessionIdChange after restore — it must not clobber
    // the index entry or pollute recents with the ephemeral worktree path.
    lastAgent().callbacks.onSessionIdChange('sess-wt');

    const entry = store.getSessionIndex().find((e) => e.sessionId === 'sess-wt');
    expect(entry).toMatchObject({ workdir: worktree.repoRoot, cwd: worktree.path });
    expect(entry?.worktree?.repoRoot).toBe(worktree.repoRoot);
    expect(store.getRecentWorkdirs()).not.toContain(worktree.path);
  });

  it('desktopSelectSession with a gone worktree drops the index entry only', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: 'sess-wt',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });
    // worktree.path NOT added to existingPaths — removed externally.

    await host.handleWebviewMessage({
      command: 'desktopSelectSession',
      workdir: worktree.repoRoot,
      sessionId: 'sess-wt',
    });

    expect(store.getSessionIndex().some((e) => e.sessionId === 'sess-wt')).toBe(false);
    // Repo root stays in recents — only the stale index entry is dropped.
    expect(store.getRecentWorkdirs()).toContain('/work/a');
    expect(lastAgent().restoreSession).not.toHaveBeenCalled();
    const sysMsgs = sent('appendMessage').filter((m) => JSON.stringify(m).includes('worktree 目录不存在'));
    expect(sysMsgs).toHaveLength(1);
  });

  it('desktopDeleteSession on a worktree session requests removeWorktree', async () => {
    const { host, store } = await readyHost();
    store.upsertSession({
      sessionId: 'sess-wt',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'sess-wt' });

    expect(store.getSessionIndex().some((e) => e.sessionId === 'sess-wt')).toBe(false);
    expect(h.clientRequests).toContainEqual({
      method: 'removeWorktree',
      params: { path: worktree.path, branch: worktree.branch, repoRoot: worktree.repoRoot },
    });
  });

  it('desktopDeleteSession refreshes the tree without waiting for worktree removal', async () => {
    const { host, store, sent } = await readyHost();
    store.upsertSession({
      sessionId: 'sess-wt-slow',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });
    // A second surviving session keeps the tree non-empty after the delete,
    // so refreshSessionTree actually posts an update.
    store.upsertSession({
      sessionId: 'sess-keep',
      title: 'keep',
      workdir: worktree.repoRoot,
      cwd: worktree.repoRoot,
      lastActiveAt: Date.now(),
    });
    // Block the removeWorktree RPC — the delete must not wait for it. If the
    // handler awaited removal, the await below would hang until test timeout.
    let releaseRemoval: () => void = () => {};
    h.removeWorktreeGate = new Promise<void>((resolve) => { releaseRemoval = () => resolve(); });

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'sess-wt-slow' });

    expect(store.getSessionIndex().some((e) => e.sessionId === 'sess-wt-slow')).toBe(false);
    const tree = sent('desktopSessionTree').at(-1);
    expect(JSON.stringify(tree).includes('sess-wt-slow')).toBe(false);
    // Removal was still kicked off in the background.
    expect(h.clientRequests).toContainEqual({
      method: 'removeWorktree',
      params: { path: worktree.path, branch: worktree.branch, repoRoot: worktree.repoRoot },
    });
    releaseRemoval();
  });

  it('desktopDeleteSession on the live worktree session switches back to the repo root first', async () => {
    const { host, store, sent } = await readyHost();
    h.worktreeResult = worktree;
    h.existingPaths.add(worktree.path);
    await host.handleWebviewMessage({ command: 'desktopCreateWorktree', workdir: '/work/a', baseBranch: 'main' });
    lastAgent().callbacks.onSessionIdChange('live-wt');

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'live-wt' });

    // Agent moved back to the repo root before the worktree was removed.
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: '/work/a' }));
    expect(sent('desktopWorkdirState').at(-1)).toMatchObject({ workdir: '/work/a' });
    expect(h.clientRequests).toContainEqual({
      method: 'removeWorktree',
      params: { path: worktree.path, branch: worktree.branch, repoRoot: worktree.repoRoot },
    });
    expect(store.getSessionIndex().some((e) => e.sessionId === 'live-wt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// theme switching (FR-016..FR-019)
// ---------------------------------------------------------------------------

describe('theme', () => {
  it('setInitialState carries the resolved effective theme (no in-app preference)', async () => {
    const { sent } = await readyHost();
    expect(sent('setInitialState')[0]).toMatchObject({
      theme: { effective: 'light' },
    });
  });

  it('getInitialEffectiveTheme follows the OS appearance (FR-019)', async () => {
    const { host } = createHost();
    await host.handleWebviewMessage({ command: 'desktopReady' });
    // Light OS → light.
    expect(host.getInitialEffectiveTheme()).toBe('light');

    nativeTheme.__setSystemDark(true);
    expect(host.getInitialEffectiveTheme()).toBe('dark');
  });

  it('posts desktopThemeChange when the OS appearance flips', async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: 'desktopReady' });

    nativeTheme.__setSystemDark(true);
    const changes = sent('desktopThemeChange');
    expect(changes[changes.length - 1]).toMatchObject({ effective: 'dark' });
  });

  it('dispose unsubscribes from nativeTheme updates', async () => {
    const { host, sent } = createHost();
    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.dispose();

    const before = sent('desktopThemeChange').length;
    nativeTheme.__setSystemDark(true);
    expect(sent('desktopThemeChange').length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// multi-session parallel (FR-031)
// ---------------------------------------------------------------------------

describe('multi-session parallel (FR-031)', () => {
  /** Give the active agent content + register its session in the index. */
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

  const treeSessions = (tree: Record<string, unknown> | undefined) =>
    ((tree?.groups as Array<{ sessions: Array<{ sessionId: string; running: boolean; waitingConfirmation?: boolean }> }>) ?? []).flatMap(
      (g) => g.sessions,
    );

  it('desktopSelectSession on a live agent activates it without spawning or restoring', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'clearChat' });
    seedActiveSession('sess-2');
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });

    expect(h.agentInstances).toHaveLength(before);
    expect(agent1.restoreSession).not.toHaveBeenCalled();
    expect(sent('setInitialState').at(-1)).toMatchObject({ session: { id: 'sess-1' } });
  });

  it('desktopSelectSession on the current session is a no-op', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const states = sent('setInitialState').length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });

    expect(h.agentInstances).toHaveLength(1);
    expect(sent('setInitialState')).toHaveLength(states);
  });

  it('switching back to a directory reactivates its live agent instead of spawning', async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession('sess-1');
    store.addRecentWorkdir('/work/b');
    h.existingPaths.add('/work/b');

    await host.handleWebviewMessage({ command: 'desktopSelectRecentWorkdir', path: '/work/b' });
    expect(h.agentInstances).toHaveLength(2);

    await host.handleWebviewMessage({ command: 'desktopSelectRecentWorkdir', path: '/work/a' });

    expect(h.agentInstances).toHaveLength(2);
    expect(sent('setInitialState').at(-1)).toMatchObject({ session: { id: 'sess-1' } });
  });

  it('keeps the running dot on background sessions in the tree', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    agent1.isStreaming = true;
    agent1.callbacks.onLoadingChange(true);

    await host.handleWebviewMessage({ command: 'clearChat' });
    expect(agent1.destroy).not.toHaveBeenCalled();
    const agent2 = seedActiveSession('sess-2');
    agent2.isStreaming = true;
    agent2.callbacks.onLoadingChange(true);

    const sessions = treeSessions(sent('desktopSessionTree').at(-1));
    expect(sessions.find((s) => s.sessionId === 'sess-1')?.running).toBe(true);
    expect(sessions.find((s) => s.sessionId === 'sess-2')?.running).toBe(true);

    // Background turn end: no endStreaming for the view, but the dot clears.
    agent1.isStreaming = false;
    agent1.callbacks.onLoadingChange(false);
    expect(sent('endStreaming')).toHaveLength(0);
    const after = treeSessions(sent('desktopSessionTree').at(-1));
    expect(after.find((s) => s.sessionId === 'sess-1')?.running).toBe(false);
    expect(after.find((s) => s.sessionId === 'sess-2')?.running).toBe(true);
  });

  it('flags a background session waiting-confirmation in the tree until resolved', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'clearChat' });
    seedActiveSession('sess-2');

    // Background permission request: no dialog, but the tree flags the session.
    agent1.callbacks.onPermissionRequest('req-bg', { toolName: 'Edit', toolInput: { file_path: '/x.ts' } });
    expect(sent('showConfirmation')).toHaveLength(0);
    const flagged = treeSessions(sent('desktopSessionTree').at(-1));
    expect(flagged.find((s) => s.sessionId === 'sess-1')?.waitingConfirmation).toBe(true);
    expect(flagged.find((s) => s.sessionId === 'sess-2')?.waitingConfirmation).toBe(false);

    // Switching back surfaces the pending confirmation via initial state;
    // responding clears the tree flag.
    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });
    const state = sent('setInitialState').at(-1) as { pendingConfirmations?: Array<{ confirmationId: string }> };
    expect(state.pendingConfirmations).toHaveLength(1);
    await host.handleWebviewMessage({
      command: 'confirmationResponse',
      confirmationId: state.pendingConfirmations![0].confirmationId,
      approved: true,
    });

    const cleared = treeSessions(sent('desktopSessionTree').at(-1));
    expect(cleared.find((s) => s.sessionId === 'sess-1')?.waitingConfirmation).toBe(false);
  });

  it('flags the active session waiting-confirmation alongside the dialog', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');

    lastAgent().callbacks.onPermissionRequest('req-1', { toolName: 'Edit', toolInput: { file_path: '/x.ts' } });
    await vi.waitFor(() => {
      expect(sent('showConfirmation')).toHaveLength(1);
    });
    const flagged = treeSessions(sent('desktopSessionTree').at(-1));
    expect(flagged.find((s) => s.sessionId === 'sess-1')?.waitingConfirmation).toBe(true);

    const confirmationId = sent('showConfirmation')[0].confirmationId as string;
    await host.handleWebviewMessage({ command: 'confirmationResponse', confirmationId, approved: true });
    const cleared = treeSessions(sent('desktopSessionTree').at(-1));
    expect(cleared.find((s) => s.sessionId === 'sess-1')?.waitingConfirmation).toBe(false);
  });

  it('gates background agent view callbacks until the session is activated', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'clearChat' });
    seedActiveSession('sess-2');

    const appends = sent('appendMessage').length;
    agent1.messages = [{ id: 'm-sess-1' }, { id: 'bg-1' }];
    agent1.callbacks.onAssistantMessageAdded({ id: 'bg-1' });
    expect(sent('appendMessage')).toHaveLength(appends);

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });
    expect(sent('setInitialState').at(-1)?.messages).toEqual([{ id: 'm-sess-1' }, { id: 'bg-1' }]);
  });

  it('never evicts idle agents — the pool is unbounded until session deletion', async () => {
    const { host } = await readyHost();
    const agents = [seedActiveSession('sess-1')];
    // Spawn well beyond the old pool cap; each new session needs a non-empty active one.
    for (let i = 2; i <= 10; i++) {
      await host.handleWebviewMessage({ command: 'clearChat' });
      agents.push(seedActiveSession(`sess-${i}`));
    }

    for (const a of agents) expect(a.destroy).not.toHaveBeenCalled();

    // Switching back to the oldest session still reuses its live agent.
    const before = h.agentInstances.length;
    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });
    expect(h.agentInstances).toHaveLength(before);
    expect(agents[0].restoreSession).not.toHaveBeenCalled();
  });

  it('dispose destroys every live agent in the pool', async () => {
    const { host } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'clearChat' });
    const agent2 = seedActiveSession('sess-2');

    await host.dispose();

    expect(agent1.destroy).toHaveBeenCalled();
    expect(agent2.destroy).toHaveBeenCalled();
  });
});

describe('split-view panes (FR-032~036)', () => {
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

  const panePushes = (sent: ReturnType<typeof createHost>['sent']) =>
    sent('desktopPanes').map(
      (m) => m as { panes: Array<{ paneId: string; sessionId?: string; width?: number }>; focusedPaneId: string },
    );

  it('webviewReady pushes an initial single-pane layout', async () => {
    const { sent } = await readyHost();
    const layouts = panePushes(sent);
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts.at(-1)?.panes).toHaveLength(1);
    expect(layouts.at(-1)?.focusedPaneId).toBe(layouts.at(-1)?.panes[0].paneId);
  });

  it('desktopOpenPane appends a pane, restores the session into it and focuses it', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-old' });

    // A new agent was spawned + restored for the dropped session.
    expect(h.agentInstances).toHaveLength(before + 1);
    const dropped = lastAgent();
    expect(dropped.restoreSession).toHaveBeenCalledWith('sess-old');

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[1].sessionId).toBe('sess-old');
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
    // The restored pane received its initial state, tagged with its paneId.
    const init = sent('setInitialState').at(-1);
    expect(init?.paneId).toBe(layout.panes[1].paneId);
  });

  it('desktopOpenPane on a worktree session spawns the agent at entry.cwd, not the repo root', async () => {
    const { host, store, sent } = await readyHost();
    seedActiveSession('sess-1');
    const worktree = {
      path: '/work/a/.wave/worktrees/gentle-pike-147',
      branch: 'worktree-gentle-pike-147',
      repoRoot: '/work/a',
    };
    // The sidebar groups worktree sessions under the repo root, so the webview
    // sends the repo root as workdir while the session files live at cwd.
    store.upsertSession({
      sessionId: 'sess-wt',
      title: 'wt',
      workdir: worktree.repoRoot,
      cwd: worktree.path,
      lastActiveAt: Date.now(),
      worktree: { path: worktree.path, branch: worktree.branch, baseBranch: 'main', repoRoot: worktree.repoRoot },
    });
    h.existingPaths.add(worktree.path);
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: worktree.repoRoot, sessionId: 'sess-wt' });

    expect(h.agentInstances).toHaveLength(before + 1);
    // Spawning at the repo root makes restoreSession look in the wrong project
    // store — it throws and the pane stays a new session.
    expect(lastAgent().initialize).toHaveBeenCalledWith(expect.objectContaining({ workdir: worktree.path }));
    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-wt');
    expect(panePushes(sent).at(-1)?.panes[1].sessionId).toBe('sess-wt');
    // The ephemeral worktree path must not leak into recents.
    expect(store.getRecentWorkdirs()).not.toContain(worktree.path);
  });

  it('desktopOpenPane with insertionIndex inserts the pane at that position and focuses it', async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-3', insertionIndex: 1 });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes.map((p) => p.sessionId)).toEqual(['sess-1', 'sess-3', 'sess-2']);
    expect(layout.focusedPaneId).toBe(layout.panes[1].paneId);
  });

  it('desktopOpenPane clamps an out-of-range insertionIndex and appends on a non-number', async () => {
    const { host, sent } = await readyHost(1600);
    seedActiveSession('sess-1');

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2', insertionIndex: 99 });
    expect(panePushes(sent).at(-1)!.panes.map((p) => p.sessionId)).toEqual(['sess-1', 'sess-2']);

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-3', insertionIndex: 'bogus' });
    expect(panePushes(sent).at(-1)!.panes.map((p) => p.sessionId)).toEqual(['sess-1', 'sess-2', 'sess-3']);
  });

  it('desktopOpenPane for an already-visible session focuses its pane instead of duplicating', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const before = h.agentInstances.length;

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });

    expect(h.agentInstances).toHaveLength(before);
    expect(panePushes(sent).at(-1)?.panes).toHaveLength(2);
  });

  it('desktopFocusPane switches focus and pushes the layout', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const panes = panePushes(sent).at(-1)!.panes;

    await host.handleWebviewMessage({ command: 'desktopFocusPane', paneId: panes[0].paneId });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(panes[0].paneId);
  });

  it('desktopFocusPane ignores unknown pane ids', async () => {
    const { host, sent } = await readyHost();
    const layouts = panePushes(sent).length;

    await host.handleWebviewMessage({ command: 'desktopFocusPane', paneId: 'pane-nope' });

    expect(panePushes(sent)).toHaveLength(layouts);
  });

  it('desktopClosePane removes the pane without destroying its agent, and moves focus to a neighbor', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const agent2 = lastAgent();
    const focusedPane = panePushes(sent).at(-1)!.focusedPaneId;

    await host.handleWebviewMessage({ command: 'desktopClosePane', paneId: focusedPane });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe('sess-1');
    // Focus moved to the remaining pane; both agents stay alive.
    expect(layout.focusedPaneId).toBe(layout.panes[0].paneId);
    expect(agent1.destroy).not.toHaveBeenCalled();
    expect(agent2.destroy).not.toHaveBeenCalled();
  });

  it('desktopClosePane on the last remaining pane is a no-op', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const onlyPane = panePushes(sent).at(-1)!.panes[0].paneId;
    const layouts = panePushes(sent).length;

    await host.handleWebviewMessage({ command: 'desktopClosePane', paneId: onlyPane });

    expect(panePushes(sent)).toHaveLength(layouts);
    expect(panePushes(sent).at(-1)?.panes).toHaveLength(1);
  });

  it('a pane-bound agent survives any number of later sessions', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    // Pin sess-2 in a second pane (pane-1 keeps sess-1).
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const paneAgent = lastAgent();
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    // Focus pane-1 so the spawn loop only replaces ITS agent, leaving the
    // sess-2 pane bound.
    await host.handleWebviewMessage({ command: 'desktopFocusPane', paneId: firstPane.paneId });
    for (let i = 3; i <= 10; i++) {
      await host.handleWebviewMessage({ command: 'clearChat' });
      seedActiveSession(`sess-${i}`);
    }

    // No eviction: the sess-2 pane is untouched and its agent stays alive.
    expect(paneAgent.destroy).not.toHaveBeenCalled();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[1].sessionId).toBe('sess-2');
  });

  it('desktopDeleteSession closes the focused pane showing it instead of resetting to a fresh session', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const agent2 = lastAgent();
    const spawned = h.agentInstances.length;
    // pane-2 (sess-2) is focused after the drop.

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'sess-2' });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe('sess-1');
    expect(layout.focusedPaneId).toBe(layout.panes[0].paneId);
    expect(agent2.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
    // The pane closed — no fresh session was spawned to fill it.
    expect(h.agentInstances).toHaveLength(spawned);
  });

  it('desktopDeleteSession closes a non-focused pane showing the deleted session', async () => {
    const { host, sent } = await readyHost();
    const agent1 = seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const agent2 = lastAgent();
    // Focus pane-1 so sess-2 lives in a background pane.
    const firstPane = panePushes(sent).at(-1)!.panes[0];
    await host.handleWebviewMessage({ command: 'desktopFocusPane', paneId: firstPane.paneId });

    await host.handleWebviewMessage({ command: 'desktopDeleteSession', sessionId: 'sess-2' });

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe('sess-1');
    expect(layout.focusedPaneId).toBe(firstPane.paneId);
    expect(agent2.destroy).toHaveBeenCalled();
    expect(agent1.destroy).not.toHaveBeenCalled();
  });

  it('host pushes carry the paneId of the pane they belong to', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const panes = panePushes(sent).at(-1)!.panes;

    // Send a message scoped to the first pane while the second is focused.
    await host.handleWebviewMessage({ command: 'sendMessage', text: 'hello', paneId: panes[0].paneId });

    // It reached pane-1's agent, not the focused pane's.
    const [firstAgent, secondAgent] = h.agentInstances as Array<ReturnType<typeof lastAgent>>;
    expect(firstAgent.sendMessage).toHaveBeenCalledWith('hello', undefined, false);
    expect(secondAgent.sendMessage).not.toHaveBeenCalled();

    // Mirror the real agent: a user message fires onUserMessageAdded, and the
    // resulting appendMessage push is tagged with the owning pane's id.
    firstAgent.callbacks.onUserMessageAdded({ id: 'u-1', role: 'user', blocks: [] });
    const append = sent('appendMessage').at(-1);
    expect(append?.paneId).toBe(panes[0].paneId);
  });
});

describe('input focus on conversation switch', () => {
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

  const panePushes = (sent: ReturnType<typeof createHost>['sent']) =>
    sent('desktopPanes').map((m) => m as { panes: Array<{ paneId: string; sessionId?: string }>; focusedPaneId: string });

  it('desktopSelectSession on a live session focuses the input', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'clearChat' });
    seedActiveSession('sess-2');
    const paneId = panePushes(sent).at(-1)!.focusedPaneId;
    const before = sent('focusInput').length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });

    const focus = sent('focusInput');
    expect(focus.length).toBeGreaterThan(before);
    expect(focus.at(-1)).toMatchObject({ paneId });
  });

  it('desktopSelectSession on a historical session focuses the input after restore', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const paneId = panePushes(sent).at(-1)!.focusedPaneId;
    const before = sent('focusInput').length;

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'hist-1' });

    expect(lastAgent().restoreSession).toHaveBeenCalledWith('hist-1');
    const focus = sent('focusInput');
    expect(focus.length).toBeGreaterThan(before);
    expect(focus.at(-1)).toMatchObject({ paneId });
  });

  it('activateAdjacentSession (switch shortcut) focuses the input', async () => {
    const { host, sent, store } = createHost();
    store.addRecentWorkdir('/work/a');
    h.existingPaths.add('/work/a');
    store.upsertSession({ sessionId: 's1', title: 'Session s1', workdir: '/work/a', cwd: '/work/a', lastActiveAt: 1000 });
    store.upsertSession({ sessionId: 's2', title: 'Session s2', workdir: '/work/a', cwd: '/work/a', lastActiveAt: 2000 });
    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'webviewReady' });
    const before = sent('focusInput').length;

    await host.activateAdjacentSession(1);

    const focus = sent('focusInput');
    expect(focus.length).toBeGreaterThan(before);
    expect(focus.at(-1)).toMatchObject({ paneId: panePushes(sent).at(-1)!.focusedPaneId });
  });

  it('selecting a session already visible in another pane focuses that pane input', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    // pane-2 (sess-2) is focused; sess-1 stays visible in pane-1.
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({ command: 'desktopSelectSession', workdir: '/work/a', sessionId: 'sess-1' });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(firstPane.paneId);
    expect(sent('focusInput').at(-1)).toMatchObject({ paneId: firstPane.paneId });
  });

  it('desktopOpenPane on an already-visible session focuses that pane input', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const firstPane = panePushes(sent).at(-1)!.panes[0];

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-1' });

    expect(sent('focusInput').at(-1)).toMatchObject({ paneId: firstPane.paneId });
  });

  it('desktopClosePane on the focused pane focuses the neighbor input', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const [firstPane, secondPane] = panePushes(sent).at(-1)!.panes;

    await host.handleWebviewMessage({ command: 'desktopClosePane', paneId: secondPane.paneId });

    expect(panePushes(sent).at(-1)?.focusedPaneId).toBe(firstPane.paneId);
    expect(sent('focusInput').at(-1)).toMatchObject({ paneId: firstPane.paneId });
  });

  it('desktopFocusPane (pane mousedown) does not steal input focus', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    const firstPane = panePushes(sent).at(-1)!.panes[0];
    const before = sent('focusInput').length;

    // A click anywhere in an unfocused pane (e.g. selecting message text)
    // refocuses the pane but must not yank the caret into the input.
    await host.handleWebviewMessage({ command: 'desktopFocusPane', paneId: firstPane.paneId });

    expect(sent('focusInput')).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------
// native menu actions (spec: desktop-split-view-multi-chat §原生菜单)
// ---------------------------------------------------------------------------

describe('native menu actions', () => {
  const seedActiveSession = (sessionId: string) => {
    const agent = lastAgent();
    agent.messages = [{ id: `m-${sessionId}` }];
    fireSessionId(agent, sessionId);
    return agent;
  };

  const panePushes = (sent: ReturnType<typeof createHost>['sent']) =>
    sent('desktopPanes').map((m) => m as { panes: Array<{ paneId: string; sessionId?: string }>; focusedPaneId: string });

  it('newSessionInFocusedPane resets the focused pane to a new session', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const agentsBefore = h.agentInstances.length;

    await host.newSessionInFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe('sess-1');
  });

  it('newSessionInFocusedPane spawns a new session even while the active agent streams', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const streaming = lastAgent();
    streaming.isStreaming = true;
    const agentsBefore = h.agentInstances.length;

    await host.newSessionInFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    expect(streaming.destroy).not.toHaveBeenCalled();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe('sess-1');
  });

  it('closeFocusedPane closes the focused pane and keeps its agent alive', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const left = lastAgent();
    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    expect(panePushes(sent).at(-1)!.panes).toHaveLength(2);
    const right = lastAgent();

    await host.closeFocusedPane();

    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).toBe('sess-1');
    expect(left.destroy).not.toHaveBeenCalled();
    expect(right.destroy).not.toHaveBeenCalled();
  });

  it('closeFocusedPane on the sole pane with a session resets it to a new session', async () => {
    const { host, sent } = await readyHost();
    seedActiveSession('sess-1');
    const old = lastAgent();
    const agentsBefore = h.agentInstances.length;

    await host.closeFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore + 1);
    expect(old.destroy).not.toHaveBeenCalled();
    const layout = panePushes(sent).at(-1)!;
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0].sessionId).not.toBe('sess-1');
  });

  it('closeFocusedPane on the sole pane with an empty new session is a no-op', async () => {
    const { host, sent } = await readyHost();
    const agentsBefore = h.agentInstances.length;
    const pushesBefore = panePushes(sent).length;

    await host.closeFocusedPane();

    expect(h.agentInstances.length).toBe(agentsBefore);
    expect(panePushes(sent).length).toBe(pushesBefore);
  });

  it('onMenuStateChange fires on pushPanes with enabled states, not on stream toggles', async () => {
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

    seedActiveSession('sess-1');
    expect(fn).toHaveBeenLastCalledWith({ canNewSession: true, canClosePane: true });

    await host.handleWebviewMessage({ command: 'desktopOpenPane', workdir: '/work/a', sessionId: 'sess-2' });
    expect(fn).toHaveBeenLastCalledWith({ canNewSession: true, canClosePane: true });
  });
});

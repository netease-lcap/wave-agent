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
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}mock-tmp`),
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
        case 'listSessions':
          return { sessions: [] };
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
    sessionId: string | undefined = 'sess-1';
    workingDirectory: string | undefined;
    latestTotalTokens = 0;
    queuedMessages: unknown[] = [];
    callbacks: Record<string, (...args: never[]) => void>;

    initialize = vi.fn(async function (this: { workingDirectory: string | undefined }, params: { workdir?: string }) {
      this.workingDirectory = params.workdir;
    });
    destroy = vi.fn(async () => undefined);
    restoreSession = vi.fn(async () => undefined);
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
import { shell } from 'electron';
import { checkForUpdate } from '../src/main/updateChecker';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const STORE_PATH = '/mock-userData/wave-desktop.json';

function createHost() {
  const store = new ConfigStore(STORE_PATH);
  const host = new DesktopHost(store);
  const send = vi.fn();
  const win = {
    webContents: { send },
    isDestroyed: () => false,
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

async function readyHost() {
  const ctx = createHost();
  ctx.store.setWorkdir('/work/a');
  await ctx.host.handleWebviewMessage({ command: 'desktopReady' });
  await ctx.host.handleWebviewMessage({ command: 'webviewReady' });
  return ctx;
}

beforeEach(() => {
  h.files.clear();
  h.existingPaths.clear();
  h.agentInstances.length = 0;
  h.clientRequests.length = 0;
  h.authUrlHandler = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// workdir lifecycle (FR-001/002/003)
// ---------------------------------------------------------------------------

describe('workdir lifecycle', () => {
  it('desktopReady posts desktopWorkdirState with the persisted workdir and recents', async () => {
    const { host, store, sent } = createHost();
    store.setWorkdir('/work/a');
    store.setWorkdir('/work/b');

    await host.handleWebviewMessage({ command: 'desktopReady' });

    const states = sent('desktopWorkdirState');
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({
      command: 'desktopWorkdirState',
      workdir: '/work/b',
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
    store.setWorkdir('/work/a');
    store.setWorkdir('/work/b');

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

  it('desktopUseTempWorkdir destroys the old agent, creates a new one and reposts state', async () => {
    const { host, store, sent } = await readyHost();
    const oldAgent = lastAgent();

    await host.handleWebviewMessage({ command: 'desktopUseTempWorkdir' });

    expect(oldAgent.destroy).toHaveBeenCalled();
    expect(h.agentInstances).toHaveLength(2);
    expect(store.getWorkdir()).toBe('/tmp/wave-desktop-mock-tmp');
    const states = sent('desktopWorkdirState');
    expect(states[states.length - 1]).toMatchObject({ workdir: '/tmp/wave-desktop-mock-tmp' });
    // new session pushed to the webview
    expect(sent('setInitialState').length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

describe('webviewReady / setInitialState', () => {
  it('initializes the stdio client + agent and posts the full initial state', async () => {
    const { sent } = await readyHost();

    const states = sent('setInitialState');
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      command: 'setInitialState',
      messages: [],
      isStreaming: false,
      isCommandRunning: false,
      isAuthenticated: false,
      workdir: '/work/a',
      sessions: [],
    });
    expect(states[0].configurationData).toBeDefined();
  });

  it('restores the persisted sessionId into agent.initialize', async () => {
    const { host, store } = createHost();
    store.setWorkdir('/work/a');
    store.setSessionId('sess-restored');

    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'webviewReady' });

    const agent = lastAgent();
    expect(agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: '/work/a', restoreSessionId: 'sess-restored' }),
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
    store.setWorkdir('/work/a');
    await host.handleWebviewMessage({ command: 'desktopReady' });
    await host.handleWebviewMessage({ command: 'webviewReady' });

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

    const hints = sent('appendMessage').filter((m) => JSON.stringify(m).includes('智能体未初始化'));
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

  it('restoreSession posts updateMessages with the latest agent messages', async () => {
    const { host, sent } = await readyHost();
    const { callbacks } = lastAgent();
    const messages = [{ id: 'm1' }];
    callbacks.onMessagesChange(messages);

    await host.handleWebviewMessage({ command: 'restoreSession', sessionId: 'sess-x' });

    const updates = sent('updateMessages');
    expect(updates[updates.length - 1]).toMatchObject({ messages });
  });

  it('onSessionIdChange persists the id and posts updateCurrentSession', async () => {
    const { store, sent } = await readyHost();
    const { callbacks } = lastAgent();

    callbacks.onSessionIdChange('sess-2');

    expect(store.getSessionId()).toBe('sess-2');
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
  it('clearChat clears agent messages and the queue', async () => {
    const { host } = await readyHost();
    await host.handleWebviewMessage({ command: 'clearChat' });
    expect(lastAgent().clearMessages).toHaveBeenCalled();
  });

  it('restoreSession forwards to the agent and refreshes the session list', async () => {
    const { host, sent } = await readyHost();
    await host.handleWebviewMessage({ command: 'restoreSession', sessionId: 'sess-x' });

    expect(lastAgent().restoreSession).toHaveBeenCalledWith('sess-x');
    await vi.waitFor(() => {
      expect(sent('updateSessions').length).toBeGreaterThanOrEqual(1);
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * TerminalManager unit tests — node-pty is mocked (the real native module is
 * covered by terminalPty.smoke.test.ts). terminal.ts caches the loaded pty
 * module at module scope, so each test resets modules and re-imports.
 */

interface MockProc {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  dataCb: null | ((data: string) => void);
  exitCb: null | ((e: { exitCode: number }) => void);
}

const h = vi.hoisted(() => ({
  procs: [] as MockProc[],
  spawn: vi.fn(),
  spawnError: null as Error | null,
}));

vi.mock('node-pty', () => ({
  spawn: h.spawn,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

function makeProc() {
  const proc = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    dataCb: null as null | ((data: string) => void),
    exitCb: null as null | ((e: { exitCode: number }) => void),
    onData(cb: (data: string) => void) {
      proc.dataCb = cb;
      return { dispose: vi.fn(() => { proc.dataCb = null; }) };
    },
    onExit(cb: (e: { exitCode: number }) => void) {
      proc.exitCb = cb;
      return { dispose: vi.fn(() => { proc.exitCb = null; }) };
    },
  };
  h.procs.push(proc);
  return proc;
}

async function freshManager() {
  vi.resetModules();
  const { TerminalManager } = await import('../src/main/terminal');
  const callbacks = { onData: vi.fn(), onExit: vi.fn() };
  return { manager: new TerminalManager(callbacks), callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.procs = [];
  h.spawnError = null;
  h.spawn.mockImplementation(() => {
    if (h.spawnError) throw h.spawnError;
    return makeProc();
  });
  process.env.SHELL = '/bin/test-shell';
});

afterEach(() => {
  delete process.env.SHELL;
});

describe('TerminalManager', () => {
  it('spawns the user default shell as a login shell with terminal env', async () => {
    const { manager } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24, 'pane-1');
    expect(h.spawn).toHaveBeenCalledWith('/bin/test-shell', ['-l'], {
      name: 'xterm-256color',
      cwd: '/work/a',
      cols: 80,
      rows: 24,
      env: expect.objectContaining({ TERM: 'xterm-256color', COLORTERM: 'truecolor' }),
    });
  });

  it('relays pty data and exit events through the callbacks', async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24);
    const proc = h.procs[0];
    proc.dataCb?.('hello');
    expect(callbacks.onData).toHaveBeenCalledWith('term-1', 'hello');
    proc.exitCb?.({ exitCode: 3 });
    expect(callbacks.onExit).toHaveBeenCalledWith('term-1', { exitCode: 3 });
  });

  it('write and resize forward to the live process', async () => {
    const { manager } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24);
    manager.write('term-1', 'ls\n');
    manager.resize('term-1', 120, 40);
    expect(h.procs[0].write).toHaveBeenCalledWith('ls\n');
    expect(h.procs[0].resize).toHaveBeenCalledWith(120, 40);
  });

  it('write/resize on an unknown termId are no-ops', async () => {
    const { manager } = await freshManager();
    manager.write('nope', 'x');
    manager.resize('nope', 1, 1);
    manager.kill('nope');
  });

  it('kill is silent: no exit event reaches the webview', async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24);
    const proc = h.procs[0];
    manager.kill('term-1');
    expect(proc.kill).toHaveBeenCalled();
    // Listeners were disposed before the kill — a late exit is swallowed.
    proc.exitCb?.({ exitCode: 0 });
    expect(callbacks.onExit).not.toHaveBeenCalled();
  });

  it('create on a live termId reattaches: resize + scrollback replay, no respawn', async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24, 'pane-1');
    const first = h.procs[0];
    first.dataCb?.('some output');
    callbacks.onData.mockClear();
    await manager.create('term-1', '/work/a', 120, 40, 'pane-2');
    expect(first.kill).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(first.resize).toHaveBeenCalledWith(120, 40);
    // Buffered scrollback replays so a remounted xterm restores its content.
    expect(callbacks.onData).toHaveBeenCalledWith('term-1', 'some output');
    // A real exit after reattach still reaches the webview.
    first.exitCb?.({ exitCode: 0 });
    expect(callbacks.onExit).toHaveBeenCalledWith('term-1', { exitCode: 0 });
  });

  it('killForPane kills only the terminals owned by that pane', async () => {
    const { manager } = await freshManager();
    await manager.create('term-a', '/w', 80, 24, 'pane-1');
    await manager.create('term-b', '/w', 80, 24, 'pane-2');
    manager.killForPane('pane-1');
    expect(h.procs[0].kill).toHaveBeenCalled();
    expect(h.procs[1].kill).not.toHaveBeenCalled();
  });

  it('killAll tears every terminal', async () => {
    const { manager } = await freshManager();
    await manager.create('term-a', '/w', 80, 24);
    await manager.create('term-b', '/w', 80, 24);
    manager.killAll();
    expect(h.procs[0].kill).toHaveBeenCalled();
    expect(h.procs[1].kill).toHaveBeenCalled();
  });

  it('reports a spawn failure via onExit with an error message', async () => {
    h.spawnError = new Error('posix_spawnp failed');
    const { manager, callbacks } = await freshManager();
    await manager.create('term-1', '/work/a', 80, 24);
    expect(callbacks.onExit).toHaveBeenCalledWith('term-1', {
      error: expect.stringContaining('posix_spawnp failed'),
    });
  });

  it('reports a node-pty load failure via onExit and caches it', async () => {
    vi.resetModules();
    vi.doMock('node-pty', () => {
      throw new Error('native binding missing');
    });
    const { TerminalManager } = await import('../src/main/terminal');
    const callbacks = { onData: vi.fn(), onExit: vi.fn() };
    const manager = new TerminalManager(callbacks);
    await manager.create('term-1', '/w', 80, 24);
    await manager.create('term-2', '/w', 80, 24);
    expect(callbacks.onExit).toHaveBeenCalledTimes(2);
    expect(callbacks.onExit).toHaveBeenCalledWith('term-1', {
      error: expect.stringContaining('终端组件加载失败'),
    });
    expect(h.spawn).not.toHaveBeenCalled();
    vi.doMock('node-pty', () => ({ spawn: h.spawn }));
  });
});

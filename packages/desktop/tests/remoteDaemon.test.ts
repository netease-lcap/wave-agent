import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const h = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  createConnection: vi.fn(),
  SocketClient: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: h.execFile,
  spawn: h.spawn,
}));

vi.mock('fs', () => ({
  existsSync: h.existsSync,
  unlinkSync: h.unlinkSync,
}));

vi.mock('net', () => ({
  createConnection: h.createConnection,
}));

vi.mock('../src/main/stdio/socketClient', () => ({
  SocketClient: h.SocketClient,
}));

import {
  getRemoteHomeDir,
  remoteDaemonSocketPath,
  localDaemonSocketPath,
  remoteDaemonAlive,
  startRemoteDaemon,
  waitForRemoteDaemon,
  ensureRemoteDaemon,
  connectRemoteDaemon,
  DAEMON_START_TIMEOUT_MS,
  DAEMON_POLL_INTERVAL_MS,
} from '../src/main/remoteCli';
import { resetRemoteShellCache, shellQuote } from '../src/main/sshHosts';
import { buildSshTunnelArgs } from '../src/main/sshHosts';

type StubResult = { stdout?: string; error?: Error };
const LOGIN_SHELL: StubResult = { stdout: '/bin/bash' };
const SOCKET_MISSING = new Error('no such socket');

/** Queue-driven execFile mock; when the queue runs dry, `dry` decides. */
function stubExec(results: StubResult[], dry: 'success' | 'fail' = 'success') {
  const queue = [...results];
  h.execFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
      const next = queue.shift() ?? (dry === 'fail' ? { error: SOCKET_MISSING } : { stdout: '' });
      if (next.error) cb(next.error, { stdout: '' });
      else cb(null, { stdout: next.stdout ?? '' });
    },
  );
}

/** Fake tunnel child process: EventEmitter with stderr + kill. */
function makeTunnel() {
  const tunnel = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  tunnel.stderr = new EventEmitter();
  tunnel.kill = vi.fn();
  return tunnel;
}

/** Fake client socket: EventEmitter with destroy (SocketClient ctor hooks it). */
function makeSocket() {
  const sock = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  sock.destroy = vi.fn();
  return sock;
}

beforeEach(() => {
  h.execFile.mockReset();
  h.spawn.mockReset();
  h.existsSync.mockReset();
  h.unlinkSync.mockReset();
  h.createConnection.mockReset();
  h.SocketClient.mockReset();
  resetRemoteShellCache();
});

describe('getRemoteHomeDir', () => {
  it('returns the trimmed $HOME', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/home/alice\n' }]);
    await expect(getRemoteHomeDir('prod')).resolves.toBe('/home/alice');
  });

  it('throws a user-facing error when the probe fails or is empty', async () => {
    stubExec([LOGIN_SHELL, { error: new Error('ssh: connect failed') }]);
    await expect(getRemoteHomeDir('prod')).rejects.toThrow('无法获取主机 prod 的远端主目录（$HOME）');

    // distinct host so the cached login shell from 'prod' doesn't shift the queue
    stubExec([LOGIN_SHELL, { stdout: '  \n' }]);
    await expect(getRemoteHomeDir('prod-empty')).rejects.toThrow(
      '无法获取主机 prod-empty 的远端主目录（$HOME）',
    );
  });
});

describe('daemon socket paths', () => {
  it('builds the remote socket under ~/.wave', () => {
    expect(remoteDaemonSocketPath('/home/alice')).toBe('/home/alice/.wave/daemon.sock');
  });

  it('builds a per-host local socket in the tmp dir (host chars sanitized)', () => {
    const p = localDaemonSocketPath('prod');
    expect(p.endsWith('wave-daemon-prod.sock')).toBe(true);
    const weird = localDaemonSocketPath('my host/with:chars');
    expect(weird.endsWith('wave-daemon-my_host_with_chars.sock')).toBe(true);
  });
});

describe('remoteDaemonAlive', () => {
  it('returns true when the probe connection succeeds', async () => {
    stubExec([LOGIN_SHELL, { stdout: '' }]);
    await expect(remoteDaemonAlive('prod', '/home/alice/.wave/daemon.sock')).resolves.toBe(true);
  });

  it('returns false when the probe fails (socket absent)', async () => {
    stubExec([LOGIN_SHELL, { error: SOCKET_MISSING }]);
    await expect(remoteDaemonAlive('prod', '/gone.sock')).resolves.toBe(false);
  });

  it('returns false when the socket exists but the daemon is dead (stale socket)', async () => {
    stubExec([LOGIN_SHELL, { error: new Error('ECONNREFUSED') }]);
    await expect(remoteDaemonAlive('prod', '/home/alice/.wave/daemon.sock')).resolves.toBe(false);
  });

  it('probes with a node net.connect so a stale socket reads as dead', async () => {
    stubExec([LOGIN_SHELL, { stdout: '' }]);
    await remoteDaemonAlive('prod', '/home/alice/.wave/daemon.sock');
    const remoteCmd = (h.execFile.mock.calls[1][1] as string[]).at(-1) as string;
    expect(remoteCmd).toContain('node -e');
    expect(remoteCmd).toContain('.connect(');
    expect(remoteCmd).toContain('/home/alice/.wave/daemon.sock');
  });
});

describe('startRemoteDaemon', () => {
  it('launches nohup detached with redirects so ssh returns', async () => {
    stubExec([LOGIN_SHELL, { stdout: '' }]);
    await startRemoteDaemon('prod', '/usr/local/bin/wave', '/home/alice/.wave/daemon.sock');
    const remoteCmd = (h.execFile.mock.calls[1][1] as string[]).at(-1) as string;
    // The login-shell wrapper re-quotes the whole command, so the inner
    // shellQuote literals appear escaped — build the expectation the same way.
    const expected = `/bin/bash -lic ${shellQuote(
      `nohup ${shellQuote('/usr/local/bin/wave')} --daemon ${shellQuote('/home/alice/.wave/daemon.sock')} </dev/null >/dev/null 2>&1 &`,
    )}`;
    expect(remoteCmd).toBe(expected);
  });
});

describe('waitForRemoteDaemon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns as soon as the socket appears', async () => {
    vi.useFakeTimers();
    // probe1: shell + probe (missing); probe2: cached shell + probe (ok).
    stubExec([LOGIN_SHELL, { error: SOCKET_MISSING }, { stdout: '' }]);
    const promise = waitForRemoteDaemon('prod', '/home/alice/.wave/daemon.sock');
    await vi.advanceTimersByTimeAsync(DAEMON_POLL_INTERVAL_MS);
    await expect(promise).resolves.toBeUndefined();
  });

  it('throws 启动超时 when the socket never appears', async () => {
    vi.useFakeTimers();
    stubExec([LOGIN_SHELL], 'fail');
    const promise = waitForRemoteDaemon('prod', '/home/alice/.wave/daemon.sock');
    // Attach the rejection handler up front — the rejection lands mid-advance
    // and would otherwise be reported as an unhandled rejection.
    const assertion = expect(promise).rejects.toThrow('远端 wave daemon 启动超时（prod）');
    await vi.advanceTimersByTimeAsync(DAEMON_START_TIMEOUT_MS + DAEMON_POLL_INTERVAL_MS);
    await assertion;
  });
});

describe('ensureRemoteDaemon', () => {
  it('returns the socket path without launching when the daemon already runs', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/home/alice' }, { stdout: '' }]); // $HOME + probe ok
    const socketPath = await ensureRemoteDaemon('prod');
    expect(socketPath).toBe('/home/alice/.wave/daemon.sock');
    const commands = h.execFile.mock.calls.map((c) => (c[1] as string[]).at(-1) as string);
    expect(commands.some((c) => c.includes('nohup'))).toBe(false);
  });

  it('resolves the binary, launches nohup and waits when the daemon is missing', async () => {
    stubExec([
      LOGIN_SHELL, // login shell probe
      { stdout: '/home/alice' }, // echo $HOME
      { error: SOCKET_MISSING }, // probe → not alive
      { stdout: 'v22.0.0' }, // node -v
      { stdout: '/usr/local/bin/wave' }, // command -v wave
      { stdout: '' }, // nohup launch
      { stdout: '' }, // probe → alive
    ]);
    const socketPath = await ensureRemoteDaemon('prod');
    expect(socketPath).toBe('/home/alice/.wave/daemon.sock');
    const commands = h.execFile.mock.calls.map((c) => (c[1] as string[]).at(-1) as string);
    const launch = commands.find((c) => c.includes('nohup'));
    expect(launch).toBe(
      `/bin/bash -lic ${shellQuote(
        `nohup ${shellQuote('/usr/local/bin/wave')} --daemon ${shellQuote('/home/alice/.wave/daemon.sock')} </dev/null >/dev/null 2>&1 &`,
      )}`,
    );
  });
});

describe('connectRemoteDaemon', () => {
  it('forwards the remote socket over ssh -N -L and wraps it in a SocketClient', async () => {
    const tunnel = makeTunnel();
    h.spawn.mockReturnValue(tunnel);
    h.existsSync.mockReturnValue(true);
    const sock = makeSocket();
    h.createConnection.mockReturnValue(sock);
    setTimeout(() => sock.emit('connect'), 0);

    const result = await connectRemoteDaemon('prod', '/home/alice/.wave/daemon.sock');
    expect(result.tunnel).toBe(tunnel);
    expect(h.SocketClient).toHaveBeenCalledWith(sock);
    expect(result.client).toBe(h.SocketClient.mock.instances[0]);

    const localSocket = localDaemonSocketPath('prod');
    expect(h.spawn).toHaveBeenCalledWith(
      'ssh',
      buildSshTunnelArgs('prod', localSocket, '/home/alice/.wave/daemon.sock'),
      expect.any(Object),
    );
    // Plain spawn — the tunnel runs no remote command, no login shell needed.
    const args = h.spawn.mock.calls[0][1] as string[];
    expect(args).not.toContain('-lic');
  });

  it('unlinks a stale local socket before starting the tunnel', async () => {
    const tunnel = makeTunnel();
    h.spawn.mockReturnValue(tunnel);
    h.existsSync.mockReturnValue(true);
    const sock = makeSocket();
    h.createConnection.mockReturnValue(sock);
    setTimeout(() => sock.emit('connect'), 0);

    await connectRemoteDaemon('prod', '/home/alice/.wave/daemon.sock');
    expect(h.unlinkSync).toHaveBeenCalledWith(localDaemonSocketPath('prod'));
  });

  it('kills the tunnel and throws when ssh exits before the socket is ready', async () => {
    const tunnel = makeTunnel();
    h.spawn.mockReturnValue(tunnel);
    h.existsSync.mockReturnValue(false); // forward never materializes

    const pending = connectRemoteDaemon('prod', '/home/alice/.wave/daemon.sock');
    tunnel.emit('exit', 255, null);
    await expect(pending).rejects.toThrow('无法连接远端 wave daemon');
    expect(tunnel.kill).toHaveBeenCalled();
  });
});

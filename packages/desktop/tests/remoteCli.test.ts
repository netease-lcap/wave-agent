import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: h.execFile,
}));

import { resolveRemoteWaveBinary, remotePathExists, listRemoteDirs, REMOTE_NODE_MIN_MAJOR } from '../src/main/remoteCli';
import { resetRemoteShellCache, shellQuote } from '../src/main/sshHosts';

type StubResult = { stdout?: string; error?: Error };

/** Login shell probe (`echo $SHELL`) precedes every remote probe command. */
const LOGIN_SHELL: StubResult = { stdout: '/bin/bash' };

/**
 * Queue-driven execFile mock: each call shifts the next stub and invokes the
 * callback (promisify(execFile) resolves through the callback, not the mock's
 * returned promise).
 */
function stubExec(results: StubResult[]) {
  const queue = [...results];
  h.execFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
      const next = queue.shift() ?? { stdout: '' };
      if (next.error) {
        cb(next.error, { stdout: '' });
      } else {
        cb(null, { stdout: next.stdout ?? '' });
      }
    },
  );
}

const CONNECT_FAIL = new Error('ssh: connect to host failed');
CONNECT_FAIL.name = 'Error';

beforeEach(() => {
  h.execFile.mockReset();
  resetRemoteShellCache();
});

describe('resolveRemoteWaveBinary', () => {
  it('returns the wave binary path when node and wave are present', async () => {
    stubExec([LOGIN_SHELL, { stdout: 'v22.3.0' }, { stdout: '/usr/local/bin/wave' }]);
    const info = await resolveRemoteWaveBinary('prod');
    expect(info).toEqual({ binaryPath: '/usr/local/bin/wave', nodeVersion: 'v22.3.0' });
  });

  it('throws an actionable error when node is missing', async () => {
    stubExec([LOGIN_SHELL, { error: CONNECT_FAIL }]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow('未检测到 Node.js');
  });

  it('throws when node is too old', async () => {
    stubExec([LOGIN_SHELL, { stdout: 'v18.0.0' }]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow(`需要 ≥ ${REMOTE_NODE_MIN_MAJOR}`);
  });

  it('auto-installs wave-code when the binary is missing, then re-probes', async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: 'v22.0.0' }, // node -v
      { error: new Error('command not found') }, // command -v wave
      { stdout: '' }, // npm install -g (progress goes to stderr)
      { stdout: '/usr/local/bin/wave' }, // re-probe
    ]);
    const info = await resolveRemoteWaveBinary('prod');
    expect(info).toEqual({ binaryPath: '/usr/local/bin/wave', nodeVersion: 'v22.0.0' });
  });

  it('throws with the install hint when auto-install fails', async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: 'v22.0.0' },
      { error: new Error('command not found') },
      { error: new Error('npm ERR! network') },
    ]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow('自动安装失败');
  });

  it('throws when installIfMissing is false and wave is absent', async () => {
    stubExec([LOGIN_SHELL, { stdout: 'v22.0.0' }, { error: new Error('command not found') }]);
    await expect(resolveRemoteWaveBinary('prod', false)).rejects.toThrow('未安装 wave-code CLI');
  });

  it('uses the npmmirror registry in the install command', async () => {
    const commands: string[] = [];
    const queue: StubResult[] = [
      LOGIN_SHELL,
      { stdout: 'v22.0.0' },
      { error: new Error('not found') },
      { stdout: '' },
      { stdout: '/usr/local/bin/wave' },
    ];
    h.execFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
        commands.push(args[args.length - 1] as string);
        const next = queue.shift() ?? { stdout: '' };
        if (next.error) cb(next.error, { stdout: '' });
        else cb(null, { stdout: next.stdout ?? '' });
      },
    );
    await resolveRemoteWaveBinary('prod');
    const install = commands.find((c) => c.includes('npm install -g wave-code'));
    expect(install).toContain('--registry=https://registry.npmmirror.com');
  });

  it('runs every probe under the host login shell so nvm-managed node is visible', async () => {
    stubExec([LOGIN_SHELL, { stdout: 'v22.0.0' }, { stdout: '/usr/local/bin/wave' }]);
    await resolveRemoteWaveBinary('prod');

    const remoteCommands = h.execFile.mock.calls.map((c) => (c[1] as string[]).at(-1) as string);
    // The login shell is probed once, then each probe is wrapped as `-lic`.
    expect(remoteCommands[0]).toBe('echo $SHELL');
    expect(remoteCommands[1]).toBe(`/bin/bash -lic 'node -v'`);
    expect(remoteCommands[2]).toBe(`/bin/bash -lic 'command -v wave'`);
  });

  it('falls back to /bin/sh when the login shell cannot be probed', async () => {
    stubExec([{ error: CONNECT_FAIL }, { stdout: 'v22.0.0' }, { stdout: '/usr/local/bin/wave' }]);
    const info = await resolveRemoteWaveBinary('prod');
    expect(info.nodeVersion).toBe('v22.0.0');
    const nodeProbe = h.execFile.mock.calls[1][1] as string[];
    expect(nodeProbe.at(-1)).toBe(`/bin/sh -lic 'node -v'`);
  });
});

describe('remotePathExists', () => {
  it('returns true when test -d succeeds', async () => {
    stubExec([LOGIN_SHELL, { stdout: '' }]);
    await expect(remotePathExists('prod', '/home/user/repo')).resolves.toBe(true);
  });

  it('returns false when test -d fails', async () => {
    stubExec([LOGIN_SHELL, { error: new Error('test -d: not found') }]);
    await expect(remotePathExists('prod', '/gone')).resolves.toBe(false);
  });

  it('quotes the remote path for shell safety', async () => {
    stubExec([LOGIN_SHELL, { stdout: '' }]);
    await remotePathExists('prod', "path with 'quotes'");
    const args = h.execFile.mock.calls[1][1] as string[];
    // The path survives TWO quoting layers: the login-shell wrapper's own
    // shellQuote, and the inner `test -d <path>` command.
    expect(args[args.length - 1]).toBe(
      `/bin/bash -lic ${shellQuote(`test -d ${shellQuote("path with 'quotes'")}`)}`,
    );
  });
});

describe('listRemoteDirs', () => {
  it('parses the first stdout line as the resolved path and the rest as sorted dirs', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/home/user/repo\nb-dir\nA-dir\nsub\n' }]);
    const result = await listRemoteDirs('prod', '/home/user/repo');
    expect(result).toEqual({ resolvedPath: '/home/user/repo', dirs: ['A-dir', 'b-dir', 'sub'] });
  });

  it('normalizes ~ and relative components via cd + pwd', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/home/alice\nproj\n' }]);
    const result = await listRemoteDirs('prod', '~/code/..');
    expect(result).toEqual({ resolvedPath: '/home/alice', dirs: ['proj'] });
  });

  it('returns an empty dir list for an empty directory', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/empty\n' }]);
    const result = await listRemoteDirs('prod', '/empty');
    expect(result).toEqual({ resolvedPath: '/empty', dirs: [] });
  });

  it('drops . and .. entries from the listing', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/repo\n.\n..\nreal\n' }]);
    const result = await listRemoteDirs('prod', '/repo');
    expect(result.dirs).toEqual(['real']);
  });

  it('assembles the ~-expansion command with shell-quoted literals', async () => {
    stubExec([LOGIN_SHELL, { stdout: '/home/alice\n' }]);
    await listRemoteDirs('prod', '~/work');
    const args = h.execFile.mock.calls[1][1] as string[];
    // `${p#'~'}` is shell parameter expansion — it must be a plain string
    // literal in the expected command, not template interpolation.
    const expected =
      `p=${shellQuote('~/work')}; ` +
      `case "$p" in '~') p="$HOME";; '~/'*) p="$HOME` +
      "${p#'~'}" +
      `";; esac; ` +
      `cd "$p" 2>/dev/null || { echo '目录不存在或不可读' >&2; exit 3; }; ` +
      `pwd; find "$p" -maxdepth 1 -mindepth 1 -type d -exec basename {} \\;`;
    expect(args[args.length - 1]).toBe(`/bin/bash -lic ${shellQuote(expected)}`);
  });

  it('throws a user-facing error when cd fails (missing or unreadable directory)', async () => {
    stubExec([LOGIN_SHELL, { error: new Error('目录不存在或不可读') }]);
    await expect(listRemoteDirs('prod', '/gone')).rejects.toThrow('读取远端目录失败：目录不存在或不可读');
  });

  it('throws a user-facing error when the ssh connection fails', async () => {
    stubExec([LOGIN_SHELL, { error: CONNECT_FAIL }]);
    await expect(listRemoteDirs('prod', '/repo')).rejects.toThrow('读取远端目录失败：ssh: connect to host failed');
  });
});

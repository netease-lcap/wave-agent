import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: h.execFile,
}));

import { resolveRemoteWaveBinary, remotePathExists, REMOTE_NODE_MIN_MAJOR } from '../src/main/remoteCli';

type StubResult = { stdout?: string; error?: Error };

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
});

describe('resolveRemoteWaveBinary', () => {
  it('returns the wave binary path when node and wave are present', async () => {
    stubExec([{ stdout: 'v22.3.0' }, { stdout: '/usr/local/bin/wave' }]);
    const info = await resolveRemoteWaveBinary('prod');
    expect(info).toEqual({ binaryPath: '/usr/local/bin/wave', nodeVersion: 'v22.3.0' });
  });

  it('throws an actionable error when node is missing', async () => {
    stubExec([{ error: CONNECT_FAIL }]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow('未检测到 Node.js');
  });

  it('throws when node is too old', async () => {
    stubExec([{ stdout: 'v18.0.0' }]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow(`需要 ≥ ${REMOTE_NODE_MIN_MAJOR}`);
  });

  it('auto-installs wave-code when the binary is missing, then re-probes', async () => {
    stubExec([
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
      { stdout: 'v22.0.0' },
      { error: new Error('command not found') },
      { error: new Error('npm ERR! network') },
    ]);
    await expect(resolveRemoteWaveBinary('prod')).rejects.toThrow('自动安装失败');
  });

  it('throws when installIfMissing is false and wave is absent', async () => {
    stubExec([{ stdout: 'v22.0.0' }, { error: new Error('command not found') }]);
    await expect(resolveRemoteWaveBinary('prod', false)).rejects.toThrow('未安装 wave-code CLI');
  });

  it('uses the npmmirror registry in the install command', async () => {
    const commands: string[] = [];
    const queue: StubResult[] = [
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
    const install = commands.find((c) => c.startsWith('npm install -g wave-code'));
    expect(install).toContain('--registry=https://registry.npmmirror.com');
  });
});

describe('remotePathExists', () => {
  it('returns true when test -d succeeds', async () => {
    stubExec([{ stdout: '' }]);
    await expect(remotePathExists('prod', '/home/user/repo')).resolves.toBe(true);
  });

  it('returns false when test -d fails', async () => {
    stubExec([{ error: new Error('test -d: not found') }]);
    await expect(remotePathExists('prod', '/gone')).resolves.toBe(false);
  });

  it('quotes the remote path for shell safety', async () => {
    stubExec([{ stdout: '' }]);
    await remotePathExists('prod', "path with 'quotes'");
    const args = h.execFile.mock.calls[0][1] as string[];
    expect(args[args.length - 1]).toBe(`test -d 'path with '\\''quotes'\\'''`);
  });
});

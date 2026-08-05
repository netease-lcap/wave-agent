import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
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
  writeFileSync: vi.fn((p: string, data: string) => {
    h.files.set(p, data);
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import {
  LOCAL_HOST,
  SSH_BASE_OPTIONS,
  parseSshConfigHosts,
  parseConnectionString,
  addSshHost,
  buildSshSpawnArgs,
  buildSshTunnelArgs,
} from '../src/main/sshHosts';

const CONFIG = '/mock-home/.ssh/config';

beforeEach(() => {
  h.files.clear();
});

describe('parseSshConfigHosts', () => {
  it('returns [] when the config file is missing', () => {
    expect(parseSshConfigHosts(CONFIG)).toEqual([]);
  });

  it('returns [] when the config file is unreadable (corrupt)', () => {
    h.files.set(CONFIG, 'not-ssh-config{{{');
    expect(parseSshConfigHosts(CONFIG)).toEqual([]);
  });

  it('lists top-level Host block names', () => {
    h.files.set(CONFIG, [
      'Host prod',
      '  HostName 10.0.0.1',
      '',
      'Host staging',
      '  User deploy',
    ].join('\n'));
    expect(parseSshConfigHosts(CONFIG)).toEqual(['prod', 'staging']);
  });

  it('skips wildcard patterns, comments, and Include lines', () => {
    h.files.set(CONFIG, [
      '# comment',
      'Include ~/.ssh/other.conf',
      'Host *',
      'Host *.example.com',
      'Host prod',
      'Host ?',
    ].join('\n'));
    expect(parseSshConfigHosts(CONFIG)).toEqual(['prod']);
  });

  it('handles multiple names on one Host line and dedupes', () => {
    h.files.set(CONFIG, 'Host prod prod2\nHost prod\n');
    expect(parseSshConfigHosts(CONFIG)).toEqual(['prod', 'prod2']);
  });

  it('trims lines, so indentation does not hide a Host block', () => {
    // Lines are trimmed before matching (mirroring ssh config parsing), so a
    // Host line with leading whitespace still registers as a host.
    h.files.set(CONFIG, 'Host prod\n  HostName 10.0.0.1\n  Host nested\nHost other\n');
    expect(parseSshConfigHosts(CONFIG)).toEqual(['prod', 'nested', 'other']);
  });
});

describe('parseConnectionString', () => {
  it('parses user@hostname', () => {
    expect(parseConnectionString('ssh dev@myhost')).toEqual({ host: 'myhost', hostName: 'myhost', user: 'dev' });
  });

  it('parses hostname with optional leading ssh', () => {
    expect(parseConnectionString('myhost')).toEqual({ host: 'myhost', hostName: 'myhost' });
    expect(parseConnectionString('ssh myhost')).toEqual({ host: 'myhost', hostName: 'myhost' });
  });

  it('parses -p port', () => {
    expect(parseConnectionString('ssh user@host -p 2222')).toEqual({
      host: 'host',
      hostName: 'host',
      user: 'user',
      port: 2222,
    });
  });

  it('strips brackets from IPv6 targets but keeps them for HostName', () => {
    expect(parseConnectionString('ssh user@[2001:db8::1] -p 22')).toEqual({
      host: '2001:db8::1',
      hostName: '[2001:db8::1]',
      user: 'user',
      port: 22,
    });
  });

  it('returns null for empty input', () => {
    expect(parseConnectionString('')).toBeNull();
    expect(parseConnectionString('   ')).toBeNull();
  });

  it('returns null for unsupported options', () => {
    expect(parseConnectionString('ssh -i key.pem user@host')).toBeNull();
    expect(parseConnectionString('ssh -v user@host')).toBeNull();
  });

  it('returns null for multiple targets', () => {
    expect(parseConnectionString('ssh host1 host2')).toBeNull();
  });

  it('returns null when -p is missing its value', () => {
    expect(parseConnectionString('ssh user@host -p')).toBeNull();
  });

  it('returns null for a bare user@', () => {
    expect(parseConnectionString('ssh user@')).toBeNull();
  });
});

describe('addSshHost', () => {
  it('appends a Host block to an existing config', () => {
    h.files.set(CONFIG, 'Host prod\n  HostName 10.0.0.1\n');
    const name = addSshHost('ssh deploy@newhost -p 2222', CONFIG);
    expect(name).toBe('newhost');
    expect(h.files.get(CONFIG)).toContain('\nHost newhost\n    User deploy\n    Port 2222\n');
  });

  it('creates the config file on demand', () => {
    const name = addSshHost('ssh myhost', CONFIG);
    expect(name).toBe('myhost');
    expect(h.files.get(CONFIG)).toContain('Host myhost\n');
  });

  it('refuses to duplicate an existing top-level host', () => {
    h.files.set(CONFIG, 'Host myhost\n  HostName 10.0.0.1\n');
    expect(() => addSshHost('ssh myhost', CONFIG)).toThrow('已存在');
  });

  it('throws on an unparsable connection string', () => {
    expect(() => addSshHost('ssh -i key.pem user@host', CONFIG)).toThrow('无法解析');
  });

  it('writes no HostName option when the name is the hostname', () => {
    addSshHost('ssh plainhost', CONFIG);
    expect(h.files.get(CONFIG)).not.toContain('HostName');
  });
});

describe('buildSshSpawnArgs', () => {
  it('prepends the ssh options and keeps the remote command as ONE argv entry', () => {
    expect(buildSshSpawnArgs('prod', '/path/to/wave --stdio')).toEqual([
      ...SSH_BASE_OPTIONS,
      'prod',
      '/path/to/wave --stdio',
    ]);
  });
});

describe('buildSshTunnelArgs', () => {
  it('builds an -N unix-socket forward with ExitOnForwardFailure', () => {
    expect(
      buildSshTunnelArgs('prod', '/tmp/wave-daemon-prod.sock', '/home/u/.wave/daemon.sock'),
    ).toEqual([
      ...SSH_BASE_OPTIONS,
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=4',
      '-N',
      '-L', '/tmp/wave-daemon-prod.sock:/home/u/.wave/daemon.sock',
      'prod',
    ]);
  });

  it('keeps ServerAlive probes tight enough to detect a half-open tunnel after sleep', () => {
    const args = buildSshTunnelArgs('prod', '/tmp/wave-daemon-prod.sock', '/home/u/.wave/daemon.sock');
    const aliveInterval = Number(args.find((a) => a.startsWith('ServerAliveInterval='))?.split('=')[1]);
    const aliveCountMax = Number(args.find((a) => a.startsWith('ServerAliveCountMax='))?.split('=')[1]);
    // interval × count bounds the dead-tunnel detection time (spec: SSH 远程会话
    // 自动重连 scenario 2 — no unbounded "looks alive but silent" state).
    expect(aliveInterval * aliveCountMax).toBeLessThanOrEqual(60);
  });
});

describe('LOCAL_HOST', () => {
  it('is the sentinel for local sessions', () => {
    expect(LOCAL_HOST).toBe('local');
  });
});

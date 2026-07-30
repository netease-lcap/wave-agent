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
  renameSync: vi.fn((from: string, to: string) => {
    h.files.set(to, h.files.get(from) ?? '');
    h.files.delete(from);
  }),
  mkdirSync: vi.fn(),
}));

import { ConfigStore } from '../src/main/configStore';

const STORE_PATH = '/mock-userData/wave-desktop.json';

beforeEach(() => {
  h.files.clear();
});

describe('ConfigStore', () => {
  it('starts with empty defaults when the file does not exist', () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getConfiguration()).toEqual({});
    expect(store.getRecentWorkdirs()).toEqual([]);
  });

  it('starts fresh when the file is corrupt', () => {
    h.files.set(STORE_PATH, 'not-json{{{');
    const store = new ConfigStore(STORE_PATH);
    expect(store.getConfiguration()).toEqual({});
    expect(store.getRecentWorkdirs()).toEqual([]);
  });

  it('persists configuration across instances', () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: 'k1', model: 'm1' });

    const reloaded = new ConfigStore(STORE_PATH);
    expect(reloaded.getConfiguration()).toEqual({ apiKey: 'k1', model: 'm1' });
  });

  it('merge-updates configuration: absent fields keep their stored value', () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: 'k1', model: 'm1', baseURL: 'https://a' });
    store.setConfiguration({ model: 'm2' });

    expect(store.getConfiguration()).toEqual({ apiKey: 'k1', model: 'm2', baseURL: 'https://a' });
  });

  it('does not mutate the stored configuration through the returned copy', () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: 'k1' });
    store.getConfiguration().apiKey = 'tampered';
    expect(store.getConfiguration().apiKey).toBe('k1');
  });

  it('pushes new workdir to the front of the recent list and deduplicates', () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir('/a');
    store.addRecentWorkdir('/b');
    store.addRecentWorkdir('/a');

    expect(store.getRecentWorkdirs()).toEqual(['/a', '/b']);
  });

  it('caps the recent list at 10 entries', () => {
    const store = new ConfigStore(STORE_PATH);
    for (let i = 0; i < 12; i++) {
      store.addRecentWorkdir(`/dir-${i}`);
    }
    const recents = store.getRecentWorkdirs();
    expect(recents).toHaveLength(10);
    expect(recents[0]).toBe('/dir-11');
    expect(recents[9]).toBe('/dir-2');
  });

  it('removeRecentWorkdir filters the entry out and persists', () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir('/a');
    store.addRecentWorkdir('/b');
    store.removeRecentWorkdir('/a');

    expect(store.getRecentWorkdirs()).toEqual(['/b']);
    expect(new ConfigStore(STORE_PATH).getRecentWorkdirs()).toEqual(['/b']);
  });

  it('drops non-string entries from a corrupted recentWorkdirs array', () => {
    h.files.set(STORE_PATH, JSON.stringify({
      configuration: {},
      recentWorkdirs: ['/ok', 42, null, '/also-ok'],
    }));
    const store = new ConfigStore(STORE_PATH);
    expect(store.getRecentWorkdirs()).toEqual(['/ok', '/also-ok']);
  });

  // ── Session index ──────────────────────────────────────────────

  it('starts with empty session index', () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getSessionIndex()).toEqual([]);
  });

  it('drops entries without sessionId from corrupted sessions array', () => {
    h.files.set(STORE_PATH, JSON.stringify({
      configuration: {},
      recentWorkdirs: [],
      sessions: [
        { sessionId: 'ok', title: 'T', workdir: '/a', cwd: '/a', lastActiveAt: 1 },
        null,
        { title: 'no id' },
        42,
      ],
    }));
    const store = new ConfigStore(STORE_PATH);
    expect(store.getSessionIndex()).toEqual([
      { sessionId: 'ok', title: 'T', workdir: '/a', cwd: '/a', createdAt: 1, lastActiveAt: 1 },
    ]);
  });

  it('backfills createdAt from lastActiveAt for legacy entries', () => {
    h.files.set(STORE_PATH, JSON.stringify({
      configuration: {},
      recentWorkdirs: [],
      sessions: [
        { sessionId: 'legacy', title: 'T', workdir: '/a', cwd: '/a', lastActiveAt: 1234 },
        { sessionId: 'current', title: 'T', workdir: '/a', cwd: '/a', createdAt: 100, lastActiveAt: 5678 },
      ],
    }));
    const store = new ConfigStore(STORE_PATH);
    const index = store.getSessionIndex();
    expect(index.find((e) => e.sessionId === 'legacy')?.createdAt).toBe(1234);
    expect(index.find((e) => e.sessionId === 'current')?.createdAt).toBe(100);
  });

  it('upsertSession adds a new session and persists', () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: 's1',
      title: 'Fix the bug',
      workdir: '/repo',
      cwd: '/repo',
      createdAt: 1000,
      lastActiveAt: 1000,
    };
    store.upsertSession(entry);

    expect(store.getSessionIndex()).toEqual([entry]);
    expect(new ConfigStore(STORE_PATH).getSessionIndex()).toEqual([entry]);
  });

  it('upsertSession updates an existing session by sessionId', () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: 's1',
      title: 'Old title',
      workdir: '/repo',
      cwd: '/repo',
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    store.upsertSession({
      sessionId: 's1',
      title: 'New title',
      workdir: '/repo',
      cwd: '/repo',
      createdAt: 1000,
      lastActiveAt: 2000,
    });

    expect(store.getSessionIndex()).toHaveLength(1);
    expect(store.getSessionIndex()[0].title).toBe('New title');
    expect(store.getSessionIndex()[0].lastActiveAt).toBe(2000);
  });

  it('upsertSession stores worktree info when provided', () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: 's1',
      title: 'WT session',
      workdir: '/repo',
      cwd: '/repo/.wave/worktrees/feat',
      createdAt: 1000,
      lastActiveAt: 1000,
      worktree: {
        path: '/repo/.wave/worktrees/feat',
        branch: 'worktree-feat',
        baseBranch: 'origin/main',
        repoRoot: '/repo',
      },
    };
    store.upsertSession(entry);
    expect(store.getSessionIndex()[0].worktree).toEqual(entry.worktree);
  });

  it('touchSession updates lastActiveAt', () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: 's1',
      title: 'T',
      workdir: '/a',
      cwd: '/a',
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.touchSession('s1', 999);
    expect(store.getSessionIndex()[0].lastActiveAt).toBe(999);
  });

  it('touchSession is a no-op for unknown sessionId', () => {
    const store = new ConfigStore(STORE_PATH);
    store.touchSession('nonexistent', 999);
    expect(store.getSessionIndex()).toEqual([]);
  });

  it('removeSession removes and returns the entry', () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: 's1',
      title: 'T',
      workdir: '/a',
      cwd: '/a',
      createdAt: 100,
      lastActiveAt: 100,
    };
    store.upsertSession(entry);
    const removed = store.removeSession('s1');

    expect(removed).toEqual(entry);
    expect(store.getSessionIndex()).toEqual([]);
  });

  it('removeSession returns undefined for unknown sessionId', () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.removeSession('nonexistent')).toBeUndefined();
  });

  it('removeSession persists the removal', () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: 's1',
      title: 'T',
      workdir: '/a',
      cwd: '/a',
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.removeSession('s1');
    expect(new ConfigStore(STORE_PATH).getSessionIndex()).toEqual([]);
  });

  it('returned copies do not mutate the store', () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: 's1',
      title: 'Original',
      workdir: '/a',
      cwd: '/a',
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.getSessionIndex()[0].title = 'tampered';
    expect(store.getSessionIndex()[0].title).toBe('Original');
  });
});

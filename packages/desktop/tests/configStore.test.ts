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
});

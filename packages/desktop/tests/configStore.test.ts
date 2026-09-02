import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
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
  writeFileSync: vi.fn((p: string, data: string) => {
    h.files.set(p, data);
  }),
  renameSync: vi.fn((from: string, to: string) => {
    h.files.set(to, h.files.get(from) ?? "");
    h.files.delete(from);
  }),
  mkdirSync: vi.fn(),
}));

import { ConfigStore } from "../src/main/configStore";

const STORE_PATH = "/mock-userData/wave-desktop.json";

beforeEach(() => {
  h.files.clear();
});

describe("ConfigStore", () => {
  it("starts with defaults when the file does not exist", () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getConfiguration()).toEqual({ language: "Chinese" });
    expect(store.getRecentWorkdirs()).toEqual([]);
  });

  it("starts fresh when the file is corrupt", () => {
    h.files.set(STORE_PATH, "not-json{{{");
    const store = new ConfigStore(STORE_PATH);
    expect(store.getConfiguration()).toEqual({ language: "Chinese" });
    expect(store.getRecentWorkdirs()).toEqual([]);
  });

  it("defaults language to Chinese when unset, matching VSCE/JetBrains", () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getConfiguration().language).toBe("Chinese");
  });

  it("persists configuration across instances", () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: "k1", model: "m1" });

    const reloaded = new ConfigStore(STORE_PATH);
    expect(reloaded.getConfiguration()).toEqual({
      apiKey: "k1",
      model: "m1",
      language: "Chinese",
    });
  });

  it("merge-updates configuration: absent fields keep their stored value", () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: "k1", model: "m1", baseURL: "https://a" });
    store.setConfiguration({ model: "m2" });

    expect(store.getConfiguration()).toEqual({
      apiKey: "k1",
      model: "m2",
      baseURL: "https://a",
      language: "Chinese",
    });
  });

  it("does not mutate the stored configuration through the returned copy", () => {
    const store = new ConfigStore(STORE_PATH);
    store.setConfiguration({ apiKey: "k1" });
    store.getConfiguration().apiKey = "tampered";
    expect(store.getConfiguration().apiKey).toBe("k1");
  });

  it("pushes new workdir to the front of the recent list and deduplicates", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "local", path: "/a" });
    store.addRecentWorkdir({ host: "local", path: "/b" });
    store.addRecentWorkdir({ host: "local", path: "/a" });

    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/a" },
      { host: "local", path: "/b" },
    ]);
  });

  it("caps the recent list at 10 entries", () => {
    const store = new ConfigStore(STORE_PATH);
    for (let i = 0; i < 12; i++) {
      store.addRecentWorkdir({ host: "local", path: `/dir-${i}` });
    }
    const recents = store.getRecentWorkdirs();
    expect(recents).toHaveLength(10);
    expect(recents[0]).toEqual({ host: "local", path: "/dir-11" });
    expect(recents[9]).toEqual({ host: "local", path: "/dir-2" });
  });

  it("keeps per-host recents separate: the same path on two hosts are distinct entries", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "local", path: "/repo" });
    store.addRecentWorkdir({ host: "devbox", path: "/repo" });
    store.addRecentWorkdir({ host: "local", path: "/other" });

    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/other" },
      { host: "devbox", path: "/repo" },
      { host: "local", path: "/repo" },
    ]);
    expect(store.getRecentWorkdirsForHost("local")).toEqual([
      "/other",
      "/repo",
    ]);
    expect(store.getRecentWorkdirsForHost("devbox")).toEqual(["/repo"]);
    expect(store.getRecentWorkdirsForHost("nonexistent")).toEqual([]);
  });

  it("removeRecentWorkdir filters the entry out and persists", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "local", path: "/a" });
    store.addRecentWorkdir({ host: "local", path: "/b" });
    store.removeRecentWorkdir({ host: "local", path: "/a" });

    expect(store.getRecentWorkdirs()).toEqual([{ host: "local", path: "/b" }]);
    expect(new ConfigStore(STORE_PATH).getRecentWorkdirs()).toEqual([
      { host: "local", path: "/b" },
    ]);
  });

  it("removeRecentWorkdir only removes the entry matching (host, path)", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "local", path: "/repo" });
    store.addRecentWorkdir({ host: "devbox", path: "/repo" });
    store.removeRecentWorkdir({ host: "devbox", path: "/repo" });

    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/repo" },
    ]);
  });

  it("drops non-string entries from a corrupted recentWorkdirs array", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        recentWorkdirs: ["/ok", 42, null, "/also-ok"],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/ok" },
      { host: "local", path: "/also-ok" },
    ]);
  });

  it("migrates legacy plain-string recents to local-host refs on load", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        recentWorkdirs: ["/legacy"],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "/legacy" },
    ]);
  });

  it("treats C:\\a and C:/a as the same local workdir", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "local", path: "C:\\Users\\foo" });
    store.addRecentWorkdir({ host: "local", path: "C:/Users/foo" });
    store.addRecentWorkdir({ host: "local", path: "C:\\Users\\foo\\" });

    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "C:\\Users\\foo" },
    ]);
  });

  it("merges pre-existing duplicates that differ only in slash style on load", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        recentWorkdirs: [
          { host: "local", path: "C:\\Users\\foo" },
          { host: "local", path: "C:/Users/foo" },
          { host: "local", path: "D:/other" },
        ],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    expect(store.getRecentWorkdirs()).toEqual([
      { host: "local", path: "C:\\Users\\foo" },
      { host: "local", path: "D:\\other" },
    ]);
  });

  it("keeps remote POSIX paths untouched", () => {
    const store = new ConfigStore(STORE_PATH);
    store.addRecentWorkdir({ host: "devbox", path: "/home/dev/repo" });
    expect(store.getRecentWorkdirs()).toEqual([
      { host: "devbox", path: "/home/dev/repo" },
    ]);
  });

  // ── Session index ──────────────────────────────────────────────

  it("starts with empty session index", () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getSessionIndex()).toEqual([]);
  });

  it("drops entries without sessionId from corrupted sessions array", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        recentWorkdirs: [],
        sessions: [
          {
            sessionId: "ok",
            title: "T",
            workdir: "/a",
            cwd: "/a",
            lastActiveAt: 1,
          },
          null,
          { title: "no id" },
          42,
        ],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    expect(store.getSessionIndex()).toEqual([
      {
        sessionId: "ok",
        title: "T",
        workdir: "/a",
        cwd: "/a",
        createdAt: 1,
        lastActiveAt: 1,
        host: "local",
      },
    ]);
  });

  it("backfills createdAt from lastActiveAt for legacy entries", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        recentWorkdirs: [],
        sessions: [
          {
            sessionId: "legacy",
            title: "T",
            workdir: "/a",
            cwd: "/a",
            lastActiveAt: 1234,
          },
          {
            sessionId: "current",
            title: "T",
            workdir: "/a",
            cwd: "/a",
            createdAt: 100,
            lastActiveAt: 5678,
          },
        ],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    const index = store.getSessionIndex();
    expect(index.find((e) => e.sessionId === "legacy")?.createdAt).toBe(1234);
    expect(index.find((e) => e.sessionId === "current")?.createdAt).toBe(100);
  });

  it("upsertSession adds a new session and persists", () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: "s1",
      title: "Fix the bug",
      workdir: "/repo",
      cwd: "/repo",
      createdAt: 1000,
      lastActiveAt: 1000,
    };
    store.upsertSession(entry);

    expect(store.getSessionIndex()).toEqual([{ ...entry, host: "local" }]);
    expect(new ConfigStore(STORE_PATH).getSessionIndex()).toEqual([
      { ...entry, host: "local" },
    ]);
  });

  it("upsertSession keeps an explicit remote host", () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: "s1",
      title: "Remote session",
      workdir: "/repo",
      cwd: "/repo",
      createdAt: 1000,
      lastActiveAt: 1000,
      host: "devbox",
    });

    expect(store.getSessionIndex()[0].host).toBe("devbox");
  });

  it("upsertSession updates an existing session by sessionId", () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: "s1",
      title: "Old title",
      workdir: "/repo",
      cwd: "/repo",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    store.upsertSession({
      sessionId: "s1",
      title: "New title",
      workdir: "/repo",
      cwd: "/repo",
      createdAt: 1000,
      lastActiveAt: 2000,
    });

    expect(store.getSessionIndex()).toHaveLength(1);
    expect(store.getSessionIndex()[0].title).toBe("New title");
    expect(store.getSessionIndex()[0].lastActiveAt).toBe(2000);
  });

  it("upsertSession stores worktree info when provided", () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: "s1",
      title: "WT session",
      workdir: "/repo",
      cwd: "/repo/.wave/worktrees/feat",
      createdAt: 1000,
      lastActiveAt: 1000,
      worktree: {
        path: "/repo/.wave/worktrees/feat",
        branch: "worktree-feat",
        baseBranch: "origin/main",
        repoRoot: "/repo",
      },
    };
    store.upsertSession(entry);
    expect(store.getSessionIndex()[0].worktree).toEqual(entry.worktree);
  });

  it("touchSession updates lastActiveAt", () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: "s1",
      title: "T",
      workdir: "/a",
      cwd: "/a",
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.touchSession("s1", 999);
    expect(store.getSessionIndex()[0].lastActiveAt).toBe(999);
  });

  it("touchSession is a no-op for unknown sessionId", () => {
    const store = new ConfigStore(STORE_PATH);
    store.touchSession("nonexistent", 999);
    expect(store.getSessionIndex()).toEqual([]);
  });

  it("removeSession removes and returns the entry", () => {
    const store = new ConfigStore(STORE_PATH);
    const entry = {
      sessionId: "s1",
      title: "T",
      workdir: "/a",
      cwd: "/a",
      createdAt: 100,
      lastActiveAt: 100,
    };
    store.upsertSession(entry);
    const removed = store.removeSession("s1");

    expect(removed).toEqual({ ...entry, host: "local" });
    expect(store.getSessionIndex()).toEqual([]);
  });

  it("removeSession returns undefined for unknown sessionId", () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.removeSession("nonexistent")).toBeUndefined();
  });

  it("removeSession persists the removal", () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: "s1",
      title: "T",
      workdir: "/a",
      cwd: "/a",
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.removeSession("s1");
    expect(new ConfigStore(STORE_PATH).getSessionIndex()).toEqual([]);
  });

  it("returned copies do not mutate the store", () => {
    const store = new ConfigStore(STORE_PATH);
    store.upsertSession({
      sessionId: "s1",
      title: "Original",
      workdir: "/a",
      cwd: "/a",
      createdAt: 100,
      lastActiveAt: 100,
    });
    store.getSessionIndex()[0].title = "tampered";
    expect(store.getSessionIndex()[0].title).toBe("Original");
  });

  // ── Theme preference ────────────────────────────────────────────

  it("defaults the theme source to following the system", () => {
    const store = new ConfigStore(STORE_PATH);
    expect(store.getThemeSource()).toBe("system");
  });

  it("persists the theme source across instances", () => {
    const store = new ConfigStore(STORE_PATH);
    store.setThemeSource("dark");
    expect(store.getThemeSource()).toBe("dark");
    expect(new ConfigStore(STORE_PATH).getThemeSource()).toBe("dark");
  });

  it("falls back to system for a corrupt theme value on disk", () => {
    h.files.set(
      STORE_PATH,
      JSON.stringify({
        configuration: {},
        theme: "neon",
        recentWorkdirs: [],
        sessions: [],
      }),
    );
    const store = new ConfigStore(STORE_PATH);
    expect(store.getThemeSource()).toBe("system");
  });
});

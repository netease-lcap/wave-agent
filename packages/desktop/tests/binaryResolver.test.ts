import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// ── Mocks ──────────────────────────────────────────────────────

// Fake fs backed by an in-memory map so the resolver's read/check/copy
// sequence is observable without touching the real filesystem.
const memFs = vi.hoisted(() => new Map<string, string>());
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn((p: string) => memFs.has(p)),
  mkdirSync: vi.fn((p: string) => {
    memFs.set(p.replace(/[\\/]$/, "") + path.sep, "");
  }),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn((p: string) => {
    const v = memFs.get(p);
    if (v == null) throw new Error(`ENOENT ${p}`);
    return v;
  }),
  rmSync: vi.fn((p: string) => {
    for (const k of [...memFs.keys()]) {
      if (k === p || k.startsWith(p + path.sep)) memFs.delete(k);
    }
  }),
  cpSync: vi.fn((src: string, dest: string) => {
    for (const [k, v] of memFs) {
      if (k === src || k.startsWith(src + path.sep)) {
        memFs.set(k.replace(src, dest), v);
      }
    }
  }),
}));

vi.mock("fs", () => ({ default: mockFs, ...mockFs }));

vi.mock("os", () => ({
  default: { homedir: () => "/fake/home", tmpdir: () => "/fake/tmp" },
  homedir: () => "/fake/home",
  tmpdir: () => "/fake/tmp",
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => "/app/root"),
  },
}));

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  ensureCliUpToDate,
  cliEntryPath,
  cliInstallDir,
  bundledCliDir,
  _resetCacheForTesting,
} from "../src/main/stdio/binaryResolver";

const bundledDir = () => path.join("/app/root", "resources", "wave-cli");
const bundledEntry = () => path.join(bundledDir(), "bin", "wave-code.js");
const entry = () =>
  path.join("/fake/home", ".wave", "cli", "desktop", "bin", "wave-code.js");

const PKG_JSON = (version: string) =>
  JSON.stringify({ name: "wave-code", version });

/** Seed the bundled CLI (as bundleCli.mjs would). */
function seedBundledCli(version = "1.0.0", content = "bundle") {
  memFs.set(bundledEntry(), "shim");
  memFs.set(path.join(bundledDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(bundledDir(), "dist", "bundle", "wave.mjs"), content);
}

/** Seed a fully installed runtime CLI (same version + bytes → no re-copy). */
function seedRuntimeCli(version = "1.0.0", content = "bundle") {
  memFs.set(entry(), "shim");
  memFs.set(path.join(cliInstallDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs"), content);
}

describe("binaryResolver (bundled CLI only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memFs.clear();
    _resetCacheForTesting();
  });

  afterEach(() => {
    _resetCacheForTesting();
  });

  it("exposes bundled and runtime dirs", () => {
    expect(bundledCliDir()).toBe(bundledDir());
    expect(cliEntryPath()).toBe(entry());
  });

  it("cliInstallDir is per-end (desktop)", () => {
    // Each frontend (vscode/desktop/jetbrains) owns its own subdir so they
    // never overwrite each other's CLI copy. The runtime dependencies the CLI
    // installs itself live at the shared root, outside this dir.
    expect(cliInstallDir()).toBe(
      path.join("/fake/home", ".wave", "cli", "desktop"),
    );
    expect(entry()).toContain(path.join(".wave", "cli", "desktop"));
  });

  it("prefers WAVE_CLI_PATH override without touching the bundle", async () => {
    process.env.WAVE_CLI_PATH = "/dev/wave-code.js";
    memFs.set("/dev/wave-code.js", "dev shim");

    try {
      await expect(resolveWaveBinary("1.0.0")).resolves.toBe(
        "/dev/wave-code.js",
      );
      expect(mockFs.cpSync).not.toHaveBeenCalled();
    } finally {
      delete process.env.WAVE_CLI_PATH;
    }
  });

  it("throws a reinstall-guide error when the bundled CLI is missing", async () => {
    await expect(resolveWaveBinary("1.0.0")).rejects.toThrow("内置 CLI 缺失");
  });

  it("copies the bundled CLI into ~/.wave/cli/desktop on first use", async () => {
    seedBundledCli("1.0.0");

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(memFs.has(entry())).toBe(true);
    expect(
      memFs.has(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe(true);
  });

  it("reuses the runtime CLI without re-copy when the bytes match", async () => {
    seedBundledCli("1.0.0");
    seedRuntimeCli("1.0.0");

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).not.toHaveBeenCalled();
  });

  it("re-copies the CLI when the bundle content changes (app upgrade)", async () => {
    seedBundledCli("1.1.0", "upgraded-bundle"); // app upgraded
    seedRuntimeCli("1.0.0");

    const result = await resolveWaveBinary("1.1.0");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
  });

  it("re-copies when a same-version reinstall ships different bundle bytes (desktop:install)", async () => {
    // desktop:install refreshes the app without bumping the version — a
    // version-only staleness check would keep running the old runtime copy
    // forever (regression: stale CLI missed the compaction display fix).
    seedBundledCli("1.1.5", "rebuilt-with-fix");
    seedRuntimeCli("1.1.5", "stale-aug26-copy");

    const result = await resolveWaveBinary("1.1.5");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
    expect(
      memFs.get(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe("rebuilt-with-fix");
  });

  it("ensureCliUpToDate resolves the runtime CLI", async () => {
    seedBundledCli("1.0.0");

    await expect(ensureCliUpToDate("1.0.0")).resolves.toBe(entry());
  });
});

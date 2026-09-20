import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// ── Mocks ──────────────────────────────────────────────────────

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

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  ensureCliUpToDate,
  decodeCommandOutput,
  setExtensionPath,
  cliInstallDir,
  _resetCacheForTesting,
} from "../../src/stdio/binaryResolver";

const EXT = "/ext/install";
const bundledDir = () => path.join(EXT, "dist", "wave-cli");
const bundledEntry = () => path.join(bundledDir(), "bin", "wave-code.js");
const entry = () =>
  path.join("/fake/home", ".wave", "cli", "vscode", "bin", "wave-code.js");

const PKG_JSON = (version: string) =>
  JSON.stringify({ name: "wave-code", version });

function seedBundledCli(version = "1.0.0", bundle = "bundle") {
  memFs.set(bundledEntry(), "shim");
  memFs.set(path.join(bundledDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(bundledDir(), "dist", "bundle", "wave.mjs"), bundle);
}

function seedRuntimeCli(version = "1.0.0", bundle = "bundle") {
  memFs.set(entry(), "shim");
  memFs.set(path.join(cliInstallDir(), "bin", "wave-code.js"), "shim");
  memFs.set(path.join(cliInstallDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs"), bundle);
}

describe("binaryResolver (bundled CLI only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memFs.clear();
    _resetCacheForTesting();
    setExtensionPath(EXT);
  });

  afterEach(() => {
    _resetCacheForTesting();
  });

  it("cliInstallDir is per-end (vscode)", () => {
    // Each frontend (vscode/desktop/jetbrains) owns its own subdir so they
    // never overwrite each other's CLI copy. The runtime dependencies the CLI
    // installs itself live at the shared root, outside this dir.
    expect(cliInstallDir()).toBe(
      path.join("/fake/home", ".wave", "cli", "vscode"),
    );
    expect(entry()).toContain(path.join(".wave", "cli", "vscode"));
  });

  it("prefers WAVE_CLI_PATH override without touching the bundle", async () => {
    process.env.WAVE_CLI_PATH = "/dev/wave-code.js";
    memFs.set("/dev/wave-code.js", "dev shim");

    try {
      await expect(resolveWaveBinary()).resolves.toBe("/dev/wave-code.js");
      expect(mockFs.cpSync).not.toHaveBeenCalled();
    } finally {
      delete process.env.WAVE_CLI_PATH;
    }
  });

  it("throws a reinstall-guide error when the bundled CLI is missing", async () => {
    await expect(resolveWaveBinary()).rejects.toThrow("内置 CLI 缺失");
  });

  it("throws when no extension path is set", async () => {
    setExtensionPath("");
    await expect(resolveWaveBinary()).rejects.toThrow("缺少扩展路径");
  });

  it("copies the bundled CLI into ~/.wave/cli/vscode on first use", async () => {
    seedBundledCli("1.0.0");

    const result = await resolveWaveBinary();

    expect(result).toBe(entry());
    expect(memFs.has(entry())).toBe(true);
    expect(
      memFs.has(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe(true);
  });

  it("reuses the runtime CLI without re-copy when the bytes match", async () => {
    seedBundledCli("1.0.0");
    seedRuntimeCli("1.0.0");

    const result = await resolveWaveBinary();

    expect(result).toBe(entry());
    expect(mockFs.cpSync).not.toHaveBeenCalled();
  });

  it("re-copies the CLI when the bundle bytes change", async () => {
    seedBundledCli("1.1.0", "bundle-v2");
    seedRuntimeCli("1.0.0", "bundle-v1");

    const result = await resolveWaveBinary();

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
  });

  it("re-copies when a same-version install ships different bundle bytes", async () => {
    // The copy decision is content-based: dev reinstalls and GUI-only
    // releases can ship new bytes without bumping the version, so an
    // unchanged version number must not suppress the re-copy.
    seedBundledCli("1.0.0", "bundle-v2");
    seedRuntimeCli("1.0.0", "bundle-v1");

    const result = await resolveWaveBinary();

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
  });

  it("ensureCliUpToDate resolves the runtime CLI", async () => {
    seedBundledCli("1.0.0");

    await expect(ensureCliUpToDate()).resolves.toBe(entry());
  });

  it("decodeCommandOutput falls back to GBK on U+FFFD", () => {
    // GBK (CP936) bytes of `刘一奇` — cmd.exe output on Chinese Windows.
    const gbk = Buffer.from([0xc1, 0xf5, 0xd2, 0xbb, 0xc6, 0xe6]);
    expect(decodeCommandOutput(gbk)).toBe("刘一奇");
  });

  it("decodeCommandOutput keeps valid UTF-8 untouched", () => {
    expect(decodeCommandOutput("C:\\Users\\wave.cmd")).toBe(
      "C:\\Users\\wave.cmd",
    );
  });
});

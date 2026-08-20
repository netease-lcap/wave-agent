import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// ── Mocks ──────────────────────────────────────────────────────

const mockTarX = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockMaxSatisfying = vi.hoisted(() => vi.fn(() => "1.18.0"));

const memFs = vi.hoisted(() => new Map<string, string>());
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn((p: string) => memFs.has(p)),
  mkdirSync: vi.fn((p: string) => {
    // Mirror the real fs: directories are recorded so tar's cwd check
    // (extract refuses to cd into a missing dir) is observable.
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

vi.mock("tar", () => ({ x: mockTarX }));

vi.mock("semver", () => ({ maxSatisfying: mockMaxSatisfying }));

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  ensureCliUpToDate,
  ensureRipgrep,
  decodeCommandOutput,
  setExtensionPath,
  cliInstallDir,
  NPM_REGISTRY,
  _resetCacheForTesting,
} from "../../src/stdio/binaryResolver";

const EXT = "/ext/install";
const bundledDir = () => path.join(EXT, "dist", "wave-cli");
const bundledEntry = () => path.join(bundledDir(), "bin", "wave-code.js");
const entry = () =>
  path.join("/fake/home", ".wave", "cli", "bin", "wave-code.js");
const rgBin = () =>
  path.join(
    "/fake/home/.wave/cli/node_modules/@vscode",
    `ripgrep-${process.platform}-${process.arch}`,
    "bin",
    process.platform === "win32" ? "rg.exe" : "rg",
  );

const PKG_JSON = (version: string) =>
  JSON.stringify({
    name: "wave-code",
    version,
    dependencies: { "@vscode/ripgrep": "^1.18.0" },
  });

function seedBundledCli(version = "1.0.0") {
  memFs.set(bundledEntry(), "shim");
  memFs.set(path.join(bundledDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(bundledDir(), "dist", "bundle", "wave.mjs"), "bundle");
}

function seedRuntimeCli(version = "1.0.0") {
  memFs.set(entry(), "shim");
  memFs.set(path.join(cliInstallDir(), "bin", "wave-code.js"), "shim");
  memFs.set(path.join(cliInstallDir(), "package.json"), PKG_JSON(version));
  memFs.set(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs"), "bundle");
}

function seedRg() {
  memFs.set(rgBin(), "rg");
}

function res(extra: Record<string, unknown> = {}) {
  return { ok: true, status: 200, statusText: "OK", ...extra };
}

function mockRipgrepRegistry() {
  mockFetch.mockImplementation(async (url: string) => {
    if (url === `${NPM_REGISTRY}/@vscode/ripgrep`) {
      return res({
        json: async () => ({
          versions: { "1.18.0": { dist: { tarball: "https://x/rg.tgz" } } },
        }),
      });
    }
    if (
      url ===
      `${NPM_REGISTRY}/@vscode/ripgrep-${process.platform}-${process.arch}`
    ) {
      return res({
        json: async () => ({
          versions: {
            "1.18.0": { dist: { tarball: "https://x/rg-plat.tgz" } },
          },
        }),
      });
    }
    if (url === "https://x/rg.tgz" || url === "https://x/rg-plat.tgz") {
      return res({ arrayBuffer: async () => Buffer.from("rg-tgz") });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  mockTarX.mockImplementation(async (opts: { cwd?: string }) => {
    // tar refuses to cd into a missing cwd — mirror the real extractor so a
    // resolver that skips mkdirSync before extract fails the tests.
    const cwd = opts?.cwd ?? "";
    if (!memFs.has(cwd.replace(/[\\/]$/, "") + path.sep)) {
      throw new Error(`[CwdError] ENOENT: Cannot cd into '${cwd}'`);
    }
    memFs.set(rgBin(), "rg");
  });
}

describe("binaryResolver (bundled CLI + downloaded rg)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memFs.clear();
    _resetCacheForTesting();
    setExtensionPath(EXT);
    vi.stubGlobal("fetch", mockFetch);
    mockTarX.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    _resetCacheForTesting();
    vi.unstubAllGlobals();
  });

  it("prefers WAVE_CLI_PATH override without touching bundle/rg", async () => {
    process.env.WAVE_CLI_PATH = "/dev/wave-code.js";
    memFs.set("/dev/wave-code.js", "dev shim");

    try {
      await expect(resolveWaveBinary("1.0.0")).resolves.toBe(
        "/dev/wave-code.js",
      );
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.WAVE_CLI_PATH;
    }
  });

  it("throws a reinstall-guide error when the bundled CLI is missing", async () => {
    await expect(resolveWaveBinary("1.0.0")).rejects.toThrow("内置 CLI 缺失");
  });

  it("throws when no extension path is set", async () => {
    setExtensionPath("");
    await expect(resolveWaveBinary("1.0.0")).rejects.toThrow("缺少扩展路径");
  });

  it("copies the bundled CLI into ~/.wave/cli on first use and downloads rg", async () => {
    seedBundledCli("1.0.0");
    mockRipgrepRegistry();

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(memFs.has(entry())).toBe(true);
    expect(
      memFs.has(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe(true);
    expect(memFs.has(rgBin())).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("reuses the runtime CLI and cached rg without re-copy or re-download", async () => {
    seedBundledCli("1.0.0");
    seedRuntimeCli("1.0.0");
    seedRg();

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-copies the CLI but keeps the cached rg when the version changes", async () => {
    seedBundledCli("1.1.0");
    seedRuntimeCli("1.0.0");
    seedRg();

    const result = await resolveWaveBinary("1.1.0");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(memFs.has(rgBin())).toBe(true);
  });

  it("does not download rg when the CLI has no grep dependency", async () => {
    seedBundledCli();
    memFs.set(
      path.join(bundledDir(), "package.json"),
      JSON.stringify({ name: "wave-code", version: "1.0.0" }),
    );

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a failed rg download surfaces a clear error", async () => {
    seedBundledCli("1.0.0");
    mockFetch.mockImplementation(async () =>
      res({ ok: false, status: 500, statusText: "Server Error" }),
    );

    await expect(resolveWaveBinary("1.0.0")).rejects.toThrow("ripgrep");
  });

  it("ensureRipgrep returns false when the download fails", async () => {
    mockFetch.mockImplementation(async () =>
      res({ ok: false, status: 500, statusText: "Server Error" }),
    );
    seedRuntimeCli("1.0.0");

    await expect(ensureRipgrep()).resolves.toBe(false);
  });

  it("ensureCliUpToDate resolves the runtime CLI", async () => {
    seedBundledCli("1.0.0");
    mockRipgrepRegistry();

    await expect(ensureCliUpToDate("1.0.0")).resolves.toBe(entry());
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

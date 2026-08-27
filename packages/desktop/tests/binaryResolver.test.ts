import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// ── Mocks ──────────────────────────────────────────────────────

const mockTarX = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockMaxSatisfying = vi.hoisted(() => vi.fn(() => "1.18.0"));

// Fake fs backed by an in-memory map so the resolver's read/check/copy
// sequence is observable without touching the real filesystem.
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

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => "/app/root"),
  },
}));

vi.mock("tar", () => ({ x: mockTarX }));

vi.mock("semver", () => ({ maxSatisfying: mockMaxSatisfying }));

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  ensureCliUpToDate,
  ensureRipgrep,
  cliEntryPath,
  cliInstallDir,
  rgInstallDir,
  bundledCliDir,
  NPM_REGISTRY,
  _resetCacheForTesting,
} from "../src/main/stdio/binaryResolver";

const bundledDir = () => path.join("/app/root", "resources", "wave-cli");
const bundledEntry = () => path.join(bundledDir(), "bin", "wave-code.js");
const entry = () =>
  path.join("/fake/home", ".wave", "cli", "desktop", "bin", "wave-code.js");
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

/** Seed an already-downloaded rg binary (→ cached, no fetch). */
function seedRg() {
  memFs.set(rgBin(), "rg");
}

/** Fake registry response. */
function res(extra: Record<string, unknown> = {}) {
  return { ok: true, status: 200, statusText: "OK", ...extra };
}

/** Registry fetch mock that serves metadata + tarballs for ripgrep. */
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
    // Simulate extraction: the rg binary lands in place.
    memFs.set(rgBin(), "rg");
  });
}

describe("binaryResolver (bundled CLI + downloaded rg)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memFs.clear();
    _resetCacheForTesting();
    vi.stubGlobal("fetch", mockFetch);
    mockTarX.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    _resetCacheForTesting();
    vi.unstubAllGlobals();
  });

  it("exposes bundled and runtime dirs", () => {
    expect(bundledCliDir()).toBe(bundledDir());
    expect(cliEntryPath()).toBe(entry());
  });

  it("cliInstallDir is per-end (desktop) while rg stays at the shared root", () => {
    // Each frontend (vscode/desktop/jetbrains) owns its own subdir so they
    // never overwrite each other's CLI copy.
    expect(cliInstallDir()).toBe(
      path.join("/fake/home", ".wave", "cli", "desktop"),
    );
    expect(entry()).toContain(path.join(".wave", "cli", "desktop"));
    // rg is shared by all three frontends — a sibling of the per-end dir,
    // not inside it, so a CLI re-copy never wipes the cached download.
    expect(rgInstallDir()).toBe(
      path.join("/fake/home", ".wave", "cli", "node_modules", "@vscode"),
    );
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

  it("copies the bundled CLI into ~/.wave/cli/desktop on first use and downloads rg", async () => {
    seedBundledCli("1.0.0");
    mockRipgrepRegistry();

    const result = await resolveWaveBinary("1.0.0");

    expect(result).toBe(entry());
    expect(memFs.has(entry())).toBe(true);
    expect(
      memFs.has(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe(true);
    expect(memFs.has(rgBin())).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(5); // rg meta x2 + plat meta + 2 tarballs
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

  it("re-copies the CLI but keeps the cached rg when the bundle content changes (app upgrade)", async () => {
    seedBundledCli("1.1.0", "upgraded-bundle"); // app upgraded
    seedRuntimeCli("1.0.0");
    seedRg(); // rg already downloaded

    const result = await resolveWaveBinary("1.1.0");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
    // node_modules (rg) preserved: no fetch happened.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(memFs.has(rgBin())).toBe(true);
  });

  it("re-copies when a same-version reinstall ships different bundle bytes (desktop:install)", async () => {
    // desktop:install refreshes the app without bumping the version — a
    // version-only staleness check would keep running the old runtime copy
    // forever (regression: stale CLI missed the compaction display fix).
    seedBundledCli("1.1.5", "rebuilt-with-fix");
    seedRuntimeCli("1.1.5", "stale-aug26-copy");
    seedRg();

    const result = await resolveWaveBinary("1.1.5");

    expect(result).toBe(entry());
    expect(mockFs.cpSync).toHaveBeenCalled();
    expect(
      memFs.get(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs")),
    ).toBe("rebuilt-with-fix");
    expect(mockFetch).not.toHaveBeenCalled();
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
});

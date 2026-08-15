import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// ── Mocks ──────────────────────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: {
    execSync: mockExecSync,
    execFile: mockExecFile,
    execFileSync: mockExecFileSync,
  },
  execSync: mockExecSync,
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
}));

vi.mock("fs", () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync,
}));

// ── Platform-aware constants ───────────────────────────────────
// The source uses `which`/`where`, `wave`/`wave.cmd`, and a different
// global-bin layout per platform. Mirror those here so mocks match on
// both Linux and Windows runners.

const isWin = process.platform === "win32";
const waveLookup = isWin ? "where wave" : "which wave";
const npmLookup = isWin ? "where npm" : "which npm";
const nodeLookup = isWin ? "where node" : "which node";
const nodeBin = isWin ? "C:\\nodejs\\node.exe" : "/usr/bin/node";
const npmBin = isWin ? "C:\\nodejs\\npm.cmd" : "/usr/bin/npm";
const npmPrefix = isWin ? "C:\\nodejs" : "/usr/local";
// Source: globalBin = prefix on Windows, path.join(prefix, 'bin') elsewhere.
const globalBin = isWin ? npmPrefix : path.join(npmPrefix, "bin");
const waveName = isWin ? "wave.cmd" : "wave";
const globalWave = path.join(globalBin, waveName);

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  _resetCacheForTesting,
  upgradeWaveBinary,
  resetCache,
  getCliVersion,
  ensureCliUpToDate,
  NPM_REGISTRY,
  NodeJsNotFoundError,
  NodeJsVersionError,
} from "../../src/stdio/binaryResolver";

describe("binaryResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    // Default: node version check passes (>= 22). findNode() tries
    // `which node`/`where node` first; if that throws it falls back to
    // process.execPath. Either way checkNodeVersion() calls
    // execFileSync(<nodePath>, ['-v']).
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFileSync.mockReturnValue("v22.0.0\n");
    _resetCacheForTesting();
  });

  afterEach(() => {
    _resetCacheForTesting();
  });

  // ── Found on PATH ──────────────────────────────────────────

  it("returns wave path from which/where command", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        return `${globalWave}\n`;
      }
      throw new Error("unexpected");
    });

    const result = await resolveWaveBinary();
    expect(result).toBe(globalWave);
  });

  it("trims whitespace and takes first line from which output", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        return `  /usr/bin/wave\n/opt/wave\n`;
      }
      throw new Error("unexpected");
    });

    const result = await resolveWaveBinary();
    expect(result).toBe("/usr/bin/wave");
  });

  // ── Found in npm global bin ────────────────────────────────

  it("finds wave in npm global bin directory when not on PATH", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) throw new Error("not found");
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation((p: string) => {
      return p === globalWave;
    });

    const result = await resolveWaveBinary();
    expect(result).toBe(globalWave);
  });

  // ── Installs wave-code when not found ──────────────────────

  it("installs wave-code globally when not found anywhere", async () => {
    let installCalled = false;
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        if (installCalled) return `${globalWave}\n`;
        throw new Error("not found");
      }
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) {
        installCalled = true;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation((p: string) => {
      return installCalled && p === globalWave;
    });

    const result = await resolveWaveBinary();
    expect(result).toBe(globalWave);
    expect(installCalled).toBe(true);
  });

  // ── Caching ────────────────────────────────────────────────

  it("caches result and does not re-resolve on second call", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      throw new Error("unexpected");
    });

    const result1 = await resolveWaveBinary();
    const result2 = await resolveWaveBinary();

    expect(result1).toBe(globalWave);
    expect(result2).toBe(globalWave);
    // wave lookup should only be called once due to caching
    const whichCalls = mockExecSync.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes(waveLookup),
    );
    expect(whichCalls).toHaveLength(1);
  });

  // ── Error cases ────────────────────────────────────────────

  it("throws NodeJsNotFoundError when npm cannot be found anywhere", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) throw new Error("not found");
      if (cmd.includes(npmLookup)) throw new Error("not found");
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    // findNpm falls back to process.execPath dir checks; all return false
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveWaveBinary()).toThrow(NodeJsNotFoundError);
    expect(() => resolveWaveBinary()).toThrow("未检测到 Node.js/npm");
  });

  it("throws when wave not found after installation", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) throw new Error("not found");
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) return "";
      throw new Error(`unexpected: ${cmd}`);
    });
    // wave never exists
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveWaveBinary()).toThrow(
      "wave binary not found after installation",
    );
  });

  // ── install-if-missing registry ──────────────────────────────

  it("install-if-missing uses npmmirror registry", async () => {
    let installCmd = "";
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        if (installCmd) return `${globalWave}\n`;
        throw new Error("not found");
      }
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) {
        installCmd = cmd;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation(
      (p: string) => !!installCmd && p === globalWave,
    );

    const result = await resolveWaveBinary();
    expect(result).toBe(globalWave);
    expect(installCmd).toContain(`--registry=${NPM_REGISTRY}`);
  });

  // ── first-install pins the exact version (spec: stdio-transport.md) ──
  // When the CLI is missing entirely, the auto-install must pin
  // `wave-code@<pluginVersion>` — NOT resolve @latest — so a plugin at 1.0.0
  // never silently gets 1.0.1 (which ensureCliUpToDate would then accept).

  it("resolveWaveBinary pins the exact version when a target version is given", async () => {
    let installCmd = "";
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        if (installCmd) return `${globalWave}\n`;
        throw new Error("not found");
      }
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) {
        installCmd = cmd;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation(
      (p: string) => !!installCmd && p === globalWave,
    );

    const result = await resolveWaveBinary(undefined, "1.0.0");
    expect(result).toBe(globalWave);
    expect(installCmd).toContain("install -g wave-code@1.0.0");
    expect(installCmd).toContain(`--registry=${NPM_REGISTRY}`);
  });

  it("resolveWaveBinary falls back to the bare package when no version is given", async () => {
    let installCmd = "";
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        if (installCmd) return `${globalWave}\n`;
        throw new Error("not found");
      }
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) {
        installCmd = cmd;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation(
      (p: string) => !!installCmd && p === globalWave,
    );

    const result = await resolveWaveBinary();
    expect(result).toBe(globalWave);
    expect(installCmd).toContain("install -g wave-code ");
    expect(installCmd).not.toContain("@");
  });

  it("ensureCliUpToDate pins the exact version on first install (wave missing)", async () => {
    let installCmd = "";
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) {
        if (installCmd) return `${globalWave}\n`;
        throw new Error("not found");
      }
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      if (cmd.includes("install -g wave-code")) {
        installCmd = cmd;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExistsSync.mockImplementation(
      (p: string) => !!installCmd && p === globalWave,
    );
    // wave -v after the pinned install reports exactly the target version.
    mockExecFileSync.mockImplementation((cmd: string | Buffer) =>
      String(cmd).replace(/^"|"$/g, "") === globalWave
        ? "1.0.0\n"
        : "v22.0.0\n",
    );

    const result = await ensureCliUpToDate("1.0.0");
    expect(result).toBe(globalWave);
    expect(installCmd).toContain("install -g wave-code@1.0.0");
    expect(installCmd).toContain(`--registry=${NPM_REGISTRY}`);
    // Exact match → no follow-up upgrade.
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("resolveWaveBinary rejects non-semver target versions (shell-injection guard)", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes("prefix -g")) return `${npmPrefix}\n`;
      throw new Error("not found");
    });
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveWaveBinary(undefined, "1.0.0; rm -rf /")).toThrow(
      "Invalid version",
    );
    expect(() => resolveWaveBinary(undefined, "$(rm -rf /)")).toThrow(
      "Invalid version",
    );
    expect(() => resolveWaveBinary(undefined, "latest")).toThrow(
      "Invalid version",
    );
    // The invalid spec must never reach execSync (no shell injection).
    const installCalls = mockExecSync.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes("install -g wave-code"),
    );
    expect(installCalls).toHaveLength(0);
  });

  // ── resetCache ───────────────────────────────────────────────

  it("resetCache clears the cached path", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      throw new Error("unexpected");
    });

    await resolveWaveBinary();
    resetCache();
    await resolveWaveBinary();

    const whichCalls = mockExecSync.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes(waveLookup),
    );
    expect(whichCalls).toHaveLength(2);
  });

  // ── upgradeWaveBinary ────────────────────────────────────────

  it("upgradeWaveBinary installs the target version via execFile with npmmirror registry", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null) => void;
      cb(null);
    });

    const result = await upgradeWaveBinary("1.2.3");

    expect(result).toBe(globalWave);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const callArgs = mockExecFile.mock.calls[0];
    // On Windows the executable is pre-quoted for the cmd.exe `shell:true`
    // command line; off-Windows it is passed as-is.
    expect(callArgs[0]).toBe(isWin ? `"${npmBin}"` : npmBin);
    expect(callArgs[1]).toEqual([
      "install",
      "-g",
      "wave-code@1.2.3",
      `--registry=${NPM_REGISTRY}`,
    ]);
    // cache was invalidated: resolveWaveBinary re-ran wave lookup
    const whichCalls = mockExecSync.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes(waveLookup),
    );
    expect(whichCalls).toHaveLength(1);
  });

  it("upgradeWaveBinary rejects when execFile errors", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null) => void;
      cb(new Error("install failed"));
    });

    await expect(upgradeWaveBinary("1.2.3")).rejects.toThrow("install failed");
  });

  // ── Version validation (shell-injection guard) ────────────
  // On Windows, execFile runs through cmd.exe; the version is validated
  // first so shell metacharacters can never reach the shell.

  it("upgradeWaveBinary rejects non-semver versions and never reaches execFile", async () => {
    await expect(upgradeWaveBinary("1.2.3; rm -rf /")).rejects.toThrow(
      "Invalid version",
    );
    await expect(upgradeWaveBinary("$(rm -rf /)")).rejects.toThrow(
      "Invalid version",
    );
    await expect(upgradeWaveBinary("")).rejects.toThrow("Invalid version");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("upgradeWaveBinary accepts prerelease/build semver", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null) => void;
      cb(null);
    });

    await expect(upgradeWaveBinary("1.2.3-alpha.1")).resolves.toBe(globalWave);
    await expect(upgradeWaveBinary("1.2.3+build.7")).resolves.toBe(globalWave);
  });

  // ── Windows .cmd execFile guard ───────────────────────────
  // `npm` resolves to `npm.cmd` on Windows; execFile refuses a `.cmd`
  // without `shell: true` (ERR_CHILD_PROCESS_INVALID_COMMAND_FILE).
  // Simulate the guard on Linux so the reproducer runs in blocking CI.

  function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: platform });
    const restore = () => {
      if (original) Object.defineProperty(process, "platform", original);
    };
    try {
      return fn().finally(restore);
    } catch (e) {
      // fn threw synchronously (before returning a promise) — restore here
      // too or the fake platform leaks into every later test.
      restore();
      throw e;
    }
  }

  it("upgradeWaveBinary uses shell:true for npm.cmd on Windows", async () => {
    const npmCmd = "C:\\nodejs\\npm.cmd";
    const waveCmd = "C:\\nodejs\\wave.cmd";

    await withPlatform("win32", async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("where npm")) return `${npmCmd}\n`;
        if (cmd.includes("where wave")) return `${waveCmd}\n`;
        if (cmd.includes("prefix -g")) return "C:\\nodejs\n";
        throw new Error(`unexpected: ${cmd}`);
      });
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cmd = args[0] as string;
        const opts = args[2] as { shell?: boolean } | undefined;
        // Enforce Node's Windows guard: refuse npm.cmd without shell.
        // (The executable may be pre-quoted for the shell command line.)
        if (/\.cmd"?$/i.test(cmd) && opts?.shell !== true) {
          throw new Error("ERR_CHILD_PROCESS_INVALID_COMMAND_FILE");
        }
        const cb = args[args.length - 1] as (err: Error | null) => void;
        cb(null);
      });

      const result = await upgradeWaveBinary("1.2.3");

      expect(result).toBe(waveCmd);
      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe(`"${npmCmd}"`);
      expect((callArgs[2] as { shell?: boolean }).shell).toBe(true);
    });
  });

  // ── Windows: `where` multi-line output + path-with-spaces quoting ──
  // Customer repro: a default Node.js install lives at
  // `C:\Program Files\nodejs`. `where npm` lists the extensionless bash
  // launcher FIRST (`...\npm`, then `...\npm.cmd`); with `shell: true`
  // Node concatenates file+args into the cmd.exe command line WITHOUT
  // quoting, so cmd splits the path at the space and fails with
  // "'C:\Program' 不是内部或外部命令" — the auto-upgrade then dies and the
  // shared stdio client never initializes.

  it("on Windows, resolveWaveBinary prefers the .cmd line from where output", async () => {
    const nodeBinWin = "C:\\Program Files\\nodejs\\node.exe";
    const waveShim = "C:\\Users\\runneradmin\\AppData\\Roaming\\npm\\wave";
    const waveCmd = "C:\\Users\\runneradmin\\AppData\\Roaming\\npm\\wave.cmd";

    await withPlatform("win32", async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("where wave")) return `${waveShim}\n${waveCmd}\n`;
        if (cmd.includes("where node")) return `${nodeBinWin}\n`;
        throw new Error(`unexpected: ${cmd}`);
      });

      const result = await resolveWaveBinary();
      // cmd.exe cannot execute the extensionless bash launcher.
      expect(result).toBe(waveCmd);
    });
  });

  // ── Windows: cmd.exe builtins output GBK on Chinese systems ──
  // `where` is a cmd.exe builtin — on a Chinese system its stdout is in the
  // OEM code page (CP936/GBK), NOT UTF-8. Decoding those bytes as UTF-8
  // corrupts non-ASCII path segments (`C:\Users\刘一奇\...` → U+FFFD
  // garbage), and spawning the corrupted path fails with
  // ERROR_PATH_NOT_FOUND ("系统找不到指定的路径。") — the upgrade-only
  // regression where fresh installs worked but any upgrade failed.
  // The resolver must decode cmd output UTF-8-first / GBK-fallback.

  it("on Windows, decodes GBK-encoded Chinese username paths from where output", async () => {
    const nodeBinWin = "C:\\Program Files\\nodejs\\node.exe";
    // GBK (CP936) bytes of `刘一奇` — what cmd.exe actually writes when
    // the username contains Chinese characters.
    const gbkUsername = Buffer.from([0xc1, 0xf5, 0xd2, 0xbb, 0xc6, 0xe6]);
    const gbkLine = (suffix: string) =>
      Buffer.concat([
        Buffer.from("C:\\Users\\", "ascii"),
        gbkUsername,
        Buffer.from(suffix, "ascii"),
      ]);
    const whereOutput = Buffer.concat([
      gbkLine("\\AppData\\Roaming\\npm\\wave\r\n"),
      gbkLine("\\AppData\\Roaming\\npm\\wave.cmd\r\n"),
    ]);

    await withPlatform("win32", async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("where wave")) return whereOutput;
        if (cmd.includes("where node")) return `${nodeBinWin}\n`;
        throw new Error(`unexpected: ${cmd}`);
      });

      const result = await resolveWaveBinary();
      expect(result).toBe("C:\\Users\\刘一奇\\AppData\\Roaming\\npm\\wave.cmd");
    });
  });

  it("on Windows, upgradeWaveBinary picks npm.cmd and quotes the space-containing path", async () => {
    const nodeBinWin = "C:\\Program Files\\nodejs\\node.exe";
    const npmShim = "C:\\Program Files\\nodejs\\npm";
    const npmCmd = "C:\\Program Files\\nodejs\\npm.cmd";
    const waveCmd = "C:\\Program Files\\nodejs\\wave.cmd";

    await withPlatform("win32", async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("where npm")) return `${npmShim}\n${npmCmd}\n`;
        if (cmd.includes("where wave")) return `${waveCmd}\n`;
        if (cmd.includes("where node")) return `${nodeBinWin}\n`;
        throw new Error(`unexpected: ${cmd}`);
      });
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const file = args[0] as string;
        // cmd.exe parses the `shell: true` command line by whitespace:
        // an unquoted path with spaces breaks at "C:\Program".
        expect(file.startsWith('"')).toBe(true);
        const cb = args[args.length - 1] as (err: Error | null) => void;
        cb(null);
      });

      const result = await upgradeWaveBinary("0.19.8");

      expect(result).toBe(waveCmd);
      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe(`"${npmCmd}"`);
      expect(callArgs[1]).toEqual([
        "install",
        "-g",
        "wave-code@0.19.8",
        `--registry=${NPM_REGISTRY}`,
      ]);
    });
  });

  it("on Windows, getCliVersion quotes a wave path containing spaces", async () => {
    const waveCmd = "C:\\Users\\a b\\AppData\\Roaming\\npm\\wave.cmd";

    await withPlatform("win32", async () => {
      mockExecFileSync.mockReturnValue("0.19.8\n");

      expect(getCliVersion(waveCmd)).toBe("0.19.8");
      const call = mockExecFileSync.mock.calls[0];
      expect(call[0]).toBe(`"${waveCmd}"`);
      expect((call[2] as { shell?: boolean }).shell).toBe(true);
    });
  });

  // ── getCliVersion ────────────────────────────────────────────

  it("getCliVersion returns the bare version from wave -v", () => {
    mockExecFileSync.mockReturnValue("0.18.7\n");
    expect(getCliVersion(globalWave)).toBe("0.18.7");
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const args = mockExecFileSync.mock.calls[0];
    expect(args[0]).toBe(isWin ? `"${globalWave}"` : globalWave);
    expect(args[1]).toEqual(["-v"]);
  });

  it("getCliVersion strips a leading v prefix", () => {
    mockExecFileSync.mockReturnValue("v0.19.0\n");
    expect(getCliVersion(globalWave)).toBe("0.19.0");
  });

  it("getCliVersion returns null when wave -v throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(getCliVersion(globalWave)).toBeNull();
  });

  it("getCliVersion returns null for empty output", () => {
    mockExecFileSync.mockReturnValue("   \n  \n");
    expect(getCliVersion(globalWave)).toBeNull();
  });

  // ── ensureCliUpToDate ────────────────────────────────────────

  it("ensureCliUpToDate returns existing path when version is >= target", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    // Node -v returns v22+; wave -v returns 1.0.0 (>= target).
    // (On Windows the wave path reaches execFileSync pre-quoted.)
    mockExecFileSync.mockImplementation((cmd: string | Buffer) =>
      String(cmd).replace(/^"|"$/g, "") === globalWave
        ? "1.0.0\n"
        : "v22.0.0\n",
    );

    const result = await ensureCliUpToDate("1.0.0");
    expect(result).toBe(globalWave);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("ensureCliUpToDate upgrades when version is older than target", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    // Node -v returns v22+; wave -v returns 0.18.0 (< target)
    mockExecFileSync.mockImplementation((cmd: string | Buffer) =>
      String(cmd).replace(/^"|"$/g, "") === globalWave
        ? "0.18.0\n"
        : "v22.0.0\n",
    );
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null) => void;
      cb(null);
    });

    const result = await ensureCliUpToDate("1.0.0");
    expect(result).toBe(globalWave);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile.mock.calls[0][1]).toEqual([
      "install",
      "-g",
      "wave-code@1.0.0",
      `--registry=${NPM_REGISTRY}`,
    ]);
  });

  it("ensureCliUpToDate upgrades when getCliVersion returns null (corrupt binary)", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(npmLookup)) return `${npmBin}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    // Node -v returns v22+; wave -v fails (corrupt binary)
    mockExecFileSync.mockImplementation((cmd: string | Buffer) => {
      if (String(cmd).replace(/^"|"$/g, "") === globalWave)
        throw new Error("corrupt");
      return "v22.0.0\n";
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null) => void;
      cb(null);
    });

    const result = await ensureCliUpToDate("1.0.0");
    expect(result).toBe(globalWave);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("ensureCliUpToDate does not upgrade when version is newer than target", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    // Node -v returns v22+; wave -v returns 2.0.0 (> target)
    mockExecFileSync.mockImplementation((cmd: string | Buffer) =>
      String(cmd).replace(/^"|"$/g, "") === globalWave
        ? "2.0.0\n"
        : "v22.0.0\n",
    );

    const result = await ensureCliUpToDate("1.0.0");
    expect(result).toBe(globalWave);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  // ── Node.js version check (FR-005b) ──────────────────────────

  it("throws NodeJsVersionError when Node.js version is below 22", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFileSync.mockReturnValue("v18.17.0\n");

    expect(() => resolveWaveBinary()).toThrow(NodeJsVersionError);
    expect(() => resolveWaveBinary()).toThrow("Node.js 版本过低");
    expect(() => resolveWaveBinary()).toThrow("v18");
  });

  it("does not throw version error when Node.js is exactly v22", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFileSync.mockReturnValue("v22.0.0\n");

    expect(() => resolveWaveBinary()).not.toThrow();
  });

  it("does not throw version error when Node.js is above v22", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes(waveLookup)) return `${globalWave}\n`;
      if (cmd.includes(nodeLookup)) return `${nodeBin}\n`;
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFileSync.mockReturnValue("v22.14.0\n");

    expect(() => resolveWaveBinary()).not.toThrow();
  });
});

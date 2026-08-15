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

// ── Import after mocks ─────────────────────────────────────────

import {
  resolveWaveBinary,
  _resetCacheForTesting,
} from "../src/main/stdio/binaryResolver";

describe("binaryResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    // checkNodeVersion(): `where node`/`which node` first, then
    // execFileSync(<node>, ["-v"]) — the desktop main process runs inside
    // Electron, so that call also carries ELECTRON_RUN_AS_NODE=1.
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("where node") || cmd.includes("which node")) {
        return process.platform === "win32"
          ? "C:\\nodejs\\node.exe\n"
          : "/usr/bin/node\n";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    mockExecFileSync.mockReturnValue("v22.0.0\n");
    _resetCacheForTesting();
  });

  afterEach(() => {
    _resetCacheForTesting();
  });

  // ── Windows: cmd.exe builtins output GBK on Chinese systems ──
  // `where` is a cmd.exe builtin — on a Chinese system its stdout is in the
  // OEM code page (CP936/GBK), NOT UTF-8. Decoding those bytes as UTF-8
  // corrupts non-ASCII path segments (`C:\Users\刘一奇\...` → U+FFFD
  // garbage); spawning the corrupted wave.cmd path then fails with
  // ERROR_PATH_NOT_FOUND and the stdio process dies before initialize —
  // surfacing as「初始化失败：连接已断开」on Windows (desktop parity with
  // the vsce fix 08f2c0dc, which only patched packages/vscode).

  it("on Windows, decodes GBK-encoded Chinese username paths from where output", async () => {
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
      mockExecSync.mockImplementation(
        (cmd: string, opts?: { encoding?: string }) => {
          if (cmd.includes("where wave")) {
            // Mirror Node's real behaviour: `encoding: "buffer"` yields the
            // raw cmd.exe bytes, "utf-8" yields them already corrupted.
            return opts?.encoding === "buffer"
              ? whereOutput
              : whereOutput.toString("utf-8");
          }
          if (cmd.includes("where node")) return "C:\\nodejs\\node.exe\n";
          throw new Error(`unexpected: ${cmd}`);
        },
      );

      const result = await resolveWaveBinary();
      expect(result).toBe("C:\\Users\\刘一奇\\AppData\\Roaming\\npm\\wave.cmd");
    });
  });

  it("on Windows, decodes GBK-encoded Chinese npm global prefix", async () => {
    // `npm prefix -g` on a Chinese system echoes the prefix in GBK — a
    // UTF-8 decode turns `C:\Users\刘一奇\AppData\Roaming\npm` into garbage
    // and the wave.cmd lookup inside it misses even after a fresh install.
    const gbkUsername = Buffer.from([0xc1, 0xf5, 0xd2, 0xbb, 0xc6, 0xe6]);
    const prefix = Buffer.concat([
      Buffer.from("C:\\Users\\", "ascii"),
      gbkUsername,
      Buffer.from("\\AppData\\Roaming\\npm", "ascii"),
    ]);
    // Mirror the resolver's own join so the assertion matches on every OS
    // (path.join follows the host platform, not the faked process.platform).
    const waveCmd = path.join(
      "C:\\Users\\刘一奇\\AppData\\Roaming\\npm",
      "wave.cmd",
    );

    await withPlatform("win32", async () => {
      mockExecSync.mockImplementation(
        (cmd: string, opts?: { encoding?: string }) => {
          if (cmd.includes("where wave")) throw new Error("not found");
          if (cmd.includes("where npm")) return "C:\\nodejs\\npm.cmd\n";
          if (cmd.includes("prefix -g")) {
            return opts?.encoding === "buffer"
              ? prefix
              : prefix.toString("utf-8");
          }
          throw new Error(`unexpected: ${cmd}`);
        },
      );
      mockExistsSync.mockImplementation((p: string) => p === waveCmd);

      const result = await resolveWaveBinary();
      expect(result).toBe(waveCmd);
    });
  });

  // ── Found on PATH ──────────────────────────────────────────

  it("returns wave path from where/which command", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("where wave") || cmd.includes("which wave")) {
        return process.platform === "win32"
          ? "C:\\nodejs\\wave.cmd\n"
          : "/usr/bin/wave\n";
      }
      throw new Error("unexpected");
    });

    const result = await resolveWaveBinary();
    expect(result).toBe(
      process.platform === "win32" ? "C:\\nodejs\\wave.cmd" : "/usr/bin/wave",
    );
  });
});

/** Temporarily fake process.platform (desktop tests run on any OS). */
function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  const restore = () => {
    if (original) Object.defineProperty(process, "platform", original);
  };
  try {
    return fn().finally(restore);
  } catch (e) {
    restore();
    throw e;
  }
}

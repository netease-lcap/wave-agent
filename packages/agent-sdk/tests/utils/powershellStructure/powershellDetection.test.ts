import { accessSync, constants, statSync } from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findPowerShell,
  getPowerShellEdition,
  getPowerShellPath,
  resetPowerShellCache,
} from "../../../src/utils/shell/powershellDetection.js";

/**
 * `fs` is mocked rather than pointed at a temp directory: this module only ever
 * asks "is this path a file", so a mock states that answer directly instead of
 * depending on what the machine happens to have installed.
 */
vi.mock("fs", () => ({
  statSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

const isWindows = process.platform === "win32";
/** The names this module searches, per platform. */
const CORE = isWindows ? "pwsh.exe" : "pwsh";
const DESKTOP = isWindows ? "powershell.exe" : "powershell";

const DIR_A = path.resolve("/fake/first");
const DIR_B = path.resolve("/fake/second");

/** Pretend exactly these paths exist as files; everything else is ENOENT. */
function existingFiles(...files: string[]): void {
  const allowed = new Set(files);
  vi.mocked(statSync).mockImplementation(((candidate: string) => {
    if (!allowed.has(candidate)) throw new Error(`ENOENT: ${candidate}`);
    return { isFile: () => true };
  }) as unknown as typeof statSync);
}

const originalPath = process.env.PATH;
const originalSystemRoot = process.env.SystemRoot;
const originalWindir = process.env.windir;

function setPath(...directories: string[]): void {
  process.env.PATH = directories.join(path.delimiter);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPowerShellCache();
  // The well-known location must not fire unless a test asks for it.
  delete process.env.SystemRoot;
  delete process.env.windir;
  existingFiles();
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
  if (originalWindir === undefined) delete process.env.windir;
  else process.env.windir = originalWindir;
  resetPowerShellCache();
});

describe("findPowerShell", () => {
  it("splits PATH with path.delimiter, not with a colon", () => {
    // On Windows every entry carries a drive colon, so a `":"` split would
    // search `C` and `\fake\first\C` and never find the binary.
    const expected = path.join(DIR_B, CORE);
    setPath(DIR_A, DIR_B);
    existingFiles(expected);

    expect(findPowerShell()).toBe(expected);
  });

  it("looks in every directory, in order", () => {
    const inSecond = path.join(DIR_B, CORE);
    setPath(DIR_A, DIR_B);
    existingFiles(inSecond);

    expect(findPowerShell()).toBe(inSecond);
  });

  it("ignores a quoted PATH entry", () => {
    // `"C:\Program Files\…";C:\…` is what some installers write.
    const expected = path.join(DIR_A, CORE);
    setPath(`"${DIR_A}"`);
    existingFiles(expected);

    expect(findPowerShell()).toBe(expected);
  });

  it("ignores an empty PATH entry", () => {
    const expected = path.join(DIR_B, CORE);
    setPath(DIR_A, "", DIR_B);
    existingFiles(expected);

    expect(findPowerShell()).toBe(expected);
  });

  it.skipIf(!isWindows)(
    "prefers pwsh over powershell even when powershell comes first",
    () => {
      // Name-major, not directory-major: otherwise System32 (early in PATH)
      // would pin every session to Windows PowerShell 5.1.
      const core = path.join(DIR_A, CORE);
      setPath(DIR_A, DIR_B);
      existingFiles(path.join(DIR_B, DESKTOP), core);

      expect(findPowerShell()).toBe(core);
    },
  );

  it.skipIf(!isWindows)("falls back to powershell without a pwsh", () => {
    const desktop = path.join(DIR_A, DESKTOP);
    setPath(DIR_A);
    existingFiles(desktop);

    expect(findPowerShell()).toBe(desktop);
  });

  it("returns undefined when there is none", () => {
    setPath(DIR_A, DIR_B);

    expect(findPowerShell()).toBeUndefined();
  });

  it.skipIf(!isWindows)(
    "falls back to the well-known location when PATH misses System32",
    () => {
      const systemRoot = path.resolve("/fake/windows");
      const expected = path.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      process.env.SystemRoot = systemRoot;
      setPath(DIR_A);
      existingFiles(expected);

      expect(findPowerShell()).toBe(expected);
    },
  );

  it.skipIf(!isWindows)("reads windir when SystemRoot is unset", () => {
    const windir = path.resolve("/fake/windir");
    const expected = path.join(
      windir,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    process.env.windir = windir;
    setPath(DIR_A);
    existingFiles(expected);

    expect(findPowerShell()).toBe(expected);
  });

  it.skipIf(isWindows)("skips a file that is not executable", () => {
    const candidate = path.join(DIR_A, CORE);
    setPath(DIR_A);
    existingFiles(candidate);
    vi.mocked(accessSync).mockImplementation(((target: string) => {
      if (target === candidate) throw new Error("EACCES");
    }) as unknown as typeof accessSync);

    expect(findPowerShell()).toBeUndefined();
    expect(accessSync).toHaveBeenCalledWith(candidate, constants.X_OK);
  });
});

describe("getPowerShellPath", () => {
  it("looks the binary up once", () => {
    setPath(DIR_A);
    existingFiles(path.join(DIR_A, CORE));

    getPowerShellPath();
    getPowerShellPath();

    expect(statSync).toHaveBeenCalledTimes(1);
  });

  it("caches a missing binary too", () => {
    setPath(DIR_A);

    expect(getPowerShellPath()).toBeUndefined();
    expect(getPowerShellPath()).toBeUndefined();
    // One pass over PATH: the platform's single executable name.
    expect(statSync).toHaveBeenCalledTimes(isWindows ? 2 : 1);
  });

  it("looks again after the cache is reset", () => {
    setPath(DIR_A);
    getPowerShellPath();
    const before = vi.mocked(statSync).mock.calls.length;

    resetPowerShellCache();

    expect(getPowerShellPath()).toBeUndefined();
    expect(vi.mocked(statSync).mock.calls.length).toBeGreaterThan(before);
  });
});

describe("getPowerShellEdition", () => {
  it("calls pwsh core and powershell desktop", () => {
    expect(getPowerShellEdition(path.join(DIR_A, CORE))).toBe("core");
    expect(getPowerShellEdition(path.join(DIR_A, DESKTOP))).toBe("desktop");
  });

  it("has no edition without a binary", () => {
    setPath(DIR_A);

    expect(getPowerShellEdition()).toBeUndefined();
  });

  it("reads the edition off the resolved path", () => {
    setPath(DIR_A);
    existingFiles(path.join(DIR_A, CORE));

    expect(getPowerShellEdition()).toBe("core");
  });
});

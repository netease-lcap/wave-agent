import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import {
  execFileAsyncHidden,
  execFileHidden,
  execFileSyncHidden,
} from "../../src/utils/execFileHidden.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

/** node's real callback shape: `(error, stdout, stderr)` — three arguments. */
type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Make the mocked `execFile` behave like node's: call back with the real
 * three-argument shape. Anything else (a single merged object, say) hides how
 * the caller actually consumes the result — the whole reason a bare-string
 * `stdout` regression once shipped green.
 *
 * The failure case deliberately leaves `stdout` / `stderr` **off** the error,
 * exactly as node does: it only passes them in the callback. A fake that
 * pre-attaches them cannot tell whether the wrapper does.
 */
function stubExecFile(succeed = true) {
  vi.mocked(execFile).mockImplementation((_file, _args, options, cb) => {
    const callback = (typeof options === "function"
      ? options
      : cb) as unknown as ExecFileCallback | undefined;
    if (typeof callback === "function") {
      if (succeed) {
        callback(null, "out", "err");
      } else {
        const error = Object.assign(new Error("git failed"), { code: 128 });
        callback(error, "partial out", "fatal: not a git repository");
      }
    }
    return {} as unknown as ReturnType<typeof execFile>;
  });
}

const noop = () => {};

describe("execFileHidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubExecFile();
    vi.mocked(execFileSync).mockReturnValue(
      "out" as unknown as ReturnType<typeof execFileSync>,
    );
  });

  it("forces windowsHide: true when the caller passes no options", () => {
    execFileHidden("git", ["--version"]);
    expect(execFile).toHaveBeenCalledWith("git", ["--version"], {
      windowsHide: true,
    });
  });

  it("still forces windowsHide: true when the caller asks for false", () => {
    execFileHidden("git", ["status"], { windowsHide: false }, noop);
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["status"],
      { windowsHide: true },
      noop,
    );
  });

  it("passes every other option through untouched", () => {
    const env = { GIT_TERMINAL_PROMPT: "0" };

    execFileHidden(
      "git",
      ["clone", "url", "dest"],
      {
        cwd: "/repo",
        env,
        timeout: 120_000,
        maxBuffer: 1024,
        encoding: "utf8",
      },
      noop,
    );
    execFileHidden("git", ["status"], { cwd: "/repo", env, timeout: 5 }, noop);

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["clone", "url", "dest"],
      {
        cwd: "/repo",
        env,
        timeout: 120_000,
        maxBuffer: 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      noop,
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["status"],
      { cwd: "/repo", env, timeout: 5, windowsHide: true },
      noop,
    );
  });

  it("forwards the callback unchanged", () => {
    const callback = vi.fn();
    execFileHidden("git", ["rev-parse", "HEAD"], {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "out", "err");
  });

  it("accepts options in the args slot, like execFile does", () => {
    execFileHidden("git", { cwd: "/repo" });
    expect(execFile).toHaveBeenCalledWith("git", [], {
      cwd: "/repo",
      windowsHide: true,
    });
  });
});

describe("execFileAsyncHidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubExecFile();
  });

  it("resolves an object mapping callback args 2 and 3 onto stdout and stderr", async () => {
    const result = await execFileAsyncHidden("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    });

    // An object with both fields — not the bare stdout string (or array) that
    // `promisify` over a plain wrapper would hand back.
    expect(Array.isArray(result)).toBe(false);
    expect(typeof result).toBe("object");
    expect(result).toEqual({ stdout: "out", stderr: "err" });
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
  });

  it("still forces windowsHide: true", async () => {
    await execFileAsyncHidden("git", ["status"], {
      cwd: "/repo",
      encoding: "utf8",
    });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["status"],
      { cwd: "/repo", encoding: "utf8", windowsHide: true },
      expect.any(Function),
    );
  });

  it("rejects with the original error, stdout and stderr attached", async () => {
    stubExecFile(false);

    // node's `ExecFileException` carries neither stream, and
    // `GitService.handleGitError` reads `error.stderr` to tell "no such
    // repository" from "authentication failed" — so the wrapper has to attach
    // them the way `util.promisify.custom` does.
    const error = await execFileAsyncHidden("git", ["clone", "url"], {
      encoding: "utf8",
    }).then(
      () => null,
      (rejection: unknown) =>
        rejection as { stdout?: string; stderr?: string; code?: number },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.code).toBe(128);
    expect(error?.stdout).toBe("partial out");
    expect(error?.stderr).toBe("fatal: not a git repository");
  });
});

describe("execFileSyncHidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFileSync).mockReturnValue(
      "out" as unknown as ReturnType<typeof execFileSync>,
    );
  });

  it("forces windowsHide: true when the caller passes no options", () => {
    execFileSyncHidden("git", ["--version"]);
    expect(execFileSync).toHaveBeenCalledWith("git", ["--version"], {
      windowsHide: true,
    });
  });

  it("still forces windowsHide: true when the caller asks for false", () => {
    execFileSyncHidden("where", ["git"], { windowsHide: false, timeout: 3000 });
    expect(execFileSync).toHaveBeenCalledWith("where", ["git"], {
      timeout: 3000,
      windowsHide: true,
    });
  });

  it("passes every other option through untouched", () => {
    const result = execFileSyncHidden("git", ["status", "--porcelain"], {
      cwd: "/repo",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });

    expect(result).toBe("out");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain"],
      {
        cwd: "/repo",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
        windowsHide: true,
      },
    );
  });

  it("accepts options in the args slot, like execFileSync does", () => {
    execFileSyncHidden("git", { encoding: "utf8" });
    expect(execFileSync).toHaveBeenCalledWith("git", [], {
      encoding: "utf8",
      windowsHide: true,
    });
  });
});

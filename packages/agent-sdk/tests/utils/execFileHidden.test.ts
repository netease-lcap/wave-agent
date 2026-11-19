import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exec,
  execFile,
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";
import {
  execAsyncHidden,
  execFileAsyncHidden,
  execFileHidden,
  execFileSyncHidden,
  spawnHidden,
  spawnSyncHidden,
} from "../../src/utils/execFileHidden.js";

// Every stubbed name is here because the wrapper dereferences the module at call
// time: a factory that only lists half of them still satisfies the wrapper, and
// that is deliberate (see the module doc).
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
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

describe("spawnHidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReturnValue({
      pid: 4242,
    } as unknown as ReturnType<typeof spawn>);
  });

  it("forces windowsHide: true when the caller passes no options", () => {
    spawnHidden("rg", ["--version"]);
    expect(spawn).toHaveBeenCalledWith("rg", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("still forces windowsHide: true when the caller asks for false", () => {
    spawnHidden("rg", ["foo"], { windowsHide: false, cwd: "/repo" });
    expect(spawn).toHaveBeenCalledWith("rg", ["foo"], {
      cwd: "/repo",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  /**
   * fd0: node defaults it to a pipe nobody writes, so `rg` with no path waits
   * for stdin until the timeout (fb0034cb3). A caller that did not say anything
   * about stdio gets `/dev/null` instead.
   */
  it("points fd0 at /dev/null when the caller declares no stdio", () => {
    spawnHidden("rg", ["wave_no_such_symbol_xyzq"]);
    expect(spawn).toHaveBeenCalledWith("rg", ["wave_no_such_symbol_xyzq"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("leaves an explicit pipe fd0 alone — that caller writes stdin", () => {
    spawnHidden("tsserver", [], { stdio: ["pipe", "pipe", "pipe"] });
    expect(spawn).toHaveBeenCalledWith("tsserver", [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("leaves an inherited stdio alone — the child shares the terminal", () => {
    spawnHidden("git", ["pull"], { stdio: "inherit" });
    expect(spawn).toHaveBeenCalledWith("git", ["pull"], {
      stdio: "inherit",
      windowsHide: true,
    });
  });

  it("returns the ChildProcess spawn returns", () => {
    const child = spawnHidden("rg", []);
    expect(child).toEqual({ pid: 4242 });
  });

  it("accepts options in the args slot, like spawn does", () => {
    spawnHidden("rg", { cwd: "/repo" });
    expect(spawn).toHaveBeenCalledWith("rg", [], {
      cwd: "/repo",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  });
});

describe("spawnSyncHidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      status: 0,
      stdout: "out",
      stderr: "",
    } as unknown as ReturnType<typeof spawnSync>);
  });

  it("forces windowsHide: true when the caller passes no options", () => {
    spawnSyncHidden("taskkill", ["/pid", "1", "/T", "/F"]);
    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "1", "/T", "/F"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  });

  it("still forces windowsHide: true when the caller asks for false", () => {
    spawnSyncHidden("pnpm", ["list", "-g"], {
      encoding: "utf-8",
      windowsHide: false,
    });
    expect(spawnSync).toHaveBeenCalledWith("pnpm", ["list", "-g"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("leaves an explicit stdio alone", () => {
    spawnSyncHidden("npm", ["install", "-g"], { stdio: "inherit" });
    expect(spawnSync).toHaveBeenCalledWith("npm", ["install", "-g"], {
      stdio: "inherit",
      windowsHide: true,
    });
  });

  it("accepts options in the args slot, like spawnSync does", () => {
    spawnSyncHidden("git", { encoding: "utf8", stdio: "ignore" });
    expect(spawnSync).toHaveBeenCalledWith("git", [], {
      encoding: "utf8",
      stdio: "ignore",
      windowsHide: true,
    });
  });
});

describe("execAsyncHidden", () => {
  type ExecCallback = (
    error: Error | null,
    stdout: string,
    stderr: string,
  ) => void;

  /** node hands the streams to the callback only; the error carries none. */
  function stubExec(succeed = true) {
    vi.mocked(exec).mockImplementation((_command, _options, cb) => {
      const callback = cb as unknown as ExecCallback;
      if (succeed) {
        callback(null, "out", "err");
      } else {
        const error = Object.assign(new Error("command failed"), { code: 2 });
        callback(error, "partial out", "boom");
      }
      return {} as unknown as ReturnType<typeof exec>;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stubExec();
  });

  it("forces windowsHide: true", async () => {
    await execAsyncHidden("echo hi", { cwd: "/repo" });
    expect(exec).toHaveBeenCalledWith(
      "echo hi",
      { cwd: "/repo", windowsHide: true },
      expect.any(Function),
    );
  });

  it("resolves an object carrying both streams", async () => {
    const result = await execAsyncHidden("echo hi");
    expect(result).toEqual({ stdout: "out", stderr: "err" });
  });

  it("rejects with stdout and stderr attached to the error", async () => {
    stubExec(false);

    const error = await execAsyncHidden("nope").then(
      () => null,
      (rejection: unknown) =>
        rejection as { stdout?: string; stderr?: string; code?: number },
    );

    expect(error?.code).toBe(2);
    expect(error?.stdout).toBe("partial out");
    expect(error?.stderr).toBe("boom");
  });
});

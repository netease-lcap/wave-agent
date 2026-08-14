import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  buildShellSpawnArgs,
  getCachedShellSnapshotPath,
  getShellSnapshotPath,
  resetShellSnapshotCache,
  shellSingleQuote,
} from "../../src/utils/shellSnapshot.js";

const mockExecFile = vi.mocked(execFile);

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

describe("shellSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetShellSnapshotCache();
  });

  it("captures the login-shell PATH via `-c -l` and parses the marker line", async () => {
    mockExecFile.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(
        null,
        "Welcome to your profile!\nWAVE_SHELL_SNAPSHOT\n/usr/local/bin:/usr/bin:/bin\n",
        "",
      );
    }) as typeof execFile);

    const result = await getShellSnapshotPath("/bin/bash");

    expect(result).toBe("/usr/local/bin:/usr/bin:/bin");
    expect(mockExecFile).toHaveBeenCalledWith(
      "/bin/bash",
      ["-c", "-l", expect.stringContaining('echo "$PATH"')],
      expect.objectContaining({ timeout: 10000, encoding: "utf8" }),
      expect.any(Function),
    );
    // The login shell must inherit the SHELL env pointing at itself so the
    // user profile sees the right shell.
    const options = mockExecFile.mock.calls[0][2] as {
      env: Record<string, string>;
    };
    expect(options.env.SHELL).toBe("/bin/bash");
  });

  it("caches the snapshot per shell path — a second call does not re-exec", async () => {
    mockExecFile.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(null, "WAVE_SHELL_SNAPSHOT\n/usr/bin:/bin\n", "");
    }) as typeof execFile);

    const first = await getShellSnapshotPath("/bin/bash");
    const second = await getShellSnapshotPath("/bin/bash");

    expect(first).toBe("/usr/bin:/bin");
    expect(second).toBe("/usr/bin:/bin");
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("keeps independent snapshots for different shell paths", async () => {
    mockExecFile.mockImplementation(((
      file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(
        null,
        `WAVE_SHELL_SNAPSHOT\n${file === "/bin/bash" ? "/usr/bin:/bin" : "/opt/homebrew/bin"}\n`,
        "",
      );
    }) as typeof execFile);

    const bash = await getShellSnapshotPath("/bin/bash");
    const zsh = await getShellSnapshotPath("/bin/zsh");

    expect(bash).toBe("/usr/bin:/bin");
    expect(zsh).toBe("/opt/homebrew/bin");
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("returns undefined and caches the failure when the shell errors", async () => {
    mockExecFile.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(new Error("spawn ENOENT"), "", "");
    }) as typeof execFile);

    const first = await getShellSnapshotPath("/bin/bash");
    const second = await getShellSnapshotPath("/bin/bash");

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    // Failure is cached (settled undefined) — no retry per command, matching
    // Claude Code: commands then fall back to `-l` login shells.
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for an empty PATH", async () => {
    mockExecFile.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(null, "WAVE_SHELL_SNAPSHOT\n", "");
    }) as typeof execFile);

    expect(await getShellSnapshotPath("/bin/bash")).toBeUndefined();
  });

  it("returns undefined when execFile throws synchronously (no unhandled rejection)", async () => {
    mockExecFile.mockImplementation(() => {
      throw new TypeError("invalid arguments");
    });

    expect(await getShellSnapshotPath("/bin/bash")).toBeUndefined();
  });

  it("resetShellSnapshotCache clears the cache so the snapshot is re-captured", async () => {
    mockExecFile.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      callback(null, "WAVE_SHELL_SNAPSHOT\n/usr/bin:/bin\n", "");
    }) as typeof execFile);

    await getShellSnapshotPath("/bin/bash");
    resetShellSnapshotCache();
    await getShellSnapshotPath("/bin/bash");

    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  describe("getCachedShellSnapshotPath", () => {
    it("returns undefined before the snapshot capture has settled", async () => {
      let settleCallback: ExecFileCallback | undefined;
      mockExecFile.mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        settleCallback = callback;
      }) as typeof execFile);

      const promise = getShellSnapshotPath("/bin/bash");
      expect(getCachedShellSnapshotPath("/bin/bash")).toBeUndefined();

      // Let the capture settle — the synchronous getter now returns the PATH.
      settleCallback?.(null, "WAVE_SHELL_SNAPSHOT\n/usr/bin:/bin\n", "");
      await promise;
      expect(getCachedShellSnapshotPath("/bin/bash")).toBe("/usr/bin:/bin");
    });

    it("returns the captured PATH synchronously once the snapshot is ready", async () => {
      mockExecFile.mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        callback(
          null,
          "WAVE_SHELL_SNAPSHOT\n/usr/local/bin:/usr/bin:/bin\n",
          "",
        );
      }) as typeof execFile);

      await getShellSnapshotPath("/bin/bash");

      expect(getCachedShellSnapshotPath("/bin/bash")).toBe(
        "/usr/local/bin:/usr/bin:/bin",
      );
    });

    it("returns undefined for a failed capture", async () => {
      mockExecFile.mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        callback(new Error("spawn ENOENT"), "", "");
      }) as typeof execFile);

      await getShellSnapshotPath("/bin/bash");

      expect(getCachedShellSnapshotPath("/bin/bash")).toBeUndefined();
    });
  });

  describe("buildShellSpawnArgs", () => {
    it("returns -c -l and kicks off snapshot creation when none cached", () => {
      mockExecFile.mockImplementation((() => {
        // Never invoke the callback — the capture stays pending.
      }) as unknown as typeof execFile);

      expect(buildShellSpawnArgs("/bin/bash", "echo hi")).toEqual([
        "-c",
        "-l",
        "echo hi",
      ]);
      // Capture kicked off (fire-and-forget) for later commands.
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("returns -c with the cached PATH re-exported once the snapshot is ready", async () => {
      mockExecFile.mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        callback(
          null,
          "WAVE_SHELL_SNAPSHOT\n/usr/local/bin:/usr/bin:/bin\n",
          "",
        );
      }) as typeof execFile);
      await getShellSnapshotPath("/bin/bash");
      mockExecFile.mockClear();

      expect(buildShellSpawnArgs("/bin/bash", "echo hi")).toEqual([
        "-c",
        "export PATH='/usr/local/bin:/usr/bin:/bin'; echo hi",
      ]);
      // Snapshot already cached — no new capture kicked off.
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe("shellSingleQuote", () => {
    it("wraps the value in single quotes", () => {
      expect(shellSingleQuote("/usr/bin:/bin")).toBe("'/usr/bin:/bin'");
    });

    it("escapes embedded single quotes", () => {
      expect(shellSingleQuote("a'b")).toBe(`'a'"'"'b'`);
    });
  });
});

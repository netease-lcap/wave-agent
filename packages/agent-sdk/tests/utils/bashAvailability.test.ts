import { accessSync, constants } from "fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isBashAvailable } from "../../src/utils/bashAvailability.js";
import { resolveShellPath } from "../../src/utils/shellResolver.js";

/**
 * Shell resolution is mocked and `fs` along with it: this module only asks two
 * questions ("what did resolution answer", "is that path executable"), so the
 * answers are stated directly instead of depending on what the machine has
 * installed — the suite must not flip along with Git Bash's presence.
 */
vi.mock("../../src/utils/shellResolver.js", () => ({
  resolveShellPath: vi.fn(),
}));

vi.mock("fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

describe("isBashAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is false when resolution finds no shell", () => {
    vi.mocked(resolveShellPath).mockReturnValue(undefined);

    expect(isBashAvailable()).toBe(false);
    expect(accessSync).not.toHaveBeenCalled();
  });

  it("is true when the resolved shell exists and is executable", () => {
    vi.mocked(resolveShellPath).mockReturnValue(
      "C:/Program Files/Git/bin/bash.exe",
    );
    vi.mocked(accessSync).mockReturnValue(undefined);

    expect(isBashAvailable()).toBe(true);
    expect(accessSync).toHaveBeenCalledWith(
      "C:/Program Files/Git/bin/bash.exe",
      constants.X_OK,
    );
  });

  it("is false when the resolved path is not on disk", () => {
    // The shape that matters on Windows: `WAVE_GIT_BASH_PATH` is returned
    // verbatim by `resolveWindowsShell()`, so a stale value answers "resolved"
    // for a binary nothing can spawn.
    vi.mocked(resolveShellPath).mockReturnValue("/nowhere/bash");
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT: /nowhere/bash");
    });

    expect(isBashAvailable()).toBe(false);
  });

  it("is false when the resolved shell exists but is not executable", () => {
    vi.mocked(resolveShellPath).mockReturnValue("/path/bash");
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("EACCES: /path/bash");
    });

    expect(isBashAvailable()).toBe(false);
  });
});

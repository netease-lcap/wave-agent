import { accessSync, constants } from "fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __resetBashAvailabilityCacheForTesting,
  isBashAvailable,
} from "../../src/utils/bashAvailability.js";
import { collectShellToolGateInput } from "../../src/utils/shell/shellToolGate.js";
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

// Only `loadMergedWaveConfig` is reached (for the `WAVE_USE_POWERSHELL_TOOL`
// lookup); the rest of the settings stack is not this file's subject.
vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(() => null),
}));

describe("isBashAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetBashAvailabilityCacheForTesting();
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

  /**
   * The answer is an environment fact (platform + OS env + what is installed),
   * so it is probed once per process. Without the memo every *model request*
   * re-probes, because the system prompt names the shell that runs the session
   * — and on a machine whose Git lives outside `C:\Program Files\Git` that
   * probe is a `where.exe` spawn (~170 ms, synchronous).
   */
  describe("probe memo", () => {
    it("resolves the shell path once, however many times it is asked", () => {
      vi.mocked(resolveShellPath).mockReturnValue("/path/bash");
      vi.mocked(accessSync).mockReturnValue(undefined);

      expect(isBashAvailable()).toBe(true);
      expect(isBashAvailable()).toBe(true);

      expect(resolveShellPath).toHaveBeenCalledTimes(1);
    });

    it("remembers a negative answer too", () => {
      vi.mocked(resolveShellPath).mockReturnValue(undefined);

      expect(isBashAvailable()).toBe(false);
      vi.mocked(resolveShellPath).mockReturnValue("/path/bash");
      expect(isBashAvailable()).toBe(false);

      expect(resolveShellPath).toHaveBeenCalledTimes(1);
    });

    it("is shared by every workdir the shell gate is collected for", () => {
      vi.mocked(resolveShellPath).mockReturnValue("/path/bash");
      vi.mocked(accessSync).mockReturnValue(undefined);

      collectShellToolGateInput("/tmp/a");
      collectShellToolGateInput("/tmp/a");
      collectShellToolGateInput("/tmp/b");

      expect(resolveShellPath).toHaveBeenCalledTimes(1);
      expect(collectShellToolGateInput("/tmp/c").hasGitBash).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import { createBashProvider } from "../../../src/utils/shell/bashProvider.js";
import { getShellProvider } from "../../../src/utils/shell/resolveProvider.js";
import { buildSearchShellPrelude } from "../../../src/utils/searchShell.js";

vi.mock("../../../src/utils/searchShell.js", () => ({
  buildSearchShellPrelude: vi.fn(),
}));

const SHELL = "/bin/bash";
const TEMP_DIR = path.join(os.tmpdir(), "wave-bash-provider-test");

describe("bashProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSearchShellPrelude).mockReturnValue(undefined);
  });

  it("declares itself as bash and keeps the resolved shell path", () => {
    const provider = createBashProvider(SHELL);

    expect(provider.type).toBe("bash");
    expect(provider.shellPath).toBe(SHELL);
    expect(provider.detached).toBe(true);
    // bash is invoked through spawn's `shell` option, not through argv.
    expect(provider.getSpawnArgs("echo hi")).toEqual([]);
    expect(provider.getEnvironmentOverrides("echo hi")).toEqual({});
  });

  describe("prepareCommand", () => {
    it("passes the command through when the install has no search binaries", () => {
      const provider = createBashProvider(SHELL);

      expect(provider.prepareCommand("echo hi")).toBe("echo hi");
    });

    it("prepends the search prelude inside the command string", () => {
      vi.mocked(buildSearchShellPrelude).mockReturnValue(
        "function grep { :; }",
      );
      const provider = createBashProvider(SHELL);

      expect(provider.prepareCommand("echo hi")).toBe(
        "function grep { :; }\necho hi",
      );
    });
  });

  describe("buildExecCommand", () => {
    it("wraps the command in eval with pwd -P appended", () => {
      const provider = createBashProvider(SHELL);

      const exec = provider.buildExecCommand("echo hi", {
        tempDir: () => TEMP_DIR,
        cwdTracking: true,
      });

      expect(exec.commandString).toContain("eval 'echo hi'");
      expect(exec.commandString).toMatch(/&& pwd -P >\| .*wave_cwd_.*\.tmp$/);
      // The path handed to the shell is POSIX-shaped; the caller reads the
      // native one back.
      expect(exec.commandString).toContain(
        exec.cwdFilePath.replace(/\\/g, "/"),
      );
      expect(path.dirname(exec.cwdFilePath)).toBe(TEMP_DIR);
    });

    it("escapes single quotes in the user command", () => {
      const provider = createBashProvider(SHELL);

      const exec = provider.buildExecCommand("echo 'hi'", {
        tempDir: () => TEMP_DIR,
        cwdTracking: true,
      });

      expect(exec.commandString).toMatch(/^eval 'echo '"'"'hi'"'"''/);
    });

    it("keeps the && pwd -P suffix outside the eval quotes for heredocs", () => {
      const provider = createBashProvider(SHELL);
      const command = [`cat <<'EOF'`, "line", "EOF"].join("\n");

      const exec = provider.buildExecCommand(command, {
        tempDir: () => TEMP_DIR,
        cwdTracking: true,
      });

      const evalStart = exec.commandString.lastIndexOf("eval '");
      const pwdIndex = exec.commandString.indexOf("&& pwd -P");
      expect(pwdIndex).toBeGreaterThan(evalStart);
      expect(exec.commandString).toMatch(/&& pwd -P >\| .*wave_cwd_.*\.tmp$/);
    });

    it("leaves the command alone when CWD tracking is off, but still names a file", () => {
      const provider = createBashProvider(SHELL);

      const exec = provider.buildExecCommand("echo hi", {
        tempDir: () => TEMP_DIR,
        cwdTracking: false,
      });

      expect(exec.commandString).toBe("echo hi");
      expect(exec.cwdFilePath).toMatch(/wave_cwd_.*\.tmp$/);
    });

    it("asks for the temp dir only once per call", () => {
      const provider = createBashProvider(SHELL);
      const tempDir = vi.fn(() => TEMP_DIR);

      provider.buildExecCommand("echo hi", { tempDir, cwdTracking: true });

      expect(tempDir).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getShellProvider", () => {
  it("returns a bash provider only for the bash kind", () => {
    const provider = getShellProvider("bash");

    expect(provider?.type).toBe("bash");
    // The PowerShell provider lands with the PowerShell tool; until then the
    // dispatch must answer "not available" rather than guess.
    expect(getShellProvider("powershell")).toBeUndefined();
  });
});

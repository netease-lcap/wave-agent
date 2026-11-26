import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import {
  consoleCodePagePrologue,
  createBashProvider,
  withConsoleCodePage,
} from "../../../src/utils/shell/bashProvider.js";
import { getShellProvider } from "../../../src/utils/shell/resolveProvider.js";
import { getPowerShellPath } from "../../../src/utils/shell/powershellDetection.js";
import { getShellSnapshot } from "../../../src/utils/shell/shellSnapshot.js";
import { buildSearchShellPrelude } from "../../../src/utils/searchShell.js";

vi.mock("../../../src/utils/searchShell.js", () => ({
  buildSearchShellPrelude: vi.fn(),
}));

// Building a snapshot runs a real login shell, so the seam is mocked: by
// default there is none, which is the "search shadows only" command string the
// pre-snapshot tests were written against.
vi.mock("../../../src/utils/shell/shellSnapshot.js", () => ({
  getShellSnapshot: vi.fn(),
}));

// Discovery stats every `PATH` entry; the dispatch test asks only whether a
// found binary produces a provider.
vi.mock("../../../src/utils/shell/powershellDetection.js", () => ({
  getPowerShellPath: vi.fn(),
}));

// Windows only: the console's output code page has to be UTF-8 before anything
// the command runs, or a native program's localized text reaches the pipe as
// GBK (see `consoleCodePagePrologue` in bashProvider). It opens the spawn
// string, in front of the eval wrapper; POSIX has no such code page, so the
// difference is written into the expectation rather than skipped. The prologue
// text itself is asserted separately below.
const CODE_PAGE_PRELUDE =
  process.platform === "win32" ? `${consoleCodePagePrologue()}; ` : "";

describe("console code page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("switches with the absolute chcp.com path under SYSTEMROOT", () => {
    vi.stubEnv("SystemRoot", "C:\\Windows");

    expect(consoleCodePagePrologue()).toBe(
      "C:/Windows/System32/chcp.com 65001 >/dev/null 2>&1",
    );
  });

  it("accepts the upper-case env name and windir", () => {
    vi.stubEnv("SystemRoot", "");
    vi.stubEnv("SYSTEMROOT", "D:\\WINNT");

    expect(consoleCodePagePrologue()).toBe(
      "D:/WINNT/System32/chcp.com 65001 >/dev/null 2>&1",
    );
  });

  it("falls back to the bare name when the path cannot be quoted safely", () => {
    // A space (or any shell metacharacter) in the resolved path would break the
    // launcher string, so the unqualified name is the safer fallback.
    vi.stubEnv("SystemRoot", "C:\\Program Files\\Windows");

    expect(consoleCodePagePrologue()).toBe("chcp.com 65001 >/dev/null 2>&1");
  });

  it("falls back to the bare name when SYSTEMROOT is empty", () => {
    vi.stubEnv("SystemRoot", "");
    vi.stubEnv("SYSTEMROOT", "");
    vi.stubEnv("windir", "");

    expect(consoleCodePagePrologue()).toBe("chcp.com 65001 >/dev/null 2>&1");
  });
});

describe("withConsoleCodePage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("only prepends on Windows", () => {
    vi.stubEnv("SystemRoot", "C:\\Windows");

    expect(withConsoleCodePage("echo hi")).toBe(
      process.platform === "win32"
        ? "C:/Windows/System32/chcp.com 65001 >/dev/null 2>&1; echo hi"
        : "echo hi",
    );
  });
});

const SHELL = "/bin/bash";
const TEMP_DIR = path.join(os.tmpdir(), "wave-bash-provider-test");
const SNAPSHOT = "/tmp/snap.sh";

describe("bashProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSearchShellPrelude).mockReturnValue(undefined);
    vi.mocked(getShellSnapshot).mockResolvedValue(undefined);
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
    it("passes the command through when the shell has neither snapshot nor search binaries", async () => {
      const provider = createBashProvider(SHELL);

      await expect(provider.prepareCommand("echo hi")).resolves.toBe("echo hi");
    });

    it("prepends the search prelude inside the command string", async () => {
      vi.mocked(buildSearchShellPrelude).mockReturnValue(
        "function grep { :; }",
      );
      const provider = createBashProvider(SHELL);

      await expect(provider.prepareCommand("echo hi")).resolves.toBe(
        "function grep { :; }\necho hi",
      );
    });

    it("sources the session snapshot before the search shadows", async () => {
      vi.mocked(getShellSnapshot).mockResolvedValue(SNAPSHOT);
      vi.mocked(buildSearchShellPrelude).mockReturnValue(
        "function grep { :; }",
      );
      const provider = createBashProvider(SHELL);

      const prepared = await provider.prepareCommand("echo hi", {
        tempDir: TEMP_DIR,
      });

      expect(prepared.split("\n")).toEqual([
        `. '${SNAPSHOT}' 2>/dev/null || true`,
        "function grep { :; }",
        "echo hi",
      ]);
      // The sandbox's temp dir has to reach the snapshot build, or a command run
      // inside the sandbox would source a file it cannot read.
      expect(getShellSnapshot).toHaveBeenCalledWith(SHELL, TEMP_DIR);
    });

    it("drops the snapshot line when none could be built", async () => {
      vi.mocked(buildSearchShellPrelude).mockReturnValue(
        "function grep { :; }",
      );
      const provider = createBashProvider(SHELL);

      const prepared = await provider.prepareCommand("echo hi", {
        tempDir: TEMP_DIR,
      });

      expect(prepared).not.toContain("snap.sh");
      expect(prepared).toBe("function grep { :; }\necho hi");
    });
  });

  describe("buildExecCommand", () => {
    it("wraps the command in eval with pwd -P appended", () => {
      const provider = createBashProvider(SHELL);

      const exec = provider.buildExecCommand("echo hi", {
        tempDir: () => TEMP_DIR,
        cwdTracking: true,
      });

      // The code page switch, where there is one, opens the string: it has to
      // run before anything the command spawns can write to the pipe.
      expect(
        exec.commandString.startsWith(`${CODE_PAGE_PRELUDE}eval 'echo hi'`),
      ).toBe(true);
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

      const body = exec.commandString.slice(CODE_PAGE_PRELUDE.length);
      expect(body).toMatch(/^eval 'echo '"'"'hi'"'"''/);
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

      // Nothing appended — only the code page switch comes before it.
      expect(exec.commandString).toBe(`${CODE_PAGE_PRELUDE}echo hi`);
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
  it("returns a bash provider for the bash kind", () => {
    const provider = getShellProvider("bash");

    expect(provider?.type).toBe("bash");
  });

  it("returns a PowerShell provider only when a binary was found", () => {
    vi.mocked(getPowerShellPath).mockReturnValue(undefined);
    expect(getShellProvider("powershell")).toBeUndefined();

    vi.mocked(getPowerShellPath).mockReturnValue("C:\\pwsh.exe");

    const provider = getShellProvider("powershell");

    expect(provider?.type).toBe("powershell");
    expect(provider?.shellPath).toBe("C:\\pwsh.exe");
  });
});

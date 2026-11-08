import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wrapper logs one diagnostic line per adoption; spy it so the suite stays
 * quiet and the log contract can be asserted instead of muted.
 */
const { hostLogMock } = vi.hoisted(() => ({
  hostLogMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/hostLog", () => ({ hostLog: hostLogMock }));

import type { LoginShellEnvOptions } from "wave-agent-sdk/host";
import {
  _resetLoginPathCacheForTesting,
  adoptLoginPathIntoEnv,
  probeLoginPath,
  type AdoptLoginShellEnvOptions,
} from "../../src/stdio/loginPath";

const LINUX: NodeJS.Platform = "linux";
const WIN32: NodeJS.Platform = "win32";
const HOMEDIR = "/home/tester";
/** rc files are POSIX paths — build them with path.posix to stay platform-neutral. */
const ZSHRC = path.posix.join(HOMEDIR, ".zshrc");

type ExecOptions = { env: NodeJS.ProcessEnv; timeout: number };
type ExecCall = { file: string; args: string[]; options: ExecOptions };

/** execFile stub that records every call and answers from `respond`. */
function createExecStub(respond: (call: ExecCall) => string) {
  const calls: ExecCall[] = [];
  const execFile = (
    file: string,
    args: string[],
    options: ExecOptions,
  ): Promise<string> => {
    const call = { file, args, options };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { execFile, calls };
}

/** A stub whose every probe attempt fails (timeout / missing shell). */
function createFailingExecStub() {
  const calls: ExecCall[] = [];
  const execFile = (
    file: string,
    args: string[],
    options: ExecOptions,
  ): Promise<string> => {
    calls.push({ file, args, options });
    return Promise.reject(new Error("probe timeout"));
  };
  return { execFile, calls };
}

function probeCommand(call: ExecCall): string {
  return call.args[call.args.length - 1];
}

/** Both markers the probe echoes, read back out of the generated command. */
function extractNonces(command: string): { start: string; end: string } {
  const found = [...command.matchAll(/echo "([^"]+)"/g)].map((m) => m[1]);
  return { start: found[0], end: found[1] };
}

/** `env -0` output: NUL-separated entries between the two markers. */
function nulOutput(call: ExecCall, entries: Record<string, string>): string {
  const { start, end } = extractNonces(probeCommand(call));
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\0`)
    .join("");
  return `${start}\n${body}${end}\n`;
}

function filesExist(...paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

/** Baseline options for a POSIX probe that resolves `/bin/zsh`. */
function posixOptions(
  execFile: LoginShellEnvOptions["execFile"],
  target: NodeJS.ProcessEnv = {},
): AdoptLoginShellEnvOptions {
  return {
    platform: LINUX,
    homedir: HOMEDIR,
    env: { PATH: "/usr/bin:/bin", HOME: HOMEDIR, SHELL: "/bin/zsh" },
    fileExists: filesExist("/bin/zsh", ZSHRC),
    execFile,
    target,
  };
}

describe("loginPath", () => {
  const originalGitBash = process.env.WAVE_GIT_BASH_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetLoginPathCacheForTesting();
  });

  afterEach(() => {
    if (originalGitBash === undefined) delete process.env.WAVE_GIT_BASH_PATH;
    else process.env.WAVE_GIT_BASH_PATH = originalGitBash;
    _resetLoginPathCacheForTesting();
  });

  describe("adoptLoginPathIntoEnv", () => {
    it("adopts the whitelisted login-shell values and merges PATH", async () => {
      const { execFile } = createExecStub((call) =>
        nulOutput(call, {
          PATH: "/probe/nvm/bin:/opt/homebrew/bin:/usr/bin",
          LANG: "zh_CN.UTF-8",
          HTTPS_PROXY: "http://proxy:8080",
          SSH_AUTH_SOCK: "/tmp/ssh.sock",
          // Not whitelisted — must never reach the host process.
          SECRET_TOKEN: "leaked",
          // Rewritten by the shell itself — must be dropped.
          PWD: "/somewhere",
          SHLVL: "2",
        }),
      );
      const target: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

      await adoptLoginPathIntoEnv(posixOptions(execFile, target));

      // Probed segments first, inherited ones after, deduped.
      expect(target.PATH).toBe(
        "/probe/nvm/bin:/opt/homebrew/bin:/usr/bin:/bin",
      );
      expect(target.LANG).toBe("zh_CN.UTF-8");
      expect(target.HTTPS_PROXY).toBe("http://proxy:8080");
      expect(target.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
      expect(target.SECRET_TOKEN).toBeUndefined();
      expect(target.PWD).toBeUndefined();
      expect(target.SHLVL).toBeUndefined();
      expect(hostLogMock.info).toHaveBeenCalledWith(
        expect.stringContaining("adopted keys:"),
      );
      expect(hostLogMock.warn).not.toHaveBeenCalled();
    });

    it("keeps host-provided non-PATH keys but still merges PATH", async () => {
      const { execFile } = createExecStub((call) =>
        nulOutput(call, {
          PATH: "/probe/bin",
          HTTPS_PROXY: "http://login-shell:8080",
          LANG: "en_US.UTF-8",
        }),
      );
      const target: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        HTTPS_PROXY: "http://host:3128",
      };

      await adoptLoginPathIntoEnv(posixOptions(execFile, target));

      expect(target.HTTPS_PROXY).toBe("http://host:3128");
      expect(target.PATH).toBe("/probe/bin:/usr/bin");
      expect(target.LANG).toBe("en_US.UTF-8");
    });

    it("probes only once across calls, including a concurrent one", async () => {
      const stub = createExecStub((call) =>
        nulOutput(call, { PATH: "/probe/bin" }),
      );
      const target: NodeJS.ProcessEnv = {};

      await Promise.all([
        adoptLoginPathIntoEnv(posixOptions(stub.execFile, target)),
        adoptLoginPathIntoEnv(posixOptions(stub.execFile, target)),
      ]);
      await adoptLoginPathIntoEnv(posixOptions(stub.execFile, target));

      expect(stub.calls).toHaveLength(1);
      expect(target.PATH).toBe("/probe/bin");
    });

    it("resolves without touching the target when the probe fails", async () => {
      const { execFile } = createFailingExecStub();
      const target: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

      await adoptLoginPathIntoEnv({
        ...posixOptions(execFile, target),
        // Keep the default retry budget out of the test's runtime.
        attempts: 1,
      });

      expect(target).toEqual({ PATH: "/usr/bin" });
      expect(hostLogMock.warn).toHaveBeenCalledWith(
        expect.stringContaining("keeping the inherited environment"),
        "probe timeout",
      );
      expect(hostLogMock.info).not.toHaveBeenCalled();
    });

    it("retries within the budget before degrading", async () => {
      const stub = createFailingExecStub();
      const target: NodeJS.ProcessEnv = {};

      await adoptLoginPathIntoEnv({
        ...posixOptions(stub.execFile, target),
        attempts: 3,
        backoffBaseMs: 0,
      });

      expect(stub.calls).toHaveLength(3);
      expect(target).toEqual({});
      expect(hostLogMock.warn).toHaveBeenCalledTimes(1);
    });

    it("adopts PATH only on Windows, updating the existing case-variant key", async () => {
      // The Windows branch resolves Git Bash through the package-wide resolver;
      // the env override makes it independent of a real Git install.
      process.env.WAVE_GIT_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
      const { execFile } = createExecStub(
        () => "C:\\probe\\bin;C:\\Program Files\\Git\\bin\r\n",
      );
      const target: NodeJS.ProcessEnv = { Path: "C:\\inherited" };

      await adoptLoginPathIntoEnv({
        platform: WIN32,
        execFile,
        target,
      });

      expect(target.Path).toBe(
        "C:\\probe\\bin;C:\\Program Files\\Git\\bin;C:\\inherited",
      );
      expect(target.PATH).toBeUndefined();
      // Windows adopts PATH only: no other key may appear.
      expect(Object.keys(target)).toEqual(["Path"]);
    });
  });

  describe("probeLoginPath", () => {
    it("returns the full probed environment, PATH included", async () => {
      const { execFile } = createExecStub((call) =>
        nulOutput(call, { PATH: "/probe/bin", LANG: "en_US.UTF-8" }),
      );

      const probe = await probeLoginPath(posixOptions(execFile));

      expect(probe.env.PATH).toBe("/probe/bin");
      expect(probe.env.LANG).toBe("en_US.UTF-8");
      expect(probe.shell).toBe("/bin/zsh");
    });

    it("rejects when the probe fails (no adoption, no swallowing)", async () => {
      const { execFile } = createFailingExecStub();

      await expect(probeLoginPath(posixOptions(execFile))).rejects.toThrow(
        "probe timeout",
      );
    });
  });
});

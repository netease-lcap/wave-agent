import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Windows branch delegates to the package-wide Git Bash resolver, which
 * reads `process.env` / `fs` directly. Swap it for a stub so the Windows path
 * can be exercised on any developer machine.
 */
const { resolveShellPathMock } = vi.hoisted(() => ({
  resolveShellPathMock: vi.fn<() => string | undefined>(),
}));

vi.mock("../../src/utils/shellResolver.js", () => ({
  resolveShellPath: resolveShellPathMock,
}));

import {
  _resetLoginShellEnvCacheForTesting,
  adoptLoginShellEnv,
  LOGIN_SHELL_ENV_KEYS,
  LOGIN_SHELL_ENV_PREFIXES,
  primeProcessEnvFromLoginShell,
  probeLoginShellEnv,
  resolveProbeShell,
  selectWhitelistedEnv,
  type LoginShellEnvOptions,
} from "../../src/utils/loginShellEnv.js";

const LINUX: NodeJS.Platform = "linux";
const WIN32: NodeJS.Platform = "win32";
const HOMEDIR = "/home/tester";
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
/** rc files are POSIX paths — build them with path.posix to stay platform-neutral. */
const ZSHRC = path.posix.join(HOMEDIR, ".zshrc");
const BASHRC = path.posix.join(HOMEDIR, ".bashrc");

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

/** Both markers the probe echoes, read back out of the generated command. */
function extractNonces(command: string): { start: string; end: string } {
  const found = [...command.matchAll(/echo "([^"]+)"/g)].map((m) => m[1]);
  return { start: found[0], end: found[1] };
}

function probeCommand(call: ExecCall): string {
  return call.args[call.args.length - 1];
}

/** `env -0` output: NUL-separated entries between the two markers. */
function nulOutput(call: ExecCall, entries: Record<string, string>): string {
  const { start, end } = extractNonces(probeCommand(call));
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\0`)
    .join("");
  return `${start}\n${body}${end}\n`;
}

/** `|| env` fallback output: no end marker, newline-separated entries. */
function lineOutput(call: ExecCall, lines: string[]): string {
  const { start } = extractNonces(probeCommand(call));
  return `${start}\n${lines.join("\n")}\n`;
}

function filesExist(...paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

/** Baseline options for a POSIX probe that resolves `/bin/zsh`. */
function posixOptions(
  execFile: LoginShellEnvOptions["execFile"],
): LoginShellEnvOptions {
  return {
    platform: LINUX,
    homedir: HOMEDIR,
    env: { PATH: "/usr/bin:/bin", HOME: HOMEDIR, SHELL: "/bin/zsh" },
    fileExists: filesExist("/bin/zsh", ZSHRC),
    execFile,
  };
}

beforeEach(() => {
  _resetLoginShellEnvCacheForTesting();
  resolveShellPathMock.mockReset();
});

describe("resolveProbeShell", () => {
  it("prefers $SHELL when it is an absolute executable path", () => {
    const shell = resolveProbeShell({
      platform: LINUX,
      env: { SHELL: "/usr/local/bin/fish" },
      homedir: HOMEDIR,
      fileExists: filesExist("/usr/local/bin/fish", "/bin/zsh", "/bin/bash"),
    });
    expect(shell).toBe("/usr/local/bin/fish");
  });

  it("ignores a non-absolute $SHELL and falls through to zsh", () => {
    const shell = resolveProbeShell({
      platform: LINUX,
      env: { SHELL: "zsh" },
      homedir: HOMEDIR,
      fileExists: filesExist("/bin/zsh", ZSHRC),
    });
    expect(shell).toBe("/bin/zsh");
  });

  it("ignores $SHELL when it is not executable", () => {
    const shell = resolveProbeShell({
      platform: LINUX,
      env: { SHELL: "/usr/bin/fish" },
      homedir: HOMEDIR,
      fileExists: filesExist("/bin/bash", BASHRC),
    });
    expect(shell).toBe("/bin/bash");
  });

  it("uses /bin/zsh when ~/.zshrc exists", () => {
    const shell = resolveProbeShell({
      platform: LINUX,
      env: {},
      homedir: HOMEDIR,
      fileExists: filesExist("/bin/zsh", ZSHRC, "/bin/bash"),
    });
    expect(shell).toBe("/bin/zsh");
  });

  it("falls back to /bin/bash when zsh exists but ~/.zshrc does not", () => {
    const shell = resolveProbeShell({
      platform: LINUX,
      // No $SHELL: a bash-only box must still resolve.
      env: {},
      homedir: HOMEDIR,
      fileExists: filesExist("/bin/zsh", "/bin/bash", BASHRC),
    });
    expect(shell).toBe("/bin/bash");
  });

  it("uses the first existing shell when neither rc file exists", () => {
    expect(
      resolveProbeShell({
        platform: LINUX,
        env: {},
        homedir: HOMEDIR,
        fileExists: filesExist("/bin/zsh", "/bin/bash"),
      }),
    ).toBe("/bin/zsh");

    expect(
      resolveProbeShell({
        platform: LINUX,
        env: {},
        homedir: HOMEDIR,
        fileExists: filesExist("/bin/bash"),
      }),
    ).toBe("/bin/bash");
  });

  it("falls back to /bin/sh, then to undefined", () => {
    expect(
      resolveProbeShell({
        platform: LINUX,
        env: {},
        homedir: HOMEDIR,
        fileExists: filesExist("/bin/sh"),
      }),
    ).toBe("/bin/sh");

    expect(
      resolveProbeShell({
        platform: LINUX,
        env: {},
        homedir: HOMEDIR,
        fileExists: () => false,
      }),
    ).toBeUndefined();
  });

  it("delegates to the shared Git Bash resolver on win32", () => {
    resolveShellPathMock.mockReturnValue(GIT_BASH);
    expect(resolveProbeShell({ platform: WIN32 })).toBe(GIT_BASH);
  });
});

describe("probeLoginShellEnv (POSIX)", () => {
  it("parses NUL-separated output and strips shell bookkeeping", async () => {
    const { execFile, calls } = createExecStub((call) =>
      nulOutput(call, {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        NODE_OPTIONS: "--max-old-space-size=4096",
        PWD: HOMEDIR,
        OLDPWD: "/",
        SHLVL: "2",
        _: "/bin/zsh",
        DISABLE_AUTO_UPDATE: "true",
        ZSH_DISABLE_COMPFIX: "true",
        SSH_ASKPASS_REQUIRE: "never",
        DBUS_SESSION_BUS_ADDRESS: "disabled:",
        WAVE_LOGIN_SHELL_PROBE: "1",
      }),
    );

    const probe = await probeLoginShellEnv(posixOptions(execFile));

    expect(probe.parsedByLines).toBe(false);
    expect(probe.shell).toBe("/bin/zsh");
    expect(probe.env).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      // Not whitelisted, but the probe returns the whole environment; the
      // whitelist is applied when it is adopted.
      NODE_OPTIONS: "--max-old-space-size=4096",
    });

    const [call] = calls;
    expect(call.file).toBe("/bin/zsh");
    expect(call.args.slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    expect(probeCommand(call)).toContain("env -0");
    expect(call.options.timeout).toBe(4000);
  });

  it("keeps a noise marker the user's rc changed", async () => {
    const { execFile } = createExecStub((call) =>
      nulOutput(call, {
        PATH: "/usr/bin",
        ZSH_DISABLE_COMPFIX: "false",
      }),
    );

    const probe = await probeLoginShellEnv(posixOptions(execFile));
    expect(probe.env.ZSH_DISABLE_COMPFIX).toBe("false");
  });

  it("runs the probe child with a minimal, noise-suppressed environment", async () => {
    const { execFile, calls } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );

    await probeLoginShellEnv({
      ...posixOptions(execFile),
      env: {
        HOME: HOMEDIR,
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/zsh",
        USER: "tester",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        XDG_DATA_DIRS: "/usr/share",
        XDG_SESSION_TYPE: "wayland",
        NODE_OPTIONS: "--inspect",
        AWS_SECRET_ACCESS_KEY: "nope",
      },
    });

    const probeEnv = calls[0].options.env;
    expect(probeEnv).toMatchObject({
      HOME: HOMEDIR,
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/zsh",
      USER: "tester",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_DATA_DIRS: "/usr/share",
      XDG_SESSION_TYPE: "wayland",
      DISABLE_AUTO_UPDATE: "true",
      ZSH_DISABLE_COMPFIX: "true",
      SSH_ASKPASS_REQUIRE: "never",
      DBUS_SESSION_BUS_ADDRESS: "disabled:",
      WAVE_LOGIN_SHELL_PROBE: "1",
    });
    expect(probeEnv.NODE_OPTIONS).toBeUndefined();
    expect(probeEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    // Only the enumerated XDG_* names are passed through.
    expect(probeEnv.XDG_RUNTIME_DIR).toBeUndefined();
  });

  it("honours timeoutMs", async () => {
    const { execFile, calls } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );
    await probeLoginShellEnv({ ...posixOptions(execFile), timeoutMs: 1234 });
    expect(calls[0].options.timeout).toBe(1234);
  });

  it("falls back to line parsing and drops wrapped values", async () => {
    const { execFile } = createExecStub((call) =>
      lineOutput(call, [
        "PATH=/usr/bin:/bin",
        "LANG=en_US.UTF-8",
        "MULTILINE=first",
        "  second line of the same value",
        "KEY_WITH_EQ=a=b",
      ]),
    );

    const probe = await probeLoginShellEnv(posixOptions(execFile));

    expect(probe.parsedByLines).toBe(true);
    expect(probe.env).toEqual({
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      KEY_WITH_EQ: "a=b",
    });
    expect(probe.env.MULTILINE).toBeUndefined();
  });

  it("throws when the start marker is missing", async () => {
    const { execFile } = createExecStub(() => "welcome to zsh\n");
    await expect(probeLoginShellEnv(posixOptions(execFile))).rejects.toThrow(
      /start marker/,
    );
  });

  it("throws when no shell can be used", async () => {
    const { execFile } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );
    await expect(
      probeLoginShellEnv({
        platform: LINUX,
        homedir: HOMEDIR,
        env: {},
        fileExists: () => false,
        execFile,
      }),
    ).rejects.toThrow(/No usable login shell/);
  });
});

describe("probeLoginShellEnv (win32)", () => {
  const winOptions = (execFile: LoginShellEnvOptions["execFile"]) =>
    ({
      platform: WIN32,
      env: { PATH: "C:\\Windows", HOME: "C:\\Users\\tester" },
      execFile,
    }) satisfies LoginShellEnvOptions;

  it("probes Git Bash and yields PATH only", async () => {
    resolveShellPathMock.mockReturnValue(GIT_BASH);
    const { execFile, calls } = createExecStub(
      () =>
        "bash: cannot set terminal process group\r\nC:\\Git\\bin;C:\\Windows\\system32\r\n",
    );

    const probe = await probeLoginShellEnv(winOptions(execFile));

    expect(probe).toEqual({
      env: { PATH: "C:\\Git\\bin;C:\\Windows\\system32" },
      parsedByLines: true,
      shell: GIT_BASH,
    });
    expect(calls[0].file).toBe(GIT_BASH);
    expect(calls[0].args).toEqual(["-lic", 'cygpath -pw "$PATH"']);
    expect(calls[0].options.env.WAVE_LOGIN_SHELL_PROBE).toBe("1");
  });

  it("throws when Git Bash is missing", async () => {
    resolveShellPathMock.mockReturnValue(undefined);
    const { execFile } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );
    await expect(probeLoginShellEnv(winOptions(execFile))).rejects.toThrow(
      /Git Bash not found/,
    );
  });
});

describe("selectWhitelistedEnv", () => {
  it("keeps whitelisted keys and prefixes, drops the rest", () => {
    const selected = selectWhitelistedEnv(
      {
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
        HTTP_PROXY: "http://proxy:3128",
        LC_ALL: "en_US.UTF-8",
        LANG: "en_US.UTF-8",
        XDG_RUNTIME_DIR: "/run/user/1000",
        NODE_OPTIONS: "--inspect",
        LD_PRELOAD: "/evil.so",
        GIT_DIR: "/tmp/repo",
        path: "/lower/case",
      },
      LINUX,
    );

    expect(selected).toEqual({
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      HTTP_PROXY: "http://proxy:3128",
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });
  });

  it("matches case-insensitively on win32 but keeps the probed key names", () => {
    const selected = selectWhitelistedEnv(
      { Path: "C:\\Git\\bin", no_proxy: "localhost", Http_Proxy: "http://p" },
      WIN32,
    );
    expect(selected).toEqual({
      Path: "C:\\Git\\bin",
      no_proxy: "localhost",
      Http_Proxy: "http://p",
    });
  });

  it("is case-sensitive on POSIX", () => {
    expect(selectWhitelistedEnv({ Path: "/bin", Lc_All: "C" }, LINUX)).toEqual(
      {},
    );
  });

  it("declares the documented whitelist surface", () => {
    expect(LOGIN_SHELL_ENV_KEYS).toContain("PATH");
    expect(LOGIN_SHELL_ENV_KEYS).toContain("SSH_AUTH_SOCK");
    expect(LOGIN_SHELL_ENV_KEYS).toContain("GIT_SSL_CAINFO");
    expect(LOGIN_SHELL_ENV_KEYS).not.toContain("NODE_OPTIONS");
    expect(LOGIN_SHELL_ENV_PREFIXES).toEqual(["LC_", "XDG_"]);
  });
});

describe("adoptLoginShellEnv", () => {
  it("writes whitelisted keys that are not set yet and returns them", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const adopted = adoptLoginShellEnv(
      target,
      {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        NODE_OPTIONS: "--inspect",
        LC_ALL: "en_US.UTF-8",
      },
      LINUX,
    );

    expect(adopted).toEqual(["PATH", "SSH_AUTH_SOCK", "LC_ALL"]);
    // PATH is the one merged key: probed segments first, inherited ones after,
    // duplicates dropped — otherwise the login PATH could never be adopted.
    expect(target.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(target.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
    expect(target.LC_ALL).toBe("en_US.UTF-8");
    // Everything outside the whitelist stays out.
    expect(target.NODE_OPTIONS).toBeUndefined();
  });

  it("replaces an empty PATH with the probed one but treats other empty keys as set", () => {
    const target: NodeJS.ProcessEnv = { PATH: "", SSH_AUTH_SOCK: "" };
    expect(
      adoptLoginShellEnv(
        target,
        { PATH: "/login/path", SSH_AUTH_SOCK: "/tmp/agent.sock" },
        LINUX,
      ),
    ).toEqual(["PATH"]);
    expect(target.PATH).toBe("/login/path");
    expect(target.SSH_AUTH_SOCK).toBe("");
  });

  it("compares existing keys case-insensitively on win32", () => {
    const target: NodeJS.ProcessEnv = { Path: "C:\\Windows" };
    const adopted = adoptLoginShellEnv(
      target,
      { PATH: "C:\\Git\\bin;C:\\Windows" },
      WIN32,
    );
    // The existing `Path` key is updated in place instead of a second `PATH`
    // being added beside it.
    expect(adopted).toEqual(["PATH"]);
    expect(target.PATH).toBeUndefined();
    expect(target.Path).toBe("C:\\Git\\bin;C:\\Windows");
  });
});

describe("primeProcessEnvFromLoginShell", () => {
  it("adopts the probed environment", async () => {
    const { execFile } = createExecStub((call) =>
      nulOutput(call, {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        LANG: "en_US.UTF-8",
        NODE_OPTIONS: "--inspect",
      }),
    );
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const result = await primeProcessEnvFromLoginShell({
      ...posixOptions(execFile),
      target,
      backoffBaseMs: 0,
    });

    expect(result.error).toBeUndefined();
    expect(result.adopted).toEqual(["PATH", "SSH_AUTH_SOCK", "LANG"]);
    expect(target.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(target.NODE_OPTIONS).toBeUndefined();
  });

  it("retries with backoff and resolves instead of throwing on failure", async () => {
    const calls: ExecCall[] = [];
    const execFile = (
      file: string,
      args: string[],
      options: ExecOptions,
    ): Promise<string> => {
      calls.push({ file, args, options });
      return Promise.reject(new Error("probe timed out"));
    };
    const target: NodeJS.ProcessEnv = {};

    const result = await primeProcessEnvFromLoginShell({
      ...posixOptions(execFile),
      target,
      attempts: 3,
      backoffBaseMs: 0,
    });

    expect(calls).toHaveLength(3);
    expect(result).toEqual({ adopted: [], error: "probe timed out" });
    expect(target).toEqual({});
  });

  it("defaults to two attempts", async () => {
    const calls: ExecCall[] = [];
    const execFile = (
      file: string,
      args: string[],
      options: ExecOptions,
    ): Promise<string> => {
      calls.push({ file, args, options });
      return Promise.reject(new Error("boom"));
    };

    const result = await primeProcessEnvFromLoginShell({
      ...posixOptions(execFile),
      target: {},
      backoffBaseMs: 0,
    });

    expect(calls).toHaveLength(2);
    expect(result.adopted).toEqual([]);
    expect(result.error).toBe("boom");
  });

  it("never throws when no shell is available", async () => {
    const result = await primeProcessEnvFromLoginShell({
      platform: LINUX,
      homedir: HOMEDIR,
      env: {},
      fileExists: () => false,
      execFile: () => Promise.resolve(""),
      target: {},
      attempts: 1,
    });

    expect(result.adopted).toEqual([]);
    expect(result.error).toMatch(/No usable login shell/);
  });
});

describe("probe cache", () => {
  it("reuses a successful probe and drops it on reset", async () => {
    const { execFile, calls } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );

    await probeLoginShellEnv(posixOptions(execFile));
    await probeLoginShellEnv(posixOptions(execFile));
    expect(calls).toHaveLength(1);

    _resetLoginShellEnvCacheForTesting();
    await probeLoginShellEnv(posixOptions(execFile));
    expect(calls).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    let shouldFail = true;
    const { execFile, calls } = createExecStub((call) => {
      if (shouldFail) throw new Error("first probe failed");
      return nulOutput(call, { PATH: "/usr/bin" });
    });

    await expect(probeLoginShellEnv(posixOptions(execFile))).rejects.toThrow(
      "first probe failed",
    );

    shouldFail = false;
    const probe = await probeLoginShellEnv(posixOptions(execFile));
    expect(probe.env.PATH).toBe("/usr/bin");
    expect(calls).toHaveLength(2);
  });

  it("hands out copies so callers cannot poison the cache", async () => {
    const { execFile } = createExecStub((call) =>
      nulOutput(call, { PATH: "/usr/bin" }),
    );

    const first = await probeLoginShellEnv(posixOptions(execFile));
    first.env.PATH = "/poisoned";

    const second = await probeLoginShellEnv(posixOptions(execFile));
    expect(second.env.PATH).toBe("/usr/bin");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import { PassThrough, Readable } from "stream";

const h = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  tarCreate: vi.fn(),
  fsExists: vi.fn(() => true),
}));

vi.mock("child_process", () => ({
  execFile: h.execFile,
  spawn: h.spawn,
}));

vi.mock("tar", () => ({ c: h.tarCreate }));

// pushRemoteCliBundle checks the bundled CLI files exist locally before
// tarring — the unit tests push from a fake source.dir, so existence always
// answers true (the tar module is mocked anyway).
vi.mock("fs", () => ({
  existsSync: h.fsExists,
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
}));

import {
  resolveRemoteWaveBinary,
  readRemoteFile,
  getRemoteHomeDir,
  REMOTE_FILE_MAX_LINES,
  REMOTE_FILE_MAX_BYTES,
  MANAGED_RUNTIME_VERSION,
  ensureRemoteCliUpToDate,
  ensureRemoteDaemon,
  killRemoteDaemon,
  remoteCliShimPath,
  remoteRuntimeDir,
  remoteRuntimeNodePath,
  nodePlatformKey,
  nodeRuntimeTarget,
  nodeMirrorBase,
  parseHostPlatform,
  parseRuntimeMarker,
  parseSha256Sums,
  runtimeMarker,
} from "../src/main/remoteCli";
import { resetRemoteShellCache, shellQuote } from "../src/main/sshHosts";

/** Bundled CLI source as desktopHost would load it (loadBundledCliSource). */
const BUNDLE_HASH = "a".repeat(64); // sha256 of the bundled dist/bundle/wave.mjs
const STALE_HASH = "b".repeat(64); // a remote copy whose bytes differ
const SOURCE = {
  dir: "/app/root/resources/wave-cli",
  bundleSha256: BUNDLE_HASH,
};
const HOME = "/home/user";

/** The managed node the CLI runs on, derived from HOME. */
const RUNTIME_NODE = remoteRuntimeNodePath(HOME);

type StubResult = { stdout?: string; error?: Error };

/** Login shell probe (`echo $SHELL`) precedes every remote probe command. */
const LOGIN_SHELL: StubResult = { stdout: "/bin/bash" };

const PLATFORM_LINE = "WAVE_HOST_PLATFORM_V1 Linux|x86_64|glibc";
const MARKER_LINE = `WAVE_RUNTIME_MARKER_V1 ${runtimeMarker("linux-x64")}`;

/** Runtime probe answering "glibc linux-x64, runtime already installed". */
const RUNTIME_INSTALLED: StubResult = {
  stdout: `${PLATFORM_LINE}\n${MARKER_LINE}\n`,
};

/** Runtime probe answering "glibc linux-x64, nothing installed yet". */
const RUNTIME_MISSING: StubResult = { stdout: `${PLATFORM_LINE}\n` };

/**
 * `-lic` runs an INTERACTIVE login shell, so its rc/motd output lands in
 * stdout before the command's own answer. A real Ubuntu WSL user's first
 * login of the day prints exactly this (verified on Ubuntu-24.04); the ssh
 * path can hit the same when the shell prints a banner.
 */
const LOGIN_BANNER =
  'To run a command as administrator (user "root"), use "sudo <command>".\n' +
  'See "man sudo_root" for details.\n\n';

const MIRROR = "https://registry.npmmirror.com/-/binary/node";
const RUNTIME_TARGET = nodeRuntimeTarget("linux-x64");
const RUNTIME_BASE = `${MIRROR}/v${MANAGED_RUNTIME_VERSION}`;

/** Fake official Node archive + its real sha256, as the mirror would serve it. */
function nodeArchive() {
  const bytes = Buffer.from(`fake-node-tarball:${RUNTIME_TARGET.file}`);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Stub the mirror endpoints (`<base>/SHASUMS256.txt` + the archive). Anything
 * else answers 404, which is how a missing mirror path surfaces.
 */
function stubMirror(
  overrides: Record<string, string | Buffer | "404"> = {},
): void {
  const { bytes, sha256 } = nodeArchive();
  const routes: Record<string, string | Buffer | "404"> = {
    [`${RUNTIME_BASE}/SHASUMS256.txt`]: `${sha256}  ${RUNTIME_TARGET.file}\n`,
    [`${RUNTIME_BASE}/${RUNTIME_TARGET.file}`]: bytes,
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[url];
      if (body === undefined || body === "404") {
        return new Response("not found", {
          status: 404,
          statusText: "Not Found",
        });
      }
      return new Response(body);
    }),
  );
}

/**
 * Queue-driven execFile mock: each call shifts the next stub and invokes the
 * callback (promisify(execFile) resolves through the callback, not the mock's
 * returned promise).
 */
function stubExec(results: StubResult[]) {
  const queue = [...results];
  h.execFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      const next = queue.shift() ?? { stdout: "" };
      if (next.error) {
        cb(next.error, { stdout: "" });
      } else {
        cb(null, { stdout: next.stdout ?? "" });
      }
    },
  );
}

/**
 * Fake `ssh` child for the bundle push (spawn). Its stdin is a PassThrough the
 * tarred archive is piped into; when the archive ends, ssh "exits" with
 * `exitCode` so sshStreamCommand settles deterministically.
 */
function makePushChild(exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.stdin.on("data", () => {});
  child.stdin.on("end", () =>
    process.nextTick(() => child.emit("exit", exitCode, null)),
  );
  return child;
}

const CONNECT_FAIL = new Error("ssh: connect to host failed");
CONNECT_FAIL.name = "Error";

/**
 * Fake `wsl.exe` child for the one-shot probes (`getWslLoginShell` reads stdout
 * then waits for exit). Emitted on the next tick so the caller has subscribed.
 */
function makeProbeChild(stdout: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("exit", 0);
  });
  return child;
}

/**
 * Real stdout pollution from `zsh -lic` without a TTY on the user's remote
 * hosts: iTerm2/WezTerm-style shell integration writes OSC 1337 markers before
 * every command's output. Verified against liuyiqi@matrix 2026-08-15.
 */
const OSC1337_PREFIX =
  "\x1b]1337;RemoteHost=liuyiqi@ubuntu.ubuntu-domain\x07" +
  "\x1b]1337;CurrentDir=/home/liuyiqi\x07" +
  "\x1b]1337;ShellIntegrationVersion=14;shell=zsh\x07";

beforeEach(() => {
  h.execFile.mockReset();
  h.spawn.mockReset();
  h.tarCreate.mockReset();
  resetRemoteShellCache();
  h.spawn.mockImplementation(() => makePushChild(0));
  h.tarCreate.mockImplementation(() => Readable.from(["tar-bytes"]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WAVE_NODE_MIRROR;
});

/** The last remote command passed to the (mocked) `ssh` spawn for the push. */
function pushCommand(): string {
  const calls = h.spawn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][1] as string[]).at(-1) as string;
}

describe("managed Node runtime", () => {
  it("maps uname output onto Node's official dist keys", () => {
    expect(parseHostPlatform(`${PLATFORM_LINE}\n`)).toEqual({
      os: "Linux",
      arch: "x86_64",
      libc: "glibc",
    });
    expect(
      nodePlatformKey({ os: "Linux", arch: "x86_64", libc: "glibc" }),
    ).toBe("linux-x64");
    expect(
      nodePlatformKey({ os: "Linux", arch: "aarch64", libc: "glibc" }),
    ).toBe("linux-arm64");
    expect(
      nodePlatformKey({ os: "Darwin", arch: "arm64", libc: "glibc" }),
    ).toBe("darwin-arm64");
    expect(
      nodePlatformKey({ os: "Darwin", arch: "x86_64", libc: "glibc" }),
    ).toBe("darwin-x64");
  });

  it("reads the platform line past a login-shell banner", () => {
    expect(parseHostPlatform(`${LOGIN_BANNER}${PLATFORM_LINE}\n`)).toEqual({
      os: "Linux",
      arch: "x86_64",
      libc: "glibc",
    });
  });

  it("returns null when the probe carried no platform line", () => {
    // A distro banner alone must not be mistaken for a platform answer.
    expect(parseHostPlatform("Welcome to Ubuntu 24.04.5 LTS\n")).toBeNull();
  });

  it("refuses musl hosts: the official Node dist has no musl build", () => {
    expect(() =>
      nodePlatformKey({ os: "Linux", arch: "x86_64", libc: "musl" }),
    ).toThrow("musl");
  });

  it("refuses platforms Node does not ship", () => {
    expect(() =>
      nodePlatformKey({ os: "FreeBSD", arch: "x86_64", libc: "glibc" }),
    ).toThrow("暂不支持的平台");
    expect(() =>
      nodePlatformKey({ os: "Linux", arch: "s390x", libc: "glibc" }),
    ).toThrow("暂不支持的平台");
  });

  it("reads the version/platform marker back past a login-shell banner", () => {
    expect(parseRuntimeMarker(`${LOGIN_BANNER}${MARKER_LINE}\n`)).toBe(
      runtimeMarker("linux-x64"),
    );
    // No marker line at all → nothing installed.
    expect(parseRuntimeMarker(`${PLATFORM_LINE}\n`)).toBe("");
  });

  it("picks the archive's checksum out of SHASUMS256.txt", () => {
    const sums =
      `${"c".repeat(64)}  other.tar.gz\n` +
      `${"d".repeat(64)} *${RUNTIME_TARGET.file}\n`;
    expect(parseSha256Sums(sums, RUNTIME_TARGET.file)).toBe("d".repeat(64));
    expect(() => parseSha256Sums("", RUNTIME_TARGET.file)).toThrow(
      "SHASUMS256.txt",
    );
  });

  it("honours WAVE_NODE_MIRROR and strips its trailing slashes", () => {
    expect(nodeMirrorBase()).toBe(MIRROR);
    process.env.WAVE_NODE_MIRROR = "https://mirror.corp/node/";
    expect(nodeMirrorBase()).toBe("https://mirror.corp/node");
  });

  it("targets the official POSIX distribution layout", () => {
    expect(nodeRuntimeTarget("darwin-arm64")).toEqual({
      file: `node-v${MANAGED_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
      member: `node-v${MANAGED_RUNTIME_VERSION}-darwin-arm64/bin/node`,
    });
  });
});

describe("resolveRemoteWaveBinary (fixed pushed-shim path)", () => {
  it("returns the shim path + managed runtime when the CLI is installed", async () => {
    stubMirror();
    stubExec([LOGIN_SHELL, RUNTIME_INSTALLED, { stdout: `${BUNDLE_HASH}\n` }]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info).toEqual({
      binaryPath: remoteCliShimPath(HOME),
      runtimePath: RUNTIME_NODE,
    });
    // A matching marker means no download at all — not even a HEAD request.
    expect(h.spawn).not.toHaveBeenCalled();
    // The first probe asks for the platform and the installed marker together.
    const probeCmd = (h.execFile.mock.calls[1][1] as string[]).at(-1) as string;
    expect(probeCmd).toContain("WAVE_HOST_PLATFORM_V1");
    expect(probeCmd).toContain("uname -m");
    expect(probeCmd).toContain("musl");
    // The content probe hashes the pushed bundle with the managed node.
    const hashCmd = (h.execFile.mock.calls[2][1] as string[]).at(-1) as string;
    expect(hashCmd).toContain(".wave/runtime/node/bin/node");
    expect(hashCmd).toContain(".wave/cli/desktop");
    expect(hashCmd).toContain("dist/bundle/wave.mjs");
  });

  it("provisions a WSL distro with the managed runtime, never its own node", async () => {
    // desktop-wsl.md 场景 5/6/20: a distro is no longer a special case — the
    // runtime is pushed there too, so it needs no Node.js of its own.
    stubMirror();
    // Spawn order: the login-shell probe (`sh -c 'printf %s "$SHELL"'`) runs
    // first, then the tarball push.
    h.spawn.mockImplementationOnce(() => makeProbeChild("/bin/bash\n"));
    stubExec([
      RUNTIME_MISSING, // no marker → install the runtime into the distro
      { stdout: `v${MANAGED_RUNTIME_VERSION}\n` }, // staged node --version
      { stdout: "" }, // finalize (marker + .new/.old swap)
      { stdout: `${BUNDLE_HASH}\n` }, // CLI content probe
    ]);

    const info = await resolveRemoteWaveBinary("wsl:Ubuntu", SOURCE, HOME);

    expect(info.runtimePath).toBe(RUNTIME_NODE);
    const receive = pushCommand();
    expect(receive).toContain(
      `tar -xzf - -C ${shellQuote(`${remoteRuntimeDir(HOME)}.new`)}`,
    );
    expect(receive).toContain(RUNTIME_TARGET.member);
    // Every command after that runs on the runtime by absolute path: the
    // distro's own `node` is neither probed nor used.
    const hashCmd = (h.execFile.mock.calls[3][1] as string[]).at(-1) as string;
    expect(hashCmd).toContain(".wave/runtime/node/bin/node");
    expect(hashCmd.startsWith("node ")).toBe(false);
  });

  it("downloads, verifies and atomically installs the runtime when missing", async () => {
    stubMirror();
    stubExec([
      LOGIN_SHELL,
      RUNTIME_MISSING, // no marker → install
      { stdout: `v${MANAGED_RUNTIME_VERSION}\n` }, // staged node --version
      { stdout: "" }, // finalize (marker + .new/.old swap)
      { stdout: `${BUNDLE_HASH}\n` }, // CLI hash probe
    ]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info.runtimePath).toBe(RUNTIME_NODE);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const receive = pushCommand();
    const stagingDir = `${remoteRuntimeDir(HOME)}.new`;
    // Only `bin/node` is kept: no npm, no headers, no docs.
    expect(receive).toContain(`tar -xzf - -C ${shellQuote(stagingDir)}`);
    expect(receive).toContain(RUNTIME_TARGET.member);
    // Unquoted fragment: shellQuote wraps the whole path in single quotes.
    expect(receive).toContain(`${stagingDir}/bin/node`);
    const finalize = (h.execFile.mock.calls[3][1] as string[]).at(-1) as string;
    // The marker lands before the swap, so an installed runtime always has one.
    expect(finalize).toContain(runtimeMarker("linux-x64"));
    // Staging → live swap with a backup of the previous runtime.
    expect(finalize).toContain(`${remoteRuntimeDir(HOME)}.new`);
    expect(finalize).toContain(`${remoteRuntimeDir(HOME)}.old`);
  });

  it("reinstalls when the marker records a different runtime version", async () => {
    stubMirror();
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `${PLATFORM_LINE}\nWAVE_RUNTIME_MARKER_V1 ${JSON.stringify({
          version: "20.0.0",
          platform: "linux-x64",
        })}\n`,
      },
      { stdout: `v${MANAGED_RUNTIME_VERSION}\n` },
      { stdout: "" },
      { stdout: `${BUNDLE_HASH}\n` },
    ]);
    await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("surfaces the failing mirror URL + WAVE_NODE_MIRROR when the download 404s", async () => {
    stubMirror({ [`${RUNTIME_BASE}/${RUNTIME_TARGET.file}`]: "404" });
    stubExec([LOGIN_SHELL, RUNTIME_MISSING]);
    const pending = resolveRemoteWaveBinary("prod", SOURCE, HOME);
    await expect(pending).rejects.toThrow("WAVE_NODE_MIRROR");
    await expect(pending).rejects.toThrow(RUNTIME_TARGET.file);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("rejects an archive whose bytes do not match the mirror checksum", async () => {
    stubMirror({
      [`${RUNTIME_BASE}/SHASUMS256.txt`]: `${"c".repeat(64)}  ${RUNTIME_TARGET.file}\n`,
    });
    stubExec([LOGIN_SHELL, RUNTIME_MISSING]);
    await expect(resolveRemoteWaveBinary("prod", SOURCE, HOME)).rejects.toThrow(
      "校验失败",
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("discards the staged runtime when it cannot execute on the host", async () => {
    stubMirror();
    stubExec([
      LOGIN_SHELL,
      RUNTIME_MISSING,
      { error: new Error("cannot execute binary file") }, // --version fails
      { stdout: "" }, // rm -rf staging
    ]);
    await expect(resolveRemoteWaveBinary("prod", SOURCE, HOME)).rejects.toThrow(
      "托管 Node.js 运行时无法执行",
    );
    const cleanup = (h.execFile.mock.calls[3][1] as string[]).at(-1) as string;
    expect(cleanup).toContain("rm -rf");
    expect(cleanup).toContain(`${remoteRuntimeDir(HOME)}.new`);
  });

  it("strips OSC shell-integration markers from probe output", async () => {
    stubMirror();
    stubExec([
      LOGIN_SHELL,
      { stdout: `${OSC1337_PREFIX}${PLATFORM_LINE}\n${MARKER_LINE}\n` },
      { stdout: `${OSC1337_PREFIX}${BUNDLE_HASH}\n` },
    ]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info.runtimePath).toBe(RUNTIME_NODE);
    expect(info.binaryPath).toBe(remoteCliShimPath(HOME));
  });

  it("reads the bundle hash past a login-shell banner", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { stdout: `${LOGIN_BANNER}${BUNDLE_HASH}\n` },
    ]);
    // Hash parsed → bytes match → nothing pushed.
    await expect(
      ensureRemoteCliUpToDate("prod", SOURCE, HOME),
    ).resolves.toEqual({
      binaryPath: remoteCliShimPath(HOME),
      runtimePath: RUNTIME_NODE,
      upgraded: false,
    });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("reads the remote $HOME past a login-shell banner", async () => {
    stubExec([LOGIN_SHELL, { stdout: `${LOGIN_BANNER}/home/user\n` }]);
    await expect(getRemoteHomeDir("prod")).resolves.toBe("/home/user");
  });

  it("throws an actionable error when the host reports no platform", async () => {
    stubExec([LOGIN_SHELL, { stdout: "Welcome to Ubuntu 24.04.5 LTS\n" }]);
    await expect(resolveRemoteWaveBinary("prod", SOURCE, HOME)).rejects.toThrow(
      "无法识别运行环境",
    );
  });

  it("pushes the bundled CLI (tar over ssh) when missing", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { error: new Error("no such file") }, // hash probe → missing/corrupt
    ]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info.binaryPath).toBe(remoteCliShimPath(HOME));
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.tarCreate).toHaveBeenCalledWith(
      { cwd: SOURCE.dir, gzip: false, portable: true },
      ["bin", "dist", "package.json"],
    );
  });

  it("throws without installing when installIfMissing is false", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { error: new Error("no such file") },
    ]);
    await expect(
      resolveRemoteWaveBinary("prod", SOURCE, HOME, false),
    ).rejects.toThrow("远端未安装 wave CLI");
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("ensureRemoteCliUpToDate", () => {
  it("keeps the pushed CLI when the remote bundle bytes match the bundled bytes (scenario 7: unchanged bytes push nothing)", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { stdout: `${BUNDLE_HASH}\n` }, // remote sha256 == bundled → up to date
    ]);
    const result = await ensureRemoteCliUpToDate("prod", SOURCE, HOME);
    expect(result).toEqual({
      binaryPath: remoteCliShimPath(HOME),
      runtimePath: RUNTIME_NODE,
      upgraded: false,
    });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("pushes via an atomic .new swap when the remote bytes differ (scenario 7: changed bytes push)", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { stdout: `${STALE_HASH}\n` }, // bytes differ → sync
    ]);
    const result = await ensureRemoteCliUpToDate("prod", SOURCE, HOME);
    expect(result).toEqual({
      binaryPath: remoteCliShimPath(HOME),
      runtimePath: RUNTIME_NODE,
      upgraded: true,
    });
    const cmd = pushCommand();
    expect(cmd).toContain(
      `tar -xf - -C ${shellQuote("/home/user/.wave/cli/desktop.new")}`,
    );
    // Windows-built bundles carry no exec bit — the receive script restores it
    // on the shim so the remote daemon/probe can run it via shebang.
    expect(cmd).toContain(
      `chmod +x ${shellQuote("/home/user/.wave/cli/desktop.new/bin/wave-code.js")}`,
    );
    expect(cmd).toContain(
      `mv ${shellQuote("/home/user/.wave/cli/desktop")} ${shellQuote("/home/user/.wave/cli/desktop.old")}`,
    );
    expect(cmd).toContain(
      `rm -rf ${shellQuote("/home/user/.wave/cli/desktop.old")}`,
    );
  });

  it("treats a failing content probe as needing a push (corrupt copy)", async () => {
    stubExec([
      LOGIN_SHELL,
      RUNTIME_INSTALLED,
      { error: new Error("segfault") },
    ]);
    const result = await ensureRemoteCliUpToDate("prod", SOURCE, HOME);
    expect(result.upgraded).toBe(true);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("killRemoteDaemon", () => {
  it("pkills the daemon by its socket with the anti-self-match bracket trick", async () => {
    stubExec([LOGIN_SHELL, { stdout: "" }]);
    await killRemoteDaemon("prod", "/home/user/.wave/daemon.sock");
    const args = h.execFile.mock.calls[1][1] as string[];
    expect(args[args.length - 1]).toBe(
      `/bin/bash -lic ${shellQuote("pkill -f '[w]ave.*--daemon.*/home/user/.wave/daemon.sock' || true")}`,
    );
  });
});

describe("ensureRemoteDaemon", () => {
  // A failed sync logs a warning and notifies; the notice is the contract, so
  // keep the log out of the run (a green suite must stay quiet).
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("reuses a live daemon when the CLI bytes match (no push, no restart)", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" }, // echo $HOME
      RUNTIME_INSTALLED, // runtime probe: already installed
      { stdout: `${BUNDLE_HASH}\n` }, // hash probe == bundle
      { stdout: "" }, // daemon socket probe — alive
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE)).resolves.toBe(
      "/home/user/.wave/daemon.sock",
    );
    expect(h.spawn).not.toHaveBeenCalled();
    const commands = h.execFile.mock.calls.map(
      (c) => (c[1] as string[]).at(-1) as string,
    );
    expect(commands.some((c) => c.includes("pkill"))).toBe(false);
    expect(commands.some((c) => c.includes("nohup"))).toBe(false);
  });

  it("pushes a stale CLI and restarts the daemon so the upgrade takes effect", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      RUNTIME_INSTALLED,
      { stdout: `${STALE_HASH}\n` }, // hash probe != bundle → push
      { stdout: "" }, // pkill old daemon
      { error: new Error("ECONNREFUSED") }, // exit poll — gone
      { error: new Error("ECONNREFUSED") }, // alive check — gone
      { stdout: "" }, // nohup start new daemon
      { stdout: "" }, // start poll — alive
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE)).resolves.toBe(
      "/home/user/.wave/daemon.sock",
    );
    expect(h.spawn).toHaveBeenCalledTimes(1); // the CLI push
    const commands = h.execFile.mock.calls.map(
      (c) => (c[1] as string[]).at(-1) as string,
    );
    expect(commands.some((c) => c.includes("pkill"))).toBe(true);
    // The daemon is launched through the managed runtime, not the shim's
    // shebang — a host without a system node has nothing for it to resolve.
    const launch = commands.find((c) => c.includes("nohup"));
    expect(launch).toContain(".wave/runtime/node/bin/node");
    expect(launch).toContain(".wave/cli/desktop/bin/wave-code.js");
  });

  it("pushes onto a fresh host (no CLI) and launches the daemon", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      RUNTIME_INSTALLED,
      { error: new Error("no such file") }, // hash probe → missing
      { stdout: "" }, // pkill (nothing to kill)
      { error: new Error("ECONNREFUSED") }, // exit poll — gone
      { error: new Error("ECONNREFUSED") }, // alive check — gone
      { stdout: "" }, // nohup start
      { stdout: "" }, // start poll — alive
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE)).resolves.toBe(
      "/home/user/.wave/daemon.sock",
    );
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const cmd = pushCommand();
    expect(cmd).toContain("/home/user/.wave/cli/desktop.new");
  });

  it("installs the runtime before pushing the CLI onto a host without node", async () => {
    stubMirror();
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      RUNTIME_MISSING, // no runtime yet → download + install
      { stdout: `v${MANAGED_RUNTIME_VERSION}\n` }, // staged node --version
      { stdout: "" }, // finalize install
      { error: new Error("no such file") }, // hash probe → missing CLI
      { stdout: "" }, // pkill (nothing to kill)
      { error: new Error("ECONNREFUSED") }, // exit poll — gone
      { error: new Error("ECONNREFUSED") }, // alive check — gone
      { stdout: "" }, // nohup start
      { stdout: "" }, // start poll — alive
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE)).resolves.toBe(
      "/home/user/.wave/daemon.sock",
    );
    // Two pushes: the runtime tarball, then the CLI bundle.
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(pushCommand()).toContain("/home/user/.wave/cli/desktop.new");
  });

  it("falls back to the running old daemon and notifies when the push fails", async () => {
    h.spawn.mockImplementation(() => makePushChild(1)); // ssh push fails
    const notice = vi.fn();
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      RUNTIME_INSTALLED,
      { stdout: `${STALE_HASH}\n` }, // stale → push attempt fails
      { stdout: "" }, // old daemon still alive → reuse
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE, notice)).resolves.toBe(
      "/home/user/.wave/daemon.sock",
    );
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("同步失败"));
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("重新连接主机自动重试"),
    );
    const pkill = h.execFile.mock.calls.find((c) =>
      ((c[1] as string[]).at(-1) as string).includes("pkill"),
    );
    expect(pkill).toBeUndefined(); // failed push must not kill the old daemon
  });

  it("surfaces an actionable error when the CLI cannot be pushed to a dead host", async () => {
    h.spawn.mockImplementation(() => makePushChild(1)); // the bundle push fails
    const notice = vi.fn();
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      RUNTIME_INSTALLED,
      { error: new Error("no such file") }, // hash probe → missing
      { error: new Error("ECONNREFUSED") }, // alive check → dead
      RUNTIME_INSTALLED, // fallback resolve: runtime probe
      { error: new Error("no such file") }, // fallback resolve: still no CLI
    ]);
    await expect(ensureRemoteDaemon("prod", SOURCE, notice)).rejects.toThrow(
      "远端未安装 wave CLI",
    );
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("同步失败"));
    expect(h.spawn).toHaveBeenCalledTimes(1); // the push was attempted
  });
});

describe("readRemoteFile", () => {
  const base64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("parses a text payload with headers, total lines and truncation flag", async () => {
    const content = "line1\nline2\nline3\n";
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `WAVE_REMOTE_FILE_V1\ntype=text\nmime=text/plain\ntotal=3\ntruncated=0\n${base64(content)}\n`,
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/readme.md");
    expect(result).toEqual({
      type: "text",
      mime: "text/plain",
      totalLines: 3,
      truncated: false,
      contentBase64: base64(content),
    });
    expect(
      Buffer.from(result.contentBase64 ?? "", "base64").toString("utf8"),
    ).toBe(content);
  });

  it("strips OSC markers before matching the V1 header", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `${OSC1337_PREFIX}WAVE_REMOTE_FILE_V1\ntype=text\nmime=text/plain\ntotal=1\ntruncated=0\n${base64("hi\n")}\n`,
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/a.md");
    expect(result).toEqual({
      type: "text",
      mime: "text/plain",
      totalLines: 1,
      truncated: false,
      contentBase64: base64("hi\n"),
    });
  });

  it("skips a login-shell banner before the V1 header", async () => {
    // WSL first-login banner (and any shell that prints an rc banner) precedes
    // the payload on stdout; the header is the anchor, not line 0.
    stubExec([
      LOGIN_SHELL,
      {
        stdout:
          'To run a command as administrator (user "root"), use "sudo <command>".\n' +
          `See "man sudo_root" for details.\n\nWAVE_REMOTE_FILE_V1\ntype=text\nmime=text/plain\ntotal=1\ntruncated=0\n${base64("hi\n")}\n`,
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/a.md");
    expect(result).toEqual({
      type: "text",
      mime: "text/plain",
      totalLines: 1,
      truncated: false,
      contentBase64: base64("hi\n"),
    });
  });

  it("marks the payload truncated when the header says so", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `WAVE_REMOTE_FILE_V1\ntype=text\nmime=text/plain\ntotal=5000\ntruncated=1\n${base64("head\n")}\n`,
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/huge.log");
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(5000);
  });

  it("returns base64 image bytes for image mimes", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `WAVE_REMOTE_FILE_V1\ntype=image\nmime=image/png\ntotal=-\ntruncated=-\naGVsbG8=\n`,
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/pic.png");
    expect(result).toEqual({
      type: "image",
      mime: "image/png",
      imageBase64: "data:image/png;base64,aGVsbG8=",
    });
  });

  it("returns binary with no payload", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout:
          "WAVE_REMOTE_FILE_V1\ntype=binary\nmime=application/octet-stream\ntotal=-\ntruncated=-\n\n",
      },
    ]);
    const result = await readRemoteFile("prod", "/home/user/app.bin");
    expect(result).toEqual({
      type: "binary",
      mime: "application/octet-stream",
    });
  });

  it("throws 文件不存在 on exit code 3", async () => {
    const err = new Error("文件不存在") as Error & { code?: number };
    err.code = 3;
    stubExec([LOGIN_SHELL, { error: err }]);
    await expect(readRemoteFile("prod", "/gone/file.ts")).rejects.toThrow(
      "远端文件不存在：/gone/file.ts",
    );
  });

  it("throws 文件不可读 on exit code 4", async () => {
    const err = new Error("文件不可读") as Error & { code?: number };
    err.code = 4;
    stubExec([LOGIN_SHELL, { error: err }]);
    await expect(readRemoteFile("prod", "/secret/file.ts")).rejects.toThrow(
      "远端文件不可读：/secret/file.ts",
    );
  });

  it("throws a user-facing error when the ssh connection fails", async () => {
    stubExec([LOGIN_SHELL, { error: CONNECT_FAIL }]);
    await expect(readRemoteFile("prod", "/x/y.ts")).rejects.toThrow(
      "读取远端文件失败：ssh: connect to host failed",
    );
  });

  it("rejects an unrecognized response", async () => {
    stubExec([LOGIN_SHELL, { stdout: "ls: cannot access /x: No such file\n" }]);
    await expect(readRemoteFile("prod", "/x/y.ts")).rejects.toThrow(
      "远端返回了无法识别的响应",
    );
  });

  it("builds the read command with ~ expansion, size caps and the V1 header", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `WAVE_REMOTE_FILE_V1\ntype=text\nmime=text/plain\ntotal=1\ntruncated=0\n${base64("a\n")}\n`,
      },
    ]);
    await readRemoteFile("prod", "~/notes/a.md");
    const args = h.execFile.mock.calls[1][1] as string[];
    const cmd = args[args.length - 1] as string;
    expect(cmd).toContain("~/notes/a.md");
    expect(cmd).toContain("WAVE_REMOTE_FILE_V1");
    // `${p#'~'}` survives as a plain shell parameter expansion (its quotes are
    // escaped by the outer shellQuote wrapper) — template interpolation would
    // have failed at compile time instead.
    expect(cmd).toContain("${p#");
    expect(cmd).toContain(
      `head -c ${REMOTE_FILE_MAX_BYTES} "$p" | head -n ${REMOTE_FILE_MAX_LINES}`,
    );
  });

  it("probes mime through a file flag fallback chain and maps image extensions", async () => {
    stubExec([
      LOGIN_SHELL,
      {
        stdout: `WAVE_REMOTE_FILE_V1\ntype=image\nmime=image/png\ntotal=-\ntruncated=-\naGVsbG8=\n`,
      },
    ]);
    await readRemoteFile("prod", "/home/user/pic.png");
    const args = h.execFile.mock.calls[1][1] as string[];
    const cmd = args[args.length - 1] as string;
    // Some file builds reject -I/-i, others reject --mime-type — try in order.
    expect(cmd).toContain("file -b --mime-type");
    expect(cmd).toContain("file -b -I");
    expect(cmd).toContain("file -b -i");
    // When `file` is missing entirely, common image extensions still count.
    expect(cmd).toContain("png) mime=image/png");
    expect(cmd).toContain("svg) mime=image/svg+xml");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
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
  REMOTE_FILE_MAX_LINES,
  REMOTE_FILE_MAX_BYTES,
  REMOTE_NODE_MIN_MAJOR,
  ensureRemoteCliUpToDate,
  ensureRemoteDaemon,
  killRemoteDaemon,
  remoteCliShimPath,
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

type StubResult = { stdout?: string; error?: Error };

/** Login shell probe (`echo $SHELL`) precedes every remote probe command. */
const LOGIN_SHELL: StubResult = { stdout: "/bin/bash" };

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

/** The last remote command passed to the (mocked) `ssh` spawn for the push. */
function pushCommand(): string {
  const calls = h.spawn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][1] as string[]).at(-1) as string;
}

describe("resolveRemoteWaveBinary (fixed pushed-shim path)", () => {
  it("returns the fixed shim path + node version when the CLI is installed", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "v22.3.0" }, // node -v
      { stdout: `${BUNDLE_HASH}\n` }, // remote bundle sha256 == bundled
    ]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info).toEqual({
      binaryPath: remoteCliShimPath(HOME),
      nodeVersion: "v22.3.0",
    });
    expect(h.spawn).not.toHaveBeenCalled();
    // The content probe hashes the pushed bundle at the fixed dir, never PATH.
    const remoteCmd = (h.execFile.mock.calls[2][1] as string[]).at(
      -1,
    ) as string;
    expect(remoteCmd).toContain("node -e");
    expect(remoteCmd).toContain(".wave/cli/desktop");
    expect(remoteCmd).toContain("dist/bundle/wave.mjs");
  });

  it("strips OSC shell-integration markers from probe output", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: `${OSC1337_PREFIX}v22.23.2\n` },
      { stdout: `${OSC1337_PREFIX}${BUNDLE_HASH}\n` },
    ]);
    const info = await resolveRemoteWaveBinary("prod", SOURCE, HOME);
    expect(info.nodeVersion).toBe("v22.23.2");
    expect(info.binaryPath).toBe(remoteCliShimPath(HOME));
  });

  it("throws an actionable error when node is missing", async () => {
    stubExec([LOGIN_SHELL, { error: CONNECT_FAIL }]);
    await expect(resolveRemoteWaveBinary("prod", SOURCE, HOME)).rejects.toThrow(
      "未检测到 Node.js",
    );
  });

  it("throws when node is too old", async () => {
    stubExec([LOGIN_SHELL, { stdout: "v18.0.0" }]);
    await expect(resolveRemoteWaveBinary("prod", SOURCE, HOME)).rejects.toThrow(
      `需要 ≥ ${REMOTE_NODE_MIN_MAJOR}`,
    );
  });

  it("pushes the bundled CLI (rg self-fetch + tar over ssh) when missing", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "v22.0.0" }, // node -v
      { error: new Error("no such file") }, // hash probe → missing/corrupt
      { stdout: "" }, // rg ready probe — already in place
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
      { stdout: "v22.0.0" },
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
      { stdout: "v22.0.0" },
      { stdout: `${BUNDLE_HASH}\n` }, // remote sha256 == bundled → up to date
    ]);
    const result = await ensureRemoteCliUpToDate("prod", SOURCE, HOME);
    expect(result).toEqual({
      binaryPath: remoteCliShimPath(HOME),
      upgraded: false,
    });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("pushes via an atomic .new swap when the remote bytes differ (scenario 7: changed bytes push)", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "v22.0.0" },
      { stdout: `${STALE_HASH}\n` }, // bytes differ → sync
      { stdout: "" }, // rg ready probe
    ]);
    const result = await ensureRemoteCliUpToDate("prod", SOURCE, HOME);
    expect(result).toEqual({
      binaryPath: remoteCliShimPath(HOME),
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
      { stdout: "v22.0.0" },
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
  it("reuses a live daemon when the CLI bytes match (no push, no restart)", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" }, // echo $HOME
      { stdout: "v22.0.0" }, // node -v
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
      { stdout: "v22.0.0" },
      { stdout: `${STALE_HASH}\n` }, // hash probe != bundle → push
      { stdout: "" }, // rg ready probe
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
    expect(commands.some((c) => c.includes("nohup"))).toBe(true);
  });

  it("pushes onto a fresh host (no CLI) and launches the daemon", async () => {
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      { stdout: "v22.0.0" },
      { error: new Error("no such file") }, // hash probe → missing
      { stdout: "" }, // rg ready probe
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

  it("falls back to the running old daemon and notifies when the push fails", async () => {
    h.spawn.mockImplementation(() => makePushChild(1)); // ssh push fails
    const notice = vi.fn();
    stubExec([
      LOGIN_SHELL,
      { stdout: "/home/user" },
      { stdout: "v22.0.0" },
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
      { stdout: "v22.0.0" },
      { error: new Error("no such file") }, // hash probe → missing
      { error: new Error("ECONNREFUSED") }, // alive check → dead
      { stdout: "v22.0.0" }, // fallback resolve: node -v
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

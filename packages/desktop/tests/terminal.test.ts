import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

/**
 * TerminalManager unit tests — node-pty is mocked (the real native module is
 * covered by terminalPty.smoke.test.ts). terminal.ts caches the loaded pty
 * module at module scope, so each test resets modules and re-imports.
 */

interface MockProc {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  dataCb: null | ((data: string) => void);
  exitCb: null | ((e: { exitCode: number }) => void);
}

const h = vi.hoisted(() => ({
  procs: [] as MockProc[],
  spawn: vi.fn(),
  spawnError: null as Error | null,
  // Hoisted so the mock survives the per-test `vi.resetModules()`: a factory
  // creating a fresh vi.fn each time would be unreachable from the tests.
  existsSync: vi.fn((_file: string) => true),
}));

vi.mock("node-pty", () => ({
  spawn: h.spawn,
}));

vi.mock("fs", () => ({
  existsSync: h.existsSync,
}));

function makeProc() {
  const proc = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    dataCb: null as null | ((data: string) => void),
    exitCb: null as null | ((e: { exitCode: number }) => void),
    onData(cb: (data: string) => void) {
      proc.dataCb = cb;
      return {
        dispose: vi.fn(() => {
          proc.dataCb = null;
        }),
      };
    },
    onExit(cb: (e: { exitCode: number }) => void) {
      proc.exitCb = cb;
      return {
        dispose: vi.fn(() => {
          proc.exitCb = null;
        }),
      };
    },
  };
  h.procs.push(proc);
  return proc;
}

async function freshManager() {
  vi.resetModules();
  const { TerminalManager } = await import("../src/main/terminal");
  const callbacks = { onData: vi.fn(), onExit: vi.fn() };
  return { manager: new TerminalManager(callbacks), callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.procs = [];
  h.spawnError = null;
  h.existsSync.mockImplementation(() => true);
  h.spawn.mockImplementation(() => {
    if (h.spawnError) throw h.spawnError;
    return makeProc();
  });
  process.env.SHELL = "/bin/test-shell";
});

afterEach(() => {
  delete process.env.SHELL;
});

describe("TerminalManager", () => {
  it("spawns the user default shell as a login shell with terminal env", async () => {
    const { manager } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24, "pane-1");
    // defaultShell(): $SHELL login shell on POSIX; PowerShell on Windows.
    const [file, args] =
      process.platform === "win32"
        ? (["powershell.exe", []] as const)
        : (["/bin/test-shell", ["-l"]] as const);
    expect(h.spawn).toHaveBeenCalledWith(file, args, {
      name: "xterm-256color",
      cwd: "/work/a",
      cols: 80,
      rows: 24,
      env: expect.objectContaining({
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      }),
    });
  });

  it("spawns an ssh PTY bridge for remote hosts with -t and the quoted remote cwd", async () => {
    const { manager } = await freshManager();
    await manager.create("term-1", "/remote/proj", 100, 30, "pane-1", "myhost");
    expect(h.spawn).toHaveBeenCalledWith(
      process.platform === "win32" ? expect.stringMatching(/ssh\.exe$/) : "ssh",
      [
        "-t",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=15",
        "myhost",
        "cd '/remote/proj' && exec \"${SHELL:-/bin/bash}\" -l",
      ],
      expect.objectContaining({
        name: "xterm-256color",
        cwd: expect.any(String),
        cols: 100,
        rows: 30,
        env: expect.objectContaining({
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        }),
      }),
    );
  });

  it("shell-quotes remote cwds containing quotes", async () => {
    const { manager } = await freshManager();
    await manager.create(
      "term-1",
      "/remote/it's dir",
      80,
      24,
      "pane-1",
      "myhost",
    );
    expect(h.spawn).toHaveBeenCalledWith(
      process.platform === "win32" ? expect.stringMatching(/ssh\.exe$/) : "ssh",
      expect.arrayContaining([
        "cd '/remote/it'\\''s dir' && exec \"${SHELL:-/bin/bash}\" -l",
      ]),
      expect.anything(),
    );
  });

  /**
   * node-pty resolves a relative filename on Windows by appending it to every
   * `Path` entry *without* PATHEXT (node-pty 1.2 `path_util::get_shell_path`),
   * so a bare `ssh` matches nothing and the panel dies with
   * `File not found: ` before ssh is even started. These cases pin Windows
   * instead of letting a Linux CI run pass them as POSIX `ssh`.
   */
  describe("ssh executable on Windows", () => {
    const realPlatform = process.platform;
    const realPathVar = process.env.Path;
    const realSystemRoot = process.env.SystemRoot;

    function pinWindows(pathVar: string, systemRoot = "C:\\Windows"): void {
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });
      process.env.Path = pathVar;
      process.env.SystemRoot = systemRoot;
    }

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: realPlatform,
        configurable: true,
      });
      if (realPathVar === undefined) delete process.env.Path;
      else process.env.Path = realPathVar;
      if (realSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = realSystemRoot;
    });

    async function sshSpawnFile(): Promise<string> {
      const { manager } = await freshManager();
      await manager.create(
        "term-1",
        "/remote/proj",
        80,
        24,
        "pane-1",
        "myhost",
      );
      return h.spawn.mock.calls[0][0] as string;
    }

    it("uses the ssh.exe found on Path, the one the user's own terminal runs", async () => {
      const fromPath = path.win32.join("C:\\Program Files\\OpenSSH", "ssh.exe");
      pinWindows(["C:\\tools", "C:\\Program Files\\OpenSSH"].join(";"));
      h.existsSync.mockImplementation((file) => file === fromPath);

      expect(await sshSpawnFile()).toBe(fromPath);
    });

    it("falls back to the ssh.exe Windows ships when Path has none", async () => {
      const shipped = path.win32.join(
        "C:\\Windows",
        "System32",
        "OpenSSH",
        "ssh.exe",
      );
      pinWindows("C:\\tools");
      h.existsSync.mockImplementation((file) => file === shipped);

      expect(await sshSpawnFile()).toBe(shipped);
    });
  });

  it("relays pty data and exit events through the callbacks", async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24);
    const proc = h.procs[0];
    proc.dataCb?.("hello");
    expect(callbacks.onData).toHaveBeenCalledWith("term-1", "hello");
    proc.exitCb?.({ exitCode: 3 });
    expect(callbacks.onExit).toHaveBeenCalledWith("term-1", { exitCode: 3 });
  });

  it("write and resize forward to the live process", async () => {
    const { manager } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24);
    manager.write("term-1", "ls\n");
    manager.resize("term-1", 120, 40);
    expect(h.procs[0].write).toHaveBeenCalledWith("ls\n");
    expect(h.procs[0].resize).toHaveBeenCalledWith(120, 40);
  });

  it("write/resize on an unknown termId are no-ops", async () => {
    const { manager } = await freshManager();
    manager.write("nope", "x");
    manager.resize("nope", 1, 1);
    manager.kill("nope");
  });

  it("kill is silent: no exit event reaches the webview", async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24);
    const proc = h.procs[0];
    manager.kill("term-1");
    expect(proc.kill).toHaveBeenCalled();
    // Listeners were disposed before the kill — a late exit is swallowed.
    proc.exitCb?.({ exitCode: 0 });
    expect(callbacks.onExit).not.toHaveBeenCalled();
  });

  it("create on a live termId reattaches: resize + scrollback replay, no respawn", async () => {
    const { manager, callbacks } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24, "pane-1");
    const first = h.procs[0];
    first.dataCb?.("some output");
    callbacks.onData.mockClear();
    await manager.create("term-1", "/work/a", 120, 40, "pane-2");
    expect(first.kill).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(first.resize).toHaveBeenCalledWith(120, 40);
    // Buffered scrollback replays so a remounted xterm restores its content.
    expect(callbacks.onData).toHaveBeenCalledWith("term-1", "some output");
    // A real exit after reattach still reaches the webview.
    first.exitCb?.({ exitCode: 0 });
    expect(callbacks.onExit).toHaveBeenCalledWith("term-1", { exitCode: 0 });
  });

  it("killForPane kills only the terminals owned by that pane", async () => {
    const { manager } = await freshManager();
    await manager.create("term-a", "/w", 80, 24, "pane-1");
    await manager.create("term-b", "/w", 80, 24, "pane-2");
    manager.killForPane("pane-1");
    expect(h.procs[0].kill).toHaveBeenCalled();
    expect(h.procs[1].kill).not.toHaveBeenCalled();
  });

  it("killAll tears every terminal", async () => {
    const { manager } = await freshManager();
    await manager.create("term-a", "/w", 80, 24);
    await manager.create("term-b", "/w", 80, 24);
    manager.killAll();
    expect(h.procs[0].kill).toHaveBeenCalled();
    expect(h.procs[1].kill).toHaveBeenCalled();
  });

  it("reports a spawn failure via onExit with an error message", async () => {
    h.spawnError = new Error("posix_spawnp failed");
    const { manager, callbacks } = await freshManager();
    await manager.create("term-1", "/work/a", 80, 24);
    expect(callbacks.onExit).toHaveBeenCalledWith("term-1", {
      error: expect.stringContaining("posix_spawnp failed"),
    });
  });

  it("reports a node-pty load failure via onExit and caches it", async () => {
    vi.resetModules();
    vi.doMock("node-pty", () => {
      throw new Error("native binding missing");
    });
    const { TerminalManager } = await import("../src/main/terminal");
    const callbacks = { onData: vi.fn(), onExit: vi.fn() };
    const manager = new TerminalManager(callbacks);
    await manager.create("term-1", "/w", 80, 24);
    await manager.create("term-2", "/w", 80, 24);
    expect(callbacks.onExit).toHaveBeenCalledTimes(2);
    expect(callbacks.onExit).toHaveBeenCalledWith("term-1", {
      error: expect.stringContaining("终端组件加载失败"),
    });
    expect(h.spawn).not.toHaveBeenCalled();
    vi.doMock("node-pty", () => ({ spawn: h.spawn }));
  });
});

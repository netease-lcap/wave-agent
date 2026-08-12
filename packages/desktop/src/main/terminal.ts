/**
 * PTY terminal service for the terminal panel. Spawns the user's
 * default login shell via node-pty, keyed by a webview-supplied termId (one per
 * pane). node-pty is a native module loaded lazily — a load failure must surface
 * as a panel-local error without affecting anything else.
 *
 * Intentional kills (pane close, session switch, restart, quit) are silent:
 * listeners are detached before killing so the webview only sees exit events
 * for unexpected deaths / spawn failures.
 */

import * as fs from "fs";
import * as os from "os";
import { buildSshSpawnArgs, LOCAL_HOST, shellQuote } from "./sshHosts";

export interface TerminalExitInfo {
  exitCode?: number;
  error?: string;
}

interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void };
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cwd: string;
      cols: number;
      rows: number;
      env: Record<string, string>;
    },
  ): PtyProcess;
}

let ptyModule: PtyModule | null | undefined; // undefined = not attempted yet
let ptyLoadError = "";

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = (await import("node-pty")) as unknown as PtyModule;
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err);
    ptyModule = null;
  }
  return ptyModule;
}

/** User default shell: $SHELL, then /bin/zsh, then /bin/bash; PowerShell on Windows. */
function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: [] };
  for (const candidate of [process.env.SHELL, "/bin/zsh", "/bin/bash"]) {
    if (candidate && fs.existsSync(candidate))
      return { file: candidate, args: ["-l"] };
  }
  return { file: "/bin/sh", args: ["-l"] };
}

/**
 * Remote command for the ssh PTY (spec scenario 13): jump to the remote cwd,
 * then exec the remote user's default login shell, falling back to /bin/bash
 * when $SHELL is unset. The string is expanded by the remote login shell.
 */
function remoteShellCommand(cwd: string): string {
  return `cd ${shellQuote(cwd)} && exec "\${SHELL:-/bin/bash}" -l`;
}

export interface TerminalManagerCallbacks {
  onData: (termId: string, data: string) => void;
  onExit: (termId: string, info: TerminalExitInfo) => void;
}

interface TerminalEntry {
  proc: PtyProcess;
  paneId?: string;
  disposables: Array<{ dispose(): void }>;
  /** Capped scrollback, replayed to a remounted xterm on reattach. */
  buffer: string;
}

/** Scrollback kept per PTY for reattach replay (~last 256 KB of output). */
const BUFFER_CAP_BYTES = 256 * 1024;

export class TerminalManager {
  private terminals = new Map<string, TerminalEntry>();

  constructor(private callbacks: TerminalManagerCallbacks) {}

  /**
   * Create the PTY for termId, or reattach to the live one: a remounted
   * terminal panel (pane moved across rows) re-sends create — keeping the PTY
   * alive preserves the shell session, so the existing process is resized to
   * the fresh grid and its scrollback replayed instead of respawned.
   * Local sessions spawn the user's default shell; remote sessions spawn
   * `ssh <host> -- <shell>` (a PTY bridge, same as VS Code Remote-SSH) with
   * the remote cwd applied inside the ssh command.
   * Failures report via onExit.
   */
  async create(
    termId: string,
    cwd: string,
    cols: number,
    rows: number,
    paneId?: string,
    host: string = LOCAL_HOST,
  ): Promise<void> {
    const existing = this.terminals.get(termId);
    if (existing) {
      try {
        existing.proc.resize(cols, rows);
      } catch {
        // PTY may be mid-teardown; a stale resize is harmless.
      }
      existing.paneId = paneId ?? existing.paneId;
      if (existing.buffer) this.callbacks.onData(termId, existing.buffer);
      return;
    }
    const pty = await loadPty();
    if (!pty) {
      this.callbacks.onExit(termId, {
        error: `终端组件加载失败：${ptyLoadError}`,
      });
      return;
    }
    const shell = defaultShell();
    const env = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    try {
      const proc =
        host === LOCAL_HOST
          ? pty.spawn(shell.file, shell.args, {
              name: "xterm-256color",
              cwd,
              cols,
              rows,
              env,
            })
          : // `-t` forces TTY allocation so the PTY's cols/rows and TERM reach
            // the remote shell. The ssh process itself runs locally — its cwd
            // is irrelevant (any existing directory works); the real working
            // directory is applied on the remote side by remoteShellCommand.
            pty.spawn(
              "ssh",
              ["-t", ...buildSshSpawnArgs(host, remoteShellCommand(cwd))],
              {
                name: "xterm-256color",
                cwd: os.homedir(),
                cols,
                rows,
                env,
              },
            );
      const entry: TerminalEntry = {
        proc,
        paneId,
        disposables: [],
        buffer: "",
      };
      entry.disposables.push(
        proc.onData((data) => {
          entry.buffer = (entry.buffer + data).slice(-BUFFER_CAP_BYTES);
          this.callbacks.onData(termId, data);
        }),
        proc.onExit(({ exitCode }) => {
          if (this.terminals.get(termId) !== entry) return; // replaced/killed silently
          this.terminals.delete(termId);
          this.callbacks.onExit(termId, { exitCode });
        }),
      );
      this.terminals.set(termId, entry);
    } catch (err) {
      this.callbacks.onExit(termId, {
        error: `终端启动失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  write(termId: string, data: string): void {
    this.terminals.get(termId)?.proc.write(data);
  }

  resize(termId: string, cols: number, rows: number): void {
    try {
      this.terminals.get(termId)?.proc.resize(cols, rows);
    } catch {
      // PTY may be mid-teardown; a stale resize is harmless.
    }
  }

  /** Silent kill — no exit event reaches the webview. */
  kill(termId: string): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;
    this.terminals.delete(termId);
    for (const d of entry.disposables) d.dispose();
    try {
      entry.proc.kill();
    } catch {
      // already dead
    }
  }

  killForPane(paneId: string): void {
    for (const [termId, entry] of [...this.terminals]) {
      if (entry.paneId === paneId) this.kill(termId);
    }
  }

  killAll(): void {
    for (const termId of [...this.terminals.keys()]) this.kill(termId);
  }
}

/**
 * The seam between a shell tool and the shell that actually runs a command.
 *
 * Today there is exactly one implementation (bash, `bashProvider.ts`); the
 * PowerShell tool lands on the same interface so the tool body stops caring
 * which shell it drives. What differs per shell is only *how the command
 * string is built and how the process is spawned* — permissions, output
 * decoding and CWD callbacks stay in the tool.
 */

/** The shells wave can drive. */
export type ShellType = "bash" | "powershell";

export interface ShellExecOptions {
  /**
   * Directory the CWD-tracking file goes in. A function because the sandbox
   * temp dir must be prepared (by the wrapper) before it can be asked for.
   */
  tempDir: () => string;
  /** false when the temp dir is not writable: run without CWD tracking. */
  cwdTracking: boolean;
}

export interface ShellExecCommand {
  /** The exact string handed to spawn (prologue already included). */
  commandString: string;
  /**
   * Native path of the file the shell writes its final CWD to. Always set, so
   * the caller can clean it up; the shell only writes it when `cwdTracking`
   * is true.
   */
  cwdFilePath: string;
}

export interface ShellProvider {
  type: ShellType;
  /** Absolute path of the shell binary. */
  shellPath: string;
  /** true when the shell must run in its own process group. */
  detached: boolean;
  /**
   * Shell-specific prologue that has to sit inside the command string (bash:
   * the search shadows from `utils/searchShell.ts`, which must survive the
   * sandbox wrapper's own `bash -c`).
   */
  prepareCommand(command: string): string;
  /** Final command string for spawn, plus the CWD file it may write. */
  buildExecCommand(command: string, opts: ShellExecOptions): ShellExecCommand;
  /**
   * Leading argv for the shell binary. Empty means "let the `shell` option of
   * spawn invoke it" (bash today); a PowerShell provider returns
   * `["-Command", …]`-style args and the caller spawns without a shell.
   */
  getSpawnArgs(commandString: string): string[];
  /** Env the shell itself needs, merged over the session env. */
  getEnvironmentOverrides(command: string): Record<string, string>;
}

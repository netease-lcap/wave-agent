import { spawnHidden } from "./execFileHidden.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** true when the process could not be run, or exited with a code outside 0/1. */
  error: boolean;
}

/**
 * Run a short-lived child process and collect its output.
 *
 * Shared by the search tools (Grep and Glob both shell out to ripgrep) so the
 * two cannot drift in how they spawn, decode or classify results. Exit code 1 is
 * not an error: `rg` uses it for "no matches", which is a normal answer to a
 * search. A `null` exit code is the only true spawn failure — the caller reads
 * `stderr` for the reason.
 *
 * `spawnHidden` (not `child_process.spawn`) because this is a spawn point like
 * any other: the wrapper forces `windowsHide` and keeps fd0 at /dev/null, which
 * is what `stdio` here already asks for.
 */
export function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawnHidden(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code,
        error: code !== 0 && code !== 1,
      });
    });

    child.on("error", (err) => {
      resolve({
        stdout,
        stderr: err.message,
        exitCode: null,
        error: true,
      });
    });
  });
}

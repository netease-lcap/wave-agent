/**
 * `execFile` / `execFileSync` with `windowsHide: true` forced in.
 *
 * Why this module exists
 * ----------------------
 * On Windows a child process that owns a console — which is what
 * `detached: true` gets it, and what `execFile` gets whenever the parent was
 * launched from a GUI (Electron main process, VS Code extension host) — opens a
 * real console window. A black `cmd` box flashing on every `git status` is the
 * user-visible symptom. The one switch that suppresses it is `windowsHide:
 * true`; it allocates the child without a console window at all.
 *
 * Node's `child_process` defaults `windowsHide` to **false**. `execa` defaults
 * it to **true**, which is why Claude Code never has to think about it — this
 * repo uses raw `child_process`, so every single call site is one forgotten key
 * away from bringing the flashing window back. Remembering is not a strategy:
 * a new `git rev-parse` here, a new `where git` there, and the bug is back with
 * no test to notice it.
 *
 * So every `git` / `where` / any other short-lived child process in the SDK and
 * the CLI goes through this wrapper. Two hard rules keep it honest:
 *
 * 1. `windowsHide: true` is spread **after** the caller's options, so a caller
 *    cannot opt out (`{ windowsHide: false }` is overwritten). That is the whole
 *    point — the guarantee must not depend on the call site.
 * 2. Nothing else is added or defaulted. `cwd` / `env` / `timeout` / `stdio` /
 *    `maxBuffer` / `encoding` and the resulting return types behave exactly as
 *    `child_process` does, so migrating a call site is a rename, not a rewrite.
 *
 * Long-lived / streaming processes (a Bash tool command, a background task, the
 * daemon it re-execs) do NOT belong here: they set their own spawn options and
 * simply pass `windowsHide: true` themselves.
 *
 * Never `promisify` a wrapper from this module
 * -------------------------------------------
 * `execFile` carries `util.promisify.custom`, so `promisify(execFile)` resolves
 * `{ stdout, stderr }`. That symbol lives on the original function; a plain
 * wrapper does not inherit it, and `promisify` silently falls back to the
 * generic error-first form, which resolves the callback's *first* success value
 * — a bare `stdout` string (or `undefined` when there is no output). Eight call
 * sites destructured `{ stdout }` off that and got `undefined` with no error,
 * which is exactly the class of bug this file exists to prevent. Need a promise
 * form? Use `execFileAsyncHidden` below, which is hand-written around the
 * callback for this reason.
 *
 * Imported as a namespace and dereferenced at call time on purpose: tests stub
 * `node:child_process` with `vi.mock` factories that only cover the half they
 * exercise (`execFileSync`, say). A named import would be read during module
 * evaluation and fail the whole file, even for tests that never spawn anything
 * asynchronously. The wrapper still calls the mocked function, so
 * `tests/utils/execFileHidden.test.ts` can assert the forced option arrives.
 */
import * as childProcess from "node:child_process";
import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptions,
  ExecFileSyncOptions,
} from "node:child_process";

type NodeStyleCallback = (
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

/**
 * What node's own `util.promisify.custom` attaches before rejecting: the
 * `ExecFileException` it hands to the callback declares `stdout` / `stderr` as
 * `string`, which is wrong for the `encoding: "buffer"` case — hence the
 * widening (and the `Omit`, so the two declarations do not intersect into
 * `string & Buffer`).
 */
type ExecFileFailure = Omit<ExecFileException, "stdout" | "stderr"> & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

type ArgsOrOptions =
  | string[]
  | ExecFileOptions
  | NodeStyleCallback
  | null
  | undefined;

/**
 * `execFile` as this module calls it: options are always present (we add one)
 * and the callback is optional. `child_process`'s own overload for that shape
 * declares the callback as required-but-nullable, hence the cast.
 */
type ExecFileCall = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback?: NodeStyleCallback,
) => ChildProcess;

function execFileHiddenImpl(
  file: string,
  argsOrOptions?: ArgsOrOptions,
  optionsOrCallback?: ExecFileOptions | NodeStyleCallback | null,
  maybeCallback?: NodeStyleCallback,
): ChildProcess {
  // Mirror `execFile`'s overloads: options may sit in the args slot, and the
  // callback may be the 3rd or the 4th argument.
  let args: readonly string[] = [];
  let options: ExecFileOptions | undefined;
  let callback: NodeStyleCallback | undefined = maybeCallback;

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    } else {
      options = optionsOrCallback ?? undefined;
    }
  } else if (typeof argsOrOptions === "function") {
    callback = argsOrOptions;
  } else if (argsOrOptions) {
    options = argsOrOptions;
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    }
  }

  // Spread first, force after: the caller's `windowsHide` never wins.
  const forced: ExecFileOptions = { ...options, windowsHide: true };
  const run = childProcess.execFile as unknown as ExecFileCall;

  return callback ? run(file, args, forced, callback) : run(file, args, forced);
}

function execFileSyncHiddenImpl(
  file: string,
  argsOrOptions?: readonly string[] | ExecFileSyncOptions | null,
  maybeOptions?: ExecFileSyncOptions | null,
): string | Buffer {
  const hasArgs = Array.isArray(argsOrOptions);
  const args: readonly string[] = hasArgs ? argsOrOptions : [];
  const options = (hasArgs ? maybeOptions : argsOrOptions) ?? undefined;

  // Spread first, force after: the caller's `windowsHide` never wins.
  return childProcess.execFileSync(file, args, {
    ...options,
    windowsHide: true,
  });
}

/**
 * `child_process.execFile` with `windowsHide: true` forced. Same overloads and
 * same return type as the original — but *not* the same `promisify.custom`, so
 * do not `promisify` it (see the module doc); use `execFileAsyncHidden`.
 */
export const execFileHidden =
  execFileHiddenImpl as unknown as typeof childProcess.execFile;

/**
 * `child_process.execFileSync` with `windowsHide: true` forced. Same overloads
 * and same `string` / `Buffer` return inference as the original.
 */
export const execFileSyncHidden =
  execFileSyncHiddenImpl as unknown as typeof childProcess.execFileSync;

/** Callback-shaped `execFile` that always carries our forced options. */
const execFileWithCallback = execFileHidden as unknown as ExecFileCall;

/**
 * Promise form of `execFileHidden`, written by hand around the callback.
 *
 * `promisify(execFileHidden)` looks like the same thing and is not: the wrapper
 * has no `promisify.custom`, so the generic error-first path resolves
 * `stdout` alone and `const { stdout } = await ...` yields `undefined` instead
 * of failing loudly.
 *
 * Return types follow `child_process` itself: `execFile` defaults `encoding` to
 * `'utf8'`, so stdout/stderr are strings unless the caller asks for
 * `"buffer"` / `null`. A call site that omits `encoding` still gets a string at
 * runtime, and the types say that now rather than claiming `Buffer`.
 *
 * Deliberately unlike Claude Code's `execFileNoThrow`: that one resolves on
 * non-zero exits (`{ stdout, stderr, code, error? }`) and every call site
 * branches on `code`. All of wave's call sites are `try` / `catch`, so keeping
 * reject-on-error is both the smaller change and the behaviour they already
 * assume. Flipping the convention would mean rewriting the error handling of
 * every one of them for no user-visible gain.
 *
 * The rejection is the **original** error, never a re-wrapped one, but it is
 * not handed back untouched: node's `ExecFileException` carries `code` /
 * `killed` / `signal` and **no** `stdout` / `stderr`. `util.promisify.custom`
 * attaches the two stream values before rejecting, and so does this — otherwise
 * `GitService.handleGitError`, which reads `error.stderr` to tell "repository
 * does not exist" from "authentication failed" from "rate limited", silently
 * degrades to a generic "Git operation failed".
 */
export function execFileAsyncHidden(
  file: string,
  args: readonly string[],
  options: ExecFileOptions & { encoding: "buffer" | null },
): Promise<{ stdout: Buffer; stderr: Buffer }>;
export function execFileAsyncHidden(
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }>;
export function execFileAsyncHidden(
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    execFileWithCallback(file, args, options ?? {}, (error, stdout, stderr) => {
      if (error) {
        // `util.promisify.custom` does exactly this; node's own error does not
        // carry the streams. `GitService.handleGitError` reads `error.stderr`
        // to classify the failure, so dropping them degrades every git error
        // message to the generic branch.
        const failure = error as ExecFileFailure;
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * `parsePowerShellCommand(command)` — ask the real PowerShell parser what a
 * command means, once per distinct command string.
 *
 * Shape of a call: length gate → resolve the binary → `-EncodedCommand` →
 * JSON on stdout → `transform.ts`. Failures are *results*, never exceptions:
 * `valid: false` with one of `PowerShellParseErrorId`, which every caller
 * treats as "ask the user". Nothing here decides danger.
 *
 * Two properties this module has to keep:
 *
 * - **Never spawn twice for the same command.** A warm parse costs ~0.6-0.7 s on
 *   Windows PowerShell 5.1; a turn re-checks the same `git status` on every
 *   tool call. The LRU is keyed on the exact command string.
 * - **Never cache a broken transport.** A timeout or a spawn failure says
 *   something about this moment (cold start, antivirus, a loaded machine), not
 *   about the command, so those entries are evicted as soon as they settle and
 *   the next call tries again.
 */

import { execFileAsyncHidden } from "../execFileHidden.js";
import { getPowerShellPath } from "../shell/powershellDetection.js";
import {
  MAX_PARSE_COMMAND_BYTES,
  buildParseScript,
  toUtf16LeBase64,
} from "./parseScript.js";
import { transformRawOutput } from "./transform.js";
import {
  ParsedPowerShellCommand,
  RawParsedOutput,
  PowerShellParseErrorId,
} from "./types.js";

/**
 * Kill the parser after this long. Measured warm parse on Windows PowerShell
 * 5.1 is ~0.6-0.7 s, so 5 s leaves room for a cold, antivirus-watched start
 * without letting a wedged process hold the permission check.
 */
export const DEFAULT_PARSE_TIMEOUT_MS = 5000;

/**
 * One retry, on timeout only. Windows cold starts are spiky (first spawn in a
 * session, or a CI box under load) and the second attempt usually lands inside
 * the budget. Anything else — bad JSON, non-zero exit — would repeat exactly.
 */
const MAX_ATTEMPTS = 2;

/** Distinct commands kept. Well above one turn's worth of distinct commands. */
export const PARSE_CACHE_SIZE = 256;

/**
 * Longest command this parser accepts, in UTF-8 bytes. Re-exported because it
 * is a property of the gate in `parseImpl`: a caller that wants to explain a
 * `CommandTooLong` refusal should not have to reach into `parseScript.ts`.
 */
export { MAX_PARSE_COMMAND_BYTES };

/**
 * Error ids that describe the environment rather than the command, and so must
 * not be cached: the next call may succeed.
 */
const TRANSIENT_ERROR_IDS: ReadonlySet<string> = new Set([
  "PwshSpawnError",
  "PwshTimeout",
  "PwshError",
  "EmptyOutput",
  "InvalidJson",
]);

/** command → in-flight-or-settled parse. Insertion order is recency order. */
const cache = new Map<string, Promise<ParsedPowerShellCommand>>();

/** Whatever `execFile` rejected with, read defensively. */
interface ExecFailure {
  message?: string;
  code?: string | number | null;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

type Attempt =
  | { kind: "ok"; stdout: string }
  | { kind: "timeout" }
  | { kind: "spawn"; message: string }
  | { kind: "exit"; code: number | null; message: string };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A failure result. All of them mean "not parsed", i.e. "ask the user". */
function failure(
  command: string,
  errorId: PowerShellParseErrorId,
  message: string,
): ParsedPowerShellCommand {
  return {
    valid: false,
    errors: [{ message, errorId }],
    statements: [],
    variables: [],
    hasStopParsing: false,
    originalCommand: command,
  };
}

/**
 * One spawn. `execFileAsyncHidden` (not `spawn`) so the console window that
 * Windows would otherwise flash is suppressed — a permission check must not pop
 * a black window on every shell command.
 */
async function runOnce(shellPath: string, args: string[]): Promise<Attempt> {
  try {
    const { stdout } = await execFileAsyncHidden(shellPath, args, {
      timeout: DEFAULT_PARSE_TIMEOUT_MS,
      // A parse result is small, but a pathological command can produce a lot
      // of JSON; the default 1 MB is closer than it looks.
      maxBuffer: 8 * 1024 * 1024,
    });
    return { kind: "ok", stdout };
  } catch (error) {
    const failureInfo = error as ExecFailure;
    // A timeout arrives as `killed: true` / `SIGTERM` with `code: null` on
    // Windows; check it before `code`, which is also null there.
    if (failureInfo.killed === true || failureInfo.signal === "SIGTERM") {
      return { kind: "timeout" };
    }
    // String codes are node's own errno names: ENOENT, EACCES, …
    if (typeof failureInfo.code === "string") {
      return {
        kind: "spawn",
        message: describe(error) || failureInfo.code,
      };
    }
    const stderr = (failureInfo.stderr ?? "").trim();
    return {
      kind: "exit",
      code: typeof failureInfo.code === "number" ? failureInfo.code : null,
      message: stderr || describe(error),
    };
  }
}

async function parseImpl(command: string): Promise<ParsedPowerShellCommand> {
  if (command.trim().length === 0) {
    return failure(command, "NoInput", "empty command");
  }

  // UTF-8 bytes, not chars: the argv carries base64 of the UTF-8 encoding, so a
  // CJK command spends three bytes per character.
  const byteLength = Buffer.byteLength(command, "utf8");
  if (byteLength > MAX_PARSE_COMMAND_BYTES) {
    return failure(
      command,
      "CommandTooLong",
      `command is ${byteLength} bytes; the parser accepts at most ${MAX_PARSE_COMMAND_BYTES}`,
    );
  }

  const shellPath = getPowerShellPath();
  if (!shellPath) {
    return failure(
      command,
      "NoPowerShell",
      "no PowerShell binary found on PATH",
    );
  }

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-NoLogo",
    "-EncodedCommand",
    toUtf16LeBase64(buildParseScript(command)),
  ];

  let attempt: Attempt | undefined;
  for (let round = 1; round <= MAX_ATTEMPTS; round++) {
    attempt = await runOnce(shellPath, args);
    if (attempt.kind !== "timeout") break;
  }
  if (!attempt) {
    // Unreachable: MAX_ATTEMPTS >= 1. Kept total rather than asserted.
    return failure(command, "PwshError", "parser never ran");
  }

  if (attempt.kind === "timeout") {
    return failure(
      command,
      "PwshTimeout",
      `PowerShell parser timed out (${MAX_ATTEMPTS} × ${DEFAULT_PARSE_TIMEOUT_MS} ms)`,
    );
  }
  if (attempt.kind === "spawn") {
    return failure(
      command,
      "PwshSpawnError",
      `could not start ${shellPath}: ${attempt.message}`,
    );
  }
  if (attempt.kind === "exit") {
    return failure(
      command,
      "PwshError",
      `PowerShell parser exited with code ${attempt.code}: ${attempt.message}`,
    );
  }

  const stdout = attempt.stdout.trim();
  if (stdout.length === 0) {
    return failure(
      command,
      "EmptyOutput",
      "PowerShell parser produced no output",
    );
  }

  let raw: RawParsedOutput;
  try {
    raw = JSON.parse(stdout) as RawParsedOutput;
  } catch {
    return failure(
      command,
      "InvalidJson",
      `PowerShell parser output is not JSON: ${stdout.slice(0, 200)}`,
    );
  }
  if (!raw || typeof raw !== "object") {
    return failure(
      command,
      "InvalidJson",
      "PowerShell parser output is not an object",
    );
  }

  return transformRawOutput(raw, command);
}

/**
 * command → parse result, memoized (LRU by recency, `PARSE_CACHE_SIZE` entries).
 *
 * Never rejects: an unexpected throw is reported as `PwshError` (transient, so
 * it is not cached and a hiccup does not stick for the session).
 */
export function parsePowerShellCommand(
  command: string,
): Promise<ParsedPowerShellCommand> {
  const cached = cache.get(command);
  if (cached) {
    // Re-insert to mark it as most recently used.
    cache.delete(command);
    cache.set(command, cached);
    return cached;
  }

  const pending = parseImpl(command).catch((error: unknown) =>
    failure(
      command,
      "PwshError",
      `PowerShell parse failed: ${describe(error)}`,
    ),
  );

  cache.set(command, pending);
  if (cache.size > PARSE_CACHE_SIZE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  void pending.then((result) => {
    if (result.valid) return;
    if (!TRANSIENT_ERROR_IDS.has(result.errors[0]?.errorId ?? "")) return;
    // Only evict if this exact entry is still the one stored — a newer parse of
    // the same command must not be dropped by an older one settling late.
    if (cache.get(command) === pending) cache.delete(command);
  });

  return pending;
}

/** Test hook: forget every cached parse. */
export function resetPowerShellParserCache(): void {
  cache.clear();
}

/** Test hook: how many entries the cache holds (leak/eviction assertions). */
export function getPowerShellParserCacheSize(): number {
  return cache.size;
}

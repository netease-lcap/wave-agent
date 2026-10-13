/**
 * Dynamic OTLP export headers — run a configured command and use its stdout.
 *
 * Why a command instead of a static string: an OTLP intake that authenticates
 * with a platform-issued token (a token with a lifetime, revocable server
 * side) cannot be served by a `headers` map. A static token has to be written
 * into every machine's config (or baked into the distribution) and re-shipped
 * whenever it rotates, and the long-lived hosts (desktop, VS Code) would have
 * to restart — interrupting sessions — to pick the new one up.
 *
 * So the config names a *command*, its stdout is the header object, and the
 * result is cached with a TTL and re-read before every batch export. Aligned
 * with Claude Code's `otelHeadersHelper`.
 *
 * Credential discipline: stdout **is** the credential. It never reaches a log
 * line, an audit trail, a span attribute or an error message — the failure log
 * carries the failure kind and the exit code only. stderr is kept on the error
 * object (for callers and tests) but is deliberately not logged either.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { HeadersProvider } from "../types/telemetry.js";
import { logger } from "../utils/globalLogger.js";
import { resolveShellPath } from "../utils/shellResolver.js";
import { toPosixCommand } from "../utils/windowsPaths.js";

/** How long a single helper run may take before it is killed. */
export const HEADERS_HELPER_TIMEOUT_MS = 30_000;

/**
 * How long a successful result stays fresh before the helper is re-run.
 * 29 minutes, matching Claude Code's default: the helper is called on the
 * first export after initialization and then at this interval, so a rotated
 * token is picked up within one interval without any restart.
 */
export const HEADERS_HELPER_REFRESH_MS = 1_740_000;

/** Env override for the refresh interval (milliseconds). */
export const HEADERS_HELPER_REFRESH_ENV =
  "WAVE_OTEL_HEADERS_HELPER_DEBOUNCE_MS";

/** Why a helper run produced no usable headers. */
export type HeadersHelperFailureKind =
  | "timeout"
  | "exit_code"
  | "killed"
  | "spawn_failed"
  | "empty_output"
  | "invalid_json"
  | "not_an_object"
  | "non_string_value";

/** A helper run that produced no usable header object. */
export class HeadersHelperError extends Error {
  readonly kind: HeadersHelperFailureKind;
  readonly exitCode?: number;
  /** The command's stderr — diagnostic context, never logged by this module. */
  readonly stderr?: string;

  constructor(
    kind: HeadersHelperFailureKind,
    message: string,
    options?: { exitCode?: number; stderr?: string },
  ) {
    super(message);
    this.name = "HeadersHelperError";
    this.kind = kind;
    this.exitCode = options?.exitCode;
    this.stderr = options?.stderr;
  }
}

export interface HeadersHelperOptions {
  /** Shell command whose stdout is a JSON object of headers. */
  command: string;
  /** Working directory for the helper process (default: `process.cwd()`). */
  cwd?: string;
  /** Environment for the helper process (default: `process.env`). */
  env?: Record<string, string>;
  /** Per-run timeout (default {@link HEADERS_HELPER_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Cache TTL override (default {@link HEADERS_HELPER_REFRESH_MS}). */
  refreshMs?: number;
  /**
   * Called on every run that fails differently from the previous one — the
   * rate limit that keeps a permanently broken helper from flooding the log.
   */
  onFailure?: (error: HeadersHelperError) => void;
}

interface HelperRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: Error;
}

/** Read the refresh interval, letting the env var override the default. */
function resolveRefreshMs(override?: number): number {
  if (override !== undefined) return override;
  const envValue = process.env[HEADERS_HELPER_REFRESH_ENV];
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return HEADERS_HELPER_REFRESH_MS;
}

/**
 * Run the helper command through a shell.
 *
 * The shell plumbing mirrors hook execution (Git Bash + POSIX path conversion
 * on Windows, `/bin/sh` elsewhere) so a command written for one place behaves
 * the same here. Windows without Git Bash falls back to `cmd.exe`, as hooks do.
 */
function runHelperCommand(
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
): Promise<HelperRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const isWindows = process.platform === "win32";
    const bashPath = isWindows ? resolveShellPath() : undefined;
    let shell: string;
    let shellFlag: string;
    let finalCommand: string;
    if (bashPath) {
      shell = bashPath;
      shellFlag = "-c";
      finalCommand = toPosixCommand(command);
    } else if (isWindows) {
      shell = "cmd.exe";
      shellFlag = "/c";
      finalCommand = command;
    } else {
      shell = "/bin/sh";
      shellFlag = "-c";
      finalCommand = command;
    }

    let child: ChildProcess;
    try {
      child = spawn(shell, [shellFlag, finalCommand], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
      });
    } catch (error) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        spawnError: error as Error,
      });
      return;
    }

    let forceKillHandle: NodeJS.Timeout | undefined;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillHandle = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000);
    }, options.timeoutMs);

    const settle = (result: HelperRunResult) => {
      clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
      resolve(result);
    };

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stdout?.on("error", () => {});
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.stderr?.on("error", () => {});

    child.on("error", (error: Error) => {
      settle({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: null,
        timedOut,
        spawnError: error,
      });
    });

    child.on("close", (code: number | null) => {
      // A child killed by a signal (including our own timeout kill) reports a
      // null exit code; `timedOut` tells the two apart.
      settle({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        timedOut,
      });
    });
  });
}

/** Turn a helper run into a header object, or throw {@link HeadersHelperError}. */
function parseHelperOutput(result: HelperRunResult): Record<string, string> {
  if (result.spawnError) {
    throw new HeadersHelperError(
      "spawn_failed",
      `could not be started: ${result.spawnError.message}`,
      { stderr: result.stderr },
    );
  }
  if (result.timedOut) {
    throw new HeadersHelperError("timeout", "timed out", {
      stderr: result.stderr,
    });
  }
  if (result.exitCode !== 0) {
    throw new HeadersHelperError(
      result.exitCode === null ? "killed" : "exit_code",
      result.exitCode === null
        ? "was killed"
        : `exited with code ${result.exitCode}`,
      { exitCode: result.exitCode ?? undefined, stderr: result.stderr },
    );
  }

  // stdout is the credential — keep it in this scope, never in a message.
  const output = result.stdout.trim();
  if (!output) {
    throw new HeadersHelperError(
      "empty_output",
      "did not write a header object to stdout",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new HeadersHelperError(
      "invalid_json",
      "did not write valid JSON to stdout",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HeadersHelperError(
      "not_an_object",
      "must write a JSON object of string key-value pairs",
    );
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      throw new HeadersHelperError(
        "non_string_value",
        `returned a non-string value for header "${key}" (${typeof value})`,
      );
    }
    headers[key] = value;
  }
  return headers;
}

/**
 * Build a {@link HeadersProvider} for a helper command.
 *
 * Behaviour:
 * - a fresh result (< refresh interval) is reused as-is;
 * - concurrent exporters share one in-flight run;
 * - a failing run **never** rejects and never stalls the export: the last
 *   successful headers are reused, and when there is none the provider returns
 *   an empty object so the static `headers` / `OTEL_EXPORTER_OTLP_HEADERS`
 *   still go out. The exporter contract is explicit that the headers factory
 *   must not throw — a rejection drops the whole batch;
 * - every failure that differs from the previous one is reported through
 *   `onFailure` and one warning, so a broken helper stays visible without
 *   flooding the log.
 *
 * Claude Code divides differently here: its helper throw makes the batch fail,
 * so a broken helper stops export entirely until it works again. Wave keeps the
 * link alive on the last known credential instead, since that credential is
 * usually still valid across a rotation.
 */
export function createHeadersHelperProvider(
  options: HeadersHelperOptions,
): HeadersProvider {
  const timeoutMs = options.timeoutMs ?? HEADERS_HELPER_TIMEOUT_MS;

  let cache: Record<string, string> | undefined;
  let cachedAt = 0;
  let inflight: Promise<Record<string, string>> | undefined;
  let lastFailure: HeadersHelperError | undefined;

  const report = (error: HeadersHelperError) => {
    if (lastFailure && lastFailure.message === error.message) {
      return;
    }
    lastFailure = error;
    const detail = [
      `kind=${error.kind}`,
      error.exitCode !== undefined ? `exit=${error.exitCode}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    logger.warn(
      cache
        ? `OTLP headers helper failed (${detail}); reusing the last headers it returned`
        : `OTLP headers helper failed (${detail}); exporting without dynamic headers`,
    );
    options.onFailure?.(error);
  };

  return async () => {
    if (cache && Date.now() - cachedAt < resolveRefreshMs(options.refreshMs)) {
      return cache;
    }
    if (inflight) {
      return inflight;
    }

    inflight = (async () => {
      try {
        const result = await runHelperCommand(options.command, {
          cwd: options.cwd,
          env: options.env,
          timeoutMs,
        });
        const headers = parseHelperOutput(result);
        cache = headers;
        cachedAt = Date.now();
        lastFailure = undefined;
        logger.debug("OTLP headers helper refreshed export headers", {
          keys: Object.keys(headers),
        });
        return headers;
      } catch (error) {
        const failure =
          error instanceof HeadersHelperError
            ? error
            : new HeadersHelperError("spawn_failed", String(error));
        report(failure);
        return cache ?? {};
      } finally {
        inflight = undefined;
      }
    })();

    return inflight;
  };
}

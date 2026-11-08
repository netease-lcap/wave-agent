/**
 * Login-shell environment adoption for GUI-launched VS Code
 * (spec: docs/specs/core/bash-tools.md「用户故事：登录 shell 环境注入」).
 *
 * VS Code started from Finder/Dock (macOS) or a desktop launcher (Linux)
 * inherits a bare environment without the user's nvm/homebrew/pnpm dirs, and on
 * Windows the Git Bash profile (~/.bashrc) is never sourced by the extension
 * host. Every non-PATH export of the user's profile (corporate proxy, custom
 * CA, `SSH_AUTH_SOCK`) is missing for the same reason.
 *
 * The probe itself lives in the SDK (`primeProcessEnvFromLoginShell`), which
 * owns the whole policy: the whitelist, the PATH merge, the retry budget with
 * exponential backoff, the Windows "Git Bash + PATH only" rule and the
 * "never throws" contract. This module is only the extension host's trigger for
 * it, so the extension and the desktop app cannot drift apart.
 *
 * Two callers share one promise:
 * - `extension.ts` fires it at activation, off the critical path, so the probe
 *   overlaps with the rest of activation instead of delaying it;
 * - `ChatProvider.init()` awaits it right before `wave --stdio` is spawned.
 *   `StdioClient` spawns with `{ ...process.env }`, and every Bash tool,
 *   background task, `!` command, MCP server and hook below that child inherits
 *   that same environment — the very first spawn is the one point where the
 *   environment has to be complete.
 *
 * The wait is bounded by the SDK module's own timeout + retry budget (2
 * attempts, 4s each, 200ms backoff), and the module never throws: a slow,
 * missing or broken login shell degrades to "keep the inherited environment"
 * plus one diagnostic line (验收场景 3).
 */

import {
  primeProcessEnvFromLoginShell,
  probeLoginShellEnv,
  _resetLoginShellEnvCacheForTesting,
  type LoginShellEnvOptions,
  type LoginShellEnvProbe,
} from "wave-agent-sdk/host";
import { hostLog } from "../hostLog";

/**
 * Same knobs as `primeProcessEnvFromLoginShell` — `target` is what tests point
 * at a throwaway object so they never mutate the real `process.env`.
 */
export type AdoptLoginShellEnvOptions = LoginShellEnvOptions & {
  target?: NodeJS.ProcessEnv;
  attempts?: number;
  backoffBaseMs?: number;
};

let priming: Promise<void> | undefined;

/**
 * Probe the user's login shell once and adopt the whitelisted subset (PATH
 * merged, other keys only when the host has not set them) into `process.env`.
 *
 * Idempotent and synchronous to *start*: repeated calls return the same
 * promise, so the later `await` from the spawn path never runs a second probe.
 * The promise never rejects — a failed probe resolves after logging once.
 */
export function adoptLoginPathIntoEnv(
  options: AdoptLoginShellEnvOptions = {},
): Promise<void> {
  priming ??= primeProcessEnvFromLoginShell(options)
    .then(({ adopted, error }) => {
      if (error !== undefined) {
        hostLog.warn(
          "[login-shell] probe failed; keeping the inherited environment:",
          error,
        );
        return;
      }
      // Key names only: the values routinely carry proxy credentials and
      // tokens, and vscode.log is the file users hand to support.
      hostLog.info(
        `[login-shell] adopted keys: ${adopted.length > 0 ? adopted.join(", ") : "(none)"}`,
      );
    })
    // The SDK module is documented never to reject; the catch keeps the promise
    // chain flat anyway, so the spawn path below cannot fail on a probe bug.
    .catch((thrown: unknown) => {
      hostLog.warn(
        "[login-shell] probe threw; keeping the inherited environment:",
        thrown,
      );
    });
  return priming;
}

/**
 * Probe the login shell environment without adopting it — a thin delegate, kept
 * for diagnostics/tests. The result is the SDK probe record, so the PATH is
 * `probe.env.PATH` (the old PATH-only string this module used to return).
 */
export function probeLoginPath(
  options: LoginShellEnvOptions = {},
): Promise<LoginShellEnvProbe> {
  return probeLoginShellEnv(options);
}

/** Reset the cached adoption (wrapper promise + SDK probe cache) — tests only. */
export function _resetLoginPathCacheForTesting(): void {
  priming = undefined;
  _resetLoginShellEnvCacheForTesting();
}

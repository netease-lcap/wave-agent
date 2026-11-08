/**
 * Desktop-side trigger for the one-shot login-shell environment probe
 * (spec: docs/specs/core/bash-tools.md「用户故事：登录 shell 环境注入」).
 *
 * GUI-launched apps (Finder/Spotlight on macOS, the Start menu on Windows) get
 * a bare environment: PATH misses nvm/Homebrew/Git Bash additions, and every
 * non-PATH export in the user's profile (corporate proxy, custom CA, API keys,
 * `SSH_AUTH_SOCK`) is absent. One probe at startup fixes both halves for every
 * child this process spawns — `wave --stdio`, and through it the Bash tool,
 * background tasks, `!` commands, MCP servers and hooks.
 *
 * Two callers share one promise:
 * - `index.ts` fires it when the app becomes ready, off the critical path, so
 *   the probe overlaps with the CLI binary sync and never delays the first
 *   window or frame;
 * - `DesktopHost.ensureClient()` awaits it right before the CLI child is
 *   spawned — the first (and only) point where the environment must be
 *   complete.
 *
 * The wait is bounded by the SDK module's own timeout + retry budget, and the
 * module never throws: a slow, missing or broken login shell degrades to
 * "keep the inherited environment" plus one diagnostic warning.
 */

import { primeProcessEnvFromLoginShell } from "wave-agent-sdk/host";
import { hostLog } from "./hostLog";

let priming: Promise<void> | undefined;

/**
 * Probe + adopt the login shell environment once per app process. Repeated
 * calls return the same promise, so the later `await` from the spawn path
 * never starts a second probe.
 */
export function primeLoginShellEnv(): Promise<void> {
  priming ??= primeProcessEnvFromLoginShell().then(({ adopted, error }) => {
    if (error !== undefined) {
      hostLog.warn(
        "[login-shell] probe failed; keeping the inherited environment:",
        error,
      );
      return;
    }
    // Key names only: the values routinely carry proxy credentials and tokens,
    // and desktop.log is the file users hand to support.
    hostLog.info(
      `[login-shell] adopted keys: ${adopted.length > 0 ? adopted.join(", ") : "(none)"}`,
    );
  });
  return priming;
}

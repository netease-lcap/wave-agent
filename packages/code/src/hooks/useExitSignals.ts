import { useEffect, useRef } from "react";

/**
 * Process-level exit detection for the interactive CLI.
 *
 * Ink runs the terminal in raw mode, so Ctrl-C normally arrives as a keypress
 * (`useInput`) rather than a signal — but the signals still arrive when the
 * process is killed from outside, and the terminal itself sends one when the
 * user closes the window. Every one of those paths has to unwind through React
 * unmount, because that is what triggers `Agent.destroy()`; without a handler
 * Node applies the default action and terminates on the spot, leaving the
 * agent's async teardown — and every child process it owns — unreaped.
 *
 * `SIGHUP` is the one that actually bit us. The Bash tool spawns its shell with
 * `detached: true`, which makes the child the leader of its own process group
 * and therefore immune to the terminal's SIGHUP broadcast. If nothing reaps it,
 * the shell and everything under it survive as launchd-reparented orphans
 * (observed: one `zsh -> ping -> tail` group alive for almost three days).
 * Claude Code registers the same signal for the same reason.
 *
 * The polling branch covers macOS specifically: closing a terminal there
 * revokes the TTY file descriptors *instead of* delivering a signal, leaving
 * the process alive but unable to read or write. Nothing else would ever
 * notice, so the stdio handles are probed on the same 30s cadence Claude Code
 * uses in `gracefulShutdown`.
 */
const TTY_REVOCATION_CHECK_INTERVAL_MS = 30_000;

/**
 * Invoke `onExitSignal` on SIGINT / SIGTERM / SIGHUP, and when the controlling
 * TTY is revoked out from under the process.
 *
 * `onExitSignal` is held in a ref, so callers do not need to memoize it and a
 * re-render does not churn the signal registrations. Callers are responsible
 * for making the teardown itself idempotent: a single terminal close can arrive
 * as a signal *and* as a revoked TTY.
 *
 * @param enabled - set false to skip registration entirely (e.g. a wrapper
 *   component that renders a child which owns the handler).
 */
export function useExitSignals(onExitSignal: () => void, enabled = true): void {
  const handlerRef = useRef(onExitSignal);
  handlerRef.current = onExitSignal;

  useEffect(() => {
    if (!enabled) return;

    const handle = () => handlerRef.current();

    // Windows has no SIGHUP: the event never fires there, so registering it
    // would only imply a coverage the platform cannot provide.
    const signals: NodeJS.Signals[] =
      process.platform === "win32"
        ? ["SIGINT", "SIGTERM"]
        : ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const signal of signals) {
      process.on(signal, handle);
    }

    // Only meaningful for an interactive terminal; piping either stream out
    // means the handles legitimately stop being readable/writable.
    let ttyRevocationPoll: NodeJS.Timeout | undefined;
    if (process.stdin.isTTY) {
      ttyRevocationPoll = setInterval(() => {
        if (!process.stdout.writable || !process.stdin.readable) {
          // Stop polling before handing off: the revoked TTY stays revoked, so
          // a surviving interval would re-fire the teardown every 30s.
          if (ttyRevocationPoll) clearInterval(ttyRevocationPoll);
          handle();
        }
      }, TTY_REVOCATION_CHECK_INTERVAL_MS);
      // Never keep the process alive just to poll for its own death.
      ttyRevocationPoll.unref();
    }

    return () => {
      for (const signal of signals) {
        process.off(signal, handle);
      }
      if (ttyRevocationPoll) clearInterval(ttyRevocationPoll);
    };
  }, [enabled]);
}

/**
 * Coordinates the desktop app's quit sequence.
 *
 * Flow: `before-quit` is held (`preventDefault`) while — when `confirmQuit` is
 * given — the user is asked whether to interrupt running sessions, then while
 * the agent host disposes, bounded by {@link SHUTDOWN_TIMEOUT_MS}; when that
 * settles the quit is finished through Electron's **ordinary** quit sequence
 * (`app.quit`), not `app.exit`.
 *
 * Why not `app.exit()`: it terminates the main process immediately and skips
 * the shutdown sequence. `crashpad-handler` — `CodeWave IDE.exe
 * --type=crashpad-handler`, started alongside every run — is reaped by that
 * sequence, so `exit()` leaves it orphaned. Windows has no "child dies with its
 * parent" rule, so the orphan keeps running and keeps a handle on the install
 * directory: the next `desktop:install` then fails with `EPERM` and reports
 * "CodeWave IDE is probably still running" even though the app is long gone.
 *
 * The `disposing` latch makes the second pass through `before-quit` a no-op that
 * also stops calling `preventDefault`, so Electron continues to `will-quit` →
 * `quit` instead of looping. It is set only after the confirm step passes — a
 * cancelled quit leaves the handler idle so the next attempt asks again.
 */

/** How long the host may take to dispose before the quit proceeds anyway. */
export const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Last-resort hard exit: if the ordinary sequence never completes (a window
 * vetoing `close`, a wedged shutdown), the process still has to go away. Only
 * this fallback can orphan the crashpad handler.
 */
export const QUIT_FALLBACK_MS = 5_000;

/** The slice of Electron's `Event` the handler needs (keeps tests trivial). */
export interface QuitEvent {
  preventDefault: () => void;
}

export interface QuitHandlerDeps {
  /** Resolves once the desktop host — and its `wave --stdio` children — is done. */
  dispose: () => Promise<void>;
  /** `app.quit()`. */
  quit: () => void;
  /** `app.exit(code)`. */
  exit: (code: number) => void;
  /** Diagnostics for a dispose failure; never fatal to the quit. */
  onDisposeError?: (error: unknown) => void;
  /**
   * Asked once, before the quit sequence starts (spec desktop-shell.md
   * 「退出时保护运行中的会话」). `false` = the user cancelled: the quit is
   * dropped and the app keeps running exactly as it was. Omitted = never ask,
   * which is the pre-existing behaviour.
   */
  confirmQuit?: () => Promise<boolean>;
  /**
   * The confirm step passed and the quit sequence is really running. Callers
   * latch "we are quitting" here rather than on the first `before-quit` — a
   * cancelled confirm must not leave that latch set (it would, e.g., turn off
   * Windows' close-hides-to-tray for the rest of the session).
   */
  onQuitConfirmed?: () => void;
  disposeTimeoutMs?: number;
  fallbackMs?: number;
}

/** Handler to register on `app.on("before-quit", …)`. */
export type QuitHandler = (event: QuitEvent) => void;

export function createQuitHandler(deps: QuitHandlerDeps): QuitHandler {
  const disposeTimeoutMs = deps.disposeTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const fallbackMs = deps.fallbackMs ?? QUIT_FALLBACK_MS;
  // Three states, not a boolean: while the confirm dialog is open a second
  // `before-quit` (menu + Ctrl+Q + tray all reach here) must not stack another
  // dialog, and only the "disposing" state lets our own `quit()` through.
  let phase: "idle" | "confirming" | "disposing" = "idle";

  const finish = (): void => {
    deps.quit();
    // Dropped together with the process when the ordinary sequence works.
    setTimeout(() => deps.exit(0), fallbackMs);
  };

  const beginDispose = (): void => {
    phase = "disposing";
    deps.onQuitConfirmed?.();
    void Promise.race([
      deps.dispose().catch((error: unknown) => {
        deps.onDisposeError?.(error);
      }),
      new Promise((resolve) => setTimeout(resolve, disposeTimeoutMs)),
    ]).then(finish);
  };

  return (event: QuitEvent): void => {
    if (phase === "disposing") {
      // Second pass, triggered by our own `quit()`. Let Electron continue.
      return;
    }
    event.preventDefault();
    if (phase === "confirming") return;
    if (!deps.confirmQuit) {
      beginDispose();
      return;
    }
    phase = "confirming";
    void deps.confirmQuit().then(
      (proceed) => {
        if (!proceed) {
          // Cancelled: back to idle so the next quit asks again. Nothing was
          // disposed, so the sessions keep running untouched.
          phase = "idle";
          return;
        }
        beginDispose();
      },
      // A confirm that cannot even be shown must not make the app unquittable.
      () => beginDispose(),
    );
  };
}

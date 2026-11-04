/**
 * Coordinates the desktop app's quit sequence.
 *
 * Flow: `before-quit` is held (`preventDefault`) while the agent host disposes,
 * bounded by {@link SHUTDOWN_TIMEOUT_MS}; when that settles the quit is finished
 * through Electron's **ordinary** quit sequence (`app.quit`), not `app.exit`.
 *
 * Why not `app.exit()`: it terminates the main process immediately and skips
 * the shutdown sequence. `crashpad-handler` — `CodeWave IDE.exe
 * --type=crashpad-handler`, started alongside every run — is reaped by that
 * sequence, so `exit()` leaves it orphaned. Windows has no "child dies with its
 * parent" rule, so the orphan keeps running and keeps a handle on the install
 * directory: the next `desktop:install` then fails with `EPERM` and reports
 * "CodeWave IDE is probably still running" even though the app is long gone.
 *
 * The `quitting` latch makes the second pass through `before-quit` a no-op that
 * also stops calling `preventDefault`, so Electron continues to `will-quit` →
 * `quit` instead of looping.
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
  disposeTimeoutMs?: number;
  fallbackMs?: number;
}

/** Handler to register on `app.on("before-quit", …)`. */
export type QuitHandler = (event: QuitEvent) => void;

export function createQuitHandler(deps: QuitHandlerDeps): QuitHandler {
  const disposeTimeoutMs = deps.disposeTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const fallbackMs = deps.fallbackMs ?? QUIT_FALLBACK_MS;
  let quitting = false;

  const finish = (): void => {
    deps.quit();
    // Dropped together with the process when the ordinary sequence works.
    setTimeout(() => deps.exit(0), fallbackMs);
  };

  return (event: QuitEvent): void => {
    if (quitting) {
      // Second pass, triggered by our own `quit()`. Let Electron continue.
      return;
    }
    quitting = true;
    event.preventDefault();
    void Promise.race([
      deps.dispose().catch((error: unknown) => {
        deps.onDisposeError?.(error);
      }),
      new Promise((resolve) => setTimeout(resolve, disposeTimeoutMs)),
    ]).then(finish);
  };
}

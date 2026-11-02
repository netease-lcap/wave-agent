/**
 * The main window shows exactly one document: the bundled `webview/index.html`
 * that `loadFile` put there at startup. Anything else navigating that window is
 * a bug, and letting it through is not cosmetic — Chromium replaces the whole
 * UI with an error page on a failed main-frame load, and `attachCrashRecovery`
 * then raises 「界面加载失败」 over a chat session that was perfectly fine.
 *
 * Real incident: a markdown preview rendered `<a href="020-mini-app">` inside the
 * file panel. The click resolved against the *document* URL (the asar path, not
 * the file being read), the old guard waved it through because it was `file:`,
 * and the window navigated to `app.asar/webview/020-mini-app` → ERR_FILE_NOT_FOUND.
 *
 * So the judgement is now "is this the app's own entry URL", not "what protocol
 * is it" — every `file:` subpath, `about:blank`, `data:` and `javascript:` is
 * blocked by construction. Mirrors what Claude Code Desktop does in the main
 * process: navigation is admitted by comparing against the window's entry URL
 * (it also registers `will-redirect`, since a redirect bypasses `will-navigate`).
 */

/**
 * A `webContents`-shaped target: the navigation hooks we attach plus the reload
 * the `about:` last resort needs.
 */
export type NavigationGuardTarget = {
  on(
    event: "will-navigate" | "will-redirect" | "did-navigate",
    listener: (event: { preventDefault: () => void }, url: string) => void,
  ): unknown;
  loadURL(url: string): unknown;
};

export type NavigationGuardOptions = {
  /** `file://` URL of the bundled `webview/index.html`. */
  entryUrl: string;
  /** Handed http(s) clicks — never loaded in the app window. */
  openExternal: (url: string) => void;
  /** Defaults to console.warn; injected in tests. */
  log?: (...args: unknown[]) => void;
};

/**
 * Drop the fragment (and a cache-busting query) so an in-page anchor or
 * `index.html?v=2` still counts as the entry document itself.
 */
export const navigationUrlBase = (url: string): string =>
  url.split("#")[0].split("?")[0];

/**
 * True only for the exact document the window was opened with. Deliberately not
 * a prefix/startsWith test: `.../webview/index.html/../../x` and
 * `.../webview/index.html.bak` both share the prefix but are different files.
 */
export const isAppEntryUrl = (url: string, entryUrl: string): boolean => {
  if (!url || !entryUrl) return false;
  const target = navigationUrlBase(url);
  const entry = navigationUrlBase(entryUrl);
  if (target === entry) return true;
  // Chromium hands `will-navigate` a canonicalized URL (`%20` for a space)
  // while `loadFile` goes through `url.format`, which leaves spaces as they
  // are. Comparing the decoded forms keeps an install path with a space — the
  // normal case on macOS, `/Applications/CodeWave IDE.app/...` — from making
  // the app block its own document. `decodeURI` leaves `%2F`/`%3F`/`%23`
  // encoded, so two genuinely different paths cannot collapse into one.
  return decodeUrl(target) === decodeUrl(entry);
};

const decodeUrl = (url: string): string => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

/**
 * Attach the navigation hooks. Clicks on http(s) leave for the system browser
 * (FR-008) instead of replacing the app; everything else is dropped.
 */
export const attachNavigationGuards = (
  target: NavigationGuardTarget,
  options: NavigationGuardOptions,
): void => {
  const { entryUrl, openExternal, log = console.warn } = options;

  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (isAppEntryUrl(url, entryUrl)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) {
      openExternal(url);
      return;
    }
    // Worth a log line: a blocked in-window navigation is how a broken link
    // surfaces now that it can no longer take the UI down with it.
    log("[Wave Desktop] Blocked in-window navigation:", url);
  };

  target.on("will-navigate", guard);
  target.on("will-redirect", guard);

  // `about:blank` is the one scheme Chromium swaps the document for **without**
  // emitting `will-navigate` (measured on Electron 43: an `<a href="about:blank">`
  // or `location.href = "about:blank"` only produces
  // did-start-navigation → did-navigate). Calling `webContents.stop()` from
  // `did-start-navigation` kills the renderer instead of the navigation, so the
  // only workable repair is to put the app document back after it committed.
  target.on("did-navigate", (_event, url) => {
    if (isAppEntryUrl(url, entryUrl)) return;
    log("[Wave Desktop] Restoring the app document after navigation to:", url);
    try {
      // A promise rejection here would be the entry document itself failing to
      // load — `attachCrashRecovery` owns that dialog, not this guard.
      void Promise.resolve(target.loadURL(entryUrl)).catch(() => undefined);
    } catch {
      // Same: nothing useful to do from a listener.
    }
  });
};

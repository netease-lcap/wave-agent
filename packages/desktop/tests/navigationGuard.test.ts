import { describe, it, expect, vi } from "vitest";
import {
  attachNavigationGuards,
  isAppEntryUrl,
  navigationUrlBase,
  type NavigationGuardTarget,
} from "../src/main/navigationGuard";

const ENTRY = "file:///Applications/app.asar/webview/index.html";

/**
 * The minimum a `webContents` has to expose for the guard: `on` + `loadURL`.
 * Records every listener so a test can fire the exact event the main process
 * would receive.
 */
function createFakeTarget() {
  const listeners = new Map<
    string,
    Array<(event: { preventDefault: () => void }, url: string) => void>
  >();
  const loadURL = vi.fn(async () => undefined);
  const target: NavigationGuardTarget = {
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    loadURL,
  };
  const emit = (event: string, url: string) => {
    const preventDefault = vi.fn();
    for (const listener of listeners.get(event) ?? []) {
      listener({ preventDefault }, url);
    }
    return preventDefault;
  };
  return { target, emit, loadURL };
}

function setup() {
  const { target, emit, loadURL } = createFakeTarget();
  const openExternal = vi.fn();
  const log = vi.fn();
  attachNavigationGuards(target, { entryUrl: ENTRY, openExternal, log });
  return { emit, openExternal, log, loadURL };
}

describe("isAppEntryUrl", () => {
  it("accepts the bundled index.html itself, with or without a fragment/query", () => {
    expect(isAppEntryUrl(ENTRY, ENTRY)).toBe(true);
    expect(isAppEntryUrl(`${ENTRY}#/session/abc`, ENTRY)).toBe(true);
    expect(isAppEntryUrl(`${ENTRY}?v=2`, ENTRY)).toBe(true);
    expect(isAppEntryUrl(`${ENTRY}?v=2#pane-1`, ENTRY)).toBe(true);
  });

  it("rejects a file: subpath under the bundled webview directory", () => {
    // The reported incident: a relative markdown link resolved against the
    // document URL instead of the file being previewed.
    expect(
      isAppEntryUrl(
        "file:///Applications/app.asar/webview/020-mini-app/spec.md",
        ENTRY,
      ),
    ).toBe(false);
    expect(isAppEntryUrl("file:///Applications/app.asar/webview/", ENTRY)).toBe(
      false,
    );
  });

  it("rejects look-alike paths that only share the entry URL as a prefix", () => {
    expect(isAppEntryUrl(`${ENTRY}.bak`, ENTRY)).toBe(false);
    expect(isAppEntryUrl(`${ENTRY}/../../secrets`, ENTRY)).toBe(false);
  });

  it("accepts the entry URL whichever side percent-encodes its spaces", () => {
    // `loadFile` leaves the space alone, Chromium canonicalizes it to `%20`.
    expect(
      isAppEntryUrl(
        "file:///Applications/CodeWave%20IDE.app/Contents/Resources/app.asar/webview/index.html",
        "file:///Applications/CodeWave IDE.app/Contents/Resources/app.asar/webview/index.html",
      ),
    ).toBe(true);
    expect(
      isAppEntryUrl(
        "file:///Applications/CodeWave IDE.app/Contents/Resources/app.asar/webview/index.html",
        "file:///Applications/CodeWave%20IDE.app/Contents/Resources/app.asar/webview/index.html",
      ),
    ).toBe(true);
  });

  it("rejects empty input on either side", () => {
    expect(isAppEntryUrl("", ENTRY)).toBe(false);
    expect(isAppEntryUrl(ENTRY, "")).toBe(false);
  });
});

describe("navigationUrlBase", () => {
  it("drops the fragment first, then the query", () => {
    expect(navigationUrlBase("file:///a/index.html?x=1#y")).toBe(
      "file:///a/index.html",
    );
  });
});

describe("attachNavigationGuards", () => {
  it("cancels a navigation to a file: subpath (real incident URL)", () => {
    const { emit, openExternal, log } = setup();
    const preventDefault = emit(
      "will-navigate",
      "file:///Applications/app.asar/webview/020-mini-app/spec.md",
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("lets the app's own entry URL load", () => {
    const { emit, openExternal, log } = setup();
    const preventDefault = emit("will-navigate", ENTRY);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("cancels about:/data:/javascript: navigations without opening anything", () => {
    const { emit, openExternal } = setup();
    for (const url of [
      "about:blank",
      "data:text/html,<h1>hi</h1>",
      "javascript:alert(1)",
    ]) {
      expect(emit("will-navigate", url)).toHaveBeenCalledTimes(1);
      expect(emit("will-redirect", url)).toHaveBeenCalledTimes(1);
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("sends http(s) clicks to the system browser instead of navigating", () => {
    const { emit, openExternal } = setup();
    const preventDefault = emit("will-navigate", "https://example.com/docs");

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("guards redirects too — a redirect bypasses will-navigate", () => {
    const { emit } = setup();
    expect(
      emit(
        "will-redirect",
        "file:///Applications/app.asar/webview/020-mini-app/spec.md",
      ),
    ).toHaveBeenCalledTimes(1);
    expect(emit("will-redirect", ENTRY)).not.toHaveBeenCalled();
  });

  /**
   * `about:blank` commits without ever emitting `will-navigate` (measured on
   * Electron 43), so the only repair is to load the app document back once the
   * foreign document has committed.
   */
  it("puts the app document back after an unblockable about:blank commit", () => {
    const { emit, loadURL } = setup();

    emit("did-navigate", "about:blank");

    expect(loadURL).toHaveBeenCalledWith(ENTRY);
  });

  it("does not reload when the app document itself committed", () => {
    const { emit, loadURL } = setup();

    emit("did-navigate", ENTRY);
    emit("did-navigate", `${ENTRY}#/session/abc`);

    expect(loadURL).not.toHaveBeenCalled();
  });
});

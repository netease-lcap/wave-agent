/**
 * macOS hidden-titlebar detection for the desktop host.
 *
 * The Electron main process hides the system title bar on darwin only
 * (`titleBarStyle: "hidden"`, spec「macOS 隐藏标题栏」); the webview then has to
 * reserve a window-drag region / traffic-light clearance that Windows/Linux
 * never need. The preload exposes `wavePlatform` (process.platform), so this is
 * exact rather than UA sniffing, and stays false for every non-desktop host
 * (VS Code/JetBrains) and for the browser-based prototype preview, where the
 * real OS never draws traffic lights over the page.
 */
export const isMacHiddenTitlebar = (): boolean =>
  typeof window !== "undefined" &&
  window.waveHostType === "desktop" &&
  window.wavePlatform === "darwin";

/**
 * True inside the Electron desktop host. The desktop host is the single owner of
 * the `[data-host="desktop"]` layer in `host-desktop.css` (see `src/index.tsx`),
 * which is where the desktop-only visual affordances live — including the focus
 * rings that make newly focusable scroll regions discoverable. Renderers shared
 * by all hosts therefore gate desktop-only *tab stops* on this, so the plugin hosts
 * never gain an unstyled tab stop (WCAG 2.4.3 noise) they have no ring for.
 */
export const isDesktopHost = (): boolean =>
  typeof window !== "undefined" && window.waveHostType === "desktop";

/**
 * True inside the remote-control Web page — the shim explicitly leaves
 * `waveHostType` unset (so the page renders the plugin branch: no panes, no
 * workdir picker) and sets `waveRemotePage` instead. This is the one flag that
 * distinguishes "a plugin host" from "a browser page holding a token", and the
 * difference is a capability difference, not a taste one: the page has no
 * editor to open a file in, no settings tab, no plugin manager, no local host
 * to route a command to (spec `remote/remote-web.md` 场景 20/21).
 *
 * Prefer this over testing `waveHostType !== "desktop"`: the VSCE and JetBrains
 * hosts are also not desktop, and they *do* have all of the above.
 */
export const isRemotePageHost = (): boolean =>
  typeof window !== "undefined" && window.waveRemotePage === true;

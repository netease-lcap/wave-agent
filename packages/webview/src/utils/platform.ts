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
 * by all hosts therefore gate desktop-only *tab stops* on this, so the IDE hosts
 * never gain an unstyled tab stop (WCAG 2.4.3 noise) they have no ring for.
 */
export const isDesktopHost = (): boolean =>
  typeof window !== "undefined" && window.waveHostType === "desktop";

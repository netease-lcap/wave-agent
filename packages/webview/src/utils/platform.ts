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

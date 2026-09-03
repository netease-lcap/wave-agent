import { contextBridge, ipcRenderer } from "electron";
import * as path from "path";
import { pathToFileURL } from "url";
import { WEBVIEW_CHANNEL, HOST_CHANNEL } from "./channels";

/**
 * Bridge between the sandboxed webview page and the Electron main process.
 * The shared webview bundle only knows `window.acquireVsCodeApi()` and
 * `window.addEventListener('message')`, so we emulate exactly that surface:
 *
 *   page → main : acquireVsCodeApi().postMessage(msg) → ipc 'wave:webview-message'
 *   main → page : ipc 'wave:host-message' → window.postMessage(msg, '*')
 *
 * getState/setState are declared by the webview but never called anywhere in
 * the codebase, so they are inert here.
 */
contextBridge.exposeInMainWorld("acquireVsCodeApi", () => ({
  postMessage: (message: unknown) => {
    ipcRenderer.send(WEBVIEW_CHANNEL, message);
  },
  getState: () => undefined,
  setState: () => undefined,
}));

contextBridge.exposeInMainWorld("waveHostType", "desktop");

// Host platform ("darwin"/"win32"/"linux") — the webview uses it to enable the
// macOS-only hidden-titlebar layout (sidebar drag row / traffic-light gutter,
// spec「macOS 隐藏标题栏」). Undefined in non-Electron hosts.
contextBridge.exposeInMainWorld("wavePlatform", process.platform);

// file:// URL of the element-picker preload, injected by PreviewPane into the
// preview <webview> (`preload` attribute). Built to dist/main/pickerPreload.cjs
// alongside this file, so the relative path holds in dev and inside app.asar.
contextBridge.exposeInMainWorld(
  "wavePickerPreloadPath",
  pathToFileURL(path.join(__dirname, "pickerPreload.cjs")).toString(),
);

// Apply the persisted theme before first paint (FR-019). The main process
// resolves the effective theme synchronously; <html data-theme> then selects
// the matching inlined --vscode-* variable set before React mounts, avoiding a
// light↔dark flash on launch. The preload runs before the DOM is parsed, so
// <html> may not exist yet — defer to DOMContentLoaded in that case. The
// static default `data-theme="dark"` in index.html covers the very first paint
// regardless. Guarded for the node test environment, which has no DOM.
const initialTheme = ipcRenderer.sendSync("wave:get-initial-theme") as
  | "light"
  | "dark"
  | undefined;
const applyInitialTheme = () => {
  document.documentElement.setAttribute("data-theme", initialTheme || "dark");
};
if (typeof document !== "undefined") {
  if (document.documentElement) {
    applyInitialTheme();
  } else {
    document.addEventListener("DOMContentLoaded", applyInitialTheme, {
      once: true,
    });
  }
}

ipcRenderer.on(HOST_CHANNEL, (_event, message) => {
  window.postMessage(message, "*");
});

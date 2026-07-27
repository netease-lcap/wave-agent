import { contextBridge, ipcRenderer } from 'electron';
import { WEBVIEW_CHANNEL, HOST_CHANNEL } from './channels';

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
contextBridge.exposeInMainWorld('acquireVsCodeApi', () => ({
  postMessage: (message: unknown) => {
    ipcRenderer.send(WEBVIEW_CHANNEL, message);
  },
  getState: () => undefined,
  setState: () => undefined,
}));

contextBridge.exposeInMainWorld('waveHostType', 'desktop');

ipcRenderer.on(HOST_CHANNEL, (_event, message) => {
  window.postMessage(message, '*');
});

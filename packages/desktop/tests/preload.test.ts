import { describe, it, expect, vi } from "vitest";
import { contextBridge, ipcRenderer } from "electron";
import { WEBVIEW_CHANNEL, HOST_CHANNEL } from "../src/main/channels";
import "../src/main/preload";

describe("preload", () => {
  function exposedApi() {
    const call = vi
      .mocked(contextBridge.exposeInMainWorld)
      .mock.calls.find(([key]) => key === "acquireVsCodeApi");
    expect(call).toBeDefined();
    const factory = call![1] as () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
    return factory();
  }

  it("exposes acquireVsCodeApi emulating the VS Code webview API", () => {
    const api = exposedApi();

    api.postMessage({ command: "webviewReady" });
    expect(ipcRenderer.send).toHaveBeenCalledWith(WEBVIEW_CHANNEL, {
      command: "webviewReady",
    });

    expect(api.getState()).toBeUndefined();
    expect(api.setState({})).toBeUndefined();
  });

  it("exposes waveHostType as desktop", () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      "waveHostType",
      "desktop",
    );
  });

  it("exposes the host platform for the hidden-titlebar layout", () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      "wavePlatform",
      process.platform,
    );
  });

  it("forwards host messages into the page via window.postMessage", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { postMessage });

    const listener = vi
      .mocked(ipcRenderer.on)
      .mock.calls.find(([channel]) => channel === HOST_CHANNEL)?.[1];
    expect(listener).toBeDefined();
    (listener as (event: unknown, message: unknown) => void)(
      {},
      { command: "setInitialState" },
    );

    expect(postMessage).toHaveBeenCalledWith(
      { command: "setInitialState" },
      "*",
    );
    vi.unstubAllGlobals();
  });

  it("queries the initial theme synchronously to seed <html data-theme> (FR-019)", () => {
    expect(ipcRenderer.sendSync).toHaveBeenCalledWith("wave:get-initial-theme");
  });
});

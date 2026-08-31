import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebviewManager } from "../../src/session/webviewManager";

const { createWebviewPanel } = vi.hoisted(() => ({
  createWebviewPanel: vi.fn(),
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: -2, Active: 1 },
  Uri: {
    joinPath: (...args: string[]) => ({ path: args.join("/") }),
  },
  window: { createWebviewPanel },
}));

interface FakeWebview {
  html: string;
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: (uri: unknown) => unknown;
}

interface FakePanel {
  webview: FakeWebview;
  reveal: ReturnType<typeof vi.fn>;
  onDidDispose: (cb: () => void) => void;
  dispose: ReturnType<typeof vi.fn>;
}

function makePanel(): FakePanel {
  return {
    webview: {
      html: "",
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(),
      asWebviewUri: (uri: unknown) => String((uri as { path: string }).path),
    },
    reveal: vi.fn(),
    onDidDispose: () => {},
    dispose: vi.fn(),
  };
}

function makeManager(): WebviewManager {
  const context = {
    extensionUri: "ext-uri",
  } as unknown as ConstructorParameters<typeof WebviewManager>[0];
  const callbacks = {
    onMessage: vi.fn(),
    onTabDispose: vi.fn(),
    onWindowDispose: vi.fn(),
    onSettingsMessage: vi.fn(),
  };
  return new WebviewManager(context, callbacks);
}

describe("WebviewManager plan preview panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a plan panel beside the active editor with the plan-preview bundle", () => {
    createWebviewPanel.mockReturnValue(makePanel());
    const manager = makeManager();

    const panel = manager.getOrCreatePlanPanel("plan_tab_abc");

    expect(createWebviewPanel).toHaveBeenCalledWith(
      "wavePlanPreview",
      "计划预览",
      -2, // ViewColumn.Beside (claudePlanPreview placement)
      expect.objectContaining({ enableScripts: true }),
    );
    expect(panel.webview.html).toContain("plan-preview.js");
    expect(panel.webview.html).toContain("markdown-body");
  });

  it("reuses the existing plan panel for the same session (no second createWebviewPanel)", () => {
    createWebviewPanel.mockReturnValue(makePanel());
    const manager = makeManager();

    manager.getOrCreatePlanPanel("plan_tab_abc");
    manager.getOrCreatePlanPanel("plan_tab_abc");

    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("posts plan markdown to the plan panel", () => {
    const panel = makePanel();
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    manager.getOrCreatePlanPanel("plan_tab_abc");
    manager.postPlanContent("plan_tab_abc", "# 重构方案");

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      command: "planPreview",
      content: "# 重构方案",
    });
  });

  it("removes the plan panel from the map when the user closes it", () => {
    const panel = makePanel();
    let disposeCb: (() => void) | undefined;
    panel.onDidDispose = (cb) => {
      disposeCb = cb;
    };
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    manager.getOrCreatePlanPanel("plan_tab_abc");
    disposeCb?.();
    // Panel is gone: a subsequent call creates a fresh one.
    manager.getOrCreatePlanPanel("plan_tab_abc");

    expect(createWebviewPanel).toHaveBeenCalledTimes(2);
  });
});

describe("WebviewManager settings panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a settings tab in the active editor column with the settings-preview bundle", () => {
    const panel = makePanel();
    createWebviewPanel.mockReturnValue(panel);
    const onSettingsMessage = vi.fn();
    const manager = new WebviewManager(
      { extensionUri: "ext-uri" } as unknown as ConstructorParameters<
        typeof WebviewManager
      >[0],
      {
        onMessage: vi.fn(),
        onTabDispose: vi.fn(),
        onWindowDispose: vi.fn(),
        onSettingsMessage,
      },
    );

    manager.getOrCreateSettingsPanel();

    expect(createWebviewPanel).toHaveBeenCalledWith(
      "waveSettingsPreview",
      "设置",
      1, // ViewColumn.Active (editor-area settings tab)
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );
    expect(panel.webview.html).toContain("settings.js");
    expect(panel.webview.html).toContain("settings.css");
    // Settings tab messages are routed to the host via the onSettingsMessage callback.
    const messageHandler = panel.webview.onDidReceiveMessage.mock
      .calls[0][0] as (message: unknown) => void;
    messageHandler({ command: "getConfiguration" });
    expect(onSettingsMessage).toHaveBeenCalledWith({
      command: "getConfiguration",
    });
  });

  it("reuses the existing settings panel (no second createWebviewPanel) and reveals it", () => {
    const panel = makePanel();
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    manager.getOrCreateSettingsPanel();
    manager.getOrCreateSettingsPanel();

    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(1);
  });

  it("posts messages to the settings panel only while it exists", () => {
    const panel = makePanel();
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    // No panel yet: postSettingsMessage is a no-op.
    manager.postSettingsMessage({ command: "settingsState", workdir: "/tmp" });
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    manager.getOrCreateSettingsPanel();
    manager.postSettingsMessage({ command: "settingsState", workdir: "/tmp" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      command: "settingsState",
      workdir: "/tmp",
    });
  });

  it("clears the settings panel when the user closes the tab", () => {
    const panel = makePanel();
    let disposeCb: (() => void) | undefined;
    panel.onDidDispose = (cb) => {
      disposeCb = cb;
    };
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    manager.getOrCreateSettingsPanel();
    disposeCb?.();
    // Panel is gone: a subsequent call creates a fresh one.
    manager.getOrCreateSettingsPanel();

    expect(createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it("disposeSettingsPanel disposes and clears the panel", () => {
    const panel = makePanel();
    createWebviewPanel.mockReturnValue(panel);
    const manager = makeManager();

    manager.getOrCreateSettingsPanel();
    manager.disposeSettingsPanel();

    expect(panel.dispose).toHaveBeenCalledTimes(1);
    // Panel is gone: a subsequent call creates a fresh one.
    manager.getOrCreateSettingsPanel();
    expect(createWebviewPanel).toHaveBeenCalledTimes(2);
  });
});

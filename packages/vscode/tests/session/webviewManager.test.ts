import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebviewManager } from "../../src/session/webviewManager";

const { createWebviewPanel } = vi.hoisted(() => ({
  createWebviewPanel: vi.fn(),
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: -2 },
  Uri: {
    joinPath: (...args: string[]) => ({ path: args.join("/") }),
  },
  window: { createWebviewPanel },
}));

interface FakeWebview {
  html: string;
  postMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: (uri: unknown) => unknown;
}

interface FakePanel {
  webview: FakeWebview;
  onDidDispose: (cb: () => void) => void;
  dispose: ReturnType<typeof vi.fn>;
}

function makePanel(): FakePanel {
  return {
    webview: {
      html: "",
      postMessage: vi.fn(),
      asWebviewUri: (uri: unknown) => String((uri as { path: string }).path),
    },
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

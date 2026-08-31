import * as vscode from "vscode";

export interface WebviewManagerCallbacks {
  onMessage: (
    message: unknown,
    viewType: "sidebar" | "tab" | "window",
    windowId?: string,
  ) => Promise<void>;
  onTabDispose: (tabId: string) => void;
  onWindowDispose: (windowId: string) => void;
  /** Messages posted from the settings tab webview (see getOrCreateSettingsPanel). */
  onSettingsMessage: (message: unknown) => void | Promise<void>;
}

export class WebviewManager {
  private sidebarView: vscode.WebviewView | undefined;
  private tabPanels: Map<string, vscode.WebviewPanel> = new Map();
  private windowPanels: Map<string, vscode.WebviewPanel> = new Map();
  /** ExitPlanMode plan-preview panels (claudePlanPreview equivalent), keyed by chat session id. */
  private planPanels: Map<string, vscode.WebviewPanel> = new Map();
  /** Editor-area settings tab (single instance, see getOrCreateSettingsPanel). */
  private settingsPanel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext;
  private callbacks: WebviewManagerCallbacks;

  constructor(
    context: vscode.ExtensionContext,
    callbacks: WebviewManagerCallbacks,
  ) {
    this.context = context;
    this.callbacks = callbacks;
  }

  public setSidebarView(webviewView: vscode.WebviewView) {
    this.sidebarView = webviewView;
    this.setupWebview(webviewView.webview, "sidebar");
  }

  public getSidebarView(): vscode.WebviewView | undefined {
    return this.sidebarView;
  }

  public createTabPanel(
    viewType: string,
    title: string,
    tabId: string,
    column: vscode.ViewColumn,
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      {
        viewColumn: column,
        preserveFocus: false,
      },
      {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    this.tabPanels.set(tabId, panel);
    this.setupWebview(panel.webview, "tab", tabId);

    panel.onDidDispose(() => {
      this.tabPanels.delete(tabId);
      this.callbacks.onTabDispose(tabId);
    });

    return panel;
  }

  public getTabPanel(tabId: string): vscode.WebviewPanel | undefined {
    return this.tabPanels.get(tabId);
  }

  public getAllTabPanels(): Map<string, vscode.WebviewPanel> {
    return this.tabPanels;
  }

  public createWindowPanel(
    viewType: string,
    title: string,
    windowId: string,
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    this.windowPanels.set(windowId, panel);
    this.setupWebview(panel.webview, "window", windowId);

    panel.onDidDispose(() => {
      this.windowPanels.delete(windowId);
      this.callbacks.onWindowDispose(windowId);
    });

    return panel;
  }

  public getWindowPanel(windowId: string): vscode.WebviewPanel | undefined {
    return this.windowPanels.get(windowId);
  }

  public getAllWindowPanels(): Map<string, vscode.WebviewPanel> {
    return this.windowPanels;
  }

  /**
   * Returns the plan-preview panel for [key] (a chat session id), creating it beside the active
   * editor when missing (ViewColumn.Beside, mirroring CC's claudePlanPreview placement). One
   * panel per chat session: repeated ExitPlanMode calls reuse it and just refresh the content.
   */
  public getOrCreatePlanPanel(key: string): vscode.WebviewPanel {
    const existing = this.planPanels.get(key);
    if (existing) {
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "wavePlanPreview",
      "计划预览",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri],
        retainContextWhenHidden: true,
      },
    );
    panel.webview.html = this.getPlanPreviewContent(panel.webview);
    panel.onDidDispose(() => {
      this.planPanels.delete(key);
    });
    this.planPanels.set(key, panel);
    return panel;
  }

  /** Pushes fresh plan markdown into the plan-preview panel for [key]. */
  public postPlanContent(key: string, content: string) {
    this.planPanels.get(key)?.webview.postMessage({
      command: "planPreview",
      content,
    });
  }

  /**
   * Returns the editor-area settings tab (single instance), creating it in the
   * active editor column when missing (wave.openSettings command + the chat
   * webview's "openSettings" message; spec 场景 10). Unlike plan panels the
   * settings tab is not keyed by session — it serves config/AGENTS.md through
   * the shared configService/utilityClient. Repeated opens reuse the panel.
   */
  public getOrCreateSettingsPanel(): vscode.WebviewPanel {
    if (this.settingsPanel) {
      this.settingsPanel.reveal(vscode.ViewColumn.Active);
      return this.settingsPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "waveSettingsPreview",
      "设置",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri],
        retainContextWhenHidden: true,
      },
    );
    panel.webview.html = this.getSettingsPreviewContent(panel.webview);
    panel.webview.onDidReceiveMessage((message) => {
      void this.callbacks.onSettingsMessage(message);
    });
    panel.onDidDispose(() => {
      if (this.settingsPanel === panel) {
        this.settingsPanel = undefined;
      }
    });
    this.settingsPanel = panel;
    return panel;
  }

  /** Posts a message to the settings tab webview (no-op while it is closed). */
  public postSettingsMessage(message: unknown) {
    this.settingsPanel?.webview.postMessage(message);
  }

  /** Closes the settings tab (webview "closeSettings" message). */
  public disposeSettingsPanel() {
    if (this.settingsPanel) {
      this.settingsPanel.dispose();
      this.settingsPanel = undefined;
    }
  }

  public getSettingsPreviewContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "settings.js",
      ),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "settings.css",
      ),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} data: blob:; img-src ${webview.cspSource} data: blob: https: http:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource} data:;">
    <title>设置</title>
    <link rel="stylesheet" href="${cssUri}">
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  public getPlanPreviewContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "plan-preview.js",
      ),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "chat.css",
      ),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} data: blob:; img-src ${webview.cspSource} data: blob: https: http:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource} data:;">
    <title>计划预览</title>
    <link rel="stylesheet" href="${cssUri}">
    <style>
      body { margin: 0; padding: 16px; background: var(--vscode-editor-background); }
      #plan-preview h1 { font-size: 1.4em; }
    </style>
</head>
<body>
    <div id="plan-preview" class="markdown-body"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private setupWebview(
    webview: vscode.Webview,
    viewType: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = this.getWebviewContent(webview);

    webview.onDidReceiveMessage(async (message) => {
      await this.callbacks.onMessage(message, viewType, windowId);
    });
  }

  public postMessage(
    message: unknown,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    if (viewType) {
      if (viewType === "sidebar" && this.sidebarView) {
        this.sidebarView.webview.postMessage(message);
      } else if (viewType === "tab" && windowId) {
        const panel = this.tabPanels.get(windowId);
        if (panel) {
          panel.webview.postMessage(message);
        }
      } else if (viewType === "window" && windowId) {
        const panel = this.windowPanels.get(windowId);
        if (panel) {
          panel.webview.postMessage(message);
        }
      }
      return;
    }

    // Broadcast
    if (this.sidebarView) {
      this.sidebarView.webview.postMessage(message);
    }
    this.tabPanels.forEach((panel) => panel.webview.postMessage(message));
    this.windowPanels.forEach((panel) => panel.webview.postMessage(message));
  }

  public getWebviewContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "chat.js",
      ),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "dist",
        "chat.css",
      ),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} data: blob:; img-src ${webview.cspSource} data: blob: https: http:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource} data:;">
    <title>Wave AI Chat</title>
    <link rel="stylesheet" href="${cssUri}">
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    this.tabPanels.forEach((panel) => panel.dispose());
    this.tabPanels.clear();
    this.windowPanels.forEach((panel) => panel.dispose());
    this.windowPanels.clear();
    this.planPanels.forEach((panel) => panel.dispose());
    this.planPanels.clear();
    this.settingsPanel?.dispose();
    this.settingsPanel = undefined;
  }
}

/**
 * Settings webview entry (VS Code / JetBrains editor-area settings tab).
 *
 * A standalone bundle rendered inside the settings WebviewPanel the IDE hosts open in
 * the editor area (VSCE `createWebviewPanel`, JetBrains `WaveSettingsFileEditor` — both
 * mirror the plan-preview pattern). The page is the shared [SettingsPage] component; the
 * host bridge is `window.acquireVsCodeApi()` (native in VS Code, the vscode-shim.js
 * `__wavePostMessage`/`__waveReceive` bridge in JetBrains).
 *
 * Protocol (same command names the chat webview already uses):
 * - webview → host: `settingsReady`, `getConfiguration`, `getAgentsContent`,
 *   `closeSettings`, `prefillPrompt`（编辑操作随附 `openFile`，host 在自身
 *   编辑器打开对应配置文件）
 * - host → webview: `configurationResponse`, `agentsContentResponse`,
 *   `settingsState` (workdir push on open)
 */
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import SettingsPage from "./components/SettingsPage";
import type { NavKey } from "./components/SettingsPage";
import type { ConfigurationData } from "./types";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

const vscode = window.acquireVsCodeApi();

const root = ReactDOM.createRoot(document.getElementById("root")!);

function SettingsPreview() {
  const [configurationData, setConfigurationData] =
    useState<ConfigurationData | null>(null);
  const [saving, setSaving] = useState(false);
  const [configurationError, setConfigurationError] = useState<
    string | null | undefined
  >(undefined);
  const [workdir, setWorkdir] = useState<string | undefined>(undefined);
  const [userAgentsContent, setUserAgentsContent] = useState<string | null>(
    null,
  );
  const [projectAgentsContent, setProjectAgentsContent] = useState<
    string | null
  >(null);
  // /agents、/skills 斜杠命令经 openSettings(nav) → settingsState 下发，选中对应选项卡
  const [initialNav, setInitialNav] = useState<NavKey | undefined>(undefined);

  useEffect(() => {
    // Report readiness before pulling data: the host re-serves the cached
    // settingsState (workdir + nav) on settingsReady — a settingsState posted
    // right after the panel was created is dropped because this page's JS has
    // not registered its message listener yet (VS Code does not buffer it), which
    // would leave /mcp、/agents、/skills、/hooks unable to preselect a tab.
    vscode.postMessage({ command: "settingsReady" });
    // On open: pull the configuration + the user-level AGENTS.md (the
    // personalization view requests the project scope on demand, same as the
    // desktop full-page does via ChatApp).
    vscode.postMessage({ command: "getConfiguration" });
    vscode.postMessage({ command: "getAgentsContent", scope: "user" });

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data as Record<string, unknown> | undefined;
      if (!msg || typeof msg !== "object") return;
      switch (msg.command) {
        case "settingsState":
          if (typeof msg.workdir === "string") setWorkdir(msg.workdir);
          if (typeof msg.nav === "string") {
            setInitialNav(msg.nav as NavKey);
          }
          break;
        case "configurationResponse":
          setConfigurationData(msg.configurationData as ConfigurationData);
          setSaving(false);
          break;
        case "configurationError":
          setConfigurationError(
            typeof msg.error === "string" ? msg.error : "未知错误",
          );
          setSaving(false);
          break;
        case "agentsContentResponse":
          if (msg.scope === "project") {
            setProjectAgentsContent(
              typeof msg.content === "string" ? msg.content : "",
            );
          } else {
            setUserAgentsContent(
              typeof msg.content === "string" ? msg.content : "",
            );
          }
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <SettingsPage
      configurationData={configurationData}
      onSave={(data) => {
        setSaving(true);
        setConfigurationError(undefined);
        vscode.postMessage({
          command: "updateConfiguration",
          configurationData: data,
        });
      }}
      onClose={() => vscode.postMessage({ command: "closeSettings" })}
      userAgentsContent={userAgentsContent}
      projectAgentsContent={projectAgentsContent}
      onLoadAgentsContent={(scope) =>
        vscode.postMessage({
          command: "getAgentsContent",
          scope,
          workdir: scope === "project" ? workdir : undefined,
        })
      }
      workdir={workdir}
      saving={saving}
      configurationError={configurationError}
      initialNav={initialNav}
      vscode={vscode}
      onPrefillPrompt={(prompt, openFile) => {
        vscode.postMessage({ command: "prefillPrompt", prompt });
        // 编辑操作：配置文件交给 IDE 自身打开（聊天输入框 prefill 之外，host 在
        // 编辑器打开该文件供对照修改——VS Code / JetBrains 的 settings webview
        // 均处理 openFile）。
        if (openFile) {
          vscode.postMessage({ command: "openFile", path: openFile });
        }
      }}
    />
  );
}

root.render(<SettingsPreview />);

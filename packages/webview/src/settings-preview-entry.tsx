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
 * - webview → host: `getConfiguration`, `updateConfiguration`, `getAgentsContent`,
 *   `setAgentsContent`, `closeSettings`
 * - host → webview: `configurationResponse`, `configurationUpdated`, `configurationError`,
 *   `agentsContentResponse`, `agentsContentSaved`, `settingsState` (workdir push on open)
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
  const [workdir, setWorkdir] = useState<string | undefined>(undefined);
  const [userAgentsContent, setUserAgentsContent] = useState<string | null>(
    null,
  );
  const [projectAgentsContent, setProjectAgentsContent] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // /agents、/skills 斜杠命令经 openSettings(nav) → settingsState 下发，选中对应选项卡
  const [initialNav, setInitialNav] = useState<NavKey | undefined>(undefined);

  useEffect(() => {
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
          break;
        case "configurationUpdated":
          setSaving(false);
          break;
        case "configurationError":
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
        case "agentsContentSaved":
          setSaving(false);
          setSaveMessage(
            msg.ok === true
              ? "保存成功"
              : `保存失败：${(msg.error as string) ?? "未知错误"}`,
          );
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
      onSaveAgentsContent={(scope, content) => {
        setSaveMessage(null);
        vscode.postMessage({
          command: "setAgentsContent",
          scope,
          content,
          workdir: scope === "project" ? workdir : undefined,
        });
      }}
      workdir={workdir}
      saving={saving}
      saveMessage={saveMessage}
      initialNav={initialNav}
      vscode={vscode}
    />
  );
}

root.render(<SettingsPreview />);

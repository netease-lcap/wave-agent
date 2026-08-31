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
 * - webview → host: `getConfiguration`, `getAgentsContent`, `getHooksConfig`,
 *   `getMcpConfig`, `getMcpServers`, `connectMcpServer`, `disconnectMcpServer`,
 *   `closeSettings`
 * - host → webview: `configurationResponse`, `agentsContentResponse`,
 *   `hooksConfigResponse`, `mcpConfigResponse`, `mcpServersResponse`,
 *   `mcpServersUpdate`, `settingsState` (workdir push on open)
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
  const [hooksConfig, setHooksConfig] = useState<
    Partial<Record<"user" | "project", Record<string, unknown> | undefined>>
  >({});
  const [mcpConfig, setMcpConfig] = useState<
    Partial<Record<"user" | "project", Record<string, unknown> | undefined>>
  >({});
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
        case "hooksConfigResponse": {
          const scope = msg.scope === "project" ? "project" : "user";
          setHooksConfig((prev) => ({
            ...prev,
            [scope]: (msg.hooks as Record<string, unknown>) ?? undefined,
          }));
          break;
        }
        case "mcpConfigResponse": {
          const scope = msg.scope === "project" ? "project" : "user";
          setMcpConfig((prev) => ({
            ...prev,
            [scope]: (msg.mcpServers as Record<string, unknown>) ?? {},
          }));
          break;
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <SettingsPage
      configurationData={configurationData}
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
      initialNav={initialNav}
      vscode={vscode}
      hooksConfig={hooksConfig}
      onLoadHooksConfig={(scope) =>
        vscode.postMessage({ command: "getHooksConfig", scope, workdir })
      }
      mcpConfig={mcpConfig}
      onLoadMcpConfig={(scope) =>
        vscode.postMessage({ command: "getMcpConfig", scope, workdir })
      }
    />
  );
}

root.render(<SettingsPreview />);

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
 *   `setAgentsContent`, `getProjectSettings`, `setBuiltinPluginEnabled`,
 *   `closeSettings`、编辑操作的 `openFile` + `prefillPrompt`（`openFile` 必须先发：
 *   host 处理 `prefillPrompt` 即关闭本设置 webview，之后到达的 `openFile` 会被丢弃）
 * - host → webview: `configurationResponse`, `agentsContentResponse`,
 *   `agentsContentSaved`, `projectSettings`, `settingsState` (workdir push on open)
 */
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import SettingsPage from "./components/SettingsPage";
import type { NavKey } from "./components/SettingsPage";
import type { ConfigurationData } from "./types";
import { useHostMessage } from "./utils/useHostMessage";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

const vscode = window.acquireVsCodeApi();

const root = ReactDOM.createRoot(document.getElementById("root")!);

function SettingsPreview() {
  const [configurationData, setConfigurationData] =
    useState<ConfigurationData | null>(null);
  const [saving, setSaving] = useState(false);
  const [workdir, setWorkdir] = useState<string | undefined>(undefined);
  // Ref mirror for the once-registered message listener below (its closure only
  // sees the initial value otherwise): the projectSettings reply is stamped with
  // the workdir current when it lands.
  const workdirRef = useRef<string | undefined>(undefined);
  const [userAgentsContent, setUserAgentsContent] = useState<string | null>(
    null,
  );
  const [projectAgentsContent, setProjectAgentsContent] = useState<
    string | null
  >(null);
  // AGENTS.md 保存进行中（「个性化」视图独立保存）：agentsSaving 在点击保存到
  // host 回发 agentsContentSaved 之间为 true（禁用文本区与保存按钮）；保存结果
  // toast 由宿主发出，本页不渲染页面内提示。
  const [agentsSaving, setAgentsSaving] = useState(false);
  // /agents、/skills 斜杠命令经 openSettings(nav) → settingsState 下发，选中对应选项卡
  const [initialNav, setInitialNav] = useState<NavKey | undefined>(undefined);
  // 项目级 enabledPlugins（「项目设置」视图 SDD 开关）；进入该视图时才向 host
  // 请求（onLoadProjectSettings），host 回发 projectSettings 消息后回填。回填
  // 时按当前工作目录标注（projectSettingsWorkdir），SettingsPage 仅在标注与
  // 当前 workdir 一致时才展示该缓存——会话/工作目录切换后重入会重新拉取。
  const [projectSettings, setProjectSettings] = useState<
    { enabledPlugins: Record<string, boolean> } | undefined
  >(undefined);
  const [projectSettingsWorkdir, setProjectSettingsWorkdir] = useState<
    string | undefined
  >(undefined);

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
  }, []);

  useHostMessage((msg) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.command) {
      case "settingsState":
        if (typeof msg.workdir === "string") {
          setWorkdir(msg.workdir);
          workdirRef.current = msg.workdir;
        }
        if (typeof msg.nav === "string") {
          setInitialNav(msg.nav as NavKey);
        }
        break;
      case "configurationResponse":
        setConfigurationData(msg.configurationData as ConfigurationData);
        setSaving(false);
        break;
      case "configurationError":
        // 保存失败也复位 saving（按钮重新可用）；错误提示由宿主全局 toast 给出。
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
        // 保存结果复位 agentsSaving（按钮/文本区重新可用）；结果 toast 由宿主
        // 在发出本消息时一并推送。
        setAgentsSaving(false);
        break;
      case "projectSettings":
        if (msg.enabledPlugins && typeof msg.enabledPlugins === "object") {
          // host 回带 workdir（归属键）：归属目录与当前目录不一致（settingsState
          // 切换后才落地）的慢回复直接丢弃（过期即弃），不再按到达时目录盖章。
          if (msg.workdir !== workdirRef.current) break;
          setProjectSettings({
            enabledPlugins: msg.enabledPlugins as Record<string, boolean>,
          });
          setProjectSettingsWorkdir(msg.workdir);
        }
        break;
    }
  });

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
        setAgentsSaving(true);
        vscode.postMessage({
          command: "setAgentsContent",
          scope,
          content,
          workdir: scope === "project" ? workdir : undefined,
        });
      }}
      agentsSaving={agentsSaving}
      workdir={workdir}
      saving={saving}
      initialNav={initialNav}
      vscode={vscode}
      projectSettings={projectSettings}
      projectSettingsWorkdir={projectSettingsWorkdir}
      onLoadProjectSettings={() =>
        vscode.postMessage({ command: "getProjectSettings" })
      }
      onToggleBuiltinPlugin={(pluginId, enabled) =>
        vscode.postMessage({
          command: "setBuiltinPluginEnabled",
          pluginId,
          enabled,
          scope: "project",
        })
      }
      onPrefillPrompt={(prompt, openFile) => {
        // 顺序关键：openFile 必须先于 prefillPrompt 发出。host 处理 prefillPrompt
        // 时会关闭/销毁本设置 webview（VSCE disposeSettingsPanel、JB closeSettings），
        // 销毁后到达的 openFile 会被丢弃——表现为四个 tab 点「编辑」都不打开文件
        // （VSCE 甚至先在 ExtHost 面板表移除句柄、后续消息直接丢弃）。
        if (openFile) {
          vscode.postMessage({ command: "openFile", path: openFile });
        }
        vscode.postMessage({ command: "prefillPrompt", prompt });
      }}
    />
  );
}

root.render(<SettingsPreview />);

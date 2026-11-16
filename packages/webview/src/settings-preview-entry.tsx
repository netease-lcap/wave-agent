/**
 * Settings webview entry (VS Code / JetBrains editor-area settings tab).
 *
 * A standalone bundle rendered inside the settings WebviewPanel the plugin hosts open in
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
 *   `agentsContentSaved`, `projectSettings`, `configuredModels`（补全模型下拉的
 *   候选清单）, `settingsState` (workdir push on open)
 */
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import SettingsPage from "./components/SettingsPage";
import type {
  AgentsConflict,
  AgentsScope,
  NavKey,
} from "./components/SettingsPage";
import type { ConfigurationData } from "./types";
import type { AgentsReadState } from "./utils/agentsReadState";
import { agentsReadStateFromMessage } from "./utils/agentsReadState";
import { useHostMessage } from "./utils/useHostMessage";
import "./styles/globals.css";
import "./styles/plugin-controls.css";
import "@vscode/codicons/dist/codicon.css";

// The settings tab is a plugin-host-only webview. It is a separate HTML document
// (getSettingsPreviewContent in the VS Code extension / JetBrains bridge), so
// it does not go through src/index.tsx and would otherwise never receive
// data-host="editor" — the control layer scoped to the plugin host would
// silently skip the whole settings page. Remote pages never load this entry.
document.documentElement.dataset.host = "editor";

const vscode = window.acquireVsCodeApi();

const root = ReactDOM.createRoot(document.getElementById("root")!);

function SettingsPreview() {
  const [configurationData, setConfigurationData] =
    useState<ConfigurationData | null>(null);
  // 写盘失败回执：设置页据此把乐观改动回滚（spec agent-config「设置页控件的保存时机」）。
  const [configurationError, setConfigurationError] = useState<
    string | undefined
  >(undefined);
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
  // 个人级 <workdir>/AGENTS.local.md（打开时只预取用户级；项目级与个人级由
  // SettingsPage 在各自 tab 首次激活时按需拉取）。
  const [localAgentsContent, setLocalAgentsContent] = useState<string | null>(
    null,
  );
  // AGENTS.md 保存进行中（「个性化」视图独立保存）：agentsSaving 在点击保存到
  // host 回发 agentsContentSaved 之间为 true（禁用文本区与保存按钮）；保存结果
  // toast 由宿主发出，本页不渲染页面内提示。
  const [agentsSaving, setAgentsSaving] = useState(false);
  // 各档读状态（是否存在 / 读取是否成功 / 内容 hash）：决定编辑器能不能写、保存带
  // 什么 expectedHash（spec memory-management 场景 8–13）。
  const [agentsReadState, setAgentsReadState] = useState<
    Partial<Record<AgentsScope, AgentsReadState | null>>
  >({});
  // 保存被并发校验拒绝的档：把该档内容置回 null 让设置页按「未加载」重读（场景 12）。
  const [agentsConflict, setAgentsConflict] = useState<AgentsConflict | null>(
    null,
  );
  const agentsConflictTokenRef = useRef(0);
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
  // 补全模型下拉的候选清单（与对话模型同源，经宿主的 `getConfiguredModels`
  // 会话级 RPC —— 本设置 webview 是独立外壳，chat 的那条回包到不了这里，故
  // 由本页自己发请求；宿主未接该命令时保持空数组 = 下拉只显示当前值与未设置态）。
  const [configuredModels, setConfiguredModels] = useState<string[]>([]);

  useEffect(() => {
    // Report readiness before pulling data: the host re-serves the cached
    // settingsState (workdir + nav) on settingsReady — a settingsState posted
    // right after the panel was created is dropped because this page's JS has
    // not registered its message listener yet (VS Code does not buffer it), which
    // would leave /mcp、/agents、/skills、/hooks unable to preselect a tab.
    vscode.postMessage({ command: "settingsReady" });
    // On open: pull the configuration + the user-level AGENTS.md (the
    // personalization view requests the project / local scopes on demand, same
    // as the desktop full-page does via ChatApp).
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
        setConfigurationError(undefined);
        break;
      case "configurationError":
        // 写盘失败：把错误交给设置页回滚到上一次生效值；错误提示由宿主全局 toast 给出。
        setConfigurationError(
          typeof msg.error === "string" ? msg.error : "保存失败",
        );
        break;
      case "agentsContentResponse":
        // 三档分流（user / project / local）+ 读状态（exists / readable / hash）：
        // 落到别档会把内容显示在错误的编辑器里，丢了状态则编辑器无法判断能不能写。
        {
          const scope: AgentsScope =
            msg.scope === "project"
              ? "project"
              : msg.scope === "local"
                ? "local"
                : "user";
          const content = typeof msg.content === "string" ? msg.content : "";
          if (scope === "project") setProjectAgentsContent(content);
          else if (scope === "local") setLocalAgentsContent(content);
          else setUserAgentsContent(content);
          setAgentsReadState((prev) => ({
            ...prev,
            [scope]: agentsReadStateFromMessage(msg),
          }));
        }
        break;
      case "agentsContentSaved":
        // 保存结果复位 agentsSaving（按钮/文本区重新可用）；结果 toast 由宿主
        // 在发出本消息时一并推送。
        setAgentsSaving(false);
        // 并发保护触发：拒绝覆盖磁盘，把该档置回「未加载」让设置页重读并保留草稿
        // （spec memory-management 场景 12）。
        if (msg.conflict === true) {
          const scope: AgentsScope =
            msg.scope === "project"
              ? "project"
              : msg.scope === "local"
                ? "local"
                : "user";
          if (scope === "project") setProjectAgentsContent(null);
          else if (scope === "local") setLocalAgentsContent(null);
          else setUserAgentsContent(null);
          setAgentsReadState((prev) => ({ ...prev, [scope]: null }));
          agentsConflictTokenRef.current += 1;
          setAgentsConflict({
            scope,
            token: agentsConflictTokenRef.current,
          });
        }
        break;
      case "configuredModels":
        // 补全模型下拉只要名字（清单条目 = {name, supportsVision}）。
        setConfiguredModels(
          Array.isArray(msg.models)
            ? (msg.models as Array<{ name: string }>).map((m) => m.name)
            : [],
        );
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
        vscode.postMessage({
          command: "updateConfiguration",
          configurationData: data,
        });
      }}
      onClose={() => vscode.postMessage({ command: "closeSettings" })}
      userAgentsContent={userAgentsContent}
      projectAgentsContent={projectAgentsContent}
      localAgentsContent={localAgentsContent}
      onLoadAgentsContent={(scope) =>
        vscode.postMessage({
          command: "getAgentsContent",
          scope,
          // 项目级 / 个人级都落在项目目录里，只有用户级不需要 workdir（漏带
          // 个人级的 workdir 会被宿主拒绝）。
          workdir: scope === "user" ? undefined : workdir,
        })
      }
      onSaveAgentsContent={(scope, content, expectedHash) => {
        setAgentsSaving(true);
        vscode.postMessage({
          command: "setAgentsContent",
          scope,
          content,
          workdir: scope === "user" ? undefined : workdir,
          // undefined = 宿主没给读状态 ⇒ 不发该字段（老的「不校验」行为）。
          ...(expectedHash === undefined ? {} : { expectedHash }),
        });
      }}
      agentsReadState={agentsReadState}
      agentsConflict={agentsConflict}
      agentsSaving={agentsSaving}
      workdir={workdir}
      // 项目换了（settingsState 推来新 workdir）：项目级 / 个人级缓存按归属键作废
      // （见 SettingsPage 的 onResetProjectAgentsContent）；用户级与项目无关，保持。
      // 读状态一并作废：旧项目的 hash 不能用来校验新项目的写入。
      onResetProjectAgentsContent={() => {
        setProjectAgentsContent(null);
        setLocalAgentsContent(null);
        setAgentsReadState((prev) => ({
          ...prev,
          project: null,
          local: null,
        }));
        setAgentsConflict(null);
      }}
      configurationError={configurationError}
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
      configuredModels={configuredModels}
      onLoadConfiguredModels={() =>
        vscode.postMessage({ command: "getConfiguredModels" })
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

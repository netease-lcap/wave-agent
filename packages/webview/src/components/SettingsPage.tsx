/**
 * SettingsPage - Full-height settings page (left navigation + right content)
 *
 * Read-only views (2026-08-31 用户拍板：设置页为只读浏览视图，不做表单编辑与保存，
 * 配置修改走 CLI 命令与配置文件；对齐技能/子代理的只读列表形态):
 * - 全局设置 (global): 只读展示系统语言 + 上下文长度
 * - 直连设置 (connection): 只读展示 API Key / Base URL / Agent Model / Fast Model
 * - 项目设置 (project): SDD 内置插件开关（唯一交互控件，即时启停插件）
 * - 个性化 (personalization): AGENTS.md 只读 + 自动记忆规则只读
 * - 钩子 (hooks): 用户级/项目级双 tab，按事件分组只读展示已配置命令
 * - MCP 服务 (mcp): 用户级/项目级双 tab，服务器列表 + 连接状态 + 连接/断开
 * - 子代理 (subagents) / 技能 (skills): agent 定义与技能列表，内容自
 *   /agents、/skills 弹窗迁移而来（2026-08-29 用户拍板：斜杠命令唤起设置页
 *   对应选项卡，不再弹窗）
 *
 * Layout/dimensions follow the designer's high-fidelity prototype
 * (codechat-ui settings feature) mapped onto wave's native React + VS Code
 * theme tokens; no Element Plus dependency is used.
 */

import React, { useState, useEffect } from "react";
import { ConfigurationData, McpServerStatus } from "../types";
import SettingsSubagentsView from "./SettingsSubagentsView";
import SettingsSkillsView from "./SettingsSkillsView";
import "../styles/SettingsPage.css";

export interface SettingsPageProps {
  /** 当前配置（getConfiguration 已回），null 表示尚未加载 */
  configurationData: ConfigurationData | null;
  /** 关闭设置页（desktop 返回会话视图 / 标签页关闭） */
  onClose: () => void;
  /** 用户级 AGENTS.md 内容（null=尚未加载） */
  userAgentsContent: string | null;
  /** 项目级 AGENTS.md 内容（按当前项目） */
  projectAgentsContent: string | null;
  /** 加载 AGENTS.md（scope: "user"|"project"），ChatApp 收到 agentsContentResponse 后回填 */
  onLoadAgentsContent: (scope: "user" | "project") => void;
  /** 当前工作目录路径（用于个性化项目列表展示项目名），可空 */
  workdir?: string;
  /** 初始选中的导航项（/agents → subagents、/skills → skills 斜杠命令唤起时由外层传入） */
  initialNav?: NavKey;
  /** Host 消息桥，供「子代理」「技能」选项卡请求数据 */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 项目级设置（.wave/settings.json 合并后的 enabledPlugins），「项目设置」视图使用 */
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  /** 加载项目设置（触发 host 读取项目 .wave/settings.json） */
  onLoadProjectSettings?: () => void;
  /** 切换内置插件开关（写回项目 .wave/settings.json） */
  onToggleBuiltinPlugin?: (pluginId: string, enabled: boolean) => void;
  /** 用户级/项目级 hooks 配置（settings.json hooks，getHooksConfig RPC 回填），「钩子」视图使用 */
  hooksConfig?: Partial<
    Record<"user" | "project", Record<string, unknown> | undefined>
  >;
  /** 加载某 scope 的 hooks 配置（触发 host 经 stdio 读取配置文件） */
  onLoadHooksConfig?: (scope: "user" | "project") => void;
  /** 用户级/项目级 MCP 服务器配置（mcp.json，getMcpConfig RPC 回填），「MCP 服务」视图使用 */
  mcpConfig?: Partial<
    Record<"user" | "project", Record<string, unknown> | undefined>
  >;
  /** 加载某 scope 的 MCP 配置（触发 host 经 stdio 读取配置文件） */
  onLoadMcpConfig?: (scope: "user" | "project") => void;
}

export type NavKey =
  | "global"
  | "connection"
  | "personalization"
  | "project"
  | "skills"
  | "subagents"
  | "hooks"
  | "mcp";

type AgentsScope = "user" | "project";

interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** 导航：8 项分 3 组（对齐原型 settings-navigation.ts） */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "通用",
    items: [
      { key: "global", label: "全局设置", icon: "settings-gear" },
      { key: "connection", label: "直连设置", icon: "plug" },
      { key: "personalization", label: "个性化", icon: "person" },
    ],
  },
  {
    label: "工作区",
    items: [{ key: "project", label: "项目设置", icon: "repo" }],
  },
  {
    label: "AI 与扩展",
    items: [
      { key: "skills", label: "技能", icon: "lightbulb" },
      { key: "subagents", label: "子代理", icon: "account" },
      { key: "hooks", label: "钩子", icon: "link" },
      { key: "mcp", label: "MCP 服务", icon: "globe" },
    ],
  },
];

/** 钩子事件中文名（展示用） */
const HOOK_EVENT_LABELS: Record<string, string> = {
  PreToolUse: "工具使用前",
  PostToolUse: "工具使用后",
  UserPromptSubmit: "用户提示提交",
  Stop: "停止",
  SubagentStop: "子代理停止",
  PermissionRequest: "权限请求",
  WorktreeCreate: "工作树创建",
  WorktreeRemove: "工作树删除",
  CwdChanged: "工作目录变更",
  SessionStart: "会话开始",
  SessionEnd: "会话结束",
  PreCompact: "压缩前",
  PostCompact: "压缩后",
};

/** 从工作目录路径提取项目名（兼容 Windows/posix 分隔符） */
function getProjectName(workdir?: string): string {
  if (!workdir) return "当前项目";
  const parts = workdir.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : workdir;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  configurationData,
  onClose,
  userAgentsContent,
  projectAgentsContent,
  onLoadAgentsContent,
  workdir,
  initialNav,
  vscode,
  projectSettings,
  onLoadProjectSettings,
  onToggleBuiltinPlugin,
  hooksConfig,
  onLoadHooksConfig,
  mcpConfig,
  onLoadMcpConfig,
}) => {
  const [activeNav, setActiveNav] = useState<NavKey>(initialNav ?? "global");

  // IDE 标签页场景：设置页常驻挂载，/agents、/skills 再次唤起时 host 通过
  // settingsState 下发新的 nav，此处同步选中项（desktop 每次打开会重挂载，
  // 初始值已覆盖，本 effect 为幂等）。
  useEffect(() => {
    if (initialNav) setActiveNav(initialNav);
  }, [initialNav]);

  // 展示值（configurationData 回填后同步）
  const [language, setLanguage] = useState("zh-CN");
  const [contextLength, setContextLength] = useState(200);
  const [autoMemoryEnabled, setAutoMemoryEnabled] = useState(true);
  const [autoMemoryFrequency, setAutoMemoryFrequency] = useState(1);

  // 直连设置展示值（API Key / Base URL / Agent Model / Fast Model）
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [fastModel, setFastModel] = useState("");

  // 项目设置（SDD 开关）：切换中标记，防止重复请求
  const [pluginToggling, setPluginToggling] = useState(false);

  // AGENTS.md 编辑器
  const [activeScope, setActiveScope] = useState<AgentsScope>("user");
  const [userContent, setUserContent] = useState("");
  const [projectContent, setProjectContent] = useState("");

  // 配置数据变化时同步表单草稿
  useEffect(() => {
    if (!configurationData) return;
    setLanguage(configurationData.language || "zh-CN");
    setContextLength(configurationData.contextLength ?? 200);
    setAutoMemoryEnabled(configurationData.autoMemoryEnabled ?? true);
    setAutoMemoryFrequency(configurationData.autoMemoryFrequency ?? 1);
    setApiKey(configurationData.apiKey || "");
    setBaseURL(configurationData.baseURL || "");
    setModel(configurationData.model || "");
    setFastModel(configurationData.fastModel || "");
  }, [configurationData]);

  // AGENTS.md 内容回填后同步 textarea 草稿
  useEffect(() => {
    if (userAgentsContent !== null) setUserContent(userAgentsContent);
  }, [userAgentsContent]);

  useEffect(() => {
    if (projectAgentsContent !== null) setProjectContent(projectAgentsContent);
  }, [projectAgentsContent]);

  // 初次进入或切换 tab 时，对应内容尚未加载则请求加载
  useEffect(() => {
    if (activeScope === "user") {
      if (userAgentsContent === null) onLoadAgentsContent("user");
    } else if (projectAgentsContent === null) {
      onLoadAgentsContent("project");
    }
  }, [
    activeScope,
    userAgentsContent,
    projectAgentsContent,
    onLoadAgentsContent,
  ]);

  // 进入「项目设置」视图时加载项目级 enabledPlugins（切换成功后 host 会回发
  // projectSettings 消息自动刷新）
  useEffect(() => {
    if (activeNav === "project" && !projectSettings && onLoadProjectSettings) {
      onLoadProjectSettings();
    }
  }, [activeNav, projectSettings, onLoadProjectSettings]);

  const sddEnabled = projectSettings?.enabledPlugins?.["sdd@builtin"] === true;

  const handleToggleSdd = () => {
    if (!onToggleBuiltinPlugin || pluginToggling) return;
    setPluginToggling(true);
    onToggleBuiltinPlugin("sdd@builtin", !sddEnabled);
  };

  // 切换结果（projectSettings 消息）到达后解除禁用
  useEffect(() => {
    setPluginToggling(false);
  }, [projectSettings]);

  // ── 钩子 / MCP 视图（只读）───────────────────────────────────────
  // MCP 服务器运行时状态（getMcpServers RPC 返回，含连接状态/工具数/错误）
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [mcpConnecting, setMcpConnecting] = useState<Record<string, boolean>>(
    {},
  );

  // 进入「钩子」/「MCP 服务」视图时，双 tab（用户级/项目级）配置各加载一次
  useEffect(() => {
    if (activeNav === "hooks" && onLoadHooksConfig) {
      if (!hooksConfig?.user) onLoadHooksConfig("user");
      if (!hooksConfig?.project) onLoadHooksConfig("project");
    }
  }, [activeNav, hooksConfig, onLoadHooksConfig]);

  useEffect(() => {
    if (activeNav === "mcp" && onLoadMcpConfig) {
      if (!mcpConfig?.user) onLoadMcpConfig("user");
      if (!mcpConfig?.project) onLoadMcpConfig("project");
    }
  }, [activeNav, mcpConfig, onLoadMcpConfig]);

  // 进入「MCP 服务」视图时拉取一次服务器状态（连接/断开后 host 会回发
  // mcpServersResponse / mcpServersUpdate 刷新）
  useEffect(() => {
    if (activeNav === "mcp") {
      vscode?.postMessage({ command: "getMcpServers" });
    }
  }, [activeNav, vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        message.command === "mcpServersResponse" ||
        message.command === "mcpServersUpdate"
      ) {
        setMcpServers(message.servers || []);
        setMcpConnecting({});
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnectMcpServer = (serverName: string) => {
    setMcpConnecting((prev) => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: "connectMcpServer", serverName });
  };

  const handleDisconnectMcpServer = (serverName: string) => {
    setMcpConnecting((prev) => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: "disconnectMcpServer", serverName });
  };

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <button type="button" className="settings-back" onClick={onClose}>
            <i className="codicon codicon-arrow-left" />
            <span>返回</span>
          </button>
          <nav className="settings-navigation" aria-label="设置">
            {NAV_GROUPS.map((group) => (
              <div className="settings-nav-group" key={group.label}>
                <h2>{group.label}</h2>
                <div className="settings-nav-items">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`settings-nav-item${
                        activeNav === item.key ? " is-active" : ""
                      }`}
                      aria-current={activeNav === item.key ? "page" : undefined}
                      onClick={() => setActiveNav(item.key)}
                    >
                      <i className={`codicon codicon-${item.icon}`} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          {activeNav === "global" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>全局设置</h1>
                <p>管理 Wave 的界面、模型和基础行为。</p>
              </header>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>基础设置</h2>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>系统语言</h3>
                      <p>设置 Wave 界面和系统提示使用的语言</p>
                    </div>
                    <div className="settings-control">
                      <span className="settings-readonly-value">
                        {language === "en-US" ? "English" : "中文"}
                      </span>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>上下文长度</h3>
                      <p>设置新对话默认可以使用的最大上下文长度</p>
                    </div>
                    <div className="settings-number-control">
                      <span className="settings-readonly-value">
                        {contextLength} K
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeNav === "connection" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>直连设置</h1>
                <p>配置直连模式下的 API 地址与模型参数。</p>
              </header>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>直连 LLM</h2>
                  <p>
                    配置直连模式下的 API
                    地址与模型参数，保存后优先使用此配置，无需登录即可正常使用插件。
                  </p>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>API Key</h3>
                      <p>LLM 服务的访问密钥</p>
                    </div>
                    <div className="settings-control">
                      <span className="settings-readonly-value">
                        {apiKey || "未配置"}
                      </span>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>Base URL</h3>
                      <p>LLM 服务的 API 基础地址</p>
                    </div>
                    <div className="settings-control">
                      <span className="settings-readonly-value">
                        {baseURL || "未配置"}
                      </span>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>Agent Model</h3>
                      <p>主代理使用的模型</p>
                    </div>
                    <div className="settings-control">
                      <span className="settings-readonly-value">
                        {model || "未配置"}
                      </span>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>Fast Model</h3>
                      <p>用于轻量任务（如目标评估、摘要）的快速模型</p>
                    </div>
                    <div className="settings-control">
                      <span className="settings-readonly-value">
                        {fastModel || "未配置"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeNav === "project" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>项目设置</h1>
                <p>管理当前项目的专属配置。</p>
              </header>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>内置插件</h2>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>SDD（规格驱动开发）</h3>
                      <p>自动创建或更新功能规格说明，切换后自动生效</p>
                    </div>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        aria-label="启用 SDD 插件"
                        checked={sddEnabled}
                        disabled={pluginToggling || !projectSettings}
                        onChange={handleToggleSdd}
                      />
                      <span className="settings-switch-slider"></span>
                    </label>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeNav === "personalization" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>个性化</h1>
                <p>配置用户级和项目级 AGENTS.md，以及自动记忆规则。</p>
              </header>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>AGENTS.md</h2>
                  <p>通过文本内容定义 AI 的长期工作规则</p>
                </div>
                <div className="settings-card agents-card">
                  <div
                    className="settings-tabs"
                    role="tablist"
                    aria-label="规则范围"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeScope === "user"}
                      className={`settings-tab${
                        activeScope === "user" ? " is-active" : ""
                      }`}
                      onClick={() => setActiveScope("user")}
                    >
                      用户级
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeScope === "project"}
                      className={`settings-tab${
                        activeScope === "project" ? " is-active" : ""
                      }`}
                      onClick={() => setActiveScope("project")}
                    >
                      项目级
                    </button>
                  </div>
                  <div className="agents-editor">
                    {activeScope === "project" && (
                      <div className="project-list" aria-label="项目">
                        <button
                          type="button"
                          className="project-item is-active"
                        >
                          {getProjectName(workdir)}
                        </button>
                      </div>
                    )}
                    <textarea
                      className="settings-textarea"
                      aria-label={
                        activeScope === "project"
                          ? "项目级 AGENTS.md 内容"
                          : "用户级 AGENTS.md 内容"
                      }
                      value={
                        activeScope === "user" ? userContent : projectContent
                      }
                      readOnly
                    />
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>自动记忆规则</h2>
                </div>
                <div className="settings-card memory-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>开启自动记忆</h3>
                      <p>自动从对话中提取稳定偏好并写入记忆，默认开启</p>
                    </div>
                    <span className="settings-readonly-value">
                      {autoMemoryEnabled ? "已开启" : "已关闭"}
                    </span>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>触发记忆提取会话轮次</h3>
                      <p>达到指定对话轮次后执行记忆提取，默认 1 轮</p>
                    </div>
                    <div className="memory-turns">
                      <span className="settings-readonly-value">
                        {autoMemoryFrequency} 轮
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeNav === "subagents" && (
            <SettingsSubagentsView vscode={vscode} />
          )}

          {activeNav === "skills" && <SettingsSkillsView vscode={vscode} />}

          {activeNav === "hooks" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>钩子</h1>
                <p>
                  配置会话生命周期事件的钩子脚本（只读，修改请编辑配置文件）。
                </p>
              </header>
              <div
                className="settings-tabs"
                role="tablist"
                aria-label="配置范围"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeScope === "user"}
                  className={`settings-tab${
                    activeScope === "user" ? " is-active" : ""
                  }`}
                  onClick={() => setActiveScope("user")}
                >
                  用户级
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeScope === "project"}
                  className={`settings-tab${
                    activeScope === "project" ? " is-active" : ""
                  }`}
                  onClick={() => setActiveScope("project")}
                >
                  项目级
                </button>
              </div>
              {renderHooks(hooksConfig?.[activeScope])}
            </div>
          )}

          {activeNav === "mcp" && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>MCP 服务</h1>
                <p>管理 MCP 服务器连接（配置只读，修改请编辑配置文件）。</p>
              </header>
              <div
                className="settings-tabs"
                role="tablist"
                aria-label="配置范围"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeScope === "user"}
                  className={`settings-tab${
                    activeScope === "user" ? " is-active" : ""
                  }`}
                  onClick={() => setActiveScope("user")}
                >
                  用户级
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeScope === "project"}
                  className={`settings-tab${
                    activeScope === "project" ? " is-active" : ""
                  }`}
                  onClick={() => setActiveScope("project")}
                >
                  项目级
                </button>
              </div>
              {renderMcpServers(
                mcpConfig?.[activeScope],
                mcpServers,
                mcpConnecting,
                handleConnectMcpServer,
                handleDisconnectMcpServer,
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

/** 钩子只读视图：按事件分组展示已配置的命令（含异步/超时/匹配器标注） */
function renderHooks(
  hooks: Record<string, unknown> | undefined,
): React.ReactNode {
  const events = Object.entries(hooks ?? {});
  if (events.length === 0) {
    return (
      <div className="settings-empty-state">
        <p>当前层级未配置钩子。</p>
        <p className="settings-empty-hint">
          在对应层级的 settings.json 的 hooks 字段中配置
        </p>
      </div>
    );
  }

  return (
    <div className="settings-hooks-list">
      {events.map(([event, configs]) => {
        const configList = Array.isArray(configs) ? configs : [];
        const commands = configList.flatMap((config) => {
          const cfg = config as Record<string, unknown>;
          const hooksList = Array.isArray(cfg.hooks) ? cfg.hooks : [];
          const matcher =
            typeof cfg.matcher === "string" ? cfg.matcher : undefined;
          return hooksList.map((hook) => ({
            command: String((hook as Record<string, unknown>).command ?? ""),
            async: (hook as Record<string, unknown>).async === true,
            timeout: (hook as Record<string, unknown>).timeout,
            matcher,
          }));
        });
        if (commands.length === 0) return null;
        return (
          <div className="settings-section" key={event}>
            <div className="settings-section-heading hooks-event-heading">
              <h2>{HOOK_EVENT_LABELS[event] ?? event}</h2>
              <code className="hooks-event-key">{event}</code>
            </div>
            <div className="settings-card">
              {commands.map((cmd, index) => (
                <div className="settings-row" key={index}>
                  <div className="settings-row-copy hooks-command-copy">
                    <code className="hooks-command">{cmd.command}</code>
                    <p>
                      {[
                        cmd.matcher ? `匹配: ${cmd.matcher}` : "",
                        cmd.async ? "异步" : "",
                        cmd.timeout ? `超时: ${cmd.timeout}s` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "同步执行"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** MCP 只读视图：当前层级配置的服务器列表 + 运行时状态 + 连接/断开 */
function renderMcpServers(
  mcpServers: Record<string, unknown> | undefined,
  statuses: McpServerStatus[],
  connecting: Record<string, boolean>,
  onConnect: (name: string) => void,
  onDisconnect: (name: string) => void,
): React.ReactNode {
  const entries = Object.entries(mcpServers ?? {});
  if (entries.length === 0) {
    return (
      <div className="settings-empty-state">
        <p>当前层级未配置 MCP 服务器。</p>
        <p className="settings-empty-hint">
          在 ~/.wave/mcp.json（用户级）或项目根 .mcp.json（项目级）中配置
        </p>
      </div>
    );
  }

  return (
    <div className="settings-mcp-list">
      {entries.map(([name, cfg]) => {
        const status = statuses.find((s) => s.name === name);
        return (
          <div className="settings-section" key={name}>
            <div className="settings-card mcp-server-item">
              <div className="settings-row">
                <div className="settings-row-copy">
                  <h3>
                    <span
                      className={`mcp-status-dot mcp-status-${status?.status ?? "disconnected"}`}
                      title={status?.status ?? "disconnected"}
                    />
                    {name}
                  </h3>
                  <p>{describeMcpServer(cfg)}</p>
                  {status?.error && (
                    <p className="mcp-server-error">{status.error}</p>
                  )}
                  {status?.toolCount !== undefined &&
                    status.status === "connected" && (
                      <p className="mcp-server-tools">
                        {status.toolCount} tools
                      </p>
                    )}
                </div>
                <div className="settings-control">
                  {status &&
                    (status.status === "disconnected" ||
                      status.status === "error") && (
                      <button
                        type="button"
                        className="settings-secondary-btn"
                        onClick={() => onConnect(name)}
                        disabled={connecting[name]}
                      >
                        {connecting[name] ? "连接中..." : "连接"}
                      </button>
                    )}
                  {status?.status === "connected" && (
                    <button
                      type="button"
                      className="settings-secondary-btn"
                      onClick={() => onDisconnect(name)}
                      disabled={connecting[name]}
                    >
                      {connecting[name] ? "断开中..." : "断开"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 描述 MCP 服务器配置（类型 + 命令或端点） */
function describeMcpServer(cfg: unknown): string {
  const config = cfg as Record<string, unknown> | undefined;
  if (!config) return "";
  const type = typeof config.type === "string" ? config.type : "stdio";
  if (typeof config.url === "string" && config.url) {
    return `类型: ${type} · 端点: ${config.url}`;
  }
  const command =
    typeof config.command === "string" ? config.command : "未知命令";
  const args = Array.isArray(config.args) ? config.args.join(" ") : "";
  return `类型: ${type} · 命令: ${command}${args ? ` ${args}` : ""}`;
}

export default SettingsPage;

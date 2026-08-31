/**
 * SettingsPage - Full-height settings page (left navigation + right content)
 *
 * Functional views in this batch:
 * - 全局设置 (global): system language + context length
 * - 个性化 (personalization): AGENTS.md editor + auto-memory rules
 * - 子代理 (subagents) / 技能 (skills): agent 定义与技能列表，内容自
 *   /agents、/skills 弹窗迁移而来（2026-08-29 用户拍板：斜杠命令唤起设置页
 *   对应选项卡，不再弹窗）
 * The remaining four navigation entries render a "coming soon" placeholder.
 *
 * Layout/dimensions follow the designer's high-fidelity prototype
 * (codechat-ui settings feature) mapped onto wave's native React + VS Code
 * theme tokens; no Element Plus dependency is used.
 */

import React, { useState, useEffect } from "react";
import { ConfigurationData } from "../types";
import SettingsSubagentsView from "./SettingsSubagentsView";
import SettingsSkillsView from "./SettingsSkillsView";
import "../styles/SettingsPage.css";

export interface SettingsPageProps {
  /** 当前配置（getConfiguration 已回），null 表示尚未加载 */
  configurationData: ConfigurationData | null;
  /** 保存配置（全局设置视图的保存按钮触发，含 language/contextLength/autoMemoryEnabled/autoMemoryFrequency） */
  onSave: (data: ConfigurationData) => void;
  /** 关闭设置页（desktop 返回会话视图 / 标签页关闭） */
  onClose: () => void;
  /** 用户级 AGENTS.md 内容（null=尚未加载） */
  userAgentsContent: string | null;
  /** 项目级 AGENTS.md 内容（按当前项目） */
  projectAgentsContent: string | null;
  /** 加载 AGENTS.md（scope: "user"|"project"），ChatApp 收到 agentsContentResponse 后回填 */
  onLoadAgentsContent: (scope: "user" | "project") => void;
  /** 保存 AGENTS.md（scope + 内容） */
  onSaveAgentsContent: (scope: "user" | "project", content: string) => void;
  /** 当前工作目录路径（用于个性化项目列表展示项目名），可空 */
  workdir?: string;
  /** 保存 AGENTS.md / 配置的进行中标记 */
  saving?: boolean;
  /** 保存成功/失败提示消息 */
  saveMessage?: string | null;
  /** 初始选中的导航项（/agents → subagents、/skills → skills 斜杠命令唤起时由外层传入） */
  initialNav?: NavKey;
  /** Host 消息桥，供「子代理」「技能」选项卡请求数据 */
  vscode?: { postMessage: (msg: unknown) => void };
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

/** 其余暂未实现的导航项标题与说明 */
const PLACEHOLDER_VIEWS: Record<
  Exclude<NavKey, "global" | "personalization">,
  { title: string; description: string }
> = {
  connection: {
    title: "直连设置",
    description: "配置直连模式下的 API 地址与模型参数。",
  },
  project: { title: "项目设置", description: "管理当前项目的专属配置。" },
  skills: { title: "技能", description: "管理可复用的技能。" },
  subagents: { title: "子代理", description: "配置用于并行处理任务的子代理。" },
  hooks: { title: "钩子", description: "配置会话生命周期事件的钩子脚本。" },
  mcp: { title: "MCP 服务", description: "管理 MCP 服务器连接。" },
};

/** 从工作目录路径提取项目名（兼容 Windows/posix 分隔符） */
function getProjectName(workdir?: string): string {
  if (!workdir) return "当前项目";
  const parts = workdir.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : workdir;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  configurationData,
  onSave,
  onClose,
  userAgentsContent,
  projectAgentsContent,
  onLoadAgentsContent,
  onSaveAgentsContent,
  workdir,
  saving = false,
  saveMessage = null,
  initialNav,
  vscode,
}) => {
  const [activeNav, setActiveNav] = useState<NavKey>(initialNav ?? "global");

  // IDE 标签页场景：设置页常驻挂载，/agents、/skills 再次唤起时 host 通过
  // settingsState 下发新的 nav，此处同步选中项（desktop 每次打开会重挂载，
  // 初始值已覆盖，本 effect 为幂等）。
  useEffect(() => {
    if (initialNav) setActiveNav(initialNav);
  }, [initialNav]);

  // 表单草稿（配置），configurationData 回填后同步
  const [language, setLanguage] = useState("zh-CN");
  const [contextLength, setContextLength] = useState(200);
  const [autoMemoryEnabled, setAutoMemoryEnabled] = useState(true);
  const [autoMemoryFrequency, setAutoMemoryFrequency] = useState(1);

  // AGENTS.md 编辑器
  const [activeScope, setActiveScope] = useState<AgentsScope>("user");
  const [userContent, setUserContent] = useState("");
  const [projectContent, setProjectContent] = useState("");

  // 配置数据变化时同步表单草稿（参照 ConfigDialog 的做法）
  useEffect(() => {
    if (!configurationData) return;
    setLanguage(configurationData.language || "zh-CN");
    setContextLength(configurationData.contextLength ?? 200);
    setAutoMemoryEnabled(configurationData.autoMemoryEnabled ?? true);
    setAutoMemoryFrequency(configurationData.autoMemoryFrequency ?? 1);
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

  const handleSaveGlobal = () => {
    if (!configurationData) return;
    onSave({ ...configurationData, language, contextLength });
  };

  const handleSaveMemory = () => {
    if (!configurationData) return;
    onSave({ ...configurationData, autoMemoryEnabled, autoMemoryFrequency });
  };

  const handleSaveAgents = () => {
    onSaveAgentsContent(
      activeScope,
      activeScope === "user" ? userContent : projectContent,
    );
  };

  const placeholder =
    activeNav !== "global" &&
    activeNav !== "personalization" &&
    activeNav !== "subagents" &&
    activeNav !== "skills"
      ? PLACEHOLDER_VIEWS[activeNav]
      : null;

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
              {saveMessage && (
                <p className="settings-save-message">{saveMessage}</p>
              )}
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
                      <select
                        className="settings-select"
                        aria-label="系统语言"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        <option value="zh-CN">中文</option>
                        <option value="en-US">English</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>上下文长度</h3>
                      <p>设置新对话默认可以使用的最大上下文长度</p>
                    </div>
                    <div className="settings-number-control">
                      <input
                        className="settings-number-input"
                        type="number"
                        aria-label="上下文长度"
                        min={16}
                        max={1000}
                        step={16}
                        value={contextLength}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isNaN(value)) setContextLength(value);
                        }}
                      />
                      <span>K</span>
                    </div>
                  </div>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="settings-save-btn"
                    disabled={!configurationData || saving}
                    onClick={handleSaveGlobal}
                  >
                    保存
                  </button>
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
              {saveMessage && (
                <p className="settings-save-message">{saveMessage}</p>
              )}
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
                      disabled={saving}
                      onChange={(e) => {
                        if (activeScope === "user") {
                          setUserContent(e.target.value);
                        } else {
                          setProjectContent(e.target.value);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="settings-save-btn"
                      disabled={saving}
                      onClick={handleSaveAgents}
                    >
                      保存
                      {activeScope === "project" ? "项目级" : "用户级"}配置
                    </button>
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
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        aria-label="开启自动记忆"
                        checked={autoMemoryEnabled}
                        onChange={(e) => setAutoMemoryEnabled(e.target.checked)}
                      />
                      <span className="settings-switch-slider"></span>
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>触发记忆提取会话轮次</h3>
                      <p>达到指定对话轮次后执行记忆提取，默认 1 轮</p>
                    </div>
                    <div className="memory-turns">
                      <input
                        className="settings-number-input memory-turns-input"
                        type="number"
                        aria-label="触发记忆提取会话轮次"
                        min={1}
                        max={100}
                        value={autoMemoryFrequency}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isNaN(value)) {
                            setAutoMemoryFrequency(value);
                          }
                        }}
                      />
                      <span>轮</span>
                    </div>
                  </div>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="settings-save-btn"
                    disabled={!configurationData || saving}
                    onClick={handleSaveMemory}
                  >
                    保存
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeNav === "subagents" && (
            <SettingsSubagentsView vscode={vscode} />
          )}

          {activeNav === "skills" && <SettingsSkillsView vscode={vscode} />}

          {placeholder && (
            <div className="settings-view">
              <header className="settings-page-header">
                <h1>{placeholder.title}</h1>
                <p>{placeholder.description}</p>
              </header>
              <div className="settings-placeholder">
                <i className="codicon codicon-rocket" />
                <p>该功能即将推出，敬请期待。</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;

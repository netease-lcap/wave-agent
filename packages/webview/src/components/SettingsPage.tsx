/**
 * SettingsPage - Full-height settings page (left navigation + right content)
 *
 * Editable views (2026-09-01 用户拍板：语言/上下文长度/自动记忆恢复可编辑，
 * 经 updateConfiguration 写回，与旧设置弹窗一致；设置页只针对当前项目，
 * 删除项目切换按钮与 4 个管理视图的项目分组卡片):
 * - 全局设置 (global): 系统语言下拉 + 主题选择（仅桌面端，即时生效）
 *   + 上下文长度输入 + 保存
 * - 项目设置 (project): SDD 内置插件开关（唯一交互控件，即时启停插件）
 * - 个性化 (personalization): AGENTS.md 只读 + 自动记忆开关/轮次输入 + 保存
 * - 钩子 (hooks): 用户级/项目级双 tab，按来源平铺展示已配置命令
 * - MCP 服务 (mcp): 用户级/项目级双 tab，服务器列表 + 连接状态 + 连接/断开
 * - 子代理 (subagents) / 技能 (skills): agent 定义与技能列表，内容自
 *   /agents、/skills 弹窗迁移而来（2026-08-29 用户拍板：斜杠命令唤起设置页
 *   对应选项卡，不再弹窗）
 *
 * Layout/dimensions follow the designer's high-fidelity prototype
 * (codechat-ui settings feature) mapped onto wave's native React + VS Code
 * theme tokens; no Element Plus dependency is used.
 */

import React, { useState, useEffect, useRef } from "react";
import { ConfigurationData, ThemeSource } from "../types";
import SettingsSubagentsView from "./SettingsSubagentsView";
import SettingsSkillsView from "./SettingsSkillsView";
import SettingsHooksView from "./SettingsHooksView";
import SettingsMcpView from "./SettingsMcpView";
import {
  SettingsBackIcon,
  SettingsGlobalIcon,
  SettingsHooksIcon,
  SettingsMcpIcon,
  SettingsPersonalizationIcon,
  SettingsProjectIcon,
  SettingsSkillsIcon,
  SettingsSubagentsIcon,
} from "./HeaderIcons";
import "../styles/SettingsPage.css";

export interface SettingsPageProps {
  /** 当前配置（getConfiguration 已回），null 表示尚未加载 */
  configurationData: ConfigurationData | null;
  /** 保存配置（全局设置 / 个性化视图的保存按钮触发，含 language/contextLength/
   *  autoMemoryEnabled/autoMemoryFrequency） */
  onSave?: (data: ConfigurationData) => void;
  /** 主题偏好（仅桌面端传入；未传入 = IDE 宿主，不显示主题行）。
   *  选择即时生效（onThemeChange 触发 host setThemeSource），不依赖保存按钮。 */
  themeSource?: ThemeSource;
  /** 用户选择新主题偏好（"system" | "light" | "dark"），host 持久化并应用。 */
  onThemeChange?: (source: ThemeSource) => void;
  /** 关闭设置页（desktop 返回会话视图 / 标签页关闭） */
  onClose: () => void;
  /** 保存进行中标记（host 回包前为 true，用于禁用保存按钮与显示反馈） */
  saving?: boolean;
  /** 配置保存失败的错误信息（host 回发 configurationError），保存成功应为空 */
  configurationError?: string | null;
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
  /** 关闭设置页并预填 AI 对话框提示词（新建/编辑 技能/子代理/钩子/MCP）。
   *  desktop 由 ChatApp 实现（关设置页 + 主输入框预填）；IDE 由
   *  settings-preview-entry 转发 prefillPrompt RPC 给 host。 */
  onPrefillPrompt?: (prompt: string) => void;
  /** 用系统编辑器打开文件（desktop 走 desktopOpenFileExternal；IDE 缺省时
   *  视图内回退 openFile RPC）。 */
  onOpenExternalFile?: (path: string) => void;
}

export type NavKey =
  | "global"
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
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** 导航：7 项分 3 组（对齐原型 settings-navigation.ts；直连设置随私有化部署移除 2026-09）。
    图标 = Figma 导出 SVG（codechat-ui settings-*.svg 同源），非 codicon 字体。 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "通用",
    items: [
      { key: "global", label: "全局设置", icon: SettingsGlobalIcon },
      {
        key: "personalization",
        label: "个性化",
        icon: SettingsPersonalizationIcon,
      },
    ],
  },
  {
    label: "工作区",
    items: [{ key: "project", label: "项目设置", icon: SettingsProjectIcon }],
  },
  {
    label: "AI 与扩展",
    items: [
      { key: "skills", label: "技能", icon: SettingsSkillsIcon },
      { key: "subagents", label: "子代理", icon: SettingsSubagentsIcon },
      { key: "hooks", label: "钩子", icon: SettingsHooksIcon },
      { key: "mcp", label: "MCP 服务", icon: SettingsMcpIcon },
    ],
  },
];

const SettingsPage: React.FC<SettingsPageProps> = ({
  configurationData,
  onSave,
  themeSource,
  onThemeChange,
  onClose,
  saving = false,
  configurationError = null,
  userAgentsContent,
  projectAgentsContent,
  onLoadAgentsContent,
  workdir,
  initialNav,
  vscode,
  projectSettings,
  onLoadProjectSettings,
  onToggleBuiltinPlugin,
  onPrefillPrompt,
  onOpenExternalFile,
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
  // 主题偏好（仅桌面端有值）：选择即生效（onThemeChange 已即时上送 host），
  // 此处本地 state 保持选中态直到 host 广播 desktopThemeSource 回写。
  const [theme, setTheme] = useState<ThemeSource>(themeSource ?? "system");

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
  }, [configurationData]);

  // host 广播（desktopThemeSource / 重推 setInitialState）同步主题选中态
  useEffect(() => {
    if (themeSource) setTheme(themeSource);
  }, [themeSource]);

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

  // 保存反馈（「保存中…」由外层 saving 驱动；host 回包后按结果生成成功/失败消息）
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveRequestedRef = useRef(false);

  const handleSaveGlobal = () => {
    if (!configurationData || !onSave) return;
    setSaveMessage(null);
    saveRequestedRef.current = true;
    onSave({ ...configurationData, language, contextLength });
  };

  const handleSaveMemory = () => {
    if (!configurationData || !onSave) return;
    setSaveMessage(null);
    saveRequestedRef.current = true;
    onSave({ ...configurationData, autoMemoryEnabled, autoMemoryFrequency });
  };

  // saving 从 true → false（host 回发 configurationResponse/configurationError）
  // 即保存完成，生成反馈；回包前不显示。
  useEffect(() => {
    if (saving || !saveRequestedRef.current) return;
    saveRequestedRef.current = false;
    setSaveMessage(
      configurationError ? `保存失败：${configurationError}` : "保存成功",
    );
  }, [saving, configurationError]);

  const handleToggleSdd = () => {
    if (!onToggleBuiltinPlugin || pluginToggling) return;
    setPluginToggling(true);
    onToggleBuiltinPlugin("sdd@builtin", !sddEnabled);
  };

  // 切换结果（projectSettings 消息）到达后解除禁用
  useEffect(() => {
    setPluginToggling(false);
  }, [projectSettings]);

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <button type="button" className="settings-back" onClick={onClose}>
            <SettingsBackIcon />
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
                      <item.icon />
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
                  {themeSource !== undefined && (
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <h3>主题</h3>
                        <p>选择应用的显示外观，跟随系统或固定浅色/深色</p>
                      </div>
                      <div className="settings-control">
                        <select
                          className="settings-select"
                          aria-label="主题"
                          value={theme}
                          onChange={(e) => {
                            const next = e.target.value as ThemeSource;
                            setTheme(next);
                            onThemeChange?.(next);
                          }}
                        >
                          <option value="system">跟随系统</option>
                          <option value="light">浅色</option>
                          <option value="dark">深色</option>
                        </select>
                      </div>
                    </div>
                  )}
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
            <SettingsSubagentsView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
              onOpenExternalFile={onOpenExternalFile}
            />
          )}

          {activeNav === "skills" && (
            <SettingsSkillsView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
              onOpenExternalFile={onOpenExternalFile}
            />
          )}

          {activeNav === "hooks" && (
            <SettingsHooksView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
              onOpenExternalFile={onOpenExternalFile}
            />
          )}

          {activeNav === "mcp" && (
            <SettingsMcpView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
              onOpenExternalFile={onOpenExternalFile}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;

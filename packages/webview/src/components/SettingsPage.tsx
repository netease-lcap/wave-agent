/**
 * SettingsPage - Full-height settings page (left navigation + right content)
 *
 * Editable views (2026-09-01 用户拍板：语言/上下文长度/自动记忆恢复可编辑，
 * 经 updateConfiguration 写回，与旧设置弹窗一致；设置页只针对当前项目，
 * 删除项目切换按钮与 4 个管理视图的项目分组卡片；2026-09-04 拍板：
 * 「个性化」AGENTS.md 一并恢复可编辑 + 独立保存，写回对应文件):
 * - 全局设置 (global): 「基础设置」= AI 回复语言下拉 + 上下文长度输入 + 保存
 *   （走 stdio updateConfiguration）；「桌面端设置」区块 = 主题 + 接收 Beta 版
 *   更新（仅桌面端渲染，host 直连 configStore 通道即时生效，无保存按钮；
 *   2026-09-08 拍板从「基础设置」拆出）
 * - 项目设置 (project): SDD 内置插件开关（唯一交互控件，即时启停插件）
 * - 个性化 (personalization): AGENTS.md 可编辑（用户级/项目级文本区 + 独立保存，
 *   经 setAgentsContent RPC 写回对应文件）+ 自动记忆开关/轮次输入 + 保存
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
import { ConfigurationData, ThemeSource, UpdateChannel } from "../types";
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
import { useDesktopChrome } from "./DesktopChromeContext";
import { isMacHiddenTitlebar } from "../utils/platform";

export interface SettingsPageProps {
  /** 当前配置（getConfiguration 已回），null 表示尚未加载 */
  configurationData: ConfigurationData | null;
  /** 保存配置（全局设置 / 个性化视图的保存按钮触发）。**只带用户真正改动过的
   *  字段**（diff 载荷）：未改动的键、仍处于「未设置」态的键都不出现——宿主与
   *  CLI RPC 把「省略键」当作「不改该键」（spec agent-config 边界说明「省略键 =
   *  不改该键」）。 */
  onSave?: (data: ConfigurationData) => void;
  /** 主题偏好（仅桌面端传入；未传入 = IDE 宿主，不渲染「桌面端设置」区块与
   *  主题行）。选择即时生效（onThemeChange 触发 host setThemeSource），
   *  不依赖保存按钮。 */
  themeSource?: ThemeSource;
  /** 用户选择新主题偏好（"system" | "light" | "dark"），host 持久化并应用。 */
  onThemeChange?: (source: ThemeSource) => void;
  /** 桌面端更新通道（仅桌面端传入；未传入 = IDE 宿主，不渲染「桌面端设置」
   *  区块与开关行）。切换即时生效（onUpdateChannelChange 触发 host
   *  setUpdateChannel），不依赖保存按钮。 */
  updateChannel?: UpdateChannel;
  /** 用户切换更新通道（"stable" | "beta"），host 持久化并立即按新 feed 重查。 */
  onUpdateChannelChange?: (channel: UpdateChannel) => void;
  /** 关闭设置页（desktop 返回会话视图 / 标签页关闭） */
  onClose: () => void;
  /** 保存进行中标记（host 回包前为 true，用于禁用保存按钮；保存结果反馈由
   *  宿主全局 toast 提示，本组件不渲染页面内自建提示——2026-09-09 拍板） */
  saving?: boolean;
  /** 用户级 AGENTS.md 内容（null=尚未加载） */
  userAgentsContent: string | null;
  /** 项目级 AGENTS.md 内容（按当前项目） */
  projectAgentsContent: string | null;
  /** 加载 AGENTS.md（scope: "user"|"project"），ChatApp 收到 agentsContentResponse 后回填 */
  onLoadAgentsContent: (scope: "user" | "project") => void;
  /** 保存 AGENTS.md（scope: "user"|"project"）：经 setAgentsContent RPC 写回
   *  用户级 ~/.wave/AGENTS.md 或项目级 <workdir>/AGENTS.md，host 回发
   *  agentsContentSaved 报告结果。未传入 = 宿主不支持写入（降级只读）。 */
  onSaveAgentsContent?: (scope: "user" | "project", content: string) => void;
  /** AGENTS.md 保存进行中（host 回包前为 true，用于禁用文本区与保存按钮；
   *  保存结果反馈由宿主全局 toast 提示，本组件不渲染页面内自建提示） */
  agentsSaving?: boolean;
  /** 当前工作目录路径（用于个性化项目列表展示项目名），可空 */
  workdir?: string;
  /** 初始选中的导航项（/agents → subagents、/skills → skills 斜杠命令唤起时由外层传入） */
  initialNav?: NavKey;
  /** Host 消息桥，供「子代理」「技能」选项卡请求数据 */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 项目级设置（.wave/settings.json 合并后的 enabledPlugins），「项目设置」视图使用 */
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  /** projectSettings 对应的工作目录（host 回发时由外层按当前活动项目标注）。
   *  缓存仅在与当前工作目录一致时才可信，避免把别的项目的开关状态误显示
   *  在当前项目下（对齐 ChatApp gitBranches 按 workdir 键控的渲染模式）。 */
  projectSettingsWorkdir?: string;
  /** 加载项目设置（触发 host 读取项目 .wave/settings.json） */
  onLoadProjectSettings?: () => void;
  /** 切换内置插件开关（写回项目 .wave/settings.json） */
  onToggleBuiltinPlugin?: (pluginId: string, enabled: boolean) => void;
  /** 关闭设置页并预填 AI 对话框提示词（新建/编辑 技能/子代理/钩子/MCP）。
   *  编辑操作附带 openFile（配置文件路径）：desktop 由 ChatApp 实现（关设置页 +
   *  会话视图右侧文件面板打开该文件）；IDE 由 settings-preview-entry 转发
   *  prefillPrompt + openFile RPC 给 host（host 用 IDE 自身编辑器打开）。 */
  onPrefillPrompt?: (prompt: string, openFile?: string) => void;
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

/**
 * 用户偏好「未设置」态的表达（spec agent-config「IDE 插件配置入口」场景 7–8）：
 *
 * settings.json 里没有某个键时，控件显示**系统默认**而不是假装一个真实值——
 * 语言下拉用一个显式项（下拉没有 placeholder 语义）、两个数字输入留空 + 灰字
 * 占位符；开关不做占位态（它的真实默认就是「开」，三态开关更难用）。草稿用
 * `""` 表示未设置，与「设置成某个值」区分开。
 *
 * 保存时只把**用户真正改动过的字段**放进载荷（省略键 = 不改该键）：未改动的、
 * 仍处于未设置态的一律不写，因此系统环境里已有的 `WAVE_MAX_INPUT_TOKENS` 不会
 * 被「随手保存一次」钉成 200000（见同名边界说明）。把已写过的值清空等同
 * 「不改该键」——不提供「清除 / 恢复默认」按钮（载荷没有删键语义）。
 */
export const UNSET_OPTION_LABEL = "未设置（默认：中文）";
export const CONTEXT_LENGTH_PLACEHOLDER = "跟随模型配置（默认 200K）";
export const AUTO_MEMORY_FREQUENCY_PLACEHOLDER = "默认 1 轮";

/** 未设置态（空草稿）一律不写；与初始值相同也不写。 */
function changedString(current: string, initial?: string): string | undefined {
  if (current.trim() === "") return undefined;
  return current === (initial ?? "") ? undefined : current;
}

/** 未设置态（空草稿）一律不写；与初始值相同也不写（非数字视为未改动）。 */
function changedNumber(current: string, initial?: number): number | undefined {
  if (current.trim() === "") return undefined;
  const value = Number(current);
  if (!Number.isFinite(value)) return undefined;
  return value === initial ? undefined : value;
}

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
  updateChannel,
  onUpdateChannelChange,
  onClose,
  saving = false,
  userAgentsContent,
  projectAgentsContent,
  onLoadAgentsContent,
  onSaveAgentsContent,
  agentsSaving = false,
  workdir,
  initialNav,
  vscode,
  projectSettings,
  projectSettingsWorkdir,
  onLoadProjectSettings,
  onToggleBuiltinPlugin,
  onPrefillPrompt,
}) => {
  const [activeNav, setActiveNav] = useState<NavKey>(initialNav ?? "global");

  // macOS 全屏状态（仅 desktop 宿主有 Provider 供值；IDE 宿主无 Provider 读默认
  // false）——设置页占满整个 view 时由自身窗口行承接红绿灯让位，系统全屏
  // （红绿灯隐藏）时让位行收起。
  const { fullScreen } = useDesktopChrome();

  // IDE 标签页场景：设置页常驻挂载，/agents、/skills 再次唤起时 host 通过
  // settingsState 下发新的 nav，此处同步选中项（desktop 每次打开会重挂载，
  // 初始值已覆盖，本 effect 为幂等）。
  useEffect(() => {
    if (initialNav) setActiveNav(initialNav);
  }, [initialNav]);

  // 用户偏好草稿（configurationData 回填后同步）。`""` = 未设置（settings.json
  // 里没有该键）——此时控件显示系统默认（占位符 /「未设置（默认：中文）」项），
  // 保存时不写该键（见文件顶部 UNSET 说明与 spec agent-config 场景 7–8）。
  const [language, setLanguage] = useState("");
  const [contextLength, setContextLength] = useState("");
  const [autoMemoryFrequency, setAutoMemoryFrequency] = useState("");
  // 自动记忆开关不做占位态：它的真实默认就是「开」，三态开关更难用（spec 场景 7）。
  const [autoMemoryEnabled, setAutoMemoryEnabled] = useState(true);
  // 主题偏好（仅桌面端有值）：选择即生效（onThemeChange 已即时上送 host），
  // 此处本地 state 保持选中态直到 host 广播 desktopThemeSource 回写。
  const [theme, setTheme] = useState<ThemeSource>(themeSource ?? "system");
  // 更新通道（仅桌面端有值）：切换即生效（onUpdateChannelChange 已即时上送
  // host），此处本地 state 保持选中态直到 host 广播 desktopUpdateChannel 回写。
  const [channel, setChannel] = useState<UpdateChannel>(
    updateChannel ?? "stable",
  );

  // 项目设置（SDD 开关）：切换中标记，防止重复请求
  const [pluginToggling, setPluginToggling] = useState(false);

  // AGENTS.md 编辑器
  const [activeScope, setActiveScope] = useState<AgentsScope>("user");
  const [userContent, setUserContent] = useState("");
  const [projectContent, setProjectContent] = useState("");

  // 配置数据变化时同步表单草稿（文件里没有的键 → 未设置态，不编造默认值）
  useEffect(() => {
    if (!configurationData) return;
    setLanguage(configurationData.language ?? "");
    setContextLength(
      configurationData.contextLength === undefined
        ? ""
        : String(configurationData.contextLength),
    );
    setAutoMemoryEnabled(configurationData.autoMemoryEnabled ?? true);
    setAutoMemoryFrequency(
      configurationData.autoMemoryFrequency === undefined
        ? ""
        : String(configurationData.autoMemoryFrequency),
    );
  }, [configurationData]);

  // host 广播（desktopThemeSource / 重推 setInitialState）同步主题选中态
  useEffect(() => {
    if (themeSource) setTheme(themeSource);
  }, [themeSource]);

  // host 广播（desktopUpdateChannel / 重推 setInitialState）同步开关选中态
  useEffect(() => {
    if (updateChannel) setChannel(updateChannel);
  }, [updateChannel]);

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

  // 进入「项目设置」视图时按当前活动项目的工作目录重新加载项目级
  // enabledPlugins。每次进入该视图（导航 transition）以及停留其中时工作目录
  // 变化，都重新读取——会话/工作目录切换后重入、外部改动 .wave/settings.json
  // （手动编辑或其他端切换）后重入，均以 host 返回的真实配置刷新开关，不复用
  // 上次缓存的 projectSettings（修复「文件已启用 sdd@builtin:true 而开关仍显示
  // 关闭」的状态矛盾）。触发键不包含 projectSettings 本身：切换成功后 host 回发
  // projectSettings 消息刷新状态，若把回包也当作触发源会 fetch→reply→fetch
  // 死循环。
  const projectViewKeyRef = useRef<string>("");
  const projectViewKey =
    activeNav === "project" ? `project:${workdir ?? ""}` : activeNav;
  useEffect(() => {
    if (projectViewKeyRef.current === projectViewKey) return;
    projectViewKeyRef.current = projectViewKey;
    if (activeNav === "project" && onLoadProjectSettings) {
      onLoadProjectSettings();
    }
  }, [projectViewKey, activeNav, workdir, onLoadProjectSettings]);

  // 缓存的项目设置仅当其标注的工作目录与当前工作目录一致时才可信：不一致说明
  // 缓存属于另一项目（或早于会话切换），在 host 回发当前项目数据前按未加载
  // 处理（开关禁用）——避免「项目目录提示已切到新项目、开关还短暂显示上个
  // 项目状态」的错位帧。
  const projectSettingsForWorkdir =
    workdir === undefined || projectSettingsWorkdir === workdir
      ? projectSettings
      : undefined;

  const sddEnabled =
    projectSettingsForWorkdir?.enabledPlugins?.["sdd@builtin"] === true;

  // 保存类操作反馈统一由宿主全局 toast 提示（2026-09-09 拍板，见
  // desktop-account-and-settings「设置页反馈语义」），本组件不生成/渲染任何
  // 页面内提示文字；「保存中…」由外层 saving / agentsSaving 驱动按钮禁用。
  //
  // 载荷只带**用户真正改动过**的字段（diff 语义）：没改的、仍处于未设置态的键
  // 都不出现，宿主/CLI 把「省略键」当作「不改该键」（spec 场景 8 与边界说明
  // 「省略键 = 不改该键」）——所以「一个字都没改就点保存」不会把任何键写进
  // settings.json（否则会把系统环境里的 WAVE_MAX_INPUT_TOKENS 钉成 200000）。
  const handleSaveGlobal = () => {
    if (!configurationData || !onSave) return;
    const patch: ConfigurationData = {};
    const languagePatch = changedString(language, configurationData.language);
    if (languagePatch !== undefined) patch.language = languagePatch;
    const contextPatch = changedNumber(
      contextLength,
      configurationData.contextLength,
    );
    if (contextPatch !== undefined) patch.contextLength = contextPatch;
    onSave(patch);
  };

  const handleSaveMemory = () => {
    if (!configurationData || !onSave) return;
    const patch: ConfigurationData = {};
    // 开关无占位态：比较基准是它**显示的初始值**（未设置时显示默认「开」），
    // 因此「未设置 + 没碰它」不写该键，只有真被拨动过才写。
    if (autoMemoryEnabled !== (configurationData.autoMemoryEnabled ?? true)) {
      patch.autoMemoryEnabled = autoMemoryEnabled;
    }
    const frequencyPatch = changedNumber(
      autoMemoryFrequency,
      configurationData.autoMemoryFrequency,
    );
    if (frequencyPatch !== undefined) {
      patch.autoMemoryFrequency = frequencyPatch;
    }
    onSave(patch);
  };

  const handleSaveAgents = () => {
    if (!onSaveAgentsContent) return;
    onSaveAgentsContent(
      activeScope,
      activeScope === "user" ? userContent : projectContent,
    );
  };

  const handleToggleSdd = () => {
    if (!onToggleBuiltinPlugin || pluginToggling) return;
    setPluginToggling(true);
    onToggleBuiltinPlugin("sdd@builtin", !sddEnabled);
  };

  // 切换结果（projectSettings 消息）到达后解除禁用
  useEffect(() => {
    setPluginToggling(false);
  }, [projectSettings]);

  // 返回按钮：mac 真机位于窗口让位行下方单独一行；其余宿主保持左导航首行原布局。
  const backButton = (
    <button type="button" className="settings-back" onClick={onClose}>
      <SettingsBackIcon />
      <span>返回</span>
    </button>
  );

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          {/* macOS 隐藏标题栏（spec「macOS 隐藏标题栏」设置页场景 8）：设置页占满
              整个 view 时会话侧边栏被覆盖，系统红绿灯改由设置页自身左导航顶部承接。
              真机形态下导航顶部先渲染一条与侧边栏窗口行同规格（44px）的窗口行——
              行内不放任何控件，整行即红绿灯让位区兼窗口拖拽区（-webkit-app-region:
              drag），背景与导航同色一体无条带；「返回」按钮位于窗口行下方单独一行
              （不与红绿灯同排，左缘与导航项对齐）。进入系统全屏（红绿灯隐藏）时
              让位行整行收起（高度归零、内容上移贴顶），退出全屏恢复。仅
              desktop+darwin 真机渲染（IDE 宿主 / Windows / Linux 无窗口 chrome，
              不渲染窗口行，返回按钮保持左导航首行原布局）。 */}
          {isMacHiddenTitlebar() && (
            <div
              className={`settings-window-row${
                fullScreen ? " is-fullscreen" : ""
              }`}
              data-testid="settings-window-row"
            />
          )}
          {backButton}
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
                <p>管理 CodeWave IDE 的界面、模型和基础行为。</p>
              </header>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>基础设置</h2>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>AI 回复语言</h3>
                      <p>设置 AI 回复时使用的语言（技术术语与代码保持原文）</p>
                    </div>
                    <div className="settings-control">
                      <select
                        className="settings-select"
                        aria-label="AI 回复语言"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        {/* 未设置态：文件里没有 language 键时用显式项表达（下拉
                            没有 placeholder 语义），选中它 = 保持未设置、保存时
                            不写该键；其默认值与 SDK 解析链末尾的 DEFAULT_LANGUAGE
                            （zh-CN）同串，保证「未设置时显示 ≡ 生效」。一旦文件里
                            写过该键就不再显示此项（不提供「恢复默认」入口）。 */}
                        {language === "" && (
                          <option value="">{UNSET_OPTION_LABEL}</option>
                        )}
                        <option value="zh-CN">中文</option>
                        <option value="en-US">English</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <h3>上下文长度</h3>
                      <p>设置新对话默认可以使用的最大上下文长度</p>
                      {/* 可见说明：该值落在全局 env.WAVE_MAX_INPUT_TOKENS，当前
                          模型自带上下文上限时会以模型配置为准（spec agent-config
                          边界说明「上下文长度的落点」）——避免被误解为设置失效。 */}
                      <p className="settings-row-hint">
                        全局默认；当前模型自带上下文上限时以模型配置为准
                      </p>
                    </div>
                    <div className="settings-number-control">
                      {/* 未设置态：文件里没有 env.WAVE_MAX_INPUT_TOKENS 时留空 +
                          placeholder 显示系统默认（跟随模型配置；SDK 兜底
                          200000 = 200K），保存时不写该键——系统环境里已设的
                          WAVE_MAX_INPUT_TOKENS 因而不被「随手保存」钉住。 */}
                      <input
                        className="settings-number-input"
                        type="number"
                        aria-label="上下文长度"
                        min={16}
                        max={1000}
                        step={16}
                        placeholder={CONTEXT_LENGTH_PLACEHOLDER}
                        value={contextLength}
                        onChange={(e) => setContextLength(e.target.value)}
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
              {/* 「桌面端设置」区块（仅桌面端渲染，见 spec desktop-account-and-settings
                  场景 3）：主题与「接收 Beta 版更新」为桌面端独有的本地偏好——经
                  host 直连通道（setThemeSource / setUpdateChannel）持久化于桌面
                  configStore，不走 stdio updateConfiguration/共享 settings.json，
                  选择即时生效、无「保存」按钮。2026-09-08 拍板从「基础设置」拆出。 */}
              {(themeSource !== undefined || updateChannel !== undefined) && (
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h2>桌面端设置</h2>
                  </div>
                  <div className="settings-card">
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
                    {updateChannel !== undefined && (
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <h3>接收 Beta 版更新</h3>
                          <p>
                            {configurationData?.serverUrl
                              ? "开启后自动更新将接收测试版通道（Beta）分发的版本"
                              : "登录后可接收测试版更新"}
                          </p>
                        </div>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            aria-label="接收 Beta 版更新"
                            checked={channel === "beta"}
                            disabled={!configurationData?.serverUrl}
                            onChange={(e) => {
                              // 置灰（未登录、无 serverUrl）时不可切换——disabled
                              // 已阻止真实点击，此处防御 label 激活路径或自动化
                              // 事件直接派发造成的状态漂移（spec 场景 2）。
                              if (!configurationData?.serverUrl) return;
                              const next: UpdateChannel = e.target.checked
                                ? "beta"
                                : "stable";
                              setChannel(next);
                              onUpdateChannelChange?.(next);
                            }}
                          />
                          <span className="settings-switch-slider"></span>
                        </label>
                      </div>
                    )}
                  </div>
                </section>
              )}
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
                        disabled={pluginToggling || !projectSettingsForWorkdir}
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
                      disabled={agentsSaving}
                      onChange={(e) => {
                        if (activeScope === "user") {
                          setUserContent(e.target.value);
                        } else {
                          setProjectContent(e.target.value);
                        }
                      }}
                    />
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="settings-save-btn"
                        disabled={!onSaveAgentsContent || agentsSaving}
                        onClick={handleSaveAgents}
                      >
                        保存{activeScope === "project" ? "项目级" : "用户级"}
                        配置
                      </button>
                    </div>
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
                      {/* 未设置态：文件里没有 autoMemoryFrequency 时留空 +
                          placeholder 显示系统默认（1 轮），保存时不写该键。
                          开关一行刻意不做占位态（真实默认即「开」，三态更难用，
                          spec agent-config 场景 7）。 */}
                      <input
                        className="settings-number-input memory-turns-input"
                        type="number"
                        aria-label="触发记忆提取会话轮次"
                        min={1}
                        max={100}
                        placeholder={AUTO_MEMORY_FREQUENCY_PLACEHOLDER}
                        value={autoMemoryFrequency}
                        onChange={(e) => setAutoMemoryFrequency(e.target.value)}
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
            />
          )}

          {activeNav === "skills" && (
            <SettingsSkillsView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
            />
          )}

          {activeNav === "hooks" && (
            <SettingsHooksView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
            />
          )}

          {activeNav === "mcp" && (
            <SettingsMcpView
              vscode={vscode}
              workdir={workdir}
              onPrefillPrompt={onPrefillPrompt}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;

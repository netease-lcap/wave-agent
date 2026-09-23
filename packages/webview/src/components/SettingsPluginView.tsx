/**
 * SettingsPluginView - 插件市场整页（设置页「插件市场」导航 / `/plugin` 打开）
 *
 * 由侧边栏「插件市场」或 `/plugin` 斜杠命令打开（spec ecosystem/plugin「插件市场」）。
 * 按市场 Tab 组织插件：tab 直接显示市场自身名称（宿主下发什么名就显示什么名，
 * 场景 5 / A-011），顺序即宿主顺序；每个 tab 带该市场内的插件数量，默认选中第一
 * 个市场。tab 行右侧只有两个图标入口（场景 16/18）：加号 = 添加插件市场、
 * 齿轮 = 管理插件市场。市场内提供 全部/已安装/未安装 筛选（各带计数）与关键词
 * 搜索（限定在当前市场内）：搜索框贴筛选行最右端，分段器右侧是「更新 N」——
 * 批量更新只作用于**当前市场**中已安装且有新版本的插件（数量 0 时不出现，场景 15）。
 * 行内提供 安装（弹作用域选择，默认 user）/ 更新（安装作用域不变）/ 已安装状态，
 * 已安装行另带作用域按钮（弹「更换安装作用域」，可保存或卸载）。作用域一律相对
 * **锚点工程**（宿主下发的 `anchorWorkdir`，桌面端 = 当前选中对话所属工程）讲：
 * 两处弹窗的 project / local 两档标明工程名（为主）与根目录（为辅）、锚点为空时
 * 置灰不可选；行内气泡逐行给出所属工程、当前锚点那一行标「（当前）」（场景
 * 12/13/22、A-018）。「管理插件市场」
 * 弹窗列出全部市场（官方市场行标「官方」、不可移除），可移除自定义市场（二次确认）
 * 或经「添加插件市场」打开同名弹窗（本地路径 或 远程仓库 owner/repo、完整
 * Git 地址；市场名称由市场自身清单决定，用户无需填写）；添加成功后自动切到新市场的
 * tab（场景 18）。弹窗标题与两处入口同名（都是「添加插件市场」），不给用户引入别名。
 *
 * 打开本视图即触发一次后台市场清单刷新（只拉各市场检出、不升级任何插件，
 * spec ecosystem/plugin「市场清单自动刷新与插件升级解耦」场景 5）：刷新期间
 * 列表先显示进入前的清单并给出「检查更新中…」轻量状态，宿主在刷新结束后补发
 * 两份列表（带 refreshed 标记）→ 版本对比与「更新」按钮随之变为最新。
 *
 * 数据与变更全部经 host：host 收到变更命令后刷新两份列表并回发
 * listPluginsResponse / listMarketplacesResponse（配置的构造期副作用与重建时机
 * 由宿主按 agent-config 既有语义处理），本视图不写乐观状态，只消费回包。
 */

import React, { useEffect, useRef, useState } from "react";
import type { MarketplaceInfo, PluginInfo, PluginScope } from "../types";
import { useHostMessage } from "../utils/useHostMessage";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsAddIcon, SettingsGearIcon } from "./HeaderIcons";
import { SettingsTabs, type SettingsTabDef } from "./SettingsManageComponents";
import { Tooltip } from "./Tooltip";
import "../styles/ConfigurationDialog.css";
import "../styles/SettingsPage.css";

type PluginFilter = "all" | "installed" | "uninstalled";

/** 内置官方市场的真实名称（spec A-008 全产品按此名特判官方市场）。宿主下发的
 *  `isBuiltin` 为准，缺失时按名称兜底——旧宿主或手写载荷不带该字段。 */
const OFFICIAL_MARKETPLACE_NAME = "wave-plugins-official";

const isOfficialMarketplace = (m: MarketplaceInfo): boolean =>
  m.isBuiltin === true || m.name === OFFICIAL_MARKETPLACE_NAME;

const FILTERS: { key: PluginFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "installed", label: "已安装" },
  { key: "uninstalled", label: "未安装" },
];

const SCOPE_LABELS: Record<PluginScope, string> = {
  user: "用户",
  project: "项目",
  local: "本地",
};

/** 托管插件的行内作用域文案（spec plugin A-024）：它不属于本机任何作用域，
 *  与「用户 / 项目 / 本地」并列显示，用户据此知道这个插件是组织下发的。 */
const MANAGED_SCOPE_LABEL = "托管";

/** 托管插件的说明文案（spec plugin A-024）：卸载入口置灰时给出原因，不假设
 *  客户端形态（桌面端 / 插件端 / CLI 三端并存）。 */
const MANAGED_PLUGIN_NOTICE =
  "该插件由组织管理，无法卸载或禁用。请联系管理员调整托管配置。";

/** 三种安装作用域（spec 场景 12；标题与说明为定稿文案，不得简写或改写） */
const SCOPE_OPTIONS: { scope: PluginScope; title: string; desc: string }[] = [
  {
    scope: "user",
    title: "用户",
    desc: "作为你的用户配置，所有项目可用",
  },
  {
    scope: "project",
    title: "项目共享",
    desc: "写入当前项目配置，项目的其他协作者共享使用",
  },
  {
    scope: "local",
    title: "项目本地",
    desc: "仅在设备本地仓库配置，当前项目可用，不影响其他项目",
  },
];

export interface SettingsPluginViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
}

/** 行内版本信息（spec 场景 9–11）：未安装 = 单个可安装版本 `latest`；已安装且有新版
 *  = 一个升级胶囊 `installed → latest` + 「可更新」徽标；已安装且最新 = 单个 `installed`。
 *  `latest` 缺失（插件来源为独立 Git 仓库等无法就地读清单，A-010）时只给已安装版本。
 *  `updatable` 同时是「更新」按钮的唯一判据。 */
function pluginVersion(
  plugin: PluginInfo,
): { installed?: string; latest?: string; updatable: boolean } | null {
  const installed = plugin.version;
  const latest = plugin.latestVersion;
  if (plugin.installed) {
    if (installed && latest && installed !== latest) {
      return { installed, latest, updatable: true };
    }
    if (installed) return { installed, updatable: false };
    if (latest) return { latest, updatable: false };
    return null;
  }
  return latest ? { latest, updatable: false } : null;
}

/** 工程目录的展示文案（spec 场景 12/13/22）：**一行**的「工程名（工程根目录）」——
 *  只写「项目配置」「本地仓库」用户无法确认是哪个仓库，所以工程名为主、根目录为辅，
 *  重名时靠路径区分。工程名取末级目录名，括号用全角。 */
function projectName(workdir: string): string {
  const trimmed = workdir.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

function formatProject(workdir: string): string {
  return `${projectName(workdir)}（${workdir}）`;
}

/** 作用域按钮的悬浮气泡文案（spec 场景 22 / A-017）：只说明该插件在**当前锚点工程**
 *  的归属——一行「工程名（工程根目录）」，与行内胶囊看的是同一个工程，不加「所属项目」
 *  这类行首标签、也不列出在别的工程里的启用记录。只装了用户级时不属于任何工程，改为
 *  说明「用户级安装（所有项目可用）」；没有锚点工程时给不出工程名（此时 project /
 *  local 两档也不可选，见场景 12），只能说明「所属工程未知」。 */
function scopeTooltipText(plugin: PluginInfo, anchorWorkdir?: string): string {
  // 托管插件不属于本机任何作用域（spec plugin A-024）：气泡只说它的归属来源。
  if (plugin.managed) return "由组织管理，不可卸载";
  if (plugin.scope === "user") return "用户级安装（所有项目可用）";
  if (!anchorWorkdir) return "所属工程未知";
  if (plugin.scope === "project" || plugin.scope === "local") {
    return formatProject(anchorWorkdir);
  }
  // 装过、但在当前工程没有任何作用域记录（行内胶囊此时显示「未知」）。
  return "未在当前工程启用";
}

const SettingsPluginView: React.FC<SettingsPluginViewProps> = ({ vscode }) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  // 锚点工程（spec A-018）：宿主下发「打开插件视图那一刻的当前工程」——桌面端即
  // 当前选中对话所属工程（切换对话会先关闭整页，见场景 2，所以页面停留期间锚点
  // 不变）。弹窗的 project / local 两档据此标明配置写进哪个工程，锚点为空（宿主
  // 还没拿到任何工程目录）时这两档置灰不可选。
  const [anchorWorkdir, setAnchorWorkdir] = useState<string | undefined>();
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [activeMarket, setActiveMarket] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  // 打开视图时后台刷新各市场检出（只拉清单、不升级插件，spec 插件市场
  // 「市场清单自动刷新与插件升级解耦」A-013）：刷新期间列表先显示进入前的清单，
  // 完成后再由宿主补发最新（`refreshed: true`）并收起本提示；提示属界面内状态，
  // 不是界面外的主动提示。
  const [checkingUpdates, setCheckingUpdates] = useState(true);
  // 「添加插件市场」弹窗（本地路径 / 远程仓库）；入口是 tab 行右侧的加号图标按钮
  // （spec 场景 18），弹窗内也保留一个同名入口
  const [newMarketOpen, setNewMarketOpen] = useState(false);
  // 「管理插件市场」弹窗（spec 场景 16/17）：列出全部市场，官方只展示、
  // 自定义可移除；入口是 tab 行右侧的齿轮图标按钮
  const [manageMarketOpen, setManageMarketOpen] = useState(false);
  const [newMarketType, setNewMarketType] = useState<"local" | "remote">(
    "local",
  );
  const [newMarketInput, setNewMarketInput] = useState("");
  // 作用域弹窗（未安装 = 选择安装作用域、已安装 = 更换安装作用域）
  const [scopeTarget, setScopeTarget] = useState<PluginInfo | null>(null);
  const [pendingScope, setPendingScope] = useState<PluginScope>("user");
  const [pendingRemove, setPendingRemove] = useState<MarketplaceInfo | null>(
    null,
  );
  // 当前市场批量更新的确认弹窗（spec 场景 21）：非 null 即打开，内容是打开时刻的
  // 待更新插件快照（弹窗期间宿主刷新列表也不改已展示内容）+ 该快照所属的市场名
  // （确认后按它下发，不受此后任何列表刷新影响）
  const [updateTargets, setUpdateTargets] = useState<{
    market: string;
    plugins: PluginInfo[];
  } | null>(null);
  // 目录选择器的请求关联（host 回发 pluginMarketFolderSelected 带 requestId）
  const folderRequestRef = useRef("");
  const folderSeqRef = useRef(0);
  // 新建市场后待选中的市场名快照（spec 场景 18）：webview 只消费列表快照、拿不到
  // host 侧 addMarketplace 的返回值，而市场名由市场自身清单决定（A-011）⇒ 只能以
  // 「发请求时的市场名快照」为准，回包中出现快照外的新名字即刚添加的那个市场。
  // null = 当前没有待确认的新增请求；添加失败时不会有新名字，故保持原选中不变。
  const pendingAddRef = useRef<string[] | null>(null);
  // 市场切换条的端部渐隐（spec 场景 5）：切换条横向滚动且滚动条被隐藏，没有提示
  // 用户无从知道一侧还有市场。这里只跟踪「两端是否还有未展示的切换项」。
  const tabsStripRef = useRef<HTMLDivElement | null>(null);
  const [tabsOverflow, setTabsOverflow] = useState({
    start: false,
    end: false,
  });

  // 挂载拉取一次；vscode 经 latest ref 读取（对齐 useSettingsList 的写法，避免
  // 每次渲染重挂 effect 反复拉取）。
  const latest = useRef({ vscode });
  latest.current = { vscode };
  useEffect(() => {
    latest.current.vscode?.postMessage({ command: "listMarketplaces" });
    latest.current.vscode?.postMessage({ command: "listPlugins" });
    // 打开市场视图即后台刷新清单（只拉检出、不升级插件）：宿主在刷新结束后
    // 补发两份列表（带 refreshed 标记）。
    latest.current.vscode?.postMessage({ command: "refreshMarketplaces" });
  }, []);

  // 市场 tab 直接显示市场自身名称（spec 场景 5 / A-011）：宿主下发什么名就显示
  // 什么名（本地市场按文件夹名、远程仓库按仓库清单/仓库名派生，见 A-011），
  // 不做「官方→插件市场 / 其他→自定义市场N」这层显示名映射。tab 顺序即宿主
  // 下发顺序。
  const marketTabs: SettingsTabDef[] = marketplaces.map((m) => ({
    key: m.name,
    label: (
      <>
        {m.name}
        <span className="settings-tab-count">
          {plugins.filter((p) => p.marketplace === m.name).length}
        </span>
      </>
    ),
  }));

  // 切换条两端渐隐的显隐（spec 场景 5）：滚动位置或切换条宽度变化时重算。1px 容差
  // 兜住亚像素舍入，否则贴到端点时渐隐会留着不消失。marketplaces 进依赖是因为
  // tab 变多/改名会改变 scrollWidth 而**不改变**条盒尺寸（ResizeObserver 不会回调）。
  useEffect(() => {
    const strip = tabsStripRef.current;
    if (!strip) return;
    const update = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      setTabsOverflow({
        start: strip.scrollLeft > 1,
        end: max - strip.scrollLeft > 1,
      });
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => {
      strip.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [marketplaces]);

  // 市场默认选中第一个；当前选中市场被移除（或首次加载）时切到剩余第一个
  // （spec 场景 5、17）；全部移除后置空 → 走空态引导。
  useEffect(() => {
    if (marketplaces.length === 0) {
      if (activeMarket !== "") setActiveMarket("");
      return;
    }
    if (!marketplaces.some((m) => m.name === activeMarket)) {
      setActiveMarket(marketplaces[0].name);
    }
  }, [marketplaces, activeMarket]);

  // 选中的切换项必须在可视区里（spec 场景 18）：宿主添加市场成功后视图会自动切到
  // 新市场，而它通常追加在切换条最右端、可能落在可视区之外——不滚过去用户只会看到
  // 「选中项不见了」。语义等同 `inline: nearest`：只补足被遮住的那一段，已经完整
  // 可见就不动（避免每次切换都抖动）。手算 scrollLeft 而不是 `scrollIntoView`：
  // 后者会连带滚动所有祖先，把设置页本身也滚走。
  useEffect(() => {
    const strip = tabsStripRef.current;
    if (!strip || !activeMarket) return;
    const activeTab = strip.querySelector<HTMLElement>(
      ".settings-tab.is-active",
    );
    if (!activeTab) return;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    if (tabRect.left < stripRect.left) {
      strip.scrollLeft -= stripRect.left - tabRect.left;
    } else if (tabRect.right > stripRect.right) {
      strip.scrollLeft += tabRect.right - stripRect.right;
    }
  }, [activeMarket]);

  const closeScopeDialog = () => setScopeTarget(null);

  const closeNewMarket = () => {
    setNewMarketOpen(false);
    setNewMarketType("local");
    setNewMarketInput("");
  };

  const openInstallDialog = (plugin: PluginInfo) => {
    setScopeTarget(plugin);
    setPendingScope("user");
  };

  const openScopeDialog = (plugin: PluginInfo) => {
    setScopeTarget(plugin);
    setPendingScope(plugin.scope ?? "user");
  };

  const handleScopeConfirm = () => {
    if (!scopeTarget) return;
    if (scopeTarget.installed) {
      vscode?.postMessage({
        command: "setPluginScope",
        pluginId: scopeTarget.id,
        scope: pendingScope,
      });
    } else {
      vscode?.postMessage({
        command: "installPlugin",
        pluginId: scopeTarget.id,
        scope: pendingScope,
      });
    }
    closeScopeDialog();
  };

  /** 卸载只作用于弹窗中所选的作用域，其它作用域不受影响（spec plugin A-015）。 */
  const handleUninstall = () => {
    if (!scopeTarget) return;
    vscode?.postMessage({
      command: "uninstallPlugin",
      pluginId: scopeTarget.id,
      scope: pendingScope,
    });
    closeScopeDialog();
  };

  const handlePickFolder = () => {
    folderRequestRef.current = String(++folderSeqRef.current);
    vscode?.postMessage({
      command: "selectPluginMarketFolder",
      requestId: folderRequestRef.current,
    });
  };

  /** 下发添加市场：先记下当前市场名快照，回包据此认出新加的市场（spec 场景 18）。 */
  const addMarketplace = (input: string) => {
    pendingAddRef.current = marketplaces.map((m) => m.name);
    vscode?.postMessage({ command: "addMarketplace", input });
  };

  const handleAddRemoteMarket = () => {
    const input = newMarketInput.trim();
    if (!input) return;
    addMarketplace(input);
    closeNewMarket();
  };

  const handleConfirmRemove = () => {
    if (!pendingRemove) return;
    vscode?.postMessage({
      command: "removeMarketplace",
      name: pendingRemove.name,
    });
    setPendingRemove(null);
    // 移除后市场会自动切到剩余第一个，筛选回到「全部」避免用户在新市场里
    // 落在空分类上（对齐原型 doRemoveMarket）
    setFilter("all");
  };

  // 切换市场时把分段器复位为「全部」（spec 场景 6）：不让新市场继承上一个市场选的
  // 分组（切过去只看半个列表容易误判市场内容）；搜索框里的关键词保持不变。
  const handleSelectMarket = (name: string) => {
    setActiveMarket(name);
    setFilter("all");
  };

  // 确认当前市场批量更新（spec 场景 21）：按快照里的市场名下发（宿主 / SDK 的
  // updateMarketplace(name) 同义），与确认弹窗里列出的清单一致。
  const handleConfirmUpdateMarket = () => {
    const targets = updateTargets;
    setUpdateTargets(null);
    if (!targets) return;
    vscode?.postMessage({
      command: "updateMarketplace",
      name: targets.market,
    });
  };

  useHostMessage((message) => {
    switch (message.command) {
      case "listPluginsResponse":
        setPlugins(message.plugins || []);
        setAnchorWorkdir(message.anchorWorkdir || undefined);
        setLoading(false);
        // 打开视图触发的后台刷新已结束（宿主补发的列表），收起「检查更新中」
        if (message.refreshed) setCheckingUpdates(false);
        break;
      case "listMarketplacesResponse": {
        const next: MarketplaceInfo[] = message.marketplaces || [];
        const before = pendingAddRef.current;
        // 新市场自动选中（spec 场景 18）：回包出现快照外的新名字即添加成功；
        // 没有新名字（添加失败/重名）则什么都不做，保持原选中不变。
        const added = before
          ? next.find((m) => !before.includes(m.name))
          : undefined;
        if (added) {
          pendingAddRef.current = null;
          setActiveMarket(added.name);
          // 与移除市场同款：回到「全部」避免落在新市场的空分类上
          setFilter("all");
        }
        setMarketplaces(next);
        break;
      }
      case "pluginMarketFolderSelected": {
        if (String(message.requestId) !== folderRequestRef.current) return;
        folderRequestRef.current = "";
        // 选定文件夹即添加为市场（spec 场景 18）；取消选择回落空不动作
        if (!message.path) return;
        addMarketplace(message.path);
        closeNewMarket();
        break;
      }
    }
  });

  // 弹窗内的 Esc 关闭走 capture 拦截：设置页之下的输入框有 Esc 中断语义，
  // 弹窗打开时不应穿透（斜杠命令弹窗 / BtwPanel 同款先例）。
  useEffect(() => {
    if (!newMarketOpen && !scopeTarget && !manageMarketOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (scopeTarget) closeScopeDialog();
      else if (newMarketOpen) closeNewMarket();
      else setManageMarketOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [newMarketOpen, scopeTarget, manageMarketOpen]);

  const marketPlugins = plugins.filter((p) => p.marketplace === activeMarket);
  const installedCount = marketPlugins.filter((p) => p.installed).length;
  const counts: Record<PluginFilter, number> = {
    all: marketPlugins.length,
    installed: installedCount,
    uninstalled: marketPlugins.length - installedCount,
  };
  // 当前市场批量「更新」（spec 场景 15）：作用于**当前市场**中已安装且有新版本的
  // 插件（判据与行内「更新」一致），故按当前市场统计，且不受该市场的筛选与搜索影响；
  // 数量为 0 时整个按钮不出现。
  const updatablePlugins = marketPlugins.filter(
    (p) => pluginVersion(p)?.updatable === true,
  );
  const updatableCount = updatablePlugins.length;
  // 移除市场确认框副文本里的数量（spec 场景 17）：只数该市场下**已安装**的插件
  const installedRemovingCount = pendingRemove
    ? plugins.filter((p) => p.marketplace === pendingRemove.name && p.installed)
        .length
    : 0;

  const query = searchQuery.trim().toLowerCase();
  const visiblePlugins = marketPlugins.filter((p) => {
    if (filter === "installed" && !p.installed) return false;
    if (filter === "uninstalled" && p.installed) return false;
    if (!query) return true;
    return (
      p.name.toLowerCase().includes(query) ||
      (p.description ?? "").toLowerCase().includes(query)
    );
  });

  const renderPlugin = (plugin: PluginInfo) => {
    const version = pluginVersion(plugin);
    const updatable = version?.updatable === true;
    return (
      <div key={plugin.id} className="settings-plugin-row">
        <div className="settings-plugin-info">
          <div className="settings-plugin-head">
            <span className="settings-plugin-name">{plugin.name}</span>
            {/* 可更新（spec 场景 10）：只给**一个**升级胶囊「v旧 → v新」——左段读作
                已安装、右段读作最新，方向由中间的箭头承载；胶囊与未安装 / 已是最新的
                普通版本胶囊同一形制（中性色，不在胶囊内部引入橙色），「可更新」的
                语义完全由紧跟在它右侧的橙色实心「可更新」徽标承载。旧/新各自成胶囊
                时读不出哪个是哪个。 */}
            {updatable && version?.installed && version.latest ? (
              // 提示与作用域下拉同款（spec 场景 10 + A-020）：悬浮/聚焦在胶囊下方
              // 显示气泡，把「哪段是已安装、哪段是最新」说清；不再用原生 title
              // （同一行里两种提示风格不一致）。
              <Tooltip
                text={`已安装 v${version.installed}，最新版本 v${version.latest}`}
                position="bottom"
              >
                <span className="settings-plugin-upgrade">
                  <span className="settings-plugin-upgrade-from">
                    v{version.installed}
                  </span>
                  <i
                    className="codicon codicon-arrow-right settings-plugin-upgrade-arrow"
                    aria-hidden="true"
                  />
                  <span className="settings-plugin-upgrade-to">
                    v{version.latest}
                  </span>
                </span>
              </Tooltip>
            ) : (
              // 未安装 = 市场里的可安装版本；已安装且最新 = 当前版本（都是单个灰胶囊）
              (version?.installed ?? version?.latest) && (
                <span className="settings-plugin-version">
                  v{version?.installed ?? version?.latest}
                </span>
              )
            )}
            {updatable && (
              <span className="settings-plugin-update-badge">可更新</span>
            )}
          </div>
          {plugin.description && (
            <div className="settings-plugin-desc">{plugin.description}</div>
          )}
        </div>
        <div className="settings-plugin-actions">
          {plugin.installed && (
            // 作用域气泡（spec 场景 22）：语义由 aria-label 与气泡承载，不再用原生
            // `title`——两者并存会同时弹系统提示与自定义气泡。文案只有一行，但仍要
            // 开 multiline：默认的单行 nowrap 会把长工程路径截成省略号，而路径正是
            // 工程重名时唯一的区分依据（`multiline` 只控制折行方式，不增加行数）。
            <Tooltip
              text={scopeTooltipText(plugin, anchorWorkdir)}
              position="bottom"
              multiline
            >
              <button
                type="button"
                className="settings-scope-pill"
                aria-label="更换安装作用域"
                onClick={() => openScopeDialog(plugin)}
              >
                {plugin.managed
                  ? MANAGED_SCOPE_LABEL
                  : plugin.scope
                    ? SCOPE_LABELS[plugin.scope]
                    : "未知"}
                <i
                  className="codicon codicon-chevron-down"
                  aria-hidden="true"
                />
              </button>
            </Tooltip>
          )}
          {/* 行操作（spec 场景 8）：未安装 → 「安装」；已安装且有新版 → 「更新」；
              已安装且已是最新 → 不渲染状态按钮（「已安装」由作用域下拉本身表达）。
              主操作贴行右端，作用域下拉在它左侧。「安装」不给气泡——按钮文字已把
              动作说清，气泡只会重复一遍；「更新」的气泡带版本号，才有信息量
              （与作用域下拉同款，A-020）。 */}
          {!plugin.installed && (
            <button
              type="button"
              className="settings-plugin-act is-primary"
              onClick={() => openInstallDialog(plugin)}
            >
              安装
            </button>
          )}
          {plugin.installed && updatable && (
            <Tooltip
              text={`更新到最新版本 v${plugin.latestVersion}`}
              position="bottom"
            >
              <button
                type="button"
                className="settings-plugin-act is-primary"
                onClick={() =>
                  vscode?.postMessage({
                    command: "updatePlugin",
                    pluginId: plugin.id,
                  })
                }
              >
                更新
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="settings-view settings-plugin-view">
      {/* 页头只留「标题 + 说明」两行：市场来源的增删统一走 tab 行右侧的图标入口
          （spec 场景 16/18），页头不再单设「添加插件市场」入口 */}
      <header className="settings-page-header">
        <div className="settings-page-header-text">
          <h1>插件市场</h1>
          <p>浏览并安装插件市场的插件，扩展 Wave 的能力。</p>
        </div>
      </header>
      <section className="settings-section">
        {/* 左端渐隐（spec 场景 5）：切换条左侧还有未展示的市场时出现。挂在本 section
            上——section 左缘与切换条左缘是同一条线（切换条是工具栏首个子元素、
            无外边距）；右端那一层改挂操作区（见 actions），因为切换条右缘的位置
            取决于右侧入口宽度，CSS 里拿不到。 */}
        {tabsOverflow.start && (
          <span
            className="settings-plugin-tabs-fade is-start"
            data-testid="plugins-tabs-fade-start"
            aria-hidden="true"
          />
        )}
        <SettingsTabs
          tabs={marketTabs}
          activeTab={activeMarket}
          onChange={handleSelectMarket}
          stripRef={tabsStripRef}
          actions={
            <div className="settings-plugin-ops">
              {/* 右端渐隐（spec 场景 5）：`right: 100%` 落在切换条右缘向右 12px 的
                  工具条间距里，覆盖切换条尾部；绝对定位 + pointer-events: none，
                  不占宽度、不拦截鼠标 */}
              {tabsOverflow.end && (
                <span
                  className="settings-plugin-tabs-fade is-end"
                  data-testid="plugins-tabs-fade-end"
                  aria-hidden="true"
                />
              )}
              {/* 市场来源入口（spec 场景 16/18）：与当前选中市场无关，故不随
                  activeMarket 变化；两个都是图标按钮，按钮内无可见文字，文案由
                  aria-label + 下方悬浮提示（Tooltip）承载，不用原生 title 以免
                  与自定义气泡同时出现。「更新」在筛选行里（见下），不属于这一行 */}
              {!loading && (
                <div className="settings-plugin-market-ops">
                  <Tooltip text="添加插件市场" position="bottom">
                    <button
                      type="button"
                      className="settings-plugin-icon-btn"
                      aria-label="添加插件市场"
                      onClick={() => setNewMarketOpen(true)}
                      data-testid="plugins-add-market"
                    >
                      <SettingsAddIcon />
                    </button>
                  </Tooltip>
                  <Tooltip text="管理插件市场" position="bottom">
                    <button
                      type="button"
                      className="settings-plugin-icon-btn"
                      aria-label="管理插件市场"
                      onClick={() => setManageMarketOpen(true)}
                      data-testid="plugins-manage-markets"
                    >
                      <SettingsGearIcon />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          }
        />

        {!loading && marketplaces.length > 0 && (
          <div className="settings-plugin-toolbar">
            {/* 形制与添加插件市场弹窗的分段 tab 一致（设计师 0915 走查）；语义上这是一组
                筛选开关，故保留 aria-pressed 按钮而不是 role=tab（弹窗那边没有方向键
                导航，这里换 role 反而是无障碍降级） */}
            <div
              className="settings-plugin-filters"
              role="group"
              aria-label="插件筛选"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  className={`settings-plugin-chip${
                    filter === f.key ? " is-active" : ""
                  }`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="settings-tab-count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            {/* 当前市场批量更新（spec 场景 15）：紧随筛选分段器右侧，统计与作用
                范围都只跟当前市场走（数量 0 时不渲染）；点击先弹确认弹窗列出待
                更新插件（spec 场景 21），确认后才按该市场名下发 */}
            {updatableCount > 0 && (
              <button
                type="button"
                className="settings-plugin-update-btn"
                title={`更新「${activeMarket}」市场中的插件`}
                onClick={() =>
                  setUpdateTargets({
                    market: activeMarket,
                    plugins: updatablePlugins,
                  })
                }
                data-testid="plugins-update-market"
              >
                更新
                <span className="settings-tab-count">{updatableCount}</span>
              </button>
            )}
            {/* 刷新期间不阻塞任何操作：列表先显示进入前的清单，刷完自动变新 */}
            {checkingUpdates && (
              <span className="settings-plugin-checking">检查更新中…</span>
            )}
            {/* 搜索框贴该行最右端（margin-left: auto 吃掉剩余空间） */}
            <input
              type="search"
              className="settings-text-input settings-plugin-search"
              aria-label="搜索插件"
              placeholder="搜索插件"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <p>加载中...</p>
          </div>
        ) : marketplaces.length === 0 ? (
          <div className="empty-state">
            <p>暂无插件市场，点击「管理」添加</p>
          </div>
        ) : visiblePlugins.length === 0 ? (
          <div className="empty-state">
            <p>当前分类下暂无插件</p>
          </div>
        ) : (
          <div className="settings-plugin-list">
            {visiblePlugins.map(renderPlugin)}
          </div>
        )}
      </section>

      {manageMarketOpen && (
        <div
          className="settings-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget)
              setManageMarketOpen(false);
          }}
        >
          <div
            className="settings-modal is-manage"
            role="dialog"
            aria-modal="true"
            aria-label="管理插件市场"
          >
            <div className="settings-modal-header">
              <h3>管理插件市场</h3>
              <button
                type="button"
                className="settings-modal-close"
                aria-label="关闭"
                onClick={() => setManageMarketOpen(false)}
              >
                <i className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>

            {/* 已注册市场列表（spec 场景 16）：列出全部市场、行名即市场真实名；官方
                市场行只标「官方」、不提供移除（内置市场不可移除）；移除仍走确认框，
                避免误删整个市场及其插件。市场多到超出弹窗高度时只滚这一块
                （`.settings-modal.is-manage` 的滚动区），标题行与底部入口固定不动 */}
            <div className="settings-market-manage-list">
              {marketplaces.length === 0 ? (
                <p className="settings-modal-note">暂无插件市场。</p>
              ) : (
                marketplaces.map((m) => (
                  <div
                    key={m.name}
                    className="settings-market-manage-row"
                    data-testid={`plugins-manage-row-${m.name}`}
                  >
                    <span className="settings-market-manage-name">
                      {m.name}
                    </span>
                    {isOfficialMarketplace(m) ? (
                      <span className="settings-market-manage-note">官方</span>
                    ) : (
                      <button
                        type="button"
                        className="settings-row-btn settings-row-btn-danger"
                        onClick={() => setPendingRemove(m)}
                      >
                        移除
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="settings-modal-row">
              <button
                type="button"
                className="settings-row-btn settings-modal-block-btn"
                onClick={() => {
                  // 两层遮罩叠着会互相挡（同一 z-index），故先关管理再开新建
                  setManageMarketOpen(false);
                  setNewMarketOpen(true);
                }}
                data-testid="plugins-manage-add"
              >
                <SettingsAddIcon />
                添加插件市场
              </button>
            </div>
          </div>
        </div>
      )}

      {newMarketOpen && (
        <div
          className="settings-modal-overlay"
          onClick={(event) => {
            // 点遮罩关闭（对齐原型 .mask 行为）；Modal 内部点击不冒泡到此处
            if (event.target === event.currentTarget) closeNewMarket();
          }}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="添加插件市场"
          >
            <div className="settings-modal-header">
              <h3>添加插件市场</h3>
              <button
                type="button"
                className="settings-modal-close"
                aria-label="关闭"
                onClick={closeNewMarket}
              >
                <i className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
            <div className="settings-modal-seg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={newMarketType === "local"}
                className={`settings-modal-seg-item${
                  newMarketType === "local" ? " is-active" : ""
                }`}
                onClick={() => setNewMarketType("local")}
              >
                本地路径
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={newMarketType === "remote"}
                className={`settings-modal-seg-item${
                  newMarketType === "remote" ? " is-active" : ""
                }`}
                onClick={() => setNewMarketType("remote")}
              >
                远程仓库
              </button>
            </div>

            {newMarketType === "local" ? (
              <div className="settings-modal-row">
                <button
                  type="button"
                  className="settings-row-btn settings-modal-block-btn"
                  onClick={handlePickFolder}
                >
                  {/* 加号图标：沿用市场来源入口同一个 Figma 加号（16px,
                      currentColor），表达「新增一个本地市场」的动作语义。
                      设计师 0915 评论指定「选择文件夹前面加个加号的图标」。 */}
                  <SettingsAddIcon />
                  选择文件夹
                </button>
              </div>
            ) : (
              <div className="settings-modal-row">
                <input
                  type="text"
                  className="settings-text-input"
                  aria-label="市场地址"
                  placeholder="owner/repo 或完整 Git 地址"
                  value={newMarketInput}
                  onChange={(e) => setNewMarketInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddRemoteMarket();
                  }}
                />
                <button
                  type="button"
                  className="settings-save-btn"
                  disabled={!newMarketInput.trim()}
                  onClick={handleAddRemoteMarket}
                >
                  添加
                </button>
              </div>
            )}

            <p className="settings-modal-note">
              {newMarketType === "local"
                ? "点击「选择文件夹」选取本地插件目录，选定后将直接添加为市场。"
                : "远程仓库支持 GitHub owner/repo 写法，或完整 Git 地址。"}
            </p>
          </div>
        </div>
      )}

      {scopeTarget && (
        <div
          className="settings-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeScopeDialog();
          }}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              scopeTarget.installed ? "更换安装作用域" : "选择安装作用域"
            }
          >
            <div className="settings-modal-header">
              <h3>
                {scopeTarget.installed ? "更换安装作用域" : "选择安装作用域"}
              </h3>
              <button
                type="button"
                className="settings-modal-close"
                aria-label="关闭"
                onClick={closeScopeDialog}
              >
                <i className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
            <div className="settings-scope-list">
              {SCOPE_OPTIONS.map((option) => {
                // project / local 都写进锚点工程（场景 12/13）：两档都标明工程名与
                // 根目录——只给「项目」加名字会让「本地」看起来不属于任何工程。
                // 锚点为空时这两档置灰并说明原因（现在点了也只会写进 CLI 进程的
                // 随机 cwd）。
                const anchorScoped = option.scope !== "user";
                const disabled = anchorScoped && !anchorWorkdir;
                return (
                  <button
                    key={option.scope}
                    type="button"
                    aria-pressed={pendingScope === option.scope}
                    disabled={disabled}
                    className={`settings-scope-option${
                      pendingScope === option.scope ? " is-selected" : ""
                    }`}
                    onClick={() => setPendingScope(option.scope)}
                  >
                    {/* 单选指示在文本左侧（设计师 0915 评论「radio 应该在左侧」）：
                        原结构是「标题行 = 标题 … 单选圆」靠 space-between 把圆推到右端，
                        这里改成「圆 + 文本块」的行式结构，标题与描述同处右侧文本列。 */}
                    <span className="settings-scope-radio" aria-hidden="true" />
                    <span className="settings-scope-option-body">
                      <span className="settings-scope-option-title">
                        {option.title}
                        <em>（{option.scope}）</em>
                      </span>
                      <span className="settings-scope-option-desc">
                        {option.desc}
                      </span>
                      {anchorScoped && (
                        // 写明配置写进哪个工程（spec 场景 12/13）：一行「当前项目：工程名
                        // （工程根目录）」，工程名加粗、路径常规，重名时靠路径区分。
                        <span
                          className="settings-scope-option-project"
                          data-testid={`scope-project-${option.scope}`}
                        >
                          {anchorWorkdir ? (
                            <>
                              当前项目：
                              <span className="settings-scope-option-project-name">
                                {projectName(anchorWorkdir)}
                              </span>
                              <span className="settings-scope-option-project-path">
                                （{anchorWorkdir}）
                              </span>
                            </>
                          ) : (
                            "需先选择项目目录后才能选择此作用域"
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 托管插件的卸载入口置灰（spec plugin A-024）：不是点了再报错——
                用户在下发值被管理员撤掉前，本机怎么操作都不会让它停用。说明与
                置灰同处，避免用户把不可点当成故障。 */}
            {scopeTarget.managed && (
              <p
                className="settings-modal-note"
                data-testid="managed-plugin-notice"
              >
                {MANAGED_PLUGIN_NOTICE}
              </p>
            )}

            <div className="settings-modal-actions">
              {scopeTarget.installed && (
                <button
                  type="button"
                  className="settings-row-btn settings-row-btn-danger"
                  disabled={scopeTarget.managed === true}
                  onClick={handleUninstall}
                >
                  卸载
                </button>
              )}
              <button
                type="button"
                className="settings-row-btn"
                onClick={closeScopeDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={handleScopeConfirm}
              >
                {scopeTarget.installed ? "保存" : "安装"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={`确认移除市场「${pendingRemove.name}」？`}
          /* 副文本只数**已安装**的插件（判据与「已安装」筛选一致，spec 场景 17）：
             只列在市场里的未安装插件也会随市场一起消失，但它们不是用户装上的东西，
             不构成「要失去什么」。该市场下没有已安装插件时整行副文本不出现
             （description 为 undefined，ConfirmDialog 不渲染该行）。 */
          description={
            installedRemovingCount > 0
              ? `该市场下的 ${installedRemovingCount} 个已安装插件将一并移除。`
              : undefined
          }
          confirmText="移除"
          cancelText="取消"
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {/* 当前市场批量更新的确认弹窗（spec 场景 21）：确认后才下发一次带市场名的
          updateMarketplace；取消 / Esc 不下发任何请求。清单是打开时刻的快照，
          内容只覆盖该市场（市场名同时写进正文） */}
      {updateTargets && (
        <ConfirmDialog
          title={`确认更新 ${updateTargets.plugins.length} 个插件？`}
          description={`${updateTargets.market} 市场下有 ${updateTargets.plugins.length} 个插件可更新，确认后立即更新到最新版本。`}
          confirmText="更新"
          cancelText="取消"
          onConfirm={handleConfirmUpdateMarket}
          onCancel={() => setUpdateTargets(null)}
        >
          <ul
            className="settings-plugin-update-list"
            data-testid="plugin-update-list"
          >
            {updateTargets.plugins.map((plugin) => (
              <li
                key={plugin.id}
                className="settings-plugin-update-item"
                data-testid={`plugin-update-item-${plugin.id}`}
              >
                <span className="settings-plugin-update-name">
                  {plugin.name}
                </span>
                {/* 版本变化（作用域单列贴右）；所属市场由弹窗正文给出，不逐行重复 */}
                <span className="settings-plugin-update-versions">
                  {`v${plugin.version} → v${plugin.latestVersion}`}
                </span>
                <span className="settings-plugin-update-scope">
                  {plugin.managed
                    ? MANAGED_SCOPE_LABEL
                    : plugin.scope
                      ? SCOPE_LABELS[plugin.scope]
                      : "未知"}
                </span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
};

export default SettingsPluginView;

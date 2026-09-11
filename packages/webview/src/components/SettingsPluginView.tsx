/**
 * SettingsPluginView - 设置页「插件市场」选项卡
 *
 * 由 /plugin 斜杠命令（或手动点击设置页「插件市场」导航）打开（spec
 * ecosystem/plugin「设置页插件市场」）。按市场 Tab 组织插件：每个市场 Tab 带
 * 该市场内的插件数量、默认选中第一个市场；市场内提供 全部/已安装/未安装 筛选
 * （各带计数）与关键词搜索（限定在当前市场内）。行内提供 安装（弹作用域选择，
 * 默认 user）/ 更新（安装作用域不变）/ 已安装状态，已安装行另带作用域按钮
 * （弹「更换安装作用域」，可保存或卸载）。工具栏提供 更新市场 / 移除市场 /
 * 新建市场（本地路径 或 远程仓库 owner/repo、完整 Git 地址；市场名称由市场
 * 自身清单决定，用户无需填写）。
 *
 * 数据与变更全部经 host：host 收到变更命令后刷新两份列表并回发
 * listPluginsResponse / listMarketplacesResponse（配置的构造期副作用与重建时机
 * 由宿主按 agent-config 既有语义处理），本视图不写乐观状态，只消费回包。
 */

import React, { useEffect, useRef, useState } from "react";
import type { MarketplaceInfo, PluginInfo, PluginScope } from "../types";
import { useHostMessage } from "../utils/useHostMessage";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsAddIcon } from "./HeaderIcons";
import { SettingsTabs, type SettingsTabDef } from "./SettingsManageComponents";
import "../styles/ConfigurationDialog.css";
import "../styles/SettingsPage.css";

type PluginFilter = "all" | "installed" | "uninstalled";

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

/** 三种安装作用域（spec 场景 10；文案取自原型作用域弹窗） */
const SCOPE_OPTIONS: { scope: PluginScope; title: string; desc: string }[] = [
  { scope: "user", title: "为你安装", desc: "仅在你的用户配置中安装此插件" },
  {
    scope: "project",
    title: "为此仓库的所有协作者安装",
    desc: "在项目配置中安装，团队成员共享",
  },
  {
    scope: "local",
    title: "仅为你在此仓库中安装",
    desc: "仅在本地仓库配置中安装，不影响其他项目",
  },
];

export interface SettingsPluginViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
}

/** 版本文案（spec 场景 7–9）：未安装只看可安装的最新版；已安装且落后同时展示
 *  两个版本并标记可更新（「更新」按钮的唯一判据）；已安装且最新只展示版本。
 *  latestVersion 缺失（插件来源为独立 Git 仓库等无法就地读清单，A-010）时只展示
 *  已安装版本。 */
function pluginVersion(
  plugin: PluginInfo,
): { text: string; updatable: boolean } | null {
  const installed = plugin.version;
  const latest = plugin.latestVersion;
  if (plugin.installed) {
    if (installed && latest && installed !== latest) {
      return {
        text: `已安装 v${installed} · 最新 v${latest}`,
        updatable: true,
      };
    }
    if (installed) return { text: `v${installed}`, updatable: false };
    if (latest) return { text: `最新 v${latest}`, updatable: false };
    return null;
  }
  return latest ? { text: `最新 v${latest}`, updatable: false } : null;
}

const SettingsPluginView: React.FC<SettingsPluginViewProps> = ({ vscode }) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [activeMarket, setActiveMarket] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  // 新建市场弹窗（本地路径 / 远程仓库）
  const [newMarketOpen, setNewMarketOpen] = useState(false);
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
  // 目录选择器的请求关联（host 回发 pluginMarketFolderSelected 带 requestId）
  const folderRequestRef = useRef("");
  const folderSeqRef = useRef(0);

  // 挂载拉取一次；vscode 经 latest ref 读取（对齐 useSettingsList 的写法，避免
  // 每次渲染重挂 effect 反复拉取）。
  const latest = useRef({ vscode });
  latest.current = { vscode };
  useEffect(() => {
    latest.current.vscode?.postMessage({ command: "listMarketplaces" });
    latest.current.vscode?.postMessage({ command: "listPlugins" });
  }, []);

  // 市场默认选中第一个；当前选中市场被移除（或首次加载）时切到剩余第一个
  // （spec 场景 3、15）；全部移除后置空 → 走空态引导。
  useEffect(() => {
    if (marketplaces.length === 0) {
      if (activeMarket !== "") setActiveMarket("");
      return;
    }
    if (!marketplaces.some((m) => m.name === activeMarket)) {
      setActiveMarket(marketplaces[0].name);
    }
  }, [marketplaces, activeMarket]);

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

  const handleUninstall = () => {
    if (!scopeTarget) return;
    vscode?.postMessage({
      command: "uninstallPlugin",
      pluginId: scopeTarget.id,
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

  const handleAddRemoteMarket = () => {
    const input = newMarketInput.trim();
    if (!input) return;
    vscode?.postMessage({ command: "addMarketplace", input });
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

  useHostMessage((message) => {
    switch (message.command) {
      case "listPluginsResponse":
        setPlugins(message.plugins || []);
        setLoading(false);
        break;
      case "listMarketplacesResponse":
        setMarketplaces(message.marketplaces || []);
        break;
      case "pluginMarketFolderSelected": {
        if (String(message.requestId) !== folderRequestRef.current) return;
        folderRequestRef.current = "";
        // 选定文件夹即添加为市场（spec 场景 14）；取消选择回落空不动作
        if (!message.path) return;
        vscode?.postMessage({ command: "addMarketplace", input: message.path });
        closeNewMarket();
        break;
      }
    }
  });

  // 弹窗内的 Esc 关闭走 capture 拦截：设置页之下的输入框有 Esc 中断语义，
  // 弹窗打开时不应穿透（斜杠命令弹窗 / BtwPanel 同款先例）。
  useEffect(() => {
    if (!newMarketOpen && !scopeTarget) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (scopeTarget) closeScopeDialog();
      else closeNewMarket();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [newMarketOpen, scopeTarget]);

  const marketPlugins = plugins.filter((p) => p.marketplace === activeMarket);
  const installedCount = marketPlugins.filter((p) => p.installed).length;
  const counts: Record<PluginFilter, number> = {
    all: marketPlugins.length,
    installed: installedCount,
    uninstalled: marketPlugins.length - installedCount,
  };

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

  const renderPlugin = (plugin: PluginInfo) => {
    const version = pluginVersion(plugin);
    return (
      <div key={plugin.id} className="settings-plugin-row">
        <div className="settings-plugin-info">
          <div className="settings-plugin-head">
            <span className="settings-plugin-name">{plugin.name}</span>
            {version && (
              <span
                className={`settings-plugin-version${
                  version.updatable ? " is-update" : ""
                }`}
              >
                {version.text}
              </span>
            )}
          </div>
          {plugin.description && (
            <div className="settings-plugin-desc">{plugin.description}</div>
          )}
        </div>
        <div className="settings-plugin-actions">
          {plugin.installed && (
            <button
              type="button"
              className="settings-scope-pill"
              title="更换安装作用域"
              onClick={() => openScopeDialog(plugin)}
            >
              {plugin.scope ? SCOPE_LABELS[plugin.scope] : "未知"}
              <i className="codicon codicon-chevron-down" aria-hidden="true" />
            </button>
          )}
          {!plugin.installed ? (
            <button
              type="button"
              className="settings-plugin-act is-primary"
              title="安装插件"
              onClick={() => openInstallDialog(plugin)}
            >
              安装
            </button>
          ) : version?.updatable ? (
            <button
              type="button"
              className="settings-plugin-act is-primary"
              title={`更新到最新版本 v${plugin.latestVersion}`}
              onClick={() =>
                vscode?.postMessage({
                  command: "updatePlugin",
                  pluginId: plugin.id,
                })
              }
            >
              更新
            </button>
          ) : (
            <button
              type="button"
              className="settings-plugin-act is-installed"
              title="已是最新版本，点击更换安装作用域"
              onClick={() => openScopeDialog(plugin)}
            >
              ✓ 已安装
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="settings-view settings-plugin-view">
      <header className="settings-page-header">
        <h1>插件市场</h1>
        <p>浏览并安装插件市场的插件，扩展 Wave 的能力。</p>
      </header>
      <section className="settings-section">
        <SettingsTabs
          tabs={marketTabs}
          activeTab={activeMarket}
          onChange={setActiveMarket}
          actions={
            <div className="settings-plugin-ops">
              {/* 更新/移除紧跟市场切换（当前市场的上下文操作）；新建市场是
                  全局入口，靠右与上方操作分层（对齐原型 .market-ops/.market-add） */}
              {activeMarket && (
                <div className="settings-plugin-market-ops">
                  <button
                    type="button"
                    className="settings-row-btn"
                    onClick={() =>
                      vscode?.postMessage({
                        command: "updateMarketplace",
                        name: activeMarket,
                      })
                    }
                  >
                    更新市场
                  </button>
                  <button
                    type="button"
                    className="settings-row-btn settings-row-btn-danger"
                    onClick={() =>
                      setPendingRemove(
                        marketplaces.find((m) => m.name === activeMarket) ??
                          null,
                      )
                    }
                  >
                    移除市场
                  </button>
                </div>
              )}
              <button
                type="button"
                className="settings-save-btn settings-plugin-new-market"
                onClick={() => setNewMarketOpen(true)}
              >
                <SettingsAddIcon />
                新建市场
              </button>
            </div>
          }
        />

        {!loading && marketplaces.length > 0 && (
          <div className="settings-plugin-toolbar">
            <div className="settings-plugin-filters">
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
            <p>暂无插件市场，点击右上角「＋ 新建市场」添加</p>
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
            aria-label="新建市场"
          >
            <div className="settings-modal-header">
              <h3>新建市场</h3>
              <button
                type="button"
                className="settings-modal-close"
                aria-label="关闭"
                onClick={closeNewMarket}
              >
                <i className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
            <p className="settings-modal-hint">
              添加一个插件市场源，添加后可在顶部切换。
            </p>

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
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.scope}
                  type="button"
                  aria-pressed={pendingScope === option.scope}
                  className={`settings-scope-option${
                    pendingScope === option.scope ? " is-selected" : ""
                  }`}
                  onClick={() => setPendingScope(option.scope)}
                >
                  <span className="settings-scope-option-head">
                    <span className="settings-scope-option-title">
                      {option.title}
                      <em>（{option.scope}）</em>
                    </span>
                    <span className="settings-scope-radio" aria-hidden="true" />
                  </span>
                  <span className="settings-scope-option-desc">
                    {option.desc}
                  </span>
                </button>
              ))}
            </div>

            <div className="settings-modal-actions">
              {scopeTarget.installed && (
                <button
                  type="button"
                  className="settings-row-btn settings-row-btn-danger"
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
          description={`该市场下的 ${
            plugins.filter((p) => p.marketplace === pendingRemove.name).length
          } 个插件将一并移除。`}
          confirmText="移除"
          cancelText="取消"
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
};

export default SettingsPluginView;

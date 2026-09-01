/**
 * SettingsHooksView - 设置页「钩子」选项卡
 *
 * 按来源 Tab（用户级钩子 / 项目级钩子 / 插件钩子）展示钩子，项目级在
 * 「项目级钩子」Tab 平铺展示（仅当前项目，2026-09-01 用户拍板删项目分组
 * 卡片）。提供新建（预填 AI 对话框提示词）、编辑（预填提示词）、开关
 * （enabled 字段，关闭后不执行）、删除（二次确认 + 直接删配置）。
 * 数据通过 getHooksByScope RPC 由 host 下发，开关/删除走 setHookEnabled /
 * deleteHook RPC。
 */

import React, { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsTabs, type SettingsTabDef } from "./SettingsManageComponents";
import "../styles/ConfigurationDialog.css";
import "../styles/SettingsPage.css";

interface HookCommand {
  type: string;
  command: string;
  async?: boolean;
  timeout?: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
  enabled?: boolean;
}

type HooksByEvent = Record<string, HookEntry[]>;

const TABS: SettingsTabDef[] = [
  { key: "user", label: "用户级钩子" },
  { key: "project", label: "项目级钩子" },
  { key: "plugin", label: "插件钩子" },
];

export interface SettingsHooksViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 当前工作目录（用于项目分组展示项目名） */
  workdir?: string;
  /** 关闭设置页并预填 AI 对话框提示词 */
  onPrefillPrompt?: (prompt: string) => void;
  /** 用系统编辑器打开文件（desktop 走 desktopOpenFileExternal；IDE 回退 openFile） */
  onOpenExternalFile?: (path: string) => void;
}

/** hookName = `Event:Matcher`（无 matcher 时仅 Event），与 SDK parseHookName 互逆 */
function formatHookName(event: string, matcher?: string): string {
  return matcher ? `${event}:${matcher}` : event;
}

/** 打开钩子所在 settings.json（编辑时让用户对照配置） */
function settingsPathFor(scope: string, configPath?: string | null): string {
  if (configPath) return configPath;
  // 回退：用户级 ~/.wave/settings.json；项目级 <workdir>/.wave/settings.json
  return scope === "user" ? "~/.wave/settings.json" : ".wave/settings.json";
}

const SettingsHooksView: React.FC<SettingsHooksViewProps> = ({
  vscode,
  workdir,
  onPrefillPrompt,
  onOpenExternalFile,
}) => {
  const [hooks, setHooks] = useState<HooksByEvent>({});
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);
  // 待删除钩子（event+matcher 标识，null = 无确认框）
  const [pendingDelete, setPendingDelete] = useState<{
    event: string;
    matcher?: string;
  } | null>(null);
  // 开关操作中的条目（防止连点）
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const fetchHooks = useCallback(
    (scope: string) => {
      setLoading(true);
      vscode?.postMessage({ command: "getHooksByScope", scope });
    },
    [vscode],
  );

  // Fetch on mount and when the tab changes
  useEffect(() => {
    setPendingDelete(null);
    fetchHooks(activeTab);
  }, [activeTab, fetchHooks]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "hooksResponse") {
        setHooks((message.hooks as HooksByEvent) || {});
        if (typeof message.configPath === "string") {
          setConfigPath(message.configPath);
        } else {
          setConfigPath(null);
        }
        setLoading(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // 平铺所有条目：{event, matcher, entry}
  const entries = Object.entries(hooks).flatMap(([event, configs]) =>
    configs.map((entry) => ({ event, matcher: entry.matcher, entry })),
  );

  const activeTabDef = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  const projectName = workdir
    ? (workdir
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? workdir)
    : "当前项目";

  const handleCreate = (scope: "user" | "project") => {
    const prompt =
      scope === "user"
        ? "帮我配一个用户级钩子：<事件>时，<matcher 工具>，跑<命令>，<超时/异步>"
        : `帮我在【${projectName}】新建钩子：<事件>时，<matcher 工具>，跑<命令>，<超时/异步>`;
    onPrefillPrompt?.(prompt);
  };

  const handleEdit = (item: { event: string; matcher?: string }) => {
    onPrefillPrompt?.(
      `帮我编辑钩子${formatHookName(item.event, item.matcher)}：把<事件/匹配/命令/超时>改成<新内容>`,
    );
    const path = settingsPathFor(activeTab, configPath);
    if (onOpenExternalFile) {
      onOpenExternalFile(path);
      return;
    }
    vscode?.postMessage({ command: "openFile", path });
  };

  const handleToggle = (
    item: { event: string; matcher?: string },
    enabled: boolean,
  ) => {
    const name = formatHookName(item.event, item.matcher);
    setToggling((prev) => ({ ...prev, [name]: true }));
    vscode?.postMessage({
      command: "setHookEnabled",
      scope: activeTab,
      hookName: name,
      enabled,
    });
    // host 回发 hooksResponse 后刷新，此处乐观更新开关显示
    setHooks((prev) => {
      const next: HooksByEvent = { ...prev };
      const configs = next[item.event]?.map((entry) =>
        (entry.matcher || "") === (item.matcher || "")
          ? { ...entry, enabled }
          : entry,
      );
      if (configs) next[item.event] = configs;
      return next;
    });
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const name = formatHookName(pendingDelete.event, pendingDelete.matcher);
    vscode?.postMessage({
      command: "deleteHook",
      scope: activeTab,
      hookName: name,
    });
    setPendingDelete(null);
    setHooks((prev) => {
      const next: HooksByEvent = { ...prev };
      const remaining = (next[pendingDelete.event] ?? []).filter(
        (entry) => (entry.matcher || "") !== (pendingDelete.matcher || ""),
      );
      if (remaining.length > 0) {
        next[pendingDelete.event] = remaining;
      } else {
        delete next[pendingDelete.event];
      }
      return next;
    });
  };

  const isEditable = activeTab === "user" || activeTab === "project";

  const renderEntries = (list: typeof entries) =>
    list.map((item) => {
      const name = formatHookName(item.event, item.matcher);
      const enabled = item.entry.enabled !== false;
      const commands = (item.entry.hooks ?? [])
        .map((h) => h.command)
        .join("; ");
      return (
        <div key={name} className="mcp-server-item">
          <div className="mcp-server-info">
            <div className="mcp-server-header">
              <span className="mcp-server-name">{name}</span>
              {item.entry.enabled === false && (
                <span className="settings-tag settings-tag-off">已关闭</span>
              )}
            </div>
            {commands && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                  wordBreak: "break-all",
                }}
              >
                {commands}
              </div>
            )}
          </div>
          <div className="mcp-server-actions">
            {isEditable && (
              <>
                <label className="settings-switch settings-switch-small">
                  <input
                    type="checkbox"
                    aria-label={`启用钩子 ${name}`}
                    checked={enabled}
                    disabled={toggling[name]}
                    onChange={(e) => handleToggle(item, e.target.checked)}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
                <button
                  type="button"
                  className="settings-row-btn"
                  onClick={() => handleEdit(item)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="settings-row-btn settings-row-btn-danger"
                  onClick={() =>
                    setPendingDelete({
                      event: item.event,
                      matcher: item.matcher,
                    })
                  }
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>
      );
    });

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <h1>钩子</h1>
        <p>配置会话生命周期事件的钩子脚本。</p>
      </header>
      <section className="settings-section">
        <SettingsTabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          actions={
            activeTab === "user" || activeTab === "project" ? (
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => handleCreate(activeTab as "user" | "project")}
              >
                <i className="codicon codicon-add" aria-hidden="true" />
                新增钩子
              </button>
            ) : undefined
          }
        />
        {loading ? (
          <div className="empty-state">
            <p>加载中...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <p>{activeTabDef.label}暂无内容</p>
          </div>
        ) : (
          <div className="mcp-server-list">{renderEntries(entries)}</div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={`删除钩子「${formatHookName(pendingDelete.event, pendingDelete.matcher)}」`}
          description={`将从 ${settingsPathFor(activeTab, configPath)} 中移除该钩子配置，此操作不可撤销。`}
          confirmText="确认删除"
          cancelText="取消"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default SettingsHooksView;

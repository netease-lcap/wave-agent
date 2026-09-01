/**
 * SettingsMcpView - 设置页「MCP 服务」选项卡
 *
 * 由 /mcp 斜杠命令（或手动点击设置页「MCP 服务」导航）打开：按来源 Tab
 * （用户级 MCP / 项目级 MCP / 插件 MCP）展示服务器，项目级在「项目级 MCP」
 * Tab 平铺展示（仅当前项目，2026-09-01 用户拍板删项目分组卡片）。提供
 * 连接/断开、新建（预填 AI 对话框提示词）、编辑（预填提示词 + 打开配置文件）、
 * 删除（二次确认 + 直接删配置）。数据通过 getMcpServers RPC 由 host 下发
 * （含 scope 字段）。
 */

import React, { useState, useEffect, useCallback } from "react";
import { McpServerStatus } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsTabs, type SettingsTabDef } from "./SettingsManageComponents";
import "../styles/ConfigurationDialog.css";
import "../styles/SettingsPage.css";

const TABS: SettingsTabDef[] = [
  { key: "user", label: "用户级 MCP" },
  { key: "project", label: "项目级 MCP" },
  { key: "plugin", label: "插件 MCP" },
];

export interface SettingsMcpViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 当前工作目录（用于项目分组展示项目名） */
  workdir?: string;
  /** 关闭设置页并预填 AI 对话框提示词 */
  onPrefillPrompt?: (prompt: string) => void;
  /** 用系统编辑器打开文件（desktop 走 desktopOpenFileExternal；IDE 回退 openFile） */
  onOpenExternalFile?: (path: string) => void;
}

const SettingsMcpView: React.FC<SettingsMcpViewProps> = ({
  vscode,
  workdir,
  onPrefillPrompt,
  onOpenExternalFile,
}) => {
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);
  const [mcpConnecting, setMcpConnecting] = useState<Record<string, boolean>>(
    {},
  );
  // 用户级 / 项目级配置文件路径（getMcpConfigPaths 下发，删除确认框展示用）
  const [mcpConfigPaths, setMcpConfigPaths] = useState<{
    userPath: string | null;
    projectPath: string | null;
  } | null>(null);
  // 待删除服务器（null = 无确认框）
  const [pendingDelete, setPendingDelete] = useState<McpServerStatus | null>(
    null,
  );

  const fetchServers = useCallback(() => {
    vscode?.postMessage({ command: "getMcpServers" });
    vscode?.postMessage({ command: "getMcpConfigPaths" });
  }, [vscode]);

  // Fetch MCP servers on mount
  useEffect(() => {
    setLoading(true);
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "mcpServersResponse":
        case "mcpServersUpdate":
          setMcpServers(message.servers || []);
          setMcpConnecting({});
          setLoading(false);
          break;
        case "mcpConfigPathsResponse":
          setMcpConfigPaths({
            userPath:
              typeof message.userPath === "string" ? message.userPath : null,
            projectPath:
              typeof message.projectPath === "string"
                ? message.projectPath
                : null,
          });
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnect = (serverName: string) => {
    setMcpConnecting((prev) => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: "connectMcpServer", serverName });
  };

  const handleDisconnect = (serverName: string) => {
    setMcpConnecting((prev) => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: "disconnectMcpServer", serverName });
  };

  const tabServers = mcpServers.filter(
    (s) => (s.scope ?? "project") === activeTab,
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
        ? "/settings 帮我配个用户级 MCP 服务器<名字>：连<command/url>，参数<args>"
        : `/settings 帮我在【${projectName}】下配 MCP 服务器<名字>：连<command/url>，参数<args>`;
    onPrefillPrompt?.(prompt);
  };

  /** 打开该服务器所在配置文件（用户级 ~/.wave/mcp.json / 项目级 <workdir>/.mcp.json） */
  const openConfigFile = (server: McpServerStatus) => {
    const path =
      server.scope === "user"
        ? mcpConfigPaths?.userPath
        : mcpConfigPaths?.projectPath;
    const resolved =
      path ?? (server.scope === "user" ? "~/.wave/mcp.json" : ".mcp.json");
    if (onOpenExternalFile) {
      onOpenExternalFile(resolved);
      return;
    }
    vscode?.postMessage({ command: "openFile", path: resolved });
  };

  const handleEdit = (server: McpServerStatus) => {
    onPrefillPrompt?.(
      `帮我编辑 MCP 服务器${server.name}：把<要改的内容>改成<新内容>`,
    );
    openConfigFile(server);
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const scope = (pendingDelete.scope ?? "project") as "user" | "project";
    vscode?.postMessage({
      command: "removeMcpServer",
      scope,
      serverName: pendingDelete.name,
    });
    setPendingDelete(null);
    // 乐观移除；host 回发 mcpServersResponse 后最终一致
    setMcpServers((prev) => prev.filter((s) => s.name !== pendingDelete.name));
  };

  const configLabel = (server: McpServerStatus): string => {
    const cfg = server.config ?? ({} as Record<string, unknown>);
    if (cfg.url) return cfg.url;
    if (cfg.command) {
      return [cfg.command, ...(cfg.args ?? [])].join(" ");
    }
    return "";
  };

  const isEditable = activeTab === "user" || activeTab === "project";

  const renderServer = (server: McpServerStatus) => (
    <div key={server.name} className="mcp-server-item">
      <div className="mcp-server-info">
        <div className="mcp-server-header">
          <span
            className={`mcp-status-icon mcp-status-${server.status}`}
            title={server.status}
          >
            {server.status === "connected"
              ? "●"
              : server.status === "connecting" ||
                  server.status === "reconnecting"
                ? "⟳"
                : server.status === "error"
                  ? "✗"
                  : "○"}
          </span>
          <span className="mcp-server-name">{server.name}</span>
          {server.toolCount !== undefined && server.status === "connected" && (
            <span className="mcp-tool-count">{server.toolCount} tools</span>
          )}
        </div>
        {configLabel(server) && (
          <div
            style={{
              fontSize: "12px",
              color: "var(--vscode-descriptionForeground)",
              wordBreak: "break-all",
            }}
          >
            {configLabel(server)}
          </div>
        )}
        {server.error && <div className="mcp-server-error">{server.error}</div>}
        {server.lastConnected && (
          <div className="mcp-server-last-connected">
            最近连接: {new Date(server.lastConnected).toLocaleTimeString()}
          </div>
        )}
      </div>
      <div className="mcp-server-actions">
        {(server.status === "disconnected" || server.status === "error") && (
          <button
            className="mcp-connect-btn"
            onClick={() => handleConnect(server.name)}
            disabled={mcpConnecting[server.name]}
          >
            {mcpConnecting[server.name] ? "连接中..." : "连接"}
          </button>
        )}
        {server.status === "connected" && (
          <button
            className="mcp-disconnect-btn"
            onClick={() => handleDisconnect(server.name)}
            disabled={mcpConnecting[server.name]}
          >
            {mcpConnecting[server.name] ? "断开中..." : "断开"}
          </button>
        )}
        {isEditable && (
          <>
            <button
              type="button"
              className="settings-row-btn"
              onClick={() => handleEdit(server)}
            >
              编辑
            </button>
            <button
              type="button"
              className="settings-row-btn settings-row-btn-danger"
              onClick={() => setPendingDelete(server)}
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <h1>MCP 服务</h1>
        <p>管理 MCP 服务器连接。</p>
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
                {activeTab === "project"
                  ? "新增 MCP 服务"
                  : "新增用户级 MCP 服务"}
              </button>
            ) : undefined
          }
        />
        {loading ? (
          <div className="empty-state">
            <p>加载中...</p>
          </div>
        ) : tabServers.length === 0 ? (
          <div className="empty-state">
            <p>{activeTabDef.label}暂无内容</p>
            <p className="mcp-hint">
              {activeTab === "user"
                ? "用户级配置存于 ~/.wave/mcp.json，全局可用"
                : activeTab === "project"
                  ? "项目级配置存于项目根目录 .mcp.json，仅当前项目可用"
                  : "插件 MCP 服务由插件提供，只读"}
            </p>
          </div>
        ) : (
          <div className="mcp-server-list">{tabServers.map(renderServer)}</div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={`删除 MCP 服务「${pendingDelete.name}」`}
          description={`将从 ${
            pendingDelete.scope === "user"
              ? (mcpConfigPaths?.userPath ?? "~/.wave/mcp.json")
              : (mcpConfigPaths?.projectPath ?? "<项目>/.mcp.json")
          } 中移除该服务配置，此操作不可撤销。`}
          confirmText="确认删除"
          cancelText="取消"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default SettingsMcpView;

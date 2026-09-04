/**
 * SettingsSubagentsView - 设置页「子代理」选项卡
 *
 * 由 /agents 斜杠命令（或手动点击设置页「子代理」导航）打开：按来源 Tab
 * （插件 / 内置 / 用户 / 项目）展示 subagent 定义，项目子代理在「项目子代理」
 * Tab 平铺展示（仅当前项目，2026-09-01 用户拍板删项目分组卡片）。提供新建
 * （预填 AI 对话框提示词）、编辑（预填提示词 + 打开 markdown 文件）、删除
 * （二次确认 + 直接删文件）。数据通过 getSubagentConfigurations RPC 由 host 下发。
 */

import React, { useState, useEffect, useCallback } from "react";
import { SubagentConfiguration } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsTabs, type SettingsTabDef } from "./SettingsManageComponents";
import "../styles/ConfigurationDialog.css";
import "../styles/SettingsPage.css";

const SCOPE_LABELS: Record<string, string> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
};

const TABS: SettingsTabDef[] = [
  { key: "plugin", label: "插件子代理" },
  { key: "builtin", label: "内置子代理" },
  { key: "user", label: "用户子代理" },
  { key: "project", label: "项目子代理" },
];

export interface SettingsSubagentsViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 当前工作目录（用于项目分组展示项目名） */
  workdir?: string;
  /** 关闭设置页并预填 AI 对话框提示词；编辑操作附带 openFile（配置文件路径）——
   *  desktop 在会话视图右侧文件面板打开该文件；IDE 由 host 用自身编辑器打开。 */
  onPrefillPrompt?: (prompt: string, openFile?: string) => void;
}

const SettingsSubagentsView: React.FC<SettingsSubagentsViewProps> = ({
  vscode,
  workdir,
  onPrefillPrompt,
}) => {
  const [configurations, setConfigurations] = useState<SubagentConfiguration[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // 待删除子代理（null = 无确认框）
  const [pendingDelete, setPendingDelete] =
    useState<SubagentConfiguration | null>(null);

  const fetchConfigurations = useCallback(() => {
    vscode?.postMessage({ command: "getSubagentConfigurations" });
  }, [vscode]);

  // Fetch agent definitions on mount (fresh each time the tab opens)
  useEffect(() => {
    setLoading(true);
    fetchConfigurations();
  }, [fetchConfigurations]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "subagentConfigurationsResponse") {
        setConfigurations(message.configurations || []);
        setLoading(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const selectedAgent =
    configurations.find((c) => c.name === selectedName) || null;

  const tabAgents = configurations.filter((c) => c.scope === activeTab);
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
        ? "帮我新建用户级子代理<名字>：用于<用途>，工具用<工具列表>，模型用<模型>"
        : `帮我在【${projectName}】新建子代理<名字>：用于<用途>，工具用<工具列表>，模型用<模型>`;
    onPrefillPrompt?.(prompt);
  };

  const handleEdit = (agent: SubagentConfiguration) => {
    // 关闭设置页预填编辑提示词；同带 agent.filePath —— desktop 在会话视图右侧
    // 文件面板打开该 markdown、IDE 用自身编辑器打开，便于对照修改。
    onPrefillPrompt?.(
      `帮我编辑子代理${agent.name}：把<要改的内容>改成<新内容>`,
      agent.filePath,
    );
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    vscode?.postMessage({
      command: "deleteSubagent",
      name: pendingDelete.name,
    });
    setPendingDelete(null);
    fetchConfigurations();
  };

  const isEditable = (agent: SubagentConfiguration) =>
    agent.scope === "user" || agent.scope === "project";

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <h1>子代理</h1>
        <p>配置用于并行处理任务的子代理。</p>
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
                {activeTab === "project" ? "新增指令" : "新增子代理"}
              </button>
            ) : undefined
          }
        />
        {loading ? (
          <div className="empty-state">
            <p>加载中...</p>
          </div>
        ) : selectedAgent ? (
          <div className="mcp-server-list">
            <div className="mcp-server-item">
              <div className="mcp-server-info">
                <div className="mcp-server-header">
                  <span className="mcp-server-name">{selectedAgent.name}</span>
                  {selectedAgent.scope && (
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      {SCOPE_LABELS[selectedAgent.scope] || selectedAgent.scope}
                    </span>
                  )}
                </div>
                {selectedAgent.description && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    {selectedAgent.description}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                marginTop: "12px",
                fontSize: "13px",
                lineHeight: "1.6",
              }}
            >
              {selectedAgent.description && (
                <div>
                  <strong>描述：</strong> {selectedAgent.description}
                </div>
              )}
              <div>
                <strong>模型：</strong>{" "}
                {selectedAgent.model || "默认（未显式配置）"}
              </div>
              <div>
                <strong>来源：</strong>{" "}
                {SCOPE_LABELS[selectedAgent.scope] || selectedAgent.scope}
              </div>
              {selectedAgent.tools && selectedAgent.tools.length > 0 && (
                <div>
                  <strong>工具：</strong> {selectedAgent.tools.join(", ")}
                </div>
              )}
              {selectedAgent.filePath && (
                <div style={{ wordBreak: "break-all" }}>
                  <strong>文件：</strong> {selectedAgent.filePath}
                </div>
              )}
              {selectedAgent.systemPrompt && (
                <div style={{ marginTop: "8px" }}>
                  <strong>系统提示词：</strong>
                  <pre
                    style={{
                      background:
                        "var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15))",
                      padding: "8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontFamily: "var(--vscode-editor-font-family, monospace)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: "4px 0 0 0",
                    }}
                  >
                    {selectedAgent.systemPrompt}
                  </pre>
                </div>
              )}
            </div>

            <div className="settings-actions">
              <button
                type="button"
                onClick={() => setSelectedName(null)}
                className="settings-save-btn"
              >
                返回列表
              </button>
            </div>
          </div>
        ) : tabAgents.length === 0 ? (
          <div className="empty-state">
            <p>{activeTabDef.label}暂无内容</p>
          </div>
        ) : (
          <div className="mcp-server-list">
            {tabAgents.map((agent) => (
              <div key={agent.name} className="mcp-server-item">
                <div
                  className="mcp-server-info"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedName(agent.name)}
                >
                  <div className="mcp-server-header">
                    <span className="mcp-server-name">{agent.name}</span>
                    {agent.model && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        · {agent.model}
                      </span>
                    )}
                  </div>
                  {agent.description && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      {agent.description}
                    </div>
                  )}
                </div>
                <div className="mcp-server-actions">
                  {isEditable(agent) && (
                    <>
                      <button
                        type="button"
                        className="settings-row-btn"
                        onClick={() => handleEdit(agent)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="settings-row-btn settings-row-btn-danger"
                        onClick={() => setPendingDelete(agent)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={`删除子代理「${pendingDelete.name}」`}
          description={`将删除子代理文件${pendingDelete.filePath ? `（${pendingDelete.filePath}）` : ""}，此操作不可撤销。`}
          confirmText="确认删除"
          cancelText="取消"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default SettingsSubagentsView;

/**
 * SettingsSubagentsView - 设置页「子代理」选项卡
 *
 * 由 /agents 斜杠命令（或手动点击设置页「子代理」导航）打开：展示当前会话
 * 可见的 subagent 定义，按来源分组，点击进入详情视图。内容自弹窗
 * AgentsDialog 迁移而来（2026-08-29 用户拍板：/agents、/skills 不再弹窗，
 * 改为唤起设置页并选中对应选项卡）；去掉 overlay/关闭逻辑，数据仍通过
 * getSubagentConfigurations RPC 由 host 下发。
 */

import React, { useState, useEffect } from "react";
import { SubagentConfiguration } from "../types";
import "../styles/ConfigurationDialog.css";

const SCOPE_ORDER = ["builtin", "user", "project", "plugin"] as const;
const SCOPE_LABELS: Record<string, string> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
};

export interface SettingsSubagentsViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
}

const SettingsSubagentsView: React.FC<SettingsSubagentsViewProps> = ({
  vscode,
}) => {
  const [configurations, setConfigurations] = useState<SubagentConfiguration[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Fetch agent definitions on mount (fresh each time the tab opens)
  useEffect(() => {
    vscode?.postMessage({ command: "getSubagentConfigurations" });
  }, [vscode]);

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

  // Group by scope, keeping a stable order; agents already carry effective
  // (non-shadowed) definitions and plugin names are `pluginName:agentName`.
  const grouped = SCOPE_ORDER.map((scope) => ({
    scope,
    agents: configurations.filter((c) => c.scope === scope),
  })).filter((group) => group.agents.length > 0);

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <h1>子代理</h1>
        <p>配置用于并行处理任务的子代理。</p>
      </header>
      <section className="settings-section">
        <div className="settings-card">
          {loading ? (
            <div className="empty-state">
              <p>加载中...</p>
            </div>
          ) : selectedAgent ? (
            <div className="mcp-server-list">
              <div className="mcp-server-item">
                <div className="mcp-server-info">
                  <div className="mcp-server-header">
                    <span className="mcp-server-name">
                      {selectedAgent.name}
                    </span>
                    {selectedAgent.scope && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        {SCOPE_LABELS[selectedAgent.scope] ||
                          selectedAgent.scope}
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
                        fontFamily:
                          "var(--vscode-editor-font-family, monospace)",
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
            </div>
          ) : configurations.length === 0 ? (
            <div className="empty-state">
              <p>暂无可用 agents</p>
            </div>
          ) : (
            <div className="mcp-server-list">
              {grouped.map((group) => (
                <div key={group.scope}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: "var(--vscode-descriptionForeground)",
                      margin: "8px 0 4px 0",
                    }}
                  >
                    {SCOPE_LABELS[group.scope]} agents
                  </div>
                  {group.agents.map((agent) => (
                    <div
                      key={agent.name}
                      className="mcp-server-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedName(agent.name)}
                    >
                      <div className="mcp-server-info">
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
                        <span className="mcp-tool-count">›</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {selectedAgent && (
            <div className="settings-actions">
              <button
                type="button"
                onClick={() => setSelectedName(null)}
                className="settings-save-btn"
              >
                返回列表
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SettingsSubagentsView;

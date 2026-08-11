/**
 * AgentsDialog - agent definitions dialog
 *
 * Opened via the /agents slash command. Shows the current session's
 * visible subagent definitions grouped by scope, with a click-to-detail
 * view mirroring the CLI AgentsManager.
 */

import React, { useState, useEffect, useRef } from "react";
import { AgentsDialogProps, SubagentConfiguration } from "../types";
import "../styles/ConfigurationDialog.css";

const SCOPE_ORDER = ["builtin", "user", "project", "plugin"] as const;
const SCOPE_LABELS: Record<string, string> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
};

const AgentsDialog: React.FC<
  AgentsDialogProps & {
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onClose, vscode }) => {
  const [configurations, setConfigurations] = useState<SubagentConfiguration[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fetch agent definitions on mount
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedName) {
          setSelectedName(null);
        } else {
          onClose();
        }
      }
    };

    // Defer registration to the next tick so the click that opened this dialog
    // (still bubbling to document) doesn't immediately trigger the outside-close.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscapeKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [onClose, selectedName]);

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="agents-dialog"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3>Agents</h3>
        </div>

        <div className="mcp-container">
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

          <div className="configuration-actions">
            {selectedAgent && (
              <button
                type="button"
                onClick={() => setSelectedName(null)}
                className="configuration-cancel-btn"
              >
                返回列表
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentsDialog;

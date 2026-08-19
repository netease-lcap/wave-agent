/**
 * SkillsDialog - skill metadata dialog
 *
 * Opened via the /skills slash command. Shows the current session's visible
 * skills grouped by scope, with a click-to-detail view mirroring the CLI
 * SkillsManager.
 */

import React, { useState, useEffect, useRef } from "react";
import { SkillsDialogProps, SkillMetadata } from "../types";
import "../styles/ConfigurationDialog.css";

const SCOPE_ORDER = ["builtin", "user", "project", "plugin"] as const;
const SCOPE_LABELS: Record<string, string> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
};

/** Group scope for a skill: plugin skills (pluginName set) get their own
 * group, everything else groups by its discovery type ("personal" skills
 * are shown under the user scope). Mirrors the CLI SkillsManager. */
function getSkillScope(skill: SkillMetadata): string {
  if (skill.pluginName) {
    return "plugin";
  }
  if (skill.type === "personal") {
    return "user";
  }
  return skill.type;
}

const SkillsDialog: React.FC<
  SkillsDialogProps & {
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onClose, vscode }) => {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fetch skill metadata on mount
  useEffect(() => {
    vscode?.postMessage({ command: "getSkillMetadata" });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "skillMetadataResponse") {
        setSkills(message.skills || []);
        setLoading(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const selectedSkill = skills.find((s) => s.name === selectedName) || null;

  // Group by scope, keeping a stable order; plugin skills are `pluginName:skill`.
  const grouped = SCOPE_ORDER.map((scope) => ({
    scope,
    skills: skills.filter((s) => getSkillScope(s) === scope),
  })).filter((group) => group.skills.length > 0);

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

  const invocationLabel = (skill: SkillMetadata): string => {
    const restrictions: string[] = [];
    if (skill.userInvocable === false) {
      restrictions.push("不可通过 /命令 调用");
    }
    if (skill.disableModelInvocation) {
      restrictions.push("模型自动调用已禁用");
    }
    return restrictions.length > 0
      ? restrictions.join("，")
      : "用户与模型均可调用";
  };

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="skills-dialog"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3>Skills</h3>
        </div>

        <div className="mcp-container">
          {loading ? (
            <div className="empty-state">
              <p>加载中...</p>
            </div>
          ) : selectedSkill ? (
            <div className="mcp-server-list">
              <div className="mcp-server-item">
                <div className="mcp-server-info">
                  <div className="mcp-server-header">
                    <span className="mcp-server-name">
                      {selectedSkill.name}
                    </span>
                    {selectedSkill.pluginName && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        · {selectedSkill.pluginName}
                      </span>
                    )}
                  </div>
                  {selectedSkill.description && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      {selectedSkill.description}
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
                {selectedSkill.description && (
                  <div>
                    <strong>描述：</strong> {selectedSkill.description}
                  </div>
                )}
                <div>
                  <strong>来源：</strong>{" "}
                  {SCOPE_LABELS[getSkillScope(selectedSkill)]}
                  {selectedSkill.pluginName
                    ? ` (${selectedSkill.pluginName})`
                    : ""}
                </div>
                {selectedSkill.skillPath && (
                  <div style={{ wordBreak: "break-all" }}>
                    <strong>路径：</strong> {selectedSkill.skillPath}
                  </div>
                )}
                {selectedSkill.model && (
                  <div>
                    <strong>模型：</strong> {selectedSkill.model}
                  </div>
                )}
                {selectedSkill.agent && (
                  <div>
                    <strong>Agent：</strong> {selectedSkill.agent}
                  </div>
                )}
                {selectedSkill.allowedTools &&
                  selectedSkill.allowedTools.length > 0 && (
                    <div>
                      <strong>允许的工具：</strong>{" "}
                      {selectedSkill.allowedTools.join(", ")}
                    </div>
                  )}
                <div>
                  <strong>调用方式：</strong> {invocationLabel(selectedSkill)}
                </div>
              </div>
            </div>
          ) : skills.length === 0 ? (
            <div className="empty-state">
              <p>暂无可用技能</p>
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
                    {SCOPE_LABELS[group.scope]} skills
                  </div>
                  {group.skills.map((skill) => (
                    <div
                      key={skill.name}
                      className="mcp-server-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedName(skill.name)}
                    >
                      <div className="mcp-server-info">
                        <div className="mcp-server-header">
                          <span className="mcp-server-name">{skill.name}</span>
                          {skill.pluginName && (
                            <span
                              style={{
                                fontSize: "12px",
                                color: "var(--vscode-descriptionForeground)",
                              }}
                            >
                              · {skill.pluginName}
                            </span>
                          )}
                        </div>
                        {skill.description && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--vscode-descriptionForeground)",
                            }}
                          >
                            {skill.description}
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
            {selectedSkill && (
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

export default SkillsDialog;

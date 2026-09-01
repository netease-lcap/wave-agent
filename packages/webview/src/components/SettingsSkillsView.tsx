/**
 * SettingsSkillsView - 设置页「技能」选项卡
 *
 * 由 /skills 斜杠命令（或手动点击设置页「技能」导航）打开：按来源 Tab
 * （插件技能 / 内置技能 / 用户技能 / 项目技能）展示技能，项目技能在「项目技能」
 * Tab 平铺展示（仅当前项目，2026-09-01 用户拍板删项目分组卡片）。提供新建
 * （预填 AI 对话框提示词）、编辑（预填提示词 + 打开 SKILL.md）、删除（二次
 * 确认 + 直接删文件）。数据通过 getSkillMetadata RPC 由 host 下发。
 */

import React, { useState, useEffect, useCallback } from "react";
import { SkillMetadata } from "../types";
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
  { key: "plugin", label: "插件技能" },
  { key: "builtin", label: "内置技能" },
  { key: "user", label: "用户技能" },
  { key: "project", label: "项目技能" },
];

export interface SettingsSkillsViewProps {
  /** Host 消息桥（ChatApp desktop 分支 / settings-preview-entry 传入） */
  vscode?: { postMessage: (msg: unknown) => void };
  /** 当前工作目录（用于项目分组展示项目名） */
  workdir?: string;
  /** 关闭设置页并预填 AI 对话框提示词 */
  onPrefillPrompt?: (prompt: string) => void;
  /** 用系统编辑器打开文件（desktop 走 desktopOpenFileExternal；IDE 回退 openFile） */
  onOpenExternalFile?: (path: string) => void;
}

/** 技能来源 tab：插件技能（pluginName 设置）归 plugin，personal 归 user，其余按 type */
function getSkillScope(skill: SkillMetadata): string {
  if (skill.pluginName) return "plugin";
  if (skill.type === "personal") return "user";
  return skill.type;
}

const SettingsSkillsView: React.FC<SettingsSkillsViewProps> = ({
  vscode,
  workdir,
  onPrefillPrompt,
  onOpenExternalFile,
}) => {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // 待删除技能（null = 无确认框）
  const [pendingDelete, setPendingDelete] = useState<SkillMetadata | null>(
    null,
  );

  const fetchSkills = useCallback(() => {
    vscode?.postMessage({ command: "getSkillMetadata" });
  }, [vscode]);

  // Fetch skill metadata on mount (fresh each time the tab opens)
  useEffect(() => {
    setLoading(true);
    fetchSkills();
  }, [fetchSkills]);

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

  const tabSkills = skills.filter((s) => getSkillScope(s) === activeTab);
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
        ? "/settings 帮我新建一个用户级技能：<技能名>，用于<场景>，内容是<做什么>"
        : `/settings 帮我在【${projectName}】下新建一个技能：<技能名>，用于<场景>，内容是<做什么>`;
    onPrefillPrompt?.(prompt);
  };

  const handleEdit = (skill: SkillMetadata) => {
    onPrefillPrompt?.(
      `/settings 帮我改技能${skill.name}：把<要改的地方>改成<新内容/新行为>`,
    );
    openSkillFile(skill);
  };

  const openSkillFile = (skill: SkillMetadata) => {
    if (!skill.skillPath) return;
    if (onOpenExternalFile) {
      onOpenExternalFile(skill.skillPath);
      return;
    }
    vscode?.postMessage({ command: "openFile", path: skill.skillPath });
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    vscode?.postMessage({ command: "deleteSkill", name: pendingDelete.name });
    setPendingDelete(null);
    // 列表刷新依赖 host 回发 skillMetadataResponse（删除后重新拉取）
    fetchSkills();
  };

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

  const isEditable = (skill: SkillMetadata) =>
    getSkillScope(skill) === "user" || getSkillScope(skill) === "project";

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <h1>技能</h1>
        <p>管理可复用的技能。</p>
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
                {activeTab === "project" ? "新增指令" : "新建技能"}
              </button>
            ) : undefined
          }
        />
        {loading ? (
          <div className="empty-state">
            <p>加载中...</p>
          </div>
        ) : selectedSkill ? (
          <div className="mcp-server-list">
            <div className="mcp-server-item">
              <div className="mcp-server-info">
                <div className="mcp-server-header">
                  <span className="mcp-server-name">{selectedSkill.name}</span>
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
        ) : tabSkills.length === 0 ? (
          <div className="empty-state">
            <p>{activeTabDef.label}暂无内容</p>
          </div>
        ) : (
          <div className="mcp-server-list">
            {tabSkills.map((skill) => (
              <div key={skill.name} className="mcp-server-item">
                <div
                  className="mcp-server-info"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedName(skill.name)}
                >
                  <div className="mcp-server-header">
                    <span className="mcp-server-name">
                      {getSkillScope(skill) === "project" ? "/" : ""}
                      {skill.name}
                    </span>
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
                  {isEditable(skill) && (
                    <>
                      <button
                        type="button"
                        className="settings-row-btn"
                        onClick={() => handleEdit(skill)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="settings-row-btn settings-row-btn-danger"
                        onClick={() => setPendingDelete(skill)}
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
          title={`删除技能「${pendingDelete.name}」`}
          description={`将删除技能目录${pendingDelete.skillPath ? `（${pendingDelete.skillPath}）` : ""}，此操作不可撤销。`}
          confirmText="确认删除"
          cancelText="取消"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default SettingsSkillsView;

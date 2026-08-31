/**
 * SettingsManageComponents - 设置页管理视图共享组件（技能 / 子代理 / 钩子 / MCP）
 *
 * 四个管理视图共用同一形态（2026-08-29 用户拍板）：来源 Tab + 项目分组卡片。
 * 这里只放纯展示的共享件；每个视图自己的数据获取 / 分组 / 操作逻辑留在各视图内。
 */

import React from "react";

export interface SettingsTabDef {
  key: string;
  label: string;
}

export interface SettingsTabsProps {
  tabs: SettingsTabDef[];
  activeTab: string;
  onChange: (tab: string) => void;
  /** 右侧操作区（如「新建」按钮），可空 */
  actions?: React.ReactNode;
}

/** 来源 Tab 栏（复用个性化视图的 settings-tabs 样式） */
export const SettingsTabs: React.FC<SettingsTabsProps> = ({
  tabs,
  activeTab,
  onChange,
  actions,
}) => (
  <div className="settings-card-toolbar">
    <div className="settings-tabs" role="tablist" aria-label="来源范围">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          className={`settings-tab${activeTab === tab.key ? " is-active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
    {actions && <div className="settings-toolbar-actions">{actions}</div>}
  </div>
);

export interface ProjectCardProps {
  /** 项目名（卡片头显示） */
  projectName: string;
  /** 卡片头右侧操作（如「新增指令」），可空 */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** 项目分组卡片：项目技能/子代理/钩子/MCP 按所属项目分组，每项目一张卡片 */
export const ProjectCard: React.FC<ProjectCardProps> = ({
  projectName,
  action,
  children,
}) => (
  <div className="settings-project-card">
    <div className="settings-project-card-header">
      <i className="codicon codicon-repo" aria-hidden="true" />
      <span className="settings-project-card-name">{projectName}</span>
      {action && <div className="settings-project-card-action">{action}</div>}
    </div>
    <div className="settings-project-card-body">{children}</div>
  </div>
);

/** 从文件路径推断所属项目名；无法推断时归入「其他项目」 */
export function inferProjectName(
  filePath: string | undefined,
  workdir?: string,
): string {
  if (!filePath) return "其他项目";
  if (workdir && filePath.startsWith(workdir)) {
    const parts = workdir.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : workdir;
  }
  return "其他项目";
}

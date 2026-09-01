/**
 * SettingsManageComponents - 设置页管理视图共享组件（技能 / 子代理 / 钩子 / MCP）
 *
 * 四个管理视图共用同一形态（2026-08-29 用户拍板：来源 Tab；2026-09-01 用户
 * 拍板：设置页只针对当前项目，删除项目分组卡片，项目 Tab 直接平铺）。
 * 这里只放纯展示的共享件；每个视图自己的数据获取 / 操作逻辑留在各视图内。
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

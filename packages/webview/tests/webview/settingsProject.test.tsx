import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

function renderProjectView(options?: {
  projectSettings?: { enabledPlugins: Record<string, boolean> };
}) {
  const onLoadProjectSettings = vi.fn();
  const onToggleBuiltinPlugin = vi.fn();
  render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav="project"
      projectSettings={options?.projectSettings}
      onLoadProjectSettings={onLoadProjectSettings}
      onToggleBuiltinPlugin={onToggleBuiltinPlugin}
    />,
  );
  return { onLoadProjectSettings, onToggleBuiltinPlugin };
}

describe("SettingsPage 项目设置视图（内容自 ConfigDialog 项目设置选项卡迁移）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染 SDD 开关，未加载项目设置时进入视图触发加载", () => {
    const { onLoadProjectSettings } = renderProjectView();

    expect(
      screen.getByRole("heading", { name: "项目设置" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("启用 SDD 插件")).not.toBeChecked();
    expect(onLoadProjectSettings).toHaveBeenCalled();
  });

  it("已加载且 sdd@builtin=true 时开关为勾选态，不重复触发加载", () => {
    const { onLoadProjectSettings } = renderProjectView({
      projectSettings: { enabledPlugins: { "sdd@builtin": true } },
    });

    expect(screen.getByLabelText("启用 SDD 插件")).toBeChecked();
    expect(onLoadProjectSettings).not.toHaveBeenCalled();
  });

  it("sdd@builtin=true 时切换开关回调 false", () => {
    const { onToggleBuiltinPlugin } = renderProjectView({
      projectSettings: { enabledPlugins: { "sdd@builtin": true } },
    });

    fireEvent.click(screen.getByLabelText("启用 SDD 插件"));
    expect(onToggleBuiltinPlugin).toHaveBeenCalledWith("sdd@builtin", false);
  });

  it("sdd@builtin 未启用时切换开关回调 true", () => {
    const { onToggleBuiltinPlugin } = renderProjectView({
      projectSettings: { enabledPlugins: {} },
    });

    fireEvent.click(screen.getByLabelText("启用 SDD 插件"));
    expect(onToggleBuiltinPlugin).toHaveBeenCalledWith("sdd@builtin", true);
  });
});

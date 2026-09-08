import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage, { type NavKey } from "../../src/components/SettingsPage";

function renderProjectView(options?: {
  initialNav?: NavKey;
  workdir?: string;
  projectSettingsWorkdir?: string;
  projectSettings?: { enabledPlugins: Record<string, boolean> };
}) {
  const {
    initialNav = "project",
    workdir,
    projectSettingsWorkdir,
    projectSettings,
  } = options ?? {};
  const onLoadProjectSettings = vi.fn();
  const onToggleBuiltinPlugin = vi.fn();
  const utils = render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav={initialNav}
      workdir={workdir}
      projectSettings={projectSettings}
      projectSettingsWorkdir={projectSettingsWorkdir}
      onLoadProjectSettings={onLoadProjectSettings}
      onToggleBuiltinPlugin={onToggleBuiltinPlugin}
    />,
  );
  return { ...utils, onLoadProjectSettings, onToggleBuiltinPlugin };
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

  it("已加载且 sdd@builtin=true 时开关为勾选态；进入视图仍重新触发加载（不复用缓存）", () => {
    const { onLoadProjectSettings } = renderProjectView({
      projectSettings: { enabledPlugins: { "sdd@builtin": true } },
    });

    expect(screen.getByLabelText("启用 SDD 插件")).toBeChecked();
    // 进入视图即重拉（对齐 spec desktop-account-and-settings 场景 8：每次进入
    // 都以当前项目真实配置刷新，避免文件已启用而开关停留旧缓存值）
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);
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

  it("进入后 host 回发 projectSettings（缓存更新）不重复触发加载", () => {
    // 防 fetch→reply→fetch 死循环：触发键不包含 projectSettings 本身
    const { onLoadProjectSettings, rerender } = renderProjectView({
      workdir: "/proj/A",
      projectSettingsWorkdir: "/proj/A",
    });
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        initialNav="project"
        workdir="/proj/A"
        projectSettings={{ enabledPlugins: { "sdd@builtin": true } }}
        projectSettingsWorkdir="/proj/A"
        onLoadProjectSettings={onLoadProjectSettings}
        onToggleBuiltinPlugin={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("启用 SDD 插件")).toBeChecked();
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);
  });

  it("工作目录切换后停留视图内自动重拉，旧项目缓存不回显为当前项目状态", () => {
    // A 项目缓存：SDD 关。切换活动会话到 SDD 已开启的 B 项目，重入前视图仍停留
    // 项目设置，仅 workdir 变化即应重拉；A 的缓存不属于 B，不应显示为 B 的关。
    const { onLoadProjectSettings, rerender } = renderProjectView({
      workdir: "/proj/A",
      projectSettingsWorkdir: "/proj/A",
      projectSettings: { enabledPlugins: {} },
    });
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("启用 SDD 插件")).not.toBeChecked();

    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        initialNav="project"
        workdir="/proj/B"
        projectSettings={{ enabledPlugins: {} }}
        projectSettingsWorkdir="/proj/A"
        onLoadProjectSettings={onLoadProjectSettings}
        onToggleBuiltinPlugin={vi.fn()}
      />,
    );
    // 重拉已触发；缓存仍属 A → 开关禁用（按未加载处理），而非错误显示 B 为关
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("启用 SDD 插件")).toBeDisabled();

    // host 回发 B 的真实配置（sdd@builtin=true）→ 开关 ON
    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        initialNav="project"
        workdir="/proj/B"
        projectSettings={{ enabledPlugins: { "sdd@builtin": true } }}
        projectSettingsWorkdir="/proj/B"
        onLoadProjectSettings={onLoadProjectSettings}
        onToggleBuiltinPlugin={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("启用 SDD 插件")).toBeChecked();
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(2);
  });

  it("离开「项目设置」视图再重入会重新触发加载", () => {
    const { onLoadProjectSettings } = renderProjectView({
      initialNav: "global",
    });
    expect(onLoadProjectSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);

    // 切走再切回 = 重入视图 → 再次以当前工作目录重读
    fireEvent.click(screen.getByRole("button", { name: "技能" }));
    fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(2);
  });
});

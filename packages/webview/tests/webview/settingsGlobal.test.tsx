import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

function renderGlobalView(options?: {
  themeSource?: "system" | "light" | "dark";
  updateChannel?: "stable" | "beta";
}) {
  const onThemeChange = vi.fn();
  const onUpdateChannelChange = vi.fn();
  render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      themeSource={options?.themeSource}
      onThemeChange={onThemeChange}
      updateChannel={options?.updateChannel}
      onUpdateChannelChange={onUpdateChannelChange}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
    />,
  );
  return { onThemeChange, onUpdateChannelChange };
}

/** 定位某区块 <section>（区块标题 h2 所在的最外层 section 容器）。 */
function sectionFor(headingName: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: headingName });
  const section = heading.closest("section");
  if (!section) throw new Error(`找不到区块：${headingName}`);
  return section as HTMLElement;
}

describe("SettingsPage 全局设置视图「主题」行（仅桌面端传入 themeSource 时显示）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("桌面端（themeSource 传入）显示主题选择，选项为跟随系统/浅色/深色", () => {
    renderGlobalView({ themeSource: "system" });

    expect(
      screen.getByRole("heading", { name: "全局设置" }),
    ).toBeInTheDocument();
    const select = screen.getByLabelText("主题") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("system");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "跟随系统",
      "浅色",
      "深色",
    ]);
  });

  it("固定深色偏好时选中深色", () => {
    renderGlobalView({ themeSource: "dark" });

    const select = screen.getByLabelText("主题") as HTMLSelectElement;
    expect(select.value).toBe("dark");
  });

  it('选择浅色即时回调 onThemeChange("light")，本地选中态更新', () => {
    const { onThemeChange } = renderGlobalView({ themeSource: "system" });

    fireEvent.change(screen.getByLabelText("主题"), {
      target: { value: "light" },
    });

    expect(onThemeChange).toHaveBeenCalledWith("light");
    const select = screen.getByLabelText("主题") as HTMLSelectElement;
    expect(select.value).toBe("light");
  });

  it("host 广播新偏好（themeSource prop 更新）后选中态同步", () => {
    const { rerender } = render(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        themeSource="system"
        onThemeChange={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
      />,
    );

    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        themeSource="dark"
        onThemeChange={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
      />,
    );

    const select = screen.getByLabelText("主题") as HTMLSelectElement;
    expect(select.value).toBe("dark");
  });

  it("IDE（themeSource 未传入）不渲染主题行", () => {
    renderGlobalView();

    expect(
      screen.getByRole("heading", { name: "全局设置" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("主题")).not.toBeInTheDocument();
    expect(screen.getByLabelText("AI 回复语言")).toBeInTheDocument();
  });
});

describe("SettingsPage 全局设置视图区块拆分（2026-09-08 拍板：主题/接收 Beta 从基础设置拆为「桌面端设置」区块）", () => {
  it("桌面端（themeSource + updateChannel 均传入）渲染「基础设置」与「桌面端设置」两个区块，主题/Beta 归桌面端设置、语言/上下文长度归基础设置", () => {
    renderGlobalView({ themeSource: "system", updateChannel: "stable" });

    expect(
      screen.getByRole("heading", { name: "基础设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "桌面端设置" }),
    ).toBeInTheDocument();

    // 桌面端设置区块：含主题与接收 Beta 开关，无上下文长度
    const desktopSection = sectionFor("桌面端设置");
    expect(within(desktopSection).getByLabelText("主题")).toBeInTheDocument();
    expect(
      within(desktopSection).getByLabelText("接收 Beta 版更新"),
    ).toBeInTheDocument();
    expect(
      within(desktopSection).queryByLabelText("上下文长度"),
    ).not.toBeInTheDocument();

    // 基础设置区块：仅含语言/上下文长度（可保存项），不含主题/Beta
    const basicSection = sectionFor("基础设置");
    expect(
      within(basicSection).getByLabelText("AI 回复语言"),
    ).toBeInTheDocument();
    expect(
      within(basicSection).getByLabelText("上下文长度"),
    ).toBeInTheDocument();
    expect(
      within(basicSection).queryByLabelText("主题"),
    ).not.toBeInTheDocument();
    expect(
      within(basicSection).queryByLabelText("接收 Beta 版更新"),
    ).not.toBeInTheDocument();
  });

  it("IDE（themeSource/updateChannel 均未传入）只渲染「基础设置」，不渲染「桌面端设置」区块", () => {
    renderGlobalView();

    expect(
      screen.getByRole("heading", { name: "基础设置" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "桌面端设置" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("主题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("接收 Beta 版更新")).not.toBeInTheDocument();
  });
});

describe("SettingsPage 保存反馈（瞬态提示，切换导航项清除）", () => {
  function renderWithSaving(saving: boolean) {
    return render(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        saving={saving}
      />,
    );
  }

  it("host 回包（saving true→false）后显示「保存成功」，切换到个性化视图即清除", () => {
    const { rerender } = renderWithSaving(false);

    // 点击保存 → 模拟 host 保存中（saving=true）→ 回包（saving=false）
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        saving={true}
      />,
    );
    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        saving={false}
      />,
    );
    expect(screen.getByText("保存成功")).toBeInTheDocument();

    // 切换到「个性化」视图：瞬态反馈不得跨导航残留
    fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  });

  it("保存中（saving=true）切换导航项后回包不再显示反馈", () => {
    const { rerender } = renderWithSaving(false);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        saving={true}
      />,
    );

    // 保存进行中切到「个性化」→ 该次保存的反馈被丢弃
    fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        saving={false}
      />,
    );
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

function renderGlobalView(options?: {
  themeSource?: "system" | "light" | "dark";
}) {
  const onThemeChange = vi.fn();
  render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      themeSource={options?.themeSource}
      onThemeChange={onThemeChange}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
    />,
  );
  return { onThemeChange };
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

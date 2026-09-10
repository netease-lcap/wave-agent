import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "./test-utils";
import SettingsPage, {
  UNSET_OPTION_LABEL,
} from "../../src/components/SettingsPage";
import type { ConfigurationData } from "../../src/types";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_WAVE_MAX_INPUT_TOKENS,
} from "wave-agent-sdk/dist/utils/constants.js";

/**
 * 引 SDK 的默认值做「显示 ≡ 生效」守卫（spec agent-config 边界说明「语言默认
 * 值」）：设置页未设置态文案里写的默认值必须与 SDK 解析链末尾的兜底同源，否则
 * 会出现「设置页写着中文、实际按别的语言回复」或「占位符写 200K、实际是别的数」
 * 这类分叉。跨包引用只读常量，不引入 SDK 运行时代码路径。
 */

function renderGlobalView(options?: {
  themeSource?: "system" | "light" | "dark";
  updateChannel?: "stable" | "beta";
  /** 设置页初值（来自 settings.json）。不传 = 沿用「已设置语言」的常规回包。 */
  configurationData?: ConfigurationData;
  onSave?: (data: ConfigurationData) => void;
}) {
  const onThemeChange = vi.fn();
  const onUpdateChannelChange = vi.fn();
  const onSave = vi.fn();
  render(
    <SettingsPage
      configurationData={options?.configurationData ?? { language: "zh-CN" }}
      onSave={options?.onSave ?? onSave}
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
  return { onThemeChange, onUpdateChannelChange, onSave };
}

/** 定位某区块 <section>（区块标题 h2 所在的最外层 section 容器）。 */
function sectionFor(headingName: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: headingName });
  const section = heading.closest("section");
  if (!section) throw new Error(`找不到区块：${headingName}`);
  return section as HTMLElement;
}

function languageSelect(): HTMLSelectElement {
  return screen.getByLabelText("AI 回复语言") as HTMLSelectElement;
}

function contextLengthInput(): HTMLInputElement {
  return screen.getByLabelText("上下文长度") as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
}

describe("SettingsPage「AI 回复语言」行（未设置时显示 ≡ 生效）", () => {
  it("settings.json 未设置 language 时选中「未设置（默认：中文）」，其默认值与 SDK 兜底同语言", () => {
    renderGlobalView({ configurationData: {} });

    const select = languageSelect();
    // 未设置 = 文件里没有该键：必须显式表达「未设置」（下拉没有 placeholder 语义），
    // 而不是假装选中一个真实值（spec agent-config 场景 7）。
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe(UNSET_OPTION_LABEL);
    // 「显示 ≡ 生效」：未设置态声明的默认语言必须就是 SDK 解析链末尾的兜底
    // （zh-CN = 下拉「中文」项），否则用户会看到「设置里写着中文、AI 用别的语言回」。
    expect(DEFAULT_LANGUAGE).toBe("zh-CN");
    const zhCN = [...select.options].find((o) => o.value === "zh-CN");
    expect(zhCN?.textContent).toBe("中文");
    expect(UNSET_OPTION_LABEL).toContain("中文");
  });

  it("settings.json 有值时选中该值，且不再出现「未设置」项（无恢复默认入口）", () => {
    renderGlobalView({ configurationData: { language: "en-US" } });

    const select = languageSelect();
    expect(select.value).toBe("en-US");
    expect(select.selectedOptions[0].textContent).toBe("English");
    expect(
      [...select.options].some((o) => o.textContent === UNSET_OPTION_LABEL),
    ).toBe(false);
  });
});

describe("SettingsPage「上下文长度」行（未设置时用占位符显示系统默认）", () => {
  it("settings.json 未设置 contextLength 时输入框留空 + 灰字占位符显示 SDK 默认", () => {
    renderGlobalView({ configurationData: {} });

    const input = contextLengthInput();
    expect(input.value).toBe("");
    // 占位符里的 200K 必须来自 SDK 默认（DEFAULT_WAVE_MAX_INPUT_TOKENS = 200000），
    // 不得各写一份数字（spec agent-config 场景 7）。
    expect(input.placeholder).toBe(
      `跟随模型配置（默认 ${DEFAULT_WAVE_MAX_INPUT_TOKENS / 1000}K）`,
    );
  });

  it("settings.json 有值时显示该 K 值、占位符不参与展示", () => {
    renderGlobalView({ configurationData: { contextLength: 256 } });

    expect(contextLengthInput().value).toBe("256");
  });
});

describe("SettingsPage 全局设置保存载荷：只写改动过的字段（省略键 = 不改该键）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("一个字都没改（两个键都未设置）→ 载荷为空，不得把键钉进文件", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.click(saveButton());

    // 空载荷 = 不改任何键：系统环境里已有的 WAVE_MAX_INPUT_TOKENS 因此不会被
    // 「进设置页随手保存一次」钉成 200000（spec agent-config 场景 8）。
    expect(onSave).toHaveBeenCalledWith({});
  });

  it("只改语言 → 载荷只有 language，其余键不出现", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.change(languageSelect(), { target: { value: "en-US" } });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({ language: "en-US" });
  });

  it("只填上下文长度（语言保持未设置）→ 载荷只有 contextLength", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.change(contextLengthInput(), { target: { value: "128" } });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({ contextLength: 128 });
  });

  it("文件已有值但没动过 → 载荷为空（无差异保存不写文件）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { language: "zh-CN", contextLength: 200 },
    });

    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({});
  });

  it("把已写过的值清空后保存 → 等同「不改该键」（不提供清除/恢复默认）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { language: "zh-CN", contextLength: 200 },
    });

    fireEvent.change(contextLengthInput(), { target: { value: "" } });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({});
  });
});

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

describe("SettingsPage 保存进行中按钮禁用（2026-09-09 拍板：保存结果反馈改走宿主全局 toast，设置页不渲染页面内提示）", () => {
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

  it("保存期间（saving=true）「保存」按钮禁用，宿主回包后复位可用", () => {
    const { rerender } = renderWithSaving(false);

    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    // 成功/失败提示由宿主全局 toast 呈现，设置页不渲染页面内文字
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
    expect(screen.queryByText(/保存失败/)).not.toBeInTheDocument();
  });

  it("保存中切换导航项后回包，页面内亦无残留提示（反馈不落页面、与导航无关）", () => {
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

    // 保存进行中切到「个性化」，再回包（saving=false）：无任何残留提示
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
    expect(screen.queryByText(/保存失败/)).not.toBeInTheDocument();
  });
});

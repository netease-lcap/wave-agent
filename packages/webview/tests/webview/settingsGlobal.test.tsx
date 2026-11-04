import React from "react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "./test-utils";
import SettingsPage, {
  COMPLETION_MODEL_STALE_HINT,
  COMPLETION_MODEL_UNSET_LABEL,
  ENV_SOURCE_HINT,
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
  /** 补全模型候选（宿主 getConfiguredModels 回包）。不传 = 尚未回包（空列表）。 */
  configuredModels?: string[];
}) {
  const onThemeChange = vi.fn();
  const onUpdateChannelChange = vi.fn();
  const onSave = vi.fn();
  const onLoadConfiguredModels = vi.fn();
  render(
    <SettingsPage
      configurationData={options?.configurationData ?? { language: "zh-CN" }}
      onSave={options?.onSave ?? onSave}
      configuredModels={options?.configuredModels}
      onLoadConfiguredModels={onLoadConfiguredModels}
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
  return {
    onThemeChange,
    onUpdateChannelChange,
    onSave,
    onLoadConfiguredModels,
  };
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

describe("SettingsPage 不再提供「服务端地址」行（spec agent-config 边界说明）", () => {
  it("基础设置里没有该输入框，也没有格式提示（老宿主多下发该键也不渲染）", () => {
    // 该键已从 `UserPreferenceSettings` 移除；这里顺手模拟老宿主仍下发它的情形，
    // 设置页不得因此多渲染一行。
    renderGlobalView({
      configurationData: {
        serverUrl: "https://legacy.test",
      } as unknown as ConfigurationData,
    });

    expect(screen.queryByLabelText("服务端地址")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("server-url-invalid-hint"),
    ).not.toBeInTheDocument();
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

describe("SettingsPage 即时提交：改动发生时只写那一个键（省略键 = 不改该键）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("没有任何改动 → 一次都不写盘（不存在「随手保存一次」把键钉进文件）", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("改语言 → 选中即写，载荷只有 language", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.change(languageSelect(), { target: { value: "en-US" } });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ language: "en-US" });
  });

  it("上下文长度：打字途中不写盘，失焦才写一次（不把输入途中的值当真实值）", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    const input = contextLengthInput();
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "128" } });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ contextLength: 128 });
  });

  it("上下文长度：回车同样提交一次，输入法组合中的回车不算", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    const input = contextLengthInput();
    fireEvent.change(input, { target: { value: "256" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith({ contextLength: 256 });
  });

  it("值没变（与文件里一致）→ 不写盘", () => {
    const { onSave } = renderGlobalView({
      configurationData: { language: "zh-CN", contextLength: 200 },
    });

    fireEvent.blur(contextLengthInput());

    expect(onSave).not.toHaveBeenCalled();
  });

  it("把已写过的值清空后失焦 → 等同「不改该键」（不提供清除/恢复默认）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { language: "zh-CN", contextLength: 200 },
    });

    const input = contextLengthInput();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("设置页没有「保存」按钮（设置页不再有整页提交这个动作）", () => {
    renderGlobalView({ configurationData: {} });

    expect(
      screen.queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();
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

describe("SettingsPage 失败回滚与回执不回拨（spec「设置页控件的保存时机」场景 5–7）", () => {
  const baseProps = {
    onClose: () => {},
    userAgentsContent: null,
    projectAgentsContent: null,
    onLoadAgentsContent: () => {},
  };

  function kbSwitch(): HTMLInputElement {
    return screen.getByLabelText("企业知识库") as HTMLInputElement;
  }

  it("拨动开关即刻回写并同步显示（乐观更新，不需要任何提交按钮）", () => {
    const onSave = vi.fn();
    render(
      <SettingsPage configurationData={{}} onSave={onSave} {...baseProps} />,
    );

    expect(kbSwitch().checked).toBe(false);
    fireEvent.click(kbSwitch());

    expect(kbSwitch().checked).toBe(true);
    expect(onSave).toHaveBeenCalledWith({ enableKnowledgeBase: true });
  });

  it("写盘失败（configurationError）→ 回滚到上一次生效值", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SettingsPage configurationData={{}} onSave={onSave} {...baseProps} />,
    );

    fireEvent.click(kbSwitch());
    expect(kbSwitch().checked).toBe(true);

    // 宿主写盘失败：回发 configurationError，且不回发 configurationResponse
    // （configurationData 仍是写盘前那份）。
    rerender(
      <SettingsPage
        configurationData={{}}
        onSave={onSave}
        configurationError="disk is read-only"
        {...baseProps}
      />,
    );

    expect(kbSwitch().checked).toBe(false);
  });

  it("回执带回旧值也不回拨：本次挂载内改过的键以本地乐观值为准", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SettingsPage configurationData={{}} onSave={onSave} {...baseProps} />,
    );

    fireEvent.click(kbSwitch());
    // 滞后回执：宿主带回的是写盘前的旧值（这正是客户看到的「自动关闭」路径）。
    rerender(
      <SettingsPage
        configurationData={{ enableKnowledgeBase: false }}
        onSave={onSave}
        {...baseProps}
      />,
    );

    expect(kbSwitch().checked).toBe(true);
  });

  it("正在输入、尚未提交的草稿不被任何回执冲掉", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SettingsPage configurationData={{}} onSave={onSave} {...baseProps} />,
    );

    fireEvent.change(contextLengthInput(), { target: { value: "128" } });
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onSave={onSave}
        {...baseProps}
      />,
    );

    expect(contextLengthInput().value).toBe("128");
  });

  it("配置尚未回包（configurationData 为 null）→ 偏好控件全部置灰", () => {
    render(
      <SettingsPage configurationData={null} onSave={vi.fn()} {...baseProps} />,
    );

    expect(kbSwitch().disabled).toBe(true);
    expect(languageSelect().disabled).toBe(true);
    expect(contextLengthInput().disabled).toBe(true);
  });
});

/**
 * 「被更高层覆盖的键如实显示」（spec agent-config 场景 9）：用户级
 * `~/.wave/settings.json` 只是用户偏好的**落点**，生效值可能来自更高层——企业下发的
 * Remote 组织配置（`preferenceSources[key] === "remote"`，置灰不可改）或机器环境变量
 * （`"env"`，可编辑但要标注来源）。此时设置页必须显示**生效值**，而不是回退成用户文件
 * 里的值或「未设置」占位符（只读用户文件会让显示值与生效值分叉）。来源为 `user` /
 * `default` 的键与改造前完全一致。
 */
describe("SettingsPage 被组织配置覆盖的键：显示生效值 + 置灰 + 「由组织配置管理」", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 定位某个控件所在的行（设置页行容器）。 */
  function rowFor(headingName: string): HTMLElement {
    const heading = screen.getByRole("heading", { name: headingName });
    const row = heading.closest(".settings-row");
    if (!row) throw new Error(`找不到行：${headingName}`);
    return row as HTMLElement;
  }

  it("language 来自 Remote：下拉显示生效值并禁用，行内出现「由组织配置管理」", () => {
    renderGlobalView({
      configurationData: {
        language: "en-US",
        preferenceSources: { language: "remote" },
      },
    });

    const select = languageSelect();
    expect(select.value).toBe("en-US");
    expect(select).toBeDisabled();
    expect(
      within(rowFor("AI 回复语言")).getByText("由组织配置管理"),
    ).toBeInTheDocument();
  });

  it("contextLength 来自 Remote：输入框显示生效值并禁用 + 提示", () => {
    renderGlobalView({
      configurationData: {
        contextLength: 256,
        preferenceSources: { contextLength: "remote" },
      },
    });

    const input = contextLengthInput();
    expect(input.value).toBe("256");
    expect(input).toBeDisabled();
    expect(
      within(rowFor("上下文长度")).getByText("由组织配置管理"),
    ).toBeInTheDocument();
  });

  it("来源为 user / default 的键照旧可编辑，且不显示任何来源提示", () => {
    renderGlobalView({
      configurationData: {
        language: "en-US",
        preferenceSources: { language: "user", contextLength: "default" },
      },
    });

    expect(languageSelect()).toBeEnabled();
    expect(contextLengthInput()).toBeEnabled();
    expect(screen.queryByText("由组织配置管理")).not.toBeInTheDocument();
    expect(screen.queryByText(ENV_SOURCE_HINT)).not.toBeInTheDocument();
  });

  it("contextLength 由机器环境变量给值：显示生效值（不是「未设置」占位符）+ 标注来源 + 仍可编辑", () => {
    renderGlobalView({
      configurationData: {
        contextLength: 64,
        preferenceSources: { contextLength: "env" },
      },
    });

    const input = contextLengthInput();
    // 生效值来自 OS 环境变量：不得回落成占位符（否则页面显示 200K 与实际生效的
    // 64K 分叉）。
    expect(input.value).toBe("64");
    expect(input).toBeEnabled();
    const row = rowFor("上下文长度");
    expect(within(row).getByText(ENV_SOURCE_HINT)).toBeInTheDocument();
    // env 层不是组织策略：不显示置灰提示。
    expect(within(row).queryByText("由组织配置管理")).not.toBeInTheDocument();
  });

  it("env 给值的键能改动并写进保存载荷（用户文件优先级高于 OS 环境变量）", () => {
    const { onSave } = renderGlobalView({
      configurationData: {
        contextLength: 64,
        preferenceSources: { contextLength: "env" },
      },
    });

    fireEvent.change(contextLengthInput(), { target: { value: "128" } });
    fireEvent.blur(contextLengthInput());

    expect(onSave).toHaveBeenCalledWith({ contextLength: 128 });
  });

  it("回包不带 preferenceSources 时全部可编辑（老宿主/三端旧版本向后兼容）", () => {
    renderGlobalView({
      configurationData: { language: "en-US", contextLength: 256 },
    });

    expect(languageSelect()).toBeEnabled();
    expect(contextLengthInput()).toBeEnabled();
    expect(screen.queryByText("由组织配置管理")).not.toBeInTheDocument();
    expect(screen.queryByText(ENV_SOURCE_HINT)).not.toBeInTheDocument();
  });

  it("被覆盖的键改不动 → 保存载荷里不出现它（不会假装写进去）", () => {
    const { onSave } = renderGlobalView({
      configurationData: {
        language: "en-US",
        preferenceSources: { language: "remote" },
      },
    });

    // 置灰的控件收不到用户操作；只改上下文长度
    fireEvent.change(contextLengthInput(), { target: { value: "128" } });
    fireEvent.blur(contextLengthInput());

    expect(onSave).toHaveBeenCalledWith({ contextLength: 128 });
  });
});

describe("SettingsPage「代码补全 / 补全模型」两行（spec ui/code-completion.md 故事 4–5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function completionSelect(): HTMLSelectElement {
    return screen.getByLabelText("补全模型") as HTMLSelectElement;
  }

  function completionSwitch(): HTMLInputElement {
    return screen.getByLabelText("代码补全") as HTMLInputElement;
  }

  it("未设置补全模型 → 选中「未设置（跟随快速模型）」，开关默认开", () => {
    renderGlobalView({ configurationData: {} });

    const select = completionSelect();
    // 未设置 = 文件里没有该键：显式项表达未设置（下拉没有 placeholder 语义），
    // 文案里的回落目标必须与 SDK 解析链末尾一致（completionModel ?? fastModel）。
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe(
      COMPLETION_MODEL_UNSET_LABEL,
    );
    // 开关不做占位态：真实默认就是「开」（与自动记忆开关同一口径）。
    expect(completionSwitch().checked).toBe(true);
  });

  it("候选清单来自宿主：未设置时下拉 = 未设置项 + 全部候选", () => {
    renderGlobalView({
      configurationData: {},
      configuredModels: ["qwen2.5-coder", "gemini-3-flash"],
    });

    expect([...completionSelect().options].map((o) => o.value)).toEqual([
      "",
      "qwen2.5-coder",
      "gemini-3-flash",
    ]);
  });

  it("settings.json 有值时选中该值，且不再出现「未设置」项（无恢复默认入口）", () => {
    renderGlobalView({
      configurationData: { completionModel: "qwen2.5-coder" },
      configuredModels: ["qwen2.5-coder", "gemini-3-flash"],
    });

    const select = completionSelect();
    expect(select.value).toBe("qwen2.5-coder");
    expect(
      [...select.options].some(
        (o) => o.textContent === COMPLETION_MODEL_UNSET_LABEL,
      ),
    ).toBe(false);
  });

  it("当前值不在已配置模型列表里 → 保留该值为选项并给出行内提示（故事 4 场景 4）", () => {
    renderGlobalView({
      configurationData: { completionModel: "removed-model" },
      configuredModels: ["qwen2.5-coder"],
    });

    const select = completionSelect();
    // 受控下拉选不到值会显示成第一项/空白，等于把用户已配置的值藏起来。
    expect(select.value).toBe("removed-model");
    expect([...select.options].map((o) => o.value)).toEqual([
      "removed-model",
      "qwen2.5-coder",
    ]);
    expect(screen.getByTestId("completion-model-stale-hint")).toHaveTextContent(
      COMPLETION_MODEL_STALE_HINT,
    );
  });

  it("候选清单还没回包时不误报失效（列表为空 ≠ 模型名失效）", () => {
    renderGlobalView({ configurationData: { completionModel: "any-model" } });

    expect(completionSelect().value).toBe("any-model");
    expect(
      screen.queryByTestId("completion-model-stale-hint"),
    ).not.toBeInTheDocument();
  });

  it("进入「全局设置」视图时向宿主拉一次候选（切走再回来会重拉）", () => {
    const { onLoadConfiguredModels } = renderGlobalView({
      configurationData: {},
    });

    expect(onLoadConfiguredModels).toHaveBeenCalledTimes(1);

    // 切到别的视图再回到全局设置：重读一次（与「项目设置」进视图重读同一模式，
    // 宿主回包不构成触发源，否则 fetch→reply→fetch 死循环）。
    fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    fireEvent.click(screen.getByRole("button", { name: "全局设置" }));

    expect(onLoadConfiguredModels).toHaveBeenCalledTimes(2);
  });

  it("只改补全模型 → 立刻只写 completionModel", () => {
    const { onSave } = renderGlobalView({
      configurationData: {},
      configuredModels: ["qwen2.5-coder"],
    });

    fireEvent.change(completionSelect(), {
      target: { value: "qwen2.5-coder" },
    });

    expect(onSave).toHaveBeenCalledWith({ completionModel: "qwen2.5-coder" });
  });

  it("关闭补全开关 → 立刻只写 completionEnabled: false", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.click(completionSwitch());

    expect(onSave).toHaveBeenCalledWith({ completionEnabled: false });
  });

  it("两个补全键都未设置且没动过 → 载荷为空（不把默认值钉进文件）", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("补全开关已显式关闭时，重新打开也写一次（默认开 ≠ 已是文件里的值）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { completionEnabled: false },
    });

    expect(completionSwitch().checked).toBe(false);
    fireEvent.click(completionSwitch());

    expect(onSave).toHaveBeenCalledWith({ completionEnabled: true });
  });
});

/**
 * 补全两行只由**提供补全的宿主**渲染（spec ui/code-completion.md 边界情况
 * 「补全设置行的宿主范围」）。桌面端没有代码编辑器、远端网页没有本地宿主，
 * 那里的补全从不触发——摆一个开关等于承诺一个不会发生的功能。
 *
 * 这里锁的是「门禁按宿主**能力位**判定」：桌面端（`waveHostType === "desktop"`）
 * 与远端网页（`waveRemotePage === true`）都拿不到这两行，默认的插件端照常拿到。
 * 三处用法（渲染、进视图拉候选、保存载荷）都各有一条断言，否则会出现
 * 「看不见的行也在写键」。
 */
describe("SettingsPage 补全两行的宿主门禁（spec ui/code-completion.md 边界情况「补全设置行的宿主范围」）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.waveHostType;
    delete window.waveRemotePage;
  });

  it("桌面端：两行都不渲染，同卡片其它行照常渲染", () => {
    window.waveHostType = "desktop";
    renderGlobalView({ configurationData: {} });

    expect(screen.queryByLabelText("代码补全")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("补全模型")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-select-completion-model"),
    ).not.toBeInTheDocument();
    // 门禁只摘这两行，不是整张卡片消失
    expect(screen.getByLabelText("AI 回复语言")).toBeInTheDocument();
  });

  it("桌面端：进「全局设置」视图不去拉候选模型（不发起无消费者的 RPC）", () => {
    window.waveHostType = "desktop";
    const { onLoadConfiguredModels } = renderGlobalView({
      configurationData: {},
    });

    expect(onLoadConfiguredModels).not.toHaveBeenCalled();

    // 切换视图再回来也不拉：门禁与「进视图重读」是同一个 effect 内的两个条件
    fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    fireEvent.click(screen.getByRole("button", { name: "全局设置" }));

    expect(onLoadConfiguredModels).not.toHaveBeenCalled();
  });

  it("桌面端：保存载荷不含补全两键（文件里已有值也不回写）", () => {
    window.waveHostType = "desktop";
    const { onSave } = renderGlobalView({
      configurationData: {
        completionModel: "qwen2.5-coder",
        completionEnabled: false,
      },
    });

    // 前一条渲染门禁已让两个控件不存在、状态无从改动，这里是第三层：载荷侧也
    // 不生成这两个键，防止将来有别的入口预填草稿后「看不见的行也在写键」。
    expect(onSave).not.toHaveBeenCalled();
  });

  it("远端网页宿主：同样不渲染两行、不拉候选", () => {
    window.waveRemotePage = true;
    const { onLoadConfiguredModels } = renderGlobalView({
      configurationData: {},
    });

    expect(screen.queryByLabelText("代码补全")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("补全模型")).not.toBeInTheDocument();
    expect(onLoadConfiguredModels).not.toHaveBeenCalled();
  });

  it("插件端（默认）：两行照常渲染并拉候选（正向对照）", () => {
    const { onLoadConfiguredModels } = renderGlobalView({
      configurationData: {},
      configuredModels: ["qwen2.5-coder"],
    });

    expect(screen.getByLabelText("代码补全")).toBeInTheDocument();
    expect(screen.getByLabelText("补全模型")).toBeInTheDocument();
    expect(onLoadConfiguredModels).toHaveBeenCalledTimes(1);
  });
});

/**
 * 企业知识库开关（spec core/agent-config.md「企业知识库开关」故事）：三端都渲染
 * （知识库不是编辑器专属能力）、缺省关且不做未设置占位态、组织托管时置灰。
 */
describe("SettingsPage「企业知识库」行（顶层 enableKnowledgeBase，缺省关）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.waveHostType;
  });

  function kbSwitch(): HTMLInputElement {
    return screen.getByLabelText("企业知识库") as HTMLInputElement;
  }

  /** 定位控件所在的行（设置页行容器）。 */
  function rowFor(headingName: string): HTMLElement {
    const heading = screen.getByRole("heading", { name: headingName });
    const row = heading.closest(".settings-row");
    if (!row) throw new Error(`找不到行：${headingName}`);
    return row as HTMLElement;
  }

  it("未设置该键时显示为关（真实默认就是关，不做未设置占位态）", () => {
    renderGlobalView({ configurationData: {} });

    expect(kbSwitch().checked).toBe(false);
    expect(kbSwitch().disabled).toBe(false);
  });

  it("文件里已是开时回填为开", () => {
    renderGlobalView({ configurationData: { enableKnowledgeBase: true } });

    expect(kbSwitch().checked).toBe(true);
  });

  it("拨到开 → 立刻只写该键", () => {
    const { onSave } = renderGlobalView({ configurationData: {} });

    fireEvent.click(kbSwitch());

    expect(onSave).toHaveBeenCalledWith({ enableKnowledgeBase: true });
  });

  it("已开但没动过 → 载荷为空（无差异保存不写该键）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { enableKnowledgeBase: true },
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("关掉 → 立刻写显式 false（不删键）", () => {
    const { onSave } = renderGlobalView({
      configurationData: { enableKnowledgeBase: true },
    });

    fireEvent.click(kbSwitch());

    expect(onSave).toHaveBeenCalledWith({ enableKnowledgeBase: false });
  });

  it("组织托管（来源 remote）：显示生效值 + 置灰 + 「由组织配置管理」", () => {
    renderGlobalView({
      configurationData: {
        enableKnowledgeBase: true,
        preferenceSources: { enableKnowledgeBase: "remote" },
      },
    });

    expect(kbSwitch().checked).toBe(true);
    expect(kbSwitch().disabled).toBe(true);
    expect(
      within(rowFor("企业知识库")).getByText("由组织配置管理"),
    ).toBeInTheDocument();
  });

  it("桌面端宿主同样渲染该行（知识库不是编辑器专属能力）", () => {
    window.waveHostType = "desktop";
    renderGlobalView({ configurationData: {} });

    expect(kbSwitch()).toBeInTheDocument();
  });
});

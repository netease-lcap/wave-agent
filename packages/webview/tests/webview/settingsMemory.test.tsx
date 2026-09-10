import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  act,
  sendCommand,
  sendHostMessage,
  createMockVscode,
  fixtures,
} from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";
import { ChatApp } from "../../src/components/ChatApp";
import type { ConfigurationData, VsCodeApi } from "../../src/types";

/**
 * 「个性化 → 自动记忆规则」的保存路径回归（#2115「自动记忆开关不生效」）。
 *
 * 该缺陷的根因是 `autoMemoryEnabled` / `autoMemoryFrequency` 在
 * webview 保存 → host → CLI → SDK 整条链上**缺字段**，而字段全是 optional，
 * 编译期不报错——只有测试能盯住。这里覆盖 webview 自己负责的那一跳：用户改的
 * 值必须真的离开 webview（先由 `SettingsPage.onSave` 带出，再由 ChatApp 作为
 * `updateConfiguration` 的 `configurationData` 发给宿主）。
 *
 * 分层边界（见 agent-config.md 边界说明「验证分层」）：
 *  - 本文件＝webview 层（单测）：只断言「webview 发出去的东西对不对」。
 *  - host → CLI 的 stdio 透传由补测会话负责；host 落 `~/.wave/settings.json`
 *    与 SDK 实时重载、保存不重建会话由 desktop 单测与真 host 层负责——这里刻意
 *    不锁 `updateConfig params` 这类下游形状（2026-09-10 PR-2 起用户偏好改走写
 *    用户级 settings.json，不再当 `AgentOptions` 覆盖层下发）。
 */

const BASE_CONFIG: ConfigurationData = {
  language: "zh-CN",
  autoMemoryEnabled: true,
  autoMemoryFrequency: 1,
};

/** 覆盖「个性化」视图所需的 props（AGENTS.md 编辑器不参与本组用例）。 */
function renderMemoryView(options?: {
  configurationData?: ConfigurationData;
  onSave?: (data: ConfigurationData) => void;
}) {
  const onSave = vi.fn();
  render(
    <SettingsPage
      initialNav="personalization"
      configurationData={options?.configurationData ?? BASE_CONFIG}
      onSave={options?.onSave ?? onSave}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
    />,
  );
  return { onSave };
}

/** 定位「自动记忆规则」区块，避开同视图 AGENTS.md 的保存按钮。 */
function memorySaveButton(): HTMLButtonElement {
  const heading = screen.getByRole("heading", { name: "自动记忆规则" });
  const section = heading.closest("section") as HTMLElement;
  return within(section).getByRole("button", {
    name: "保存",
  }) as HTMLButtonElement;
}

function memorySwitch(): HTMLInputElement {
  return screen.getByLabelText("开启自动记忆") as HTMLInputElement;
}

function memoryFrequencyInput(): HTMLInputElement {
  return screen.getByLabelText("触发记忆提取会话轮次") as HTMLInputElement;
}

describe("SettingsPage 个性化「自动记忆规则」：按配置回填与保存载荷", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("按 configurationData 回填开关与轮次（关闭态/自定义轮次都如实显示）", () => {
    renderMemoryView({
      configurationData: {
        language: "zh-CN",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
      },
    });

    expect(memorySwitch()).not.toBeChecked();
    expect(memoryFrequencyInput().value).toBe("7");
  });

  it("未配置时：开关仍显示「开」（不做占位态），轮次留空 + 灰字占位符显示默认 1 轮", () => {
    renderMemoryView({ configurationData: { language: "zh-CN" } });

    // 布尔开关刻意不做占位态（真实默认就是「开」，三态开关更难用，spec
    // agent-config 场景 7），所以这里照旧是「开」。
    expect(memorySwitch()).toBeChecked();
    // 数字输入用「未设置」表达（留空 + 占位符），而不是显示一个编造出来的 1。
    expect(memoryFrequencyInput().value).toBe("");
    expect(memoryFrequencyInput().placeholder).toBe("默认 1 轮");
  });

  it("关掉开关 + 改轮次后保存：载荷只带这两个字段（不把其余配置整体上送）", () => {
    const { onSave } = renderMemoryView({
      configurationData: {
        language: "en-US",
        contextLength: 256,
        autoMemoryEnabled: true,
        autoMemoryFrequency: 1,
      },
    });

    fireEvent.click(memorySwitch());
    fireEvent.change(memoryFrequencyInput(), { target: { value: "5" } });
    fireEvent.click(memorySaveButton());

    // diff 载荷（spec 场景 8）：只有真正改动过的字段上送，未改的 language /
    // contextLength 不出现在报文里（省略键 = 不改该键）。
    expect(onSave).toHaveBeenCalledWith({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });

  it("未设置 + 一个字都没改 → 载荷为空（不把未设置的键钉进 settings.json）", () => {
    const { onSave } = renderMemoryView({ configurationData: {} });

    fireEvent.click(memorySaveButton());

    expect(onSave).toHaveBeenCalledWith({});
  });

  it("只改轮次（开关保持默认「开」）→ 载荷只有 autoMemoryFrequency", () => {
    const { onSave } = renderMemoryView({ configurationData: {} });

    fireEvent.change(memoryFrequencyInput(), { target: { value: "3" } });
    fireEvent.click(memorySaveButton());

    expect(onSave).toHaveBeenCalledWith({ autoMemoryFrequency: 3 });
  });
});

describe("ChatApp 保存路径：自动记忆偏好真的离开 webview（#2115 回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDesktopChatApp() {
    const vscode = createMockVscode();
    const host = {
      type: "desktop",
      host: "local",
      hosts: ["local"],
      recentWorkdirs: [],
      workdir: "/work/a",
      sessionTree: [],
      panes: [{ paneId: "pane-1" }],
      focusedPaneId: "pane-1",
      onSelectWorkdir: () => {},
      onSelectRecentWorkdir: () => {},
      onRemoveRecentWorkdir: () => {},
      onSelectHost: () => {},
      onAddHost: () => {},
      onSelectRemotePath: () => {},
      onListRemoteDir: () => {},
      onSelectSession: () => {},
      onDeleteSession: () => {},
      onOpenPane: () => {},
    } as unknown as React.ComponentProps<typeof ChatApp>["host"];
    render(<ChatApp vscode={vscode as unknown as VsCodeApi} host={host} />);
    sendHostMessage(fixtures.authStatusResponse());
    return vscode;
  }

  /** 桌面端 /config 在应用内打开设置页（IDE 端会改开编辑器标签页）。 */
  async function openSettingsViaConfigCommand() {
    const input = screen.getByTestId("message-input");
    input.focus();
    await act(async () => {
      input.textContent = "/config";
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      fireEvent.input(input, { data: "/config", inputType: "insertText" });
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    });
  }

  it("个性化保存 → updateConfiguration 的 configurationData 携带开关与频率", async () => {
    const vscode = renderDesktopChatApp();

    // 宿主的生效配置（含自动记忆当前值）先到，设置页据此回填
    await act(async () => {
      sendCommand("configurationResponse", { configurationData: BASE_CONFIG });
    });

    await openSettingsViaConfigCommand();
    expect(
      screen.getByRole("heading", { name: "自动记忆规则" }),
    ).toBeInTheDocument();
    expect(memorySwitch()).toBeChecked();

    await act(async () => {
      fireEvent.click(memorySwitch());
      fireEvent.change(memoryFrequencyInput(), { target: { value: "5" } });
    });
    await act(async () => {
      fireEvent.click(memorySaveButton());
    });

    const saved = vscode.postMessage.mock.calls.find(
      (call) => call[0]?.command === "updateConfiguration",
    );
    expect(saved).toBeDefined();
    // #2115 的回归点就在这一行：修复前载荷里根本没有这两个键。
    expect(saved?.[0].configurationData).toMatchObject({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });
});

/**
 * 「被组织配置覆盖的自动记忆键如实显示」（spec agent-config 场景 8）：Remote 组织下发
 * 可以盖过用户级 settings.json 的 `autoMemoryEnabled` / `autoMemoryFrequency`，此时
 * 开关/轮次输入显示**生效值** + 置灰 + 提示，用户无法在本地覆盖回来。
 */
describe("SettingsPage 自动记忆规则：被组织配置覆盖时置灰", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function memoryRowFor(headingName: string): HTMLElement {
    const heading = screen.getByRole("heading", { name: headingName });
    return heading.closest(".settings-row") as HTMLElement;
  }

  it("开关与轮次都来自 Remote：显示生效值 + 双双禁用 + 提示", () => {
    renderMemoryView({
      configurationData: {
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
        preferenceSources: {
          autoMemoryEnabled: "remote",
          autoMemoryFrequency: "remote",
        },
      },
    });

    expect(memorySwitch()).not.toBeChecked();
    expect(memorySwitch()).toBeDisabled();
    expect(memoryFrequencyInput().value).toBe("7");
    expect(memoryFrequencyInput()).toBeDisabled();
    expect(
      within(memoryRowFor("开启自动记忆")).getByText("由组织配置管理"),
    ).toBeInTheDocument();
    expect(
      within(memoryRowFor("触发记忆提取会话轮次")).getByText("由组织配置管理"),
    ).toBeInTheDocument();
  });

  it("只有开关来自 Remote 时：开关禁用，轮次仍可编辑且能保存", () => {
    const { onSave } = renderMemoryView({
      configurationData: {
        autoMemoryEnabled: true,
        autoMemoryFrequency: 3,
        preferenceSources: { autoMemoryEnabled: "remote" },
      },
    });

    expect(memorySwitch()).toBeDisabled();
    expect(memoryFrequencyInput()).toBeEnabled();

    fireEvent.change(memoryFrequencyInput(), { target: { value: "9" } });
    fireEvent.click(memorySaveButton());

    // 被覆盖的开关不出现在载荷里（控件禁用，用户改不动），只有轮次上送
    expect(onSave).toHaveBeenCalledWith({ autoMemoryFrequency: 9 });
  });

  it("来源不是 Remote（env/default/user）时不置灰、无提示", () => {
    renderMemoryView({
      configurationData: {
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
        preferenceSources: {
          autoMemoryEnabled: "env",
          autoMemoryFrequency: "user",
        },
      },
    });

    expect(memorySwitch()).toBeEnabled();
    expect(memoryFrequencyInput()).toBeEnabled();
    expect(screen.queryByText("由组织配置管理")).not.toBeInTheDocument();
  });
});

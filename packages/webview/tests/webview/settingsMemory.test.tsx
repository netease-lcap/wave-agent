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

  it("未配置时回落默认值（开关开、1 轮），不得显示成「已关闭」", () => {
    renderMemoryView({ configurationData: { language: "zh-CN" } });

    expect(memorySwitch()).toBeChecked();
    expect(memoryFrequencyInput().value).toBe("1");
  });

  it("关掉开关 + 改轮次后保存：载荷同时带出两个字段，且不丢其余配置", () => {
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

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      }),
    );
    // 同一份 configurationData 整体上送，其余字段不得被这次保存抹掉
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en-US", contextLength: 256 }),
    );
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import React from "react";
import { ChatApp } from "../../src/components/ChatApp";
import type { HostToWebviewMessage } from "wave-webview-fixtures";
import type { VsCodeApi } from "../../src/types";

// 与 desktopUpdateChannel.test.tsx 同构的 desktop host props。
function desktopHost() {
  return {
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
    onSaveSshConnection: () => {},
    onDeleteSshConnection: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

/** 打开设置页（/config → 根实例 settingsOpen → 全局设置视图）。 */
async function openSettings() {
  const input = await screen.findByTestId("message-input");
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
  await screen.findByText("管理 CodeWave IDE 的界面、模型和基础行为。");
}

const ALL_BANNER = {
  permission: "banner",
  question: "banner",
  idle: "banner",
} as const;

function pushNotificationSettings(
  levels: Record<string, unknown> = ALL_BANNER,
  sound: unknown = "system",
  drawAttention: unknown = false,
) {
  act(() => {
    sendHostMessage({
      command: "desktopNotificationSettings",
      levels,
      sound,
      drawAttention,
    } as unknown as HostToWebviewMessage);
  });
}

const LEVEL_LABELS = ["权限请求提醒", "回答提问提醒", "回合完成提醒"] as const;

/** webview → host 的 setNotificationSettings 调用（挂载期 postMessage 另有十几条，不数总数）。 */
function notificationSets(mockVscode: ReturnType<typeof createMockVscode>) {
  return vi
    .mocked(mockVscode.postMessage)
    .mock.calls.map((call) => call[0])
    .filter(
      (m) => (m as { command?: string }).command === "setNotificationSettings",
    );
}

function mountWithSnapshot(
  levels: Record<string, unknown> = ALL_BANNER,
  sound: unknown = "system",
  drawAttention: unknown = false,
) {
  const mockVscode = createMockVscode();
  render(
    <ChatApp
      vscode={mockVscode as unknown as VsCodeApi}
      host={desktopHost()}
    />,
  );
  sendHostMessage(fixtures.authStatusResponse());
  sendHostMessage(fixtures.setInitialState());
  pushNotificationSettings(levels, sound, drawAttention);
  return mockVscode;
}

describe("桌面端设置「系统通知」分组（spec desktop-notifications.md 故事 3）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未收到 desktopNotificationSettings 广播时不渲染分组（初值 undefined）", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());

    await openSettings();

    expect(screen.queryByText("系统通知")).not.toBeInTheDocument();
    for (const label of LEVEL_LABELS) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("提示音")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("通知时提醒我")).not.toBeInTheDocument();
  });

  it("广播全量快照后分组渲染：两类三档、「回合完成」两档、提示音与提醒开关取广播值", async () => {
    const mockVscode = mountWithSnapshot(
      { ...ALL_BANNER, idle: "off" },
      "none",
      true,
    );

    await openSettings();

    expect(screen.getByText("系统通知")).toBeInTheDocument();
    const permission = screen.getByLabelText(
      "权限请求提醒",
    ) as HTMLSelectElement;
    const question = screen.getByLabelText("回答提问提醒") as HTMLSelectElement;
    const idle = screen.getByLabelText("回合完成提醒") as HTMLSelectElement;
    expect(permission.value).toBe("banner");
    expect(question.value).toBe("banner");
    expect(idle.value).toBe("off");
    // 确认类三档：「仅标记」不替下一个故事承诺任务栏/Dock 标记。
    expect(Array.from(permission.options).map((o) => o.textContent)).toEqual([
      "弹窗提醒",
      "仅标记（不弹窗）",
      "关闭",
    ]);
    // 「回合完成」只有两档（故事 3 场景 1）：它不计角标、不闪不弹，
    // 「仅标记」在它身上等于「关闭」。
    expect(Array.from(idle.options).map((o) => o.textContent)).toEqual([
      "弹窗提醒",
      "关闭",
    ]);
    expect((screen.getByLabelText("提示音") as HTMLSelectElement).value).toBe(
      "none",
    );
    expect(
      (screen.getByLabelText("通知时提醒我") as HTMLInputElement).checked,
    ).toBe(true);
    // 广播来自 host 本身，设置页不得回送 setNotificationSettings。
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "setNotificationSettings" }),
    );
  });

  it("「回合完成」切到关闭 → 乐观更新并只上送改动类别的 levels", async () => {
    const mockVscode = mountWithSnapshot();
    await openSettings();

    fireEvent.change(screen.getByLabelText("回合完成提醒"), {
      target: { value: "off" },
    });

    expect(
      (screen.getByLabelText("回合完成提醒") as HTMLSelectElement).value,
    ).toBe("off");
    // 其余两类不受影响（补丁合并，不是整表覆盖）。
    expect(
      (screen.getByLabelText("权限请求提醒") as HTMLSelectElement).value,
    ).toBe("banner");
    expect(notificationSets(mockVscode)).toEqual([
      { command: "setNotificationSettings", levels: { idle: "off" } },
    ]);
  });

  it("提示音切「无」→ 乐观更新并只上送 sound（不带 levels）", async () => {
    const mockVscode = mountWithSnapshot();
    await openSettings();

    fireEvent.change(screen.getByLabelText("提示音"), {
      target: { value: "none" },
    });

    expect((screen.getByLabelText("提示音") as HTMLSelectElement).value).toBe(
      "none",
    );
    expect(notificationSets(mockVscode)).toEqual([
      { command: "setNotificationSettings", sound: "none" },
    ]);
  });

  it("「通知时提醒我」开启 → 乐观更新并只上送 drawAttention", async () => {
    const mockVscode = mountWithSnapshot();
    await openSettings();

    fireEvent.click(screen.getByLabelText("通知时提醒我"));

    expect(
      (screen.getByLabelText("通知时提醒我") as HTMLInputElement).checked,
    ).toBe(true);
    expect(notificationSets(mockVscode)).toEqual([
      { command: "setNotificationSettings", drawAttention: true },
    ]);
  });

  it("两类确认都是「关闭」→ 提醒开关置灰并说明原因，改回一档即恢复", async () => {
    mountWithSnapshot({ permission: "off", question: "off", idle: "banner" });
    await openSettings();

    const toggle = screen.getByLabelText("通知时提醒我") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(
      screen.getByText("权限请求和回答提问都是「关闭」，这条不会触发"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("回答提问提醒"), {
      target: { value: "mark" },
    });

    expect(
      (screen.getByLabelText("通知时提醒我") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      screen.queryByText("权限请求和回答提问都是「关闭」，这条不会触发"),
    ).not.toBeInTheDocument();
  });

  it("设置页打开后 host 再广播全量快照 → 控件即时同步且不回送（命令拼写契约锁定）", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());
    await openSettings();
    expect(screen.queryByText("系统通知")).not.toBeInTheDocument();

    pushNotificationSettings({ ...ALL_BANNER, question: "off" }, "none", true);

    await waitFor(() => {
      expect(screen.getByText("系统通知")).toBeInTheDocument();
    });
    expect(
      (screen.getByLabelText("回答提问提醒") as HTMLSelectElement).value,
    ).toBe("off");
    expect((screen.getByLabelText("提示音") as HTMLSelectElement).value).toBe(
      "none",
    );
    expect(
      (screen.getByLabelText("通知时提醒我") as HTMLInputElement).checked,
    ).toBe(true);
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "setNotificationSettings" }),
    );
  });

  it("坏载荷（缺类别 / sound 非枚举 / drawAttention 非布尔 / idle 给 mark）整条丢弃", async () => {
    mountWithSnapshot({ permission: "banner", question: "banner" }, "system");
    pushNotificationSettings(ALL_BANNER, "yes", false);
    pushNotificationSettings(ALL_BANNER, "system", "yes");
    pushNotificationSettings({ ...ALL_BANNER, idle: "mark" }, "system", false);
    await openSettings();

    expect(screen.queryByText("系统通知")).not.toBeInTheDocument();
  });
});

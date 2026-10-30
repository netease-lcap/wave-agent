/**
 * 设置页的「远程控制」选项卡（`/remote-control`）。
 *
 * 2026-10-17 之前它是一个独立弹层（`RemoteControlDialog`），现在与 MCP 服务一样是
 * 设置页里的一项能力：`/remote-control` 打开设置页并选中这一项（spec
 * remote/remote/remote-control.md「`/remote-control` 打开设置页的远程控制选项卡」）。
 *
 * 搬家的验收标准是「逐项与弹窗时一致」，所以这个文件钉的就是原来那几条纪律：
 * 挂载即问状态、回执按 `requestId` 关联（晚到的旧回执不许把刚建立的链路按回去）、
 * 没有页面地址就不画二维码、宿主报错原样显示。另外补三条只有「搬进设置页」才需要
 * 钉的：手动点导航也能进（不靠斜杠命令）、切走就停轮询（弹窗时代是关闭即停）、
 * 以及远控网页上这一项**连导航都不出现**（页面就是二维码指向的那一端）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  createMockVscode,
  fireEvent,
  fireInput,
  fixtures,
  render,
  renderChatApp,
  screen,
  sendHostMessage,
  waitFor,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";
import SettingsPage from "../../src/components/SettingsPage";

/** desktop host props（与 projectSettingsAttribution.test.tsx 同构）：设置页
 *  在桌面端是整页替换会话区，`/remote-control` 因此就地打开。 */
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
    onAddHost: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

const sentActions = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(
      (call) =>
        call[0] as { command?: string; action?: string; requestId?: string },
    )
    .filter((message) => message.command === "remoteControl");

/** `/remote-control` → 设置页打开并选中远程控制，返回它挂载时发的那条请求。 */
async function openRemoteControlTab() {
  const vscode = createMockVscode();
  render(<ChatApp vscode={vscode} host={desktopHost()} />);
  await act(async () => {
    sendHostMessage(fixtures.authStatusResponse());
  });
  await act(async () => {
    await typeAndSend("/remote-control");
  });
  await waitFor(() => {
    expect(screen.getByTestId("remote-control-view")).toBeInTheDocument();
  });
  const sent = sentActions(vscode);
  expect(sent.length).toBeGreaterThan(0);
  return { vscode, mountRequest: sent[sent.length - 1] };
}

/** 直接挂载设置页并落在远程控制项（不经 ChatApp：能钉「手机那端」的裁剪）。 */
function mountSettingsPage(initialNav: "global" | "remoteControl") {
  const vscode = createMockVscode();
  render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav={initialNav}
      vscode={vscode}
    />,
  );
  return vscode;
}

const reply = (requestId: string, overrides = {}) =>
  fixtures.remoteControlResponse(requestId, overrides);

describe("设置页 · 远程控制选项卡", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.waveRemotePage;
  });

  it("opens on /remote-control and immediately asks the host for status", async () => {
    const { mountRequest } = await openRemoteControlTab();
    expect(mountRequest.requestId).toEqual(expect.any(String));
    expect(mountRequest.action).toBe("status");
    // 选项卡而非弹窗：整页替换会话区（没有浮层、消息输入也不在）。
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "远程控制" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("remote-control-view")).toHaveTextContent(
      "未开启",
    );
  });

  it("sits third in the 通用 group and is reachable by hand", async () => {
    // 弹窗时代只有命令这一个入口；搬进设置页之后，手动点导航与命令是同一条路。
    const vscode = mountSettingsPage("global");
    const nav = document.querySelector(".settings-navigation") as HTMLElement;
    const labels = Array.from(nav.querySelectorAll(".settings-nav-item")).map(
      (item) => (item.textContent ?? "").trim(),
    );
    expect(labels.slice(0, 3)).toEqual(["全局设置", "个性化", "远程控制"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "远程控制" }));
    });
    expect(screen.getByTestId("remote-control-view")).toBeInTheDocument();
    expect(sentActions(vscode).length).toBeGreaterThan(0);
  });

  it("on an IDE host it still asks the host to open its settings tab, on this nav item", async () => {
    // IDE 宿主的设置页是宿主另开的标签页，视图不在这里渲染；`/remote-control`
    // 于是把「打开设置页、选中远程控制」原样交给宿主（与 /mcp、/skills 同一条路）。
    const { vscode } = renderChatApp();
    await act(async () => {
      await typeAndSend("/remote-control");
    });

    const posts = vscode.postMessage.mock.calls.map(
      (call) => call[0] as { command?: string; nav?: string },
    );
    expect(posts).toContainEqual({
      command: "openSettings",
      nav: "remoteControl",
    });
    // 没有任何 RPC 从这里发出去：连接/断开的发起方是设置页那一侧。
    expect(sentActions(vscode)).toHaveLength(0);
  });

  it("renders the state and page address from the host's reply", async () => {
    const { mountRequest } = await openRemoteControlTab();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const view = screen.getByTestId("remote-control-view");
    expect(view).toHaveTextContent("已连接");
    expect(view).toHaveTextContent("https://relay.example/remote/?host=h1");
  });

  it("draws a scannable QR of the page address the CLI resolved", async () => {
    const { mountRequest } = await openRemoteControlTab();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const qr = screen.getByTestId("remote-control-qr");
    expect(qr.querySelector("svg")).toBeTruthy();
    // 二维码指向的是页面（手机打开的那一端），不是本机持有的中继 socket。
    expect(screen.getByTestId("remote-control-view")).toHaveTextContent(
      "https://relay.example/remote/?host=h1",
    );
  });

  it("draws no QR when the reply carried no page address (never invents one)", async () => {
    const { mountRequest } = await openRemoteControlTab();

    await act(async () => {
      sendHostMessage(
        reply(mountRequest.requestId as string, {
          snapshot: { state: "online" },
        }),
      );
    });

    expect(screen.queryByTestId("remote-control-qr")).toBeNull();
    expect(screen.getByTestId("remote-control-view")).toHaveTextContent(
      "已连接",
    );
  });

  it("drops a reply whose requestId is not the newest one in flight", async () => {
    const { mountRequest } = await openRemoteControlTab();
    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });
    expect(screen.getByTestId("remote-control-view")).toHaveTextContent(
      "已连接",
    );

    // 一秒前那次轮询的回执晚到，不许把用户正看着的链路按回去。
    await act(async () => {
      sendHostMessage(
        reply("remote-control-stale", { snapshot: { state: "off" } }),
      );
    });
    expect(screen.getByTestId("remote-control-view")).toHaveTextContent(
      "已连接",
    );
  });

  it("shows the host's RPC failure verbatim (the switch is off) instead of a fake state", async () => {
    const { mountRequest } = await openRemoteControlTab();

    await act(async () => {
      sendHostMessage(
        reply(mountRequest.requestId as string, {
          snapshot: undefined,
          error:
            "Remote control is not enabled on this process (set enableRemoteControl: true).",
        }),
      );
    });

    const view = screen.getByTestId("remote-control-view");
    expect(view).toHaveTextContent("无法读取状态");
    expect(view).toHaveTextContent("enableRemoteControl");
    // 什么都没连上，主按钮仍是「开启」。
    expect(view).toHaveTextContent("开启远程控制");
  });

  it("asks the host to disconnect from the connected state", async () => {
    const { vscode, mountRequest } = await openRemoteControlTab();
    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "断开" }));
    });

    expect(sentActions(vscode).map((message) => message.action)).toContain(
      "disconnect",
    );
  });

  it("stops polling when the tab is switched away (the view unmounts)", async () => {
    // 弹窗时代是「关闭即停轮询」；搬进设置页之后等价条件是「切走即卸载」——各视图
    // 按导航项条件渲染，所以这一条必须成立，否则离开这一项还在每秒发请求。
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    await openRemoteControlTab();
    expect(screen.getByTestId("remote-control-view")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "全局设置" }));
    });

    expect(screen.queryByTestId("remote-control-view")).toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("does not exist on the phone page: no nav entry, and the command goes out as text", async () => {
    // 页面就是二维码指向的那一端：在页面上再开「手机接管本机会话」是自我指涉，
    // 所以这一项连导航都不出现（spec remote/remote-web.md 场景 21），敲命令也按
    // 普通消息发给模型 —— 与 `/plugin` `/mcp` 同一处置。
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    await act(async () => {
      await typeAndSend("/remote-control");
    });

    const posts = vscode.postMessage.mock.calls.map(
      (call) => call[0] as { command?: string; text?: string },
    );
    expect(posts).toContainEqual(
      expect.objectContaining({
        command: "sendMessage",
        text: "/remote-control",
      }),
    );
    expect(sentActions(vscode)).toHaveLength(0);
    expect(screen.queryByTestId("remote-control-view")).toBeNull();
  });
});

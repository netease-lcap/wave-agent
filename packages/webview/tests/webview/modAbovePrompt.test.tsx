import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendHostMessage } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPanelTree } from "wave-agent-sdk/types";

/**
 * 输入框周围那三样**不属于任何 pane** 的 mod 输出（spec
 * `ecosystem/plugin-mods.md`「状态带、状态行与提示」）。
 *
 * 这一层钉的是 surface 的行为：带**由自己拉取**（宿主不缓存树、每次拉都真跑
 * 一遍 `ui.render`）、按 `revision` 丢晚到的旧帧；状态行与提示是纯推送，到点
 * 自己消失。树本身的校验、限额、`revision` 怎么涨都在 SDK 侧。
 */

function renderDesktop() {
  window.waveHostType = "desktop";
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(fixtures.desktopWorkdirState({ workdir: "/work/a" }));
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const text = (value: string): ModPanelTree => ({
  type: "Text",
  props: {},
  children: [value],
});

/** webview→host 的带拉取请求（surface 才是发起方）。 */
const bandRequests = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modBandRender");

/** webview→host 的 mod 交互回传。 */
const events = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modPanelEvent")
    .map((m) => m.payload as Record<string, unknown>);

afterEach(() => {
  delete window.waveHostType;
  vi.useRealTimers();
  sessionUi.prune(new Set());
});

describe("desktop mod band / status / toast", () => {
  it("会话就绪就拉一次带（拉取模型：宿主不推树）", () => {
    const { vscode } = renderDesktop();
    // 挂载后至少发过一次；每次 stale 还会再来一条（见下一个用例）。
    expect(bandRequests(vscode).length).toBeGreaterThan(0);
  });

  it("带画在输入框上方，交互以 above-prompt 这个 instance 回传（场景 1）", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.desktopModBand([
        {
          modId: "todo:band",
          plugin: "todo",
          revision: 1,
          tree: {
            type: "Box",
            props: {},
            children: [
              { type: "Text", props: {}, children: ["ctx 62%"] },
              {
                type: "Button",
                props: { key: "refresh", label: "刷新" },
                children: [],
              },
            ],
          },
        },
      ]),
    );

    const band = screen.getByTestId("mod-band");
    expect(band).toHaveTextContent("ctx 62%");

    act(() => {
      screen.getByRole("button", { name: "刷新" }).click();
    });
    // 带不是 pane：`paneId` 用站点自己的固定值，mod 侧据此区分来源。
    expect(events(vscode)).toEqual([
      {
        modId: "todo:band",
        paneId: "above-prompt",
        key: "refresh",
        kind: "press",
      },
    ]);
  });

  it("空树 / 没内容的带不占位置，revision 更旧的帧被丢弃", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModBand([
        { modId: "todo:a", plugin: "todo", revision: 5, tree: text("新") },
        { modId: "todo:b", plugin: "todo", revision: 1, tree: null },
      ]),
    );
    expect(screen.getByTestId("mod-band")).toHaveTextContent("新");
    // 一条带一个格子：空树那条不画。
    expect(screen.getAllByTestId("mod-panel-root")).toHaveLength(1);

    // 晚到的旧帧（revision 更小）不能把已显示的内容画回去。
    sendHostMessage(
      fixtures.desktopModBand([
        { modId: "todo:a", plugin: "todo", revision: 4, tree: text("旧") },
      ]),
    );
    expect(screen.getByTestId("mod-band")).toHaveTextContent("新");
    expect(screen.getByTestId("mod-band")).not.toHaveTextContent("旧");
  });

  it("带里的错误摘要叠在上一帧树上（不是把整条换成一行错误）", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModBand([
        {
          modId: "todo:a",
          plugin: "todo",
          revision: 2,
          tree: text("仍然可点"),
          error: "钩子抛错了",
        },
      ]),
    );
    expect(screen.getByTestId("mod-band")).toHaveTextContent("钩子抛错了");
    expect(screen.getByTestId("mod-band")).toHaveTextContent("仍然可点");
  });

  it("状态行署名插件、后一次替换前一次，null 清除（场景 1）", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModStatus({
        sessionId: "s1",
        modId: "todo:a",
        plugin: "todo",
        text: "ctx 62%",
      }),
    );
    expect(screen.getByTestId("mod-status")).toHaveTextContent("todo");
    expect(screen.getByTestId("mod-status")).toHaveTextContent("ctx 62%");

    // 同一个 mod 再贴一次：替换，不是叠一行。
    sendHostMessage(
      fixtures.desktopModStatus({
        sessionId: "s1",
        modId: "todo:a",
        plugin: "todo",
        text: "ctx 71%",
      }),
    );
    expect(screen.getAllByTestId("mod-status")).toHaveLength(1);
    expect(screen.getByTestId("mod-status")).toHaveTextContent("ctx 71%");
    expect(screen.getByTestId("mod-status")).not.toHaveTextContent("ctx 62%");

    // 插件清除这一行。
    sendHostMessage(
      fixtures.desktopModStatus({
        sessionId: "s1",
        modId: "todo:a",
        plugin: "todo",
        text: null,
      }),
    );
    expect(screen.queryByTestId("mod-status")).not.toBeInTheDocument();
  });

  it("提示到点自己消失（timeoutMs 由 agent 侧给出）", () => {
    vi.useFakeTimers();
    renderDesktop();
    act(() => {
      sendHostMessage(
        fixtures.desktopModToast({
          sessionId: "s1",
          modId: "todo:a",
          plugin: "todo",
          text: "已保存",
          timeoutMs: 4000,
        }),
      );
    });
    expect(screen.getByTestId("mod-toast")).toHaveTextContent("已保存");

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByTestId("mod-toast")).toHaveTextContent("已保存");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("mod-toast")).not.toBeInTheDocument();
  });

  it("提示可以手动关掉（× 连同它的计时器一起撤）", () => {
    vi.useFakeTimers();
    renderDesktop();
    act(() => {
      sendHostMessage(
        fixtures.desktopModToast({
          sessionId: "s1",
          modId: "todo:a",
          plugin: "todo",
          text: "已保存",
          timeoutMs: 4000,
        }),
      );
    });
    expect(screen.getByTestId("mod-toast")).toHaveTextContent("已保存");

    act(() => {
      screen.getByRole("button", { name: "关闭提示" }).click();
    });
    expect(screen.queryByTestId("mod-toast")).not.toBeInTheDocument();

    // 计时器已撤：到点那次也不再对已删掉的 id 做一次滤波。
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("mod-toast")).not.toBeInTheDocument();
  });

  it("提示正文按 240 字符截断（CC 的 toast 口径）", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModToast({
        sessionId: "s1",
        modId: "todo:a",
        plugin: "todo",
        text: "已勾掉一项，".repeat(200),
        timeoutMs: 60_000,
      }),
    );
    const text = screen.getByTestId("mod-toast").textContent ?? "";
    expect(text).toContain("…");
    // 240 字符正文 + 插件署名。
    expect(text.length).toBeLessThanOrEqual(240 + "todo".length);
  });

  it("每次 stale 之后重拉带（带跟着 mod 的重画走）", () => {
    const { vscode } = renderDesktop();
    const before = bandRequests(vscode).length;
    sendHostMessage(
      fixtures.desktopModPanelUpdate({
        sessionId: "s1",
        modId: "todo:panel",
        paneId: "p1",
        title: "面板",
        revision: 1,
        stale: true,
      }),
    );
    expect(bandRequests(vscode).length).toBe(before + 1);
  });
});

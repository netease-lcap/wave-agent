import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendHostMessage } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPanelTree, ModPanelUpdatePayload } from "wave-agent-sdk/types";

/**
 * 桌面端右侧面板槽里的 mod 面板（spec `ecosystem/plugin-mods.md`）。
 *
 * 从这里往上游全在 SDK / CLI 进程侧（编译、沙箱、限额、`revision` 合并），
 * webview 只做两件事：把树画出来、把交互以 `{ kind, key }` 回传。所以这些用例
 * 只钉这两件事，加上两种必须由宿主仲裁的行为（外链走 `openExternal`、旧快照
 * 丢弃）——树本身的校验不在这一层。
 */

function renderDesktop() {
  window.waveHostType = "desktop";
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(fixtures.desktopWorkdirState({ workdir: "/work/a" }));
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const payload = (
  overrides: Partial<ModPanelUpdatePayload> = {},
): ModPanelUpdatePayload => ({
  sessionId: "s1",
  modId: "todo:panel",
  paneId: "p1",
  title: "待办",
  revision: 1,
  tree: { type: "Text", props: {}, children: ["Hello"] },
  ...overrides,
});

/** webview→host 的 mod 交互回传。 */
const events = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modPanelEvent")
    .map((m) => m.payload as Record<string, unknown>);

const externalLinks = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "openExternal")
    .map((m) => m.url as string);

afterEach(() => {
  delete window.waveHostType;
  // 面板 tab 的 UI 状态（含 `activeTabId` / `modRevision`）按会话缓存在模块级
  // `SessionUiStore` 里，跨用例存活：不清的话，上一个用例留下的 tab 会抢走
  // active 位置（下一条快照因为 tab 已存在而不被激活，树落在隐藏面板里）或把
  // 更高的 revision 带下去（新用例的 revision 1 被当成晚到的旧快照丢掉）。
  sessionUi.prune(new Set());
});

describe("desktop mod panel", () => {
  it("快照到达就开一个 tab 并画出树（场景 1）", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(fixtures.desktopModPanelUpdate(payload()));

    expect(screen.getByTestId("mod-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mod-panel-root")).toHaveTextContent("Hello");
    // tab 标题用 mod 自己起的名字，而不是兜底的「插件」。
    expect(screen.getAllByText("待办").length).toBeGreaterThan(0);
    // 画树本身不该回传任何事件。
    expect(events(vscode)).toEqual([]);
  });

  it("Box 的 flexDirection/gap 落到样式上（场景 2）", () => {
    renderDesktop();
    const tree: ModPanelTree = {
      type: "Box",
      props: { flexDirection: "row", gap: 2 },
      children: [
        { type: "Text", props: {}, children: ["A"] },
        { type: "Button", props: { key: "b", label: "B" }, children: [] },
      ],
    };
    sendHostMessage(fixtures.desktopModPanelUpdate(payload({ tree })));

    const root = screen.getByTestId("mod-panel-root").firstElementChild;
    expect(root).toHaveStyle({ display: "flex", flexDirection: "row" });
    // gap=2 就是 2px（数字即 px），间距档位另算。
    expect((root as HTMLElement).style.gap).toBe("2px");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });

  it("点 Button 回传 press，不带 value（场景 1）", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          tree: {
            type: "Button",
            props: { key: "inc", label: "+1" },
            children: [],
          },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "+1" }));

    expect(events(vscode)).toEqual([
      { modId: "todo:panel", paneId: "p1", key: "inc", kind: "press" },
    ]);
  });

  it("Input 提交回传 input 并清空输入框（场景 2）", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          tree: {
            type: "Input",
            props: { key: "add", submitLabel: "加上" },
            children: [],
          },
        }),
      ),
    );

    const input = screen.getByPlaceholderText("") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    expect(input.value).toBe("hello");
    fireEvent.click(screen.getByRole("button", { name: "加上" }));

    // 值交给 mod 之后留在框里只会让用户重复提交同一句。
    expect(input.value).toBe("");
    expect(events(vscode)).toEqual([
      {
        modId: "todo:panel",
        paneId: "p1",
        key: "add",
        kind: "input",
        value: "hello",
      },
    ]);
  });

  it("error 时画错误态而不是树（场景 1/2）", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({ tree: null, error: "元素树超过节点上限（2000）" }),
      ),
    );

    expect(screen.getByTestId("mod-panel-error")).toHaveTextContent(
      "元素树超过节点上限（2000）",
    );
    expect(screen.queryByTestId("mod-panel-root")).not.toBeInTheDocument();
  });

  it("回调抛错时错误条叠在上一帧树上，面板仍然能点（场景 18）", () => {
    const { vscode } = renderDesktop();
    const tree: ModPanelTree = {
      type: "Box",
      props: { flexDirection: "row" },
      children: [
        { type: "Button", props: { key: "ok", label: "OK" }, children: [] },
      ],
    };
    sendHostMessage(fixtures.desktopModPanelUpdate(payload({ tree })));

    // 同一个面板的下一条快照带 error，但树还在（mod 的元素回调抛了错）。
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({ tree, error: "钩子炸了", revision: 2 }),
      ),
    );

    expect(screen.getByTestId("mod-panel-error")).toHaveTextContent("钩子炸了");
    // 树没有被错误顶掉：用户还能点别的按钮，而不是整块面板报废。
    expect(screen.getByTestId("mod-panel-root")).toHaveTextContent("OK");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(events(vscode)).toEqual([
      { modId: "todo:panel", paneId: "p1", key: "ok", kind: "press" },
    ]);

    // 下一次成功渲染（error 清掉）后错误条消失。
    sendHostMessage(
      fixtures.desktopModPanelUpdate(payload({ tree, revision: 3 })),
    );
    expect(screen.queryByTestId("mod-panel-error")).not.toBeInTheDocument();
  });

  it("Link 点击交给宿主开浏览器，不在 webview 里导航", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          tree: {
            type: "Link",
            props: { href: "https://example.com/x", label: "文档" },
            children: [],
          },
        }),
      ),
    );

    // 未被 preventDefault 的话 jsdom 会打一条「not implemented: navigation」。
    expect(fireEvent.click(screen.getByRole("link", { name: "文档" }))).toBe(
      false,
    );
    expect(externalLinks(vscode)).toEqual(["https://example.com/x"]);
  });

  it("Markdown 里的链接同样走 openExternal", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          tree: {
            type: "Markdown",
            props: { text: "见 [文档](https://example.com/md)" },
            children: [],
          },
        }),
      ),
    );

    const anchor = screen.getByRole("link", { name: "文档" });
    fireEvent.click(anchor);
    expect(externalLinks(vscode)).toEqual(["https://example.com/md"]);
  });

  it("revision 更小的晚到快照不覆盖新树", () => {
    renderDesktop();
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          revision: 2,
          tree: { type: "Text", props: {}, children: ["new"] },
        }),
      ),
    );
    sendHostMessage(
      fixtures.desktopModPanelUpdate(
        payload({
          revision: 1,
          tree: { type: "Text", props: {}, children: ["old"] },
        }),
      ),
    );

    expect(screen.getByTestId("mod-panel-root")).toHaveTextContent("new");
    expect(screen.getByTestId("mod-panel-root")).not.toHaveTextContent("old");
  });

  it("用户关掉 tab 时回传 close，origin 是 person", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(fixtures.desktopModPanelUpdate(payload()));

    // 关 tab 是用户动作：mod 的 `ui.close` 钩子据此区分「人关的」与
    // 「插件自己关的 / 会话卸载」。
    fireEvent.click(screen.getByTestId("panel-tab-close-mod:todo:panel:p1"));

    expect(events(vscode)).toEqual([
      {
        modId: "todo:panel",
        paneId: "p1",
        key: "",
        kind: "close",
        origin: "person",
      },
    ]);
    expect(screen.queryByTestId("mod-panel")).not.toBeInTheDocument();
  });

  it("closed 快照关掉 tab", () => {
    renderDesktop();
    sendHostMessage(fixtures.desktopModPanelUpdate(payload()));
    expect(screen.getByTestId("mod-panel")).toBeInTheDocument();

    sendHostMessage(
      fixtures.desktopModPanelUpdate(payload({ closed: true, tree: null })),
    );

    expect(screen.queryByTestId("mod-panel")).not.toBeInTheDocument();
  });
});

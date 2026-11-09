/**
 * 会话内查找（spec ui/transcript-find.md）。
 *
 * 这里验的是「界面上的那层」：快捷键、计数、上一个/下一个、开关、关闭。匹配内核
 * 本身在 tests/utils/transcriptFind.test.ts 里单测。两条最关键的判据都在这里：
 *
 * - 命中数覆盖**未挂载**的行（虚拟列表只挂当前视口，只搜 DOM 会漏掉整段历史）；
 * - 高亮画在渲染后的文本节点上，`mark` 之外的结构不变。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
  pinMessageListViewport,
} from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const assistantMsg = (content: string, id: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

/** `window` 级快捷键：不开任何输入框时事件源就是 window。 */
const pressKey = (
  key: string,
  init: KeyboardEventInit = {},
  target?: Element | Window,
) => fireEvent.keyDown(target ?? window, { key, ...init });

const openFind = async () => {
  act(() => {
    pressKey("f", { ctrlKey: true });
  });
  return screen.findByTestId("transcript-find-input");
};

const typeQuery = (value: string) => {
  fireEvent.change(screen.getByTestId("transcript-find-input"), {
    target: { value },
  });
};

const hitCount = () =>
  document.querySelectorAll("mark.transcript-find-hit").length;

const renderWith = async (messages: unknown[]) => {
  renderChatApp();
  act(() => {
    sendCommand("updateMessages", { messages });
  });
  await waitFor(() =>
    expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
  );
  // 列表只挂视口附近的行，而视口高度来自列表外面的布局：不钉一个，整段历史
  // 都会留在 DOM 里，「未挂载的行」这条路（本文件最关键的判据）就永远不出现。
  pinMessageListViewport(screen.getByTestId("messages-container"));
};

describe("transcript find", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Ctrl/Cmd+F 打开查找条并把焦点放进输入框", async () => {
    await renderWith([userMsg("你好世界", "u1")]);

    const input = await openFind();

    expect(input).toHaveFocus();
  });

  it("画出全部匹配并显示计数", async () => {
    await renderWith([
      userMsg("先看 webview 的状态", "u1"),
      assistantMsg("webview 已经改了", "a1"),
    ]);

    await openFind();
    typeQuery("webview");

    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/2",
      ),
    );
    await waitFor(() => {
      expect(hitCount()).toBe(2);
      // 当前命中单独标出来，读者才知道「下一个」会去哪。
      expect(
        document.querySelectorAll("mark.transcript-find-hit--current").length,
      ).toBe(1);
    });
  });

  it("命中数覆盖虚拟列表未挂载的行", async () => {
    // 200 条消息、关键词落在第 50 条——那一条一开始并不在 DOM 里（列表只挂当前
    // 窗口）。计数仍然必须是 1，这条就是「不能退化成只搜 DOM」的判据。
    const messages: unknown[] = Array.from({ length: 200 }, (_, i) =>
      i === 50
        ? assistantMsg("藏在中间的 needle 关键词", `m${i}`)
        : userMsg(`普通消息 ${i}`, `m${i}`),
    );

    await renderWith(messages);
    // 视口钉好后列表要重排一次，窗口才从「全部」收缩成当前视口附近那一段。
    await waitFor(() =>
      expect(document.querySelectorAll(".virtual-row").length).toBeLessThan(
        200,
      ),
    );
    expect(document.body.textContent).not.toContain("needle");

    await openFind();
    typeQuery("needle");

    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/1",
      ),
    );
    // 未挂载的行画不出高亮（它根本不在 DOM 里）——恰恰说明计数不是从 DOM
    // 数出来的。
    expect(hitCount()).toBe(0);
  });

  it("Enter / Shift+Enter 在命中之间移动并环绕", async () => {
    await renderWith([
      userMsg("alpha one", "u1"),
      assistantMsg("alpha two", "a1"),
    ]);

    const input = await openFind();
    typeQuery("alpha");
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/2",
      ),
    );

    act(() => {
      pressKey("Enter", {}, input);
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "2/2",
      ),
    );

    // 末尾再前进一次回到第一个。
    act(() => {
      pressKey("Enter", {}, input);
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/2",
      ),
    );

    // 第一个再后退一次绕到最后一个。
    act(() => {
      pressKey("Enter", { shiftKey: true }, input);
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "2/2",
      ),
    );
  });

  it("无匹配时显示「无匹配结果」且查找条不消失", async () => {
    await renderWith([userMsg("hello", "u1")]);

    await openFind();
    typeQuery("找不到的词");

    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "无匹配结果",
      ),
    );
    expect(screen.getByTestId("transcript-find")).toBeInTheDocument();
    expect(hitCount()).toBe(0);
  });

  it("大小写开关改变结果，非法正则给出提示且不匹配", async () => {
    await renderWith([userMsg("Foo foo", "u1")]);

    await openFind();
    typeQuery("foo");
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/2",
      ),
    );

    act(() => {
      screen.getByTestId("transcript-find-case").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/1",
      ),
    );

    act(() => {
      screen.getByTestId("transcript-find-regex").click();
    });
    typeQuery("f(");
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "正则表达式无效",
      ),
    );
  });

  it("Esc 关闭查找条并清除高亮，正文文本不变", async () => {
    await renderWith([userMsg("world", "u1")]);

    const input = await openFind();
    typeQuery("world");
    await waitFor(() => expect(hitCount()).toBe(1));

    act(() => {
      pressKey("Escape", {}, input);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("transcript-find")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(hitCount()).toBe(0));
    expect(document.body.textContent).toContain("world");
  });

  it("焦点在文件面板里时 Ctrl+F 不开会话查找（那边有自己的查找条）", async () => {
    await renderWith([userMsg("hello", "u1")]);

    // 判据是事件源落在预览/文件面板内——两个查找条都挂在 window 上，靠这条分开。
    const pane = document.createElement("div");
    pane.setAttribute("data-testid", "preview-pane");
    const inner = document.createElement("button");
    pane.appendChild(inner);
    document.body.appendChild(pane);

    act(() => {
      pressKey("f", { ctrlKey: true }, inner);
    });

    expect(screen.queryByTestId("transcript-find")).not.toBeInTheDocument();
    pane.remove();
  });
});

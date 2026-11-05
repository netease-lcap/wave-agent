import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { within } from "@testing-library/react";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import { COPY_FEEDBACK_MS } from "../../src/components/AssistantMessageActions";

/**
 * 助手消息底部的复制按钮（spec: ui/message-rendering-system.md「助手消息底部的
 * 复制按钮」）。
 *
 * 这里钉住的是「复制什么」与「什么时候有这个入口」：各文本块按空行拼接的原始
 * Markdown（不含工具参数）、成功后对勾反馈与恢复、最后一条常驻 / 历史悬停、
 * 流式中与无正文时不出现。悬停显隐的几何与三档选择器只能真 Chromium 验，
 * 见 e2e/assistant-message-copy.e2e.ts。
 *
 * 桩的顺序有讲究：`renderChatApp()` 内部会 `userEvent.setup()`，它自己会给
 * `navigator.clipboard` 装一个桩，所以剪贴板的桩必须打在 render **之后**，
 * 否则会被它盖掉（现象是点击后拿不到任何 writeText 调用，但界面照样变「已复制」）。
 */
describe("Assistant message copy button", () => {
  const renderMessages = (messages: Message[]) =>
    act(() => {
      sendCommand("updateMessages", { messages });
    });

  const stubClipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  };

  const assistant = (blocks: MessageBlock[], id: string): Message => ({
    id,
    role: "assistant",
    timestamp: "2025-07-09T10:30:01.000Z",
    blocks,
  });

  const user = (content: string, id: string): Message => ({
    id,
    role: "user",
    timestamp: "2025-07-09T10:30:00.000Z",
    blocks: [{ type: "text", content }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  it("copies every text block as raw markdown, without tool arguments", async () => {
    renderChatApp();
    const writeText = stubClipboard();

    renderMessages([
      user("复述一下结论", "u1"),
      assistant(
        [
          { type: "text", content: "## 结论\n\n改 `app.ts` 就行。" },
          {
            type: "reasoning",
            stage: "end",
            content: "先看 app.ts 里有没有旧逻辑。",
          },
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "end",
            success: true,
            parameters: JSON.stringify({ command: "pnpm test --secret" }),
            result: "ok",
          },
          { type: "text", content: "- 第一条\n- 第二条" },
        ],
        "a1",
      ),
    ]);

    const button = await screen.findByTestId("assistant-copy");
    await act(async () => {
      fireEvent.click(button);
    });

    // 场景 4：文本块按顺序用空行拼接、Markdown 源码原样保留；工具参数不在里面。
    expect(writeText).toHaveBeenCalledWith(
      "## 结论\n\n改 `app.ts` 就行。\n\n- 第一条\n- 第二条",
    );
  });

  it("swaps to a check icon with a 已复制 label, then reverts", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([
      user("跑一下", "u1"),
      assistant([{ type: "text", content: "跑完了。" }], "a1"),
    ]);

    const button = await screen.findByTestId("assistant-copy");
    expect(button).toHaveAttribute("aria-label", "复制");
    expect(button.querySelector(".codicon")).toHaveClass("codicon-copy");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(button);
    });

    // 场景 5：图标换成对勾、可访问名换成「已复制」，读屏另有 role=status 播报。
    const copiedButton = screen.getByTestId("assistant-copy");
    expect(copiedButton).toHaveAttribute("aria-label", "已复制");
    expect(copiedButton).toHaveAttribute("data-copied", "true");
    expect(copiedButton.querySelector(".codicon")).toHaveClass("codicon-check");
    expect(
      within(screen.getByTestId("assistant-message-actions")).getByRole(
        "status",
      ),
    ).toHaveTextContent("已复制");

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });

    expect(screen.getByTestId("assistant-copy")).toHaveAttribute(
      "aria-label",
      "复制",
    );
    expect(screen.getByTestId("assistant-copy")).not.toHaveAttribute(
      "data-copied",
    );
  });

  it("stays visible only on the last message (history relies on hover)", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([
      user("第一轮", "u1"),
      assistant([{ type: "text", content: "第一轮的回答。" }], "a1"),
      user("第二轮", "u2"),
      assistant([{ type: "text", content: "第二轮的回答。" }], "a2"),
    ]);

    const rows = await screen.findAllByTestId("assistant-message-actions");
    // 场景 1/2：每条有正文的助手消息都有这一行（占位），但只有最后一条常驻。
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveAttribute("data-always-visible");
    expect(rows[1]).toHaveAttribute("data-always-visible", "true");
  });

  it("is absent while the reply is still streaming", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([
      user("说说思路", "u1"),
      assistant(
        [{ type: "text", content: "我想想…", stage: "streaming" }],
        "a1",
      ),
    ]);

    await waitFor(() => {
      expect(screen.getByText("我想想…")).toBeInTheDocument();
    });
    // 场景 3：正文还在往屏幕上写，不给复制入口。
    expect(screen.queryAllByTestId("assistant-message-actions")).toHaveLength(
      0,
    );
  });

  it("is absent when the reply has no text to copy", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([
      user("看下配置", "u1"),
      assistant(
        [
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "end",
            success: true,
            parameters: JSON.stringify({ command: "cat config.json" }),
            result: "{}",
          },
        ],
        "a1",
      ),
    ]);

    // 场景 7：只有工具调用的消息没有可复制的正文，不给入口。
    await waitFor(() => {
      expect(screen.getByText("看下配置")).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId("assistant-message-actions")).toHaveLength(
      0,
    );
  });

  it("is not rendered for user messages", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([user("帮我改一下", "u1")]);

    await waitFor(() => {
      expect(screen.getByText("帮我改一下")).toBeInTheDocument();
    });
    // 场景 8：用户消息上没有复制入口。
    expect(screen.queryByTestId("assistant-copy")).not.toBeInTheDocument();
  });

  it("keeps the copy icon when both clipboard paths fail", async () => {
    renderChatApp();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    // jsdom 里没有 execCommand，退回分支同样失败。
    Object.defineProperty(document, "execCommand", {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });

    renderMessages([
      user("复述", "u1"),
      assistant([{ type: "text", content: "可以。" }], "a1"),
    ]);

    const button = await screen.findByTestId("assistant-copy");
    await act(async () => {
      fireEvent.click(button);
    });

    // 场景 6：两条路都失败就不给成功反馈。
    expect(button).toHaveAttribute("aria-label", "复制");
    expect(button).not.toHaveAttribute("data-copied");
  });

  /**
   * 富文本那条路（场景 10/11）。断言分两层：这里只看「两种 flavor 都被交出去了」，
   * HTML 长什么样由 messageCopyText.test.ts 单独钉（纯函数，好断言）。
   */
  describe("rich-text clipboard", () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }

    const stubRichClipboard = () => {
      const write = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { write, writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
      Object.defineProperty(globalThis, "ClipboardItem", {
        value: FakeClipboardItem,
        configurable: true,
      });
      return write;
    };

    afterEach(() => {
      Object.defineProperty(globalThis, "ClipboardItem", {
        value: undefined,
        configurable: true,
      });
    });

    it("writes text/plain and text/html in one clipboard item", async () => {
      renderChatApp();
      const write = stubRichClipboard();

      renderMessages([
        user("复述", "u1"),
        assistant([{ type: "text", content: "## 结论\n\n- 甲\n- 乙" }], "a1"),
      ]);

      const button = await screen.findByTestId("assistant-copy");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(write).toHaveBeenCalledTimes(1);
      const [items] = write.mock.calls[0] as unknown as [FakeClipboardItem[]];
      expect(items).toHaveLength(1);
      const flavors = items[0].items;
      expect(Object.keys(flavors).sort()).toEqual(["text/html", "text/plain"]);
      expect(flavors["text/plain"]).toBeInstanceOf(Blob);
      expect(flavors["text/html"]).toBeInstanceOf(Blob);
      // 场景 10：成功反馈照旧。
      expect(screen.getByTestId("assistant-copy")).toHaveAttribute(
        "data-copied",
        "true",
      );
    });

    it("falls back to plain text when the rich write is rejected", async () => {
      renderChatApp();
      const write = vi.fn().mockRejectedValue(new Error("not focused"));
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { write, writeText },
        configurable: true,
      });
      Object.defineProperty(globalThis, "ClipboardItem", {
        value: FakeClipboardItem,
        configurable: true,
      });

      renderMessages([
        user("复述", "u1"),
        assistant([{ type: "text", content: "结论如上。" }], "a1"),
      ]);

      const button = await screen.findByTestId("assistant-copy");
      await act(async () => {
        fireEvent.click(button);
      });

      // 场景 11：降级不是失败——纯文本照样写进去，成功反馈照给。
      expect(write).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("结论如上。");
      expect(screen.getByTestId("assistant-copy")).toHaveAttribute(
        "data-copied",
        "true",
      );
    });
  });

  it("renders the message time as a semantic <time> element", async () => {
    renderChatApp();
    stubClipboard();

    const timestamp = "2025-07-09T10:30:01.000Z";
    renderMessages([
      user("第一轮", "u1"),
      assistant([{ type: "text", content: "第一轮的回答。" }], "a1"),
    ]);

    const row = await screen.findByTestId("assistant-message-actions");
    const time = row.querySelector("time");
    // 场景 4 / 6：语义元素 + 原始时间戳落在 datetime 上（可见文本随本地时区变）。
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", timestamp);
    expect(time?.textContent).toMatch(
      /^(?:\d{4}年)?\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/,
    );
  });

  it("omits the time when the message has no timestamp", async () => {
    renderChatApp();
    stubClipboard();

    renderMessages([
      user("第一轮", "u1"),
      {
        id: "a1",
        role: "assistant",
        // 老数据没有该字段（类型上要求存在，实测为空串/缺失走同一条早退分支）。
        timestamp: "",
        blocks: [{ type: "text", content: "没有时间戳的老消息。" }],
      },
    ]);

    const row = await screen.findByTestId("assistant-message-actions");
    // 场景 6：时间缺失时省略时间文本，动作行其余部分照常。
    expect(row.querySelector("time")).toBeNull();
    expect(within(row).getByTestId("assistant-copy")).toBeInTheDocument();
  });
});

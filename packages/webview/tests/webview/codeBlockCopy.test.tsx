import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Message, CODE_COPY_FEEDBACK_MS } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// 助手消息围栏代码块右上角的复制按钮（specs/ui/message-rendering-system.md
// 「助手消息代码块的复制按钮」）：每个块一颗按钮、复制出来的是这块代码的原文、
// 成功给对勾反馈、失败不给、空块不给入口。
// DOMPurify 必须是真的：白名单没放行 <button> 时按钮会被静默剥掉，只有真净化
// 能测出这件事。

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  delete window.waveHostType;
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function renderAssistant(content: string) {
  const vscode = createMockVscode();
  const message = MockDataGenerator.createAssistantMessage(content);
  const { container } = render(<Message message={message} vscode={vscode} />);
  return container;
}

const copyButton = (container: HTMLElement) =>
  container.querySelector("button.md-code-copy") as HTMLButtonElement | null;

describe("fenced code block copy button", () => {
  it("renders one button per block, before the pre", () => {
    const container = renderAssistant(
      "示例：\n\n```ts\nconst a = 1;\n```\n\n另一个：\n\n```\nnpm run build\n```",
    );
    const blocks = Array.from(container.querySelectorAll(".md-code-block"));
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const button = block.querySelector("button.md-code-copy");
      expect(button).not.toBeNull();
      // 按钮是原生 button：可 Tab 聚焦、可回车/空格触发
      expect(button?.getAttribute("type")).toBe("button");
      expect(button?.getAttribute("aria-label")).toBe("复制代码");
      // 落位在容器内、pre 之前（绝对定位的浮层，不占代码块高度）
      expect(block.querySelector("pre")?.previousElementSibling).toBe(button);
    }
  });

  it("copies the block's source text byte for byte", async () => {
    // 缩进、内部空行、行尾空格、URL 与文件路径都必须原样带走——
    // 高亮只加 <span>、链接化只把 URL/路径包进 <a>，可见文本不变。
    const code = [
      "function main() {",
      "",
      "    const longLine = 'keep trailing spaces   ';",
      "    const docs = 'https://example.com/a?b=1';",
      "    const file = 'src/components/Message.tsx';",
      "}",
    ].join("\n");
    const container = renderAssistant("看这段：\n\n```ts\n" + code + "\n```");
    fireEvent.click(copyButton(container)!);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("copies a block without an info string", async () => {
    const container = renderAssistant("命令：\n\n```\nnpm run build\n```");
    fireEvent.click(copyButton(container)!);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("npm run build"),
    );
  });

  it("switches to a check mark on success and restores afterwards", async () => {
    vi.useFakeTimers();
    try {
      const container = renderAssistant("示例：\n\n```js\nlet a = 1;\n```");
      const button = copyButton(container)!;
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.getAttribute("aria-label")).toBe("已复制");
      expect(button.getAttribute("title")).toBe("已复制");
      expect(button.classList.contains("is-copied")).toBe(true);
      expect(button.querySelector(".codicon")?.classList).toContain(
        "codicon-check",
      );
      expect(button.querySelector(".codicon")?.classList).not.toContain(
        "codicon-copy",
      );

      await vi.advanceTimersByTimeAsync(CODE_COPY_FEEDBACK_MS);
      expect(button.getAttribute("aria-label")).toBe("复制代码");
      expect(button.classList.contains("is-copied")).toBe(false);
      expect(button.querySelector(".codicon")?.classList).toContain(
        "codicon-copy",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives no success feedback when both clipboard paths fail", async () => {
    // 真浏览器里 `document.execCommand` 是存在的，只是无用户手势时 `copy` 会返回
    // false；显式固定成 false，断言就不依赖运行环境的剪贴板权限了。
    const execCommand = vi
      .spyOn(document, "execCommand")
      .mockImplementation(() => false);
    writeText.mockRejectedValue(new Error("denied"));
    const container = renderAssistant("示例：\n\n```js\nlet a = 1;\n```");
    const button = copyButton(container)!;
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(button.getAttribute("aria-label")).toBe("复制代码");
    expect(button.classList.contains("is-copied")).toBe(false);
  });

  it("renders no button for an empty block", () => {
    const container = renderAssistant("空的：\n\n```\n\n```");
    expect(container.querySelector(".md-code-block")).not.toBeNull();
    expect(copyButton(container)).toBeNull();
  });

  it("leaves user messages alone (they are not markdown)", () => {
    const vscode = createMockVscode();
    const message = MockDataGenerator.createUserMessage(
      "示例：\n\n```ts\nconst a = 1;\n```",
    );
    const { container } = render(<Message message={message} vscode={vscode} />);
    expect(container.querySelector(".md-code-block")).toBeNull();
    expect(copyButton(container)).toBeNull();
  });
});

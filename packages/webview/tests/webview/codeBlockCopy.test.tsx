import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import React from "react";
import { Message, CODE_COPY_FEEDBACK_MS } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// 助手消息围栏代码块右上角的复制按钮（specs/ui/message-rendering-system.md
// 「助手消息代码块的复制按钮」）：每个块一颗按钮、复制出来的是这块代码的原文、
// 成功给对勾反馈、失败不给、空块不给入口。
// DOMPurify 必须是真的：白名单没放行 <button> 时按钮会被静默剥掉，只有真净化
// 能测出这件事。
//
// 最后那个 describe 是排版层的三条（平时看不见、悬停淡入、浮在右上角且不压住
// 首行、横向滚动时不跟着走）——它们要真实排版与真实 :hover，`userEvent` 走 CDP
// 真鼠标事件，`:hover` 与 `opacity` 的过渡就是浏览器自己算的。

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

/**
 * 排版层那三条（原 `e2e/code-block-copy.e2e.ts`）。
 *
 * 「按钮平时看不见、悬停才淡入」「浮在右上角且不压住首行」「横向滚动时不跟着走」
 * 都要真实排版与真实 `:hover` —— 而本套件跑在真 Chromium 里，`userEvent` 走 CDP
 * 发真鼠标事件，所以不需要单独的 Playwright 工程。
 */

/** 带一条 160 字符长行的代码：横向滚动那条靠它把 `pre` 撑出滚动条。 */
const LONG_CODE = [
  'const answer: string = "你好";',
  `const veryLongLine = "${"x".repeat(160)}";`,
  "console.log(answer);",
].join("\n");

function renderLongCode() {
  const container = renderAssistant(
    `看这段：\n\n\`\`\`ts\n${LONG_CODE}\n\`\`\``,
  );
  return {
    block: container.querySelector(".md-code-block") as HTMLElement,
    pre: container.querySelector(".markdown-content pre") as HTMLElement,
    button: copyButton(container)!,
  };
}

describe("fenced code block copy button — layout", () => {
  it("stays hidden until the block is hovered", async () => {
    const { block, button } = renderLongCode();

    // 场景 3：鼠标不在代码块上时看不见（不占位：绝对定位，不影响代码块几何）
    expect(getComputedStyle(button).opacity).toBe("0");

    await userEvent.hover(block);
    await vi.waitFor(() => expect(getComputedStyle(button).opacity).toBe("1"));
  });

  it("floats in the top-right corner without covering the first line", async () => {
    const { block, pre, button } = renderLongCode();
    await userEvent.hover(block);

    const preBox = pre.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const gapTop = buttonBox.top - preBox.top;
    const gapRight = preBox.right - buttonBox.right;
    const paddingRight = Number.parseFloat(getComputedStyle(pre).paddingRight);

    // 场景 1：贴在代码块右上角（几像素的内缩），在 pre 的盒子之内
    expect(gapTop).toBeGreaterThanOrEqual(0);
    expect(gapTop).toBeLessThan(12);
    expect(gapRight).toBeGreaterThanOrEqual(0);
    expect(gapRight).toBeLessThan(12);
    // 场景 2：首行为按钮让出了内边距，宽代码不会跑到按钮底下
    expect(paddingRight).toBeGreaterThanOrEqual(buttonBox.width + 8);
  });

  it("does not move when the code scrolls horizontally", async () => {
    const { block, pre, button } = renderLongCode();
    await userEvent.hover(block);
    const before = button.getBoundingClientRect();

    pre.scrollLeft = pre.scrollWidth;

    // 先证明真的滚了：否则下面两条断言在任何实现下都成立。
    expect(pre.scrollLeft).toBeGreaterThan(0);
    const after = button.getBoundingClientRect();
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("copies this block's source and shows a check", async () => {
    const { block, button } = renderLongCode();
    await userEvent.hover(block);
    await userEvent.click(button);

    // 场景 4：代码原文（去掉围栏与末尾换行），缩进/长行原样保留
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_CODE));

    // 场景 5：图标转对勾、可访问名换成「已复制」
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-label")).toBe("已复制"),
    );
    expect(button.querySelector(".codicon")?.classList).toContain(
      "codicon-check",
    );
  });
});

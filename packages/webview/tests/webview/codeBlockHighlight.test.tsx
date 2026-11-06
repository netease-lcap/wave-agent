import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// 助手消息围栏代码块的语法高亮（specs/ui/message-rendering-system.md「助手消息
// 代码块的语法高亮」）：语言标记命中 webview 已注册的语言时着色，纯文本逐字节
// 不变；未注册 / 没写语言标记退回纯文本；着色不得吞掉代码块内的 URL 与路径
// （specs/ui/markdown-links.md、specs/ui/file-path-links.md）。
// DOMPurify 必须是真的：白名单没放行 <span> 时高亮会被静默剥掉，只有真净化能
// 测出这件事。

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderBlock(code: string, lang?: string) {
  const vscode = createMockVscode();
  const fence = lang
    ? `\`\`\`${lang}\n${code}\n\`\`\``
    : `\`\`\`\n${code}\n\`\`\``;
  const message = MockDataGenerator.createAssistantMessage(
    `请过目：\n\n${fence}`,
  );
  const { container } = render(<Message message={message} vscode={vscode} />);
  const block = container.querySelector(".markdown-content pre code");
  return {
    container,
    block,
    tokens: () =>
      Array.from(
        container.querySelectorAll(".markdown-content pre code span"),
      ) as HTMLElement[],
    links: () =>
      Array.from(
        container.querySelectorAll(".markdown-content pre code a"),
      ) as HTMLElement[],
  };
}

afterEach(() => {
  delete window.waveHostType;
});

describe("fenced code block syntax highlighting", () => {
  it("highlights a fenced block whose language is registered", () => {
    const { block, tokens } = renderBlock("const answer: number = 42;", "ts");
    // 语言类名照常保留，另加 hljs 标记（调色板认的就是这两个类名）
    expect(block?.className).toBe("hljs language-ts");
    expect(tokens().length).toBeGreaterThan(0);
    expect(tokens().some((el) => el.classList.contains("hljs-keyword"))).toBe(
      true,
    );
    // 着色只加行内元素，代码原文逐字节不变
    expect(block?.textContent).toBe("const answer: number = 42;\n");
  });

  it("resolves a language alias to its registered module", () => {
    const { block, tokens } = renderBlock("def main():\n    pass", "py");
    expect(block?.className).toBe("hljs language-py");
    expect(tokens().some((el) => el.classList.contains("hljs-keyword"))).toBe(
      true,
    );
    expect(block?.textContent).toBe("def main():\n    pass\n");
  });

  it("keeps a block without an info string plain", () => {
    const { block, tokens } = renderBlock("npm run build");
    expect(block?.className).toBe("hljs");
    expect(tokens()).toHaveLength(0);
    expect(block?.textContent).toBe("npm run build\n");
  });

  it("keeps an unregistered language plain instead of guessing", () => {
    const { block, tokens } = renderBlock("print('hi')", "lua");
    // 语言类名仍是围栏里写的那一个（其余 markdown 渲染不受影响）
    expect(block?.className).toBe("hljs language-lua");
    expect(tokens()).toHaveLength(0);
    expect(block?.textContent).toBe("print('hi')\n");
  });

  it("keeps linkifying bare URLs inside a highlighted block", () => {
    const { block, links, tokens } = renderBlock(
      "# 健康检查\ncurl http://127.0.0.1:3000/health",
      "bash",
    );
    expect(tokens().length).toBeGreaterThan(0);
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe(
      "http://127.0.0.1:3000/health",
    );
    expect(block?.textContent).toBe(
      "# 健康检查\ncurl http://127.0.0.1:3000/health\n",
    );
  });

  it("keeps the quotes of a highlighted JSON string out of the link target", () => {
    const { block, links } = renderBlock(
      '{\n  "url": "https://example.com/api"\n}',
      "json",
    );
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/api");
    // 解回原文再链接化，实体不能二次转义（屏幕上不该出现 &amp;）
    expect(block?.innerHTML).not.toContain("&amp;amp;");
    expect(block?.textContent).toBe(
      '{\n  "url": "https://example.com/api"\n}\n',
    );
  });

  it("keeps linkifying absolute file paths inside a highlighted block", () => {
    const { block, links } = renderBlock(
      "cat /home/u/proj/src/utils/a.ts",
      "bash",
    );
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.classList.contains("file-path-link")).toBe(true);
    expect(anchors[0]?.textContent).toBe("/home/u/proj/src/utils/a.ts");
    expect(block?.textContent).toBe("cat /home/u/proj/src/utils/a.ts\n");
  });

  it("highlights diff blocks without touching the markers", () => {
    const { block, tokens } = renderBlock(
      "-const a = 1;\n+const a = 2;",
      "diff",
    );
    expect(tokens().some((el) => el.classList.contains("hljs-addition"))).toBe(
      true,
    );
    expect(block?.textContent).toBe("-const a = 1;\n+const a = 2;\n");
  });
});

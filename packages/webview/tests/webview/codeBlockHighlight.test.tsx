import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
// 桌面层那条断言的意义就在「host-desktop.css 的覆写没有把调色板改掉」，
// 所以这份样式必须真的进来（它所有选择器都带 `[data-host="desktop"]`）。
import "../../src/styles/host-desktop.css";

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

/**
 * 调色板真的落到屏幕上了（原 `e2e/code-block-highlight.e2e.ts`）。
 *
 * 上面那些用例只证明「DOM 里生成了 token 元素」——token 有了但调色板没加载、
 * 或被 `.markdown-content code` 的基色压过，屏幕上仍是单色代码，它们一路绿。
 * 这里量的是浏览器算出来的颜色（本套件就跑在真 Chromium 里）。
 */
const KEYWORD_RGB = "rgb(86, 156, 214)"; // #569cd6
const STRING_RGB = "rgb(206, 145, 120)"; // #ce9178

function renderTsAndUnknownFences() {
  const message = MockDataGenerator.createAssistantMessage(
    "示例：\n\n```ts\nconst answer: string = \"你好\";\n```\n\n认不出的语言：\n\n```lua\nprint('hi')\n```",
  );
  const { container } = render(
    <Message message={message} vscode={createMockVscode()} />,
  );
  const codes = Array.from(
    container.querySelectorAll(".markdown-content pre code"),
  ) as HTMLElement[];
  const colorOf = (selector: string) => {
    const el = container.querySelector(selector) as HTMLElement | null;
    return el ? getComputedStyle(el).color : null;
  };
  return {
    codeBase: colorOf(".markdown-content pre code"),
    keyword: colorOf(".markdown-content pre code .hljs-keyword"),
    string: colorOf(".markdown-content pre code .hljs-string"),
    unknownLangClass: codes[1]?.className ?? null,
    unknownLangTokens: codes[1]?.querySelectorAll("span").length ?? 0,
  };
}

describe("fenced code block highlight — computed colors", () => {
  afterEach(() => {
    delete document.documentElement.dataset.host;
    document.documentElement.removeAttribute("data-theme");
  });

  it("插件端：代码块按语言着色，未知语言保持纯文本", () => {
    // 没有宿主标记就是插件端（editor 档）；桌面档的覆盖由下一条钉住
    expect(document.documentElement.dataset.host).toBeUndefined();

    const colors = renderTsAndUnknownFences();

    expect(colors.keyword, "关键字没有着色（调色板没加载？）").toBe(
      KEYWORD_RGB,
    );
    expect(colors.string, "字符串没有着色").toBe(STRING_RGB);
    // 反面证据：token 的颜色必须与代码基色不同，否则「有 span 但看着仍是单色」。
    expect(colors.keyword).not.toBe(colors.codeBase);

    // 未注册语言：class 保留围栏里写的那一个，但不产生 token。
    expect(colors.unknownLangClass).toContain("language-lua");
    expect(colors.unknownLangTokens).toBe(0);
  });

  it("桌面端：同一份调色板照常生效", () => {
    document.documentElement.dataset.host = "desktop";
    document.documentElement.setAttribute("data-theme", "dark");

    const colors = renderTsAndUnknownFences();

    // 配色不按宿主分叉，这里只钉住「桌面层没有把它覆盖掉」。
    expect(document.documentElement.dataset.host).toBe("desktop");
    expect(colors.keyword).toBe(KEYWORD_RGB);
    expect(colors.string).toBe(STRING_RGB);
  });
});

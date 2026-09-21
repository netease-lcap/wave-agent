import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// 围栏代码块中的裸 http(s) URL 链接化（specs/ui/markdown-links.md「围栏代码块中的
// URL 可点击」）：代码块内按空白分词，逐 token 切出 URL 提升为链接，token 内其余
// 代码原文保持原样（含文件路径识别，specs/ui/file-path-links.md）。点击路由与消息
// 文本链接一致：desktop 上 localhost → 预览面板、其余 → 系统浏览器；IDE 原生处理。

// Mermaid is heavy and irrelevant here; stub it out (same pattern as
// markdownInlineLink.test.tsx). DOMPurify must stay REAL so these tests
// exercise the actual sanitize whitelist.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderCodeBlock(
  code: string,
  options?: {
    hostType?: string;
    onOpenPreview?: (url: string) => void;
    workdir?: string;
  },
) {
  const vscode = createMockVscode();
  if (options?.hostType) {
    window.waveHostType = options.hostType;
  }
  const message = MockDataGenerator.createAssistantMessage(
    `请过目：\n\n\`\`\`\n${code}\n\`\`\``,
  );
  const result = render(
    <Message
      message={message}
      vscode={vscode}
      workdir={options?.workdir}
      onOpenPreview={options?.onOpenPreview}
    />,
  );
  return {
    ...result,
    vscode,
    block: result.container.querySelector(".markdown-content pre code"),
    links: () =>
      Array.from(
        result.container.querySelectorAll(".markdown-content pre code a"),
      ) as HTMLElement[],
  };
}

afterEach(() => {
  delete window.waveHostType;
});

describe("fenced code block URL linkification", () => {
  it("elevates a bare URL on its own line, keeping the code text and line break", () => {
    const { block, links } = renderCodeBlock("http://127.0.0.1:8097/");
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("http://127.0.0.1:8097/");
    expect(block?.textContent).toBe("http://127.0.0.1:8097/\n");
  });

  it("linkifies URLs across multiple lines, one anchor per URL", () => {
    const { block, links } = renderCodeBlock(
      "http://localhost:5173/app\nhttps://example.com/docs",
    );
    const anchors = links();
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getAttribute("href")).toBe("http://localhost:5173/app");
    expect(anchors[1]?.getAttribute("href")).toBe("https://example.com/docs");
    expect(block?.textContent).toBe(
      "http://localhost:5173/app\nhttps://example.com/docs\n",
    );
  });

  it("linkifies a URL inside a code line, leaving the surrounding code as-is", () => {
    const { block, links } = renderCodeBlock(
      "curl http://127.0.0.1:3000/health",
    );
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe(
      "http://127.0.0.1:3000/health",
    );
    expect(block?.textContent).toBe("curl http://127.0.0.1:3000/health\n");
  });

  it("keeps the quotes of a JSON value out of the link target", () => {
    const { block, links } = renderCodeBlock(
      '{\n  "url": "https://example.com/api"\n}',
    );
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/api");
    expect(block?.textContent).toBe(
      '{\n  "url": "https://example.com/api"\n}\n',
    );
  });

  it("ends the target before full-width punctuation and keeps the annotation", () => {
    const { block, links } = renderCodeBlock(
      "http://127.0.0.1:8097/（本地预览）",
    );
    const anchors = links();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("http://127.0.0.1:8097/");
    expect(anchors[0]?.textContent).toBe("http://127.0.0.1:8097/");
    expect(block?.textContent).toBe("http://127.0.0.1:8097/（本地预览）\n");
  });

  it("never linkifies non-http(s) protocols or HTML fragments", () => {
    const { block, links } = renderCodeBlock(
      "javascript:alert(1)\ndata:text/html,<h1>x</h1>\n<div>&</div>",
    );
    expect(links()).toHaveLength(0);
    expect(block?.textContent).toBe(
      "javascript:alert(1)\ndata:text/html,<h1>x</h1>\n<div>&</div>\n",
    );
    expect(block?.querySelector("h1")).toBeNull();
  });

  it("keeps file-path linkification in the same block (URL and path do not swallow each other)", () => {
    const { links } = renderCodeBlock(
      "see https://example.com/docs or /home/u/repo/src/a.ts",
    );
    const anchors = links();
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/docs");
    expect(anchors[0]?.className).toBe("");
    expect(anchors[1]?.getAttribute("href")).toBe("#");
    expect(anchors[1]?.className).toContain("file-path-link");
    expect(anchors[1]?.textContent).toBe("/home/u/repo/src/a.ts");
  });

  it("desktop host: a localhost URL in a code block opens the preview pane", () => {
    const onOpenPreview = vi.fn();
    const { vscode, links } = renderCodeBlock("http://127.0.0.1:8097/", {
      hostType: "desktop",
      onOpenPreview,
    });

    const notPrevented = fireEvent.click(links()[0]!);

    expect(onOpenPreview).toHaveBeenCalledWith("http://127.0.0.1:8097/");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it("desktop host: an external URL in a code block goes to the system browser", () => {
    const onOpenPreview = vi.fn();
    const { vscode, links } = renderCodeBlock("https://example.com/docs", {
      hostType: "desktop",
      onOpenPreview,
    });

    fireEvent.click(links()[0]!);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://example.com/docs",
    });
  });

  it("IDE host: code block links are not intercepted", () => {
    const onOpenPreview = vi.fn();
    const { vscode, links } = renderCodeBlock("http://localhost:5173/app", {
      onOpenPreview,
    });

    const notPrevented = fireEvent.click(links()[0]!);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true); // default navigation preserved
  });
});

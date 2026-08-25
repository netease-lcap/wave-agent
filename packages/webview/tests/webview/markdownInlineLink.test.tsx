import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { MockDataGenerator } from "../fixtures/mockData";

// Mermaid is heavy and irrelevant here; stub it out. DOMPurify must stay REAL so
// these tests exercise the actual sanitize whitelist in Message.tsx.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderAssistantMessage(content: string) {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const message = MockDataGenerator.createAssistantMessage(content);
  return render(<Message message={message} vscode={vscode} />);
}

describe("inline-code link elevation (specs/ui/markdown-links.md)", () => {
  it("elevates a bare http(s) URL inside inline code to a clickable link, keeping the code style", () => {
    const { container } = renderAssistantMessage(
      "看这里 `https://example.com/a/b` 和 `http://localhost:5173`",
    );
    const links = container.querySelectorAll(".markdown-content code a");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/a/b");
    expect(links[1]?.getAttribute("href")).toBe("http://localhost:5173");
  });

  it("keeps non-URL inline code as plain code", () => {
    const { container } = renderAssistantMessage(
      "变量 `var x = 1`、无协议 `www.example.com`、相对路径 `/foo`",
    );
    expect(container.querySelectorAll(".markdown-content a")).toHaveLength(0);
    expect(container.querySelectorAll(".markdown-content code")).toHaveLength(
      3,
    );
  });

  it("keeps markdown link syntax inside inline code as literal text", () => {
    const { container } = renderAssistantMessage(
      "原文 `[t](https://example.com)` 保留",
    );
    expect(container.querySelectorAll(".markdown-content a")).toHaveLength(0);
    const code = container.querySelector(".markdown-content code");
    expect(code?.textContent).toBe("[t](https://example.com)");
  });

  it("strips leading/trailing punctuation from the link target", () => {
    const { container } = renderAssistantMessage(
      "参考 `https://example.com.` 或 `（https://example.com/a）`",
    );
    const links = container.querySelectorAll(".markdown-content code a");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com");
    expect(links[1]?.getAttribute("href")).toBe("https://example.com/a");
  });

  it("never elevates non-http(s) protocols such as javascript:", () => {
    const { container } = renderAssistantMessage(
      "危险 `javascript:alert(1)` 与 `file:///c:/x` 不提升",
    );
    expect(container.querySelectorAll(".markdown-content a")).toHaveLength(0);
    expect(container.querySelectorAll(".markdown-content code")).toHaveLength(
      2,
    );
  });

  it("keeps inline code with multiple URLs as literal text", () => {
    const { container } = renderAssistantMessage(
      "多个 `https://a.com https://b.com`",
    );
    expect(container.querySelectorAll(".markdown-content a")).toHaveLength(0);
  });

  it("escapes HTML inside inline code (non-URL case)", () => {
    const { container } = renderAssistantMessage(
      "注入 `<script>alert(1)</script>` 测试",
    );
    expect(container.querySelector(".markdown-content code script")).toBeNull();
    expect(container.querySelector(".markdown-content code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
  });
});

describe("bare URL with trailing CJK punctuation (marked GFM autolink)", () => {
  it("strips a trailing Chinese period from the link target", () => {
    const { container } = renderAssistantMessage("访问 https://example.com。");
    const link = container.querySelector(".markdown-content a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("https://example.com");
  });

  it("strips a trailing pair of Chinese brackets as a whole", () => {
    const { container } = renderAssistantMessage(
      "详见 https://example.com（帮助文档）。",
    );
    const link = container.querySelector(".markdown-content a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("https://example.com");
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      "（帮助文档）。",
    );
  });

  it("strips a lone trailing Chinese opening bracket", () => {
    const { container } = renderAssistantMessage("链接 https://example.com（");
    const link = container.querySelector(".markdown-content a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("keeps ASCII punctuation behavior unchanged (trailing period is stripped)", () => {
    const { container } = renderAssistantMessage("访问 https://example.com.");
    const link = container.querySelector(".markdown-content a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("does not strip legitimate URL characters (underscore, fragment, ASCII parens)", () => {
    const { container } = renderAssistantMessage(
      "示例 https://example.com/a_b#frag 与 https://example.com/foo(bar)",
    );
    const links = container.querySelectorAll(".markdown-content a");
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/a_b#frag");
    expect(links[1]?.getAttribute("href")).toBe("https://example.com/foo(bar)");
  });

  it("keeps Chinese text inside a query string (not trailing punctuation)", () => {
    const { container } = renderAssistantMessage(
      "搜索 https://example.com/search?q=你好",
    );
    const link = container.querySelector(".markdown-content a");
    expect(link?.getAttribute("href")).toBe(
      "https://example.com/search?q=%E4%BD%A0%E5%A5%BD",
    );
  });
});

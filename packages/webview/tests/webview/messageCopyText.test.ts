import { describe, it, expect } from "vitest";
import { markdownToClipboardHtml } from "../../src/utils/messageCopyText";

/**
 * 复制进剪贴板的富文本那份（spec: ui/message-rendering-system.md「助手消息底部的
 * 复制按钮」场景 10）。
 *
 * 钉的是两件事：**结构保留**（标题 / 列表 / 代码块 / 链接 / 表格各就各位）与
 * **样式不跟走**（不带 class、不带我们自己的高亮标记）。
 */
describe("markdownToClipboardHtml", () => {
  it("keeps headings, lists and fenced code blocks as structure", () => {
    const html = markdownToClipboardHtml(
      "## 结论\n\n- 甲\n- 乙\n\n```ts\nconst a = 1;\n```",
    );

    expect(html).toContain("<h2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>甲</li>");
    expect(html).toContain("<pre>");
    expect(html).toContain("const a = 1;");
    // 代码块里的内容不该被当成 markdown 再解析一遍。
    expect(html).not.toContain("<code>const a = 1;</code>");
  });

  it("keeps tables, links and emphasis", () => {
    const html = markdownToClipboardHtml(
      "| 列 | 值 |\n| --- | --- |\n| a | 1 |\n\n**要点**与[文档](https://example.com)",
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th");
    expect(html).toContain("<strong>要点</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("carries no class names — styling belongs to the receiving editor", () => {
    const html = markdownToClipboardHtml("```ts\nconst a = 1;\n```\n\n> 引用");
    expect(html).not.toMatch(/class=/);
    expect(html).not.toContain("hljs");
  });

  it("strips markup that must not reach another app", () => {
    const html = markdownToClipboardHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("returns an empty string when there is nothing to copy", () => {
    expect(markdownToClipboardHtml("")).toBe("");
    expect(markdownToClipboardHtml("   \n\n ")).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import {
  linkifyPlainText,
  stripTrailingUrlPunct,
} from "../../src/utils/linkifyPlainText";

describe("linkifyPlainText", () => {
  it("links bare http(s) URLs and escapes surrounding text", () => {
    expect(
      linkifyPlainText("Server started at http://localhost:8000/ now"),
    ).toBe(
      'Server started at <a href="http://localhost:8000/">http://localhost:8000/</a> now',
    );
  });

  it("links https URLs too", () => {
    expect(linkifyPlainText("see https://example.com/docs")).toBe(
      'see <a href="https://example.com/docs">https://example.com/docs</a>',
    );
  });

  it("keeps text without URLs unchanged (escaped)", () => {
    expect(linkifyPlainText("plain output <x> & y")).toBe(
      "plain output &lt;x&gt; &amp; y",
    );
  });

  it("returns empty string for empty input", () => {
    expect(linkifyPlainText("")).toBe("");
  });

  it("strips trailing ASCII punctuation from the link target", () => {
    expect(linkifyPlainText("visit https://example.com.")).toBe(
      'visit <a href="https://example.com">https://example.com</a>.',
    );
    expect(linkifyPlainText("(https://example.com)")).toBe(
      '(<a href="https://example.com">https://example.com</a>)',
    );
  });

  it("strips trailing CJK punctuation from the link target", () => {
    expect(linkifyPlainText("打开 https://example.com。")).toBe(
      '打开 <a href="https://example.com">https://example.com</a>。',
    );
    expect(linkifyPlainText("（https://example.com）")).toBe(
      '（<a href="https://example.com">https://example.com</a>）',
    );
    // 成对中文括号（注释/说明）整体剥离，不保留显示
    expect(linkifyPlainText("见 https://example.com（帮助）")).toBe(
      '见 <a href="https://example.com">https://example.com</a>',
    );
  });

  it("keeps balanced ASCII parens as part of the URL", () => {
    expect(linkifyPlainText("read https://example.com/foo(bar)")).toBe(
      'read <a href="https://example.com/foo(bar)">https://example.com/foo(bar)</a>',
    );
    expect(
      linkifyPlainText("https://en.wikipedia.org/wiki/Hello_(disambiguation)"),
    ).toBe(
      '<a href="https://en.wikipedia.org/wiki/Hello_(disambiguation)">https://en.wikipedia.org/wiki/Hello_(disambiguation)</a>',
    );
  });

  it("does not link non-http(s) protocols", () => {
    expect(
      linkifyPlainText("run javascript:alert(1) or file:///etc/passwd"),
    ).toBe("run javascript:alert(1) or file:///etc/passwd");
  });

  it("escapes quotes in URLs so the href attribute cannot be broken out", () => {
    const html = linkifyPlainText('x https://a.com/?q="1" y');
    // 尾部标点剥离会去掉一个闭合引号，剩余引号转义为 &quot;，属性值不会提前闭合
    expect(html).not.toContain('href="https://a.com/?q="'); // 原始引号闭合属性
    expect(html).toContain('href="https://a.com/?q=&quot;1"');
  });

  it("escapes HTML in non-URL segments so scripts are inert", () => {
    const html = linkifyPlainText("<script>alert(1)</script> http://a.com");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="http://a.com"');
  });

  it("links every URL in multi-line output preserving line breaks", () => {
    const html = linkifyPlainText(
      "line1 http://a.com\nline2 https://b.com/x\nend",
    );
    expect(html).toBe(
      'line1 <a href="http://a.com">http://a.com</a>\nline2 <a href="https://b.com/x">https://b.com/x</a>\nend',
    );
  });

  it("keeps URLs with query strings and fragments intact", () => {
    expect(linkifyPlainText("http://a.com/p?x=1&y=2#frag")).toContain(
      'href="http://a.com/p?x=1&amp;y=2#frag"',
    );
  });
});

describe("stripTrailingUrlPunct", () => {
  it("strips ASCII and CJK punctuation only from the end", () => {
    expect(stripTrailingUrlPunct("https://a.com/b?x=1.")).toBe(
      "https://a.com/b?x=1",
    );
    expect(stripTrailingUrlPunct("https://a.com。")).toBe("https://a.com");
    expect(stripTrailingUrlPunct("https://a.com/b")).toBe("https://a.com/b");
  });

  it("strips paired CJK parentheses as a whole", () => {
    expect(stripTrailingUrlPunct("https://a.com（说明）")).toBe(
      "https://a.com",
    );
    expect(stripTrailingUrlPunct("https://a.com（")).toBe("https://a.com");
  });

  it("keeps balanced ASCII parens but strips an orphan closing paren", () => {
    expect(stripTrailingUrlPunct("https://a.com/foo(bar)")).toBe(
      "https://a.com/foo(bar)",
    );
    expect(stripTrailingUrlPunct("https://a.com/b)")).toBe("https://a.com/b");
  });
});

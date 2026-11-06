import { describe, it, expect } from "vitest";
import { linkifyAnsiText, ansiToHtml } from "../../src/utils/ansiText";
import { linkifyPlainText } from "../../src/utils/linkifyPlainText";

const ESC = "\u001b";

describe("linkifyAnsiText", () => {
  it("renders SGR colors as span classes and keeps the visible text", () => {
    expect(linkifyAnsiText(`${ESC}[31mdeleted${ESC}[0m kept`)).toBe(
      '<span class="ansi-fg-red">deleted</span> kept',
    );
  });

  it("merges adjacent text with the same style into one span", () => {
    expect(linkifyAnsiText(`${ESC}[32ma${ESC}[32mb`)).toBe(
      '<span class="ansi-fg-green">ab</span>',
    );
  });

  it("combines attributes and colors on one span", () => {
    expect(linkifyAnsiText(`${ESC}[1;32m+ added${ESC}[0m`)).toBe(
      '<span class="ansi-bold ansi-fg-green">+ added</span>',
    );
  });

  it("supports bright colors, backgrounds and attribute resets", () => {
    expect(linkifyAnsiText(`${ESC}[1;91;44mx${ESC}[22my`)).toBe(
      '<span class="ansi-bold ansi-fg-bright-red ansi-bg-blue">x</span>' +
        '<span class="ansi-fg-bright-red ansi-bg-blue">y</span>',
    );
  });

  it("maps 256-color and truecolor to inline styles", () => {
    expect(linkifyAnsiText(`${ESC}[38;5;196mred`)).toBe(
      '<span style="color:#ff0000">red</span>',
    );
    expect(linkifyAnsiText(`${ESC}[48;2;1;2;3mbg`)).toBe(
      '<span style="background-color:#010203">bg</span>',
    );
  });

  it("maps the low 256-color indexes to named colors", () => {
    expect(linkifyAnsiText(`${ESC}[38;5;9mhi`)).toBe(
      '<span class="ansi-fg-bright-red">hi</span>',
    );
  });

  it("drops non-SGR control sequences instead of showing them", () => {
    // 光标移动 / 清屏 / OSC 超链接：都不产生可见字符，也不触发行为。
    expect(
      linkifyAnsiText(
        `${ESC}[2K${ESC}[1Gclean${ESC}]8;;https://evil.test${ESC}\\`,
      ),
    ).toBe("clean");
  });

  it("returns the plain linkify output byte-for-byte when there is no ANSI", () => {
    const text = "done http://localhost:3000/ in 3s\n";
    expect(linkifyAnsiText(text)).toBe(linkifyPlainText(text));
    expect(linkifyAnsiText(text)).not.toContain("<span");
  });

  it("keeps URLs clickable inside a colored span", () => {
    expect(linkifyAnsiText(`${ESC}[36mhttp://localhost:8000/${ESC}[0m`)).toBe(
      '<span class="ansi-fg-cyan"><a href="http://localhost:8000/">http://localhost:8000/</a></span>',
    );
  });

  it("does not cut a URL in half when a color boundary splits the token", () => {
    const html = linkifyAnsiText(`${ESC}[31mhttp://local${ESC}[0mhost:8000/`);
    expect(html).toBe(
      '<span class="ansi-fg-red">http://local</span>host:8000/',
    );
    expect(html).not.toContain("<a ");
  });

  it("escapes HTML in the output", () => {
    expect(linkifyAnsiText(`${ESC}[31m<b>x</b>${ESC}[0m`)).toBe(
      '<span class="ansi-fg-red">&lt;b&gt;x&lt;/b&gt;</span>',
    );
  });

  it("handles empty text and lone reset sequences", () => {
    expect(linkifyAnsiText("")).toBe("");
    expect(linkifyAnsiText(`${ESC}[0m`)).toBe("");
  });

  it("keeps text after an unterminated color sequence", () => {
    expect(linkifyAnsiText(`${ESC}[33mwarn: no newline`)).toBe(
      '<span class="ansi-fg-yellow">warn: no newline</span>',
    );
  });
});

describe("linkifyAnsiText with truncated sequences", () => {
  it("drops an escape sequence cut in half by output truncation", () => {
    // toolResultStorage 的 preview 可能把序列截成 `ESC[3`：不能显示成可见字符。
    expect(linkifyAnsiText("tail\u001b[3")).toBe("tail");
    expect(linkifyAnsiText("tail\u001b")).toBe("tail");
  });
});

describe("ansiToHtml", () => {
  // 后台任务面板把输出原样显示（不链接化），所以这里只认颜色。
  it("renders colors without turning URLs into links", () => {
    expect(ansiToHtml(`${ESC}[32mhttp://localhost:8000/${ESC}[0m`)).toBe(
      '<span class="ansi-fg-green">http://localhost:8000/</span>',
    );
    expect(ansiToHtml("http://localhost:8000/")).toBe("http://localhost:8000/");
  });

  it("escapes HTML and keeps plain text untouched", () => {
    expect(ansiToHtml(`<b>plain</b>`)).toBe("&lt;b&gt;plain&lt;/b&gt;");
    expect(ansiToHtml(`${ESC}[31m<b>x</b>${ESC}[0m`)).toBe(
      '<span class="ansi-fg-red">&lt;b&gt;x&lt;/b&gt;</span>',
    );
  });
});

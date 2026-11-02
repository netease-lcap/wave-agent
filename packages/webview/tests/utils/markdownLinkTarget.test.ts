import { describe, it, expect } from "vitest";
import { resolveMarkdownLinkTarget } from "../../src/utils/markdownLinkTarget";

describe("resolveMarkdownLinkTarget", () => {
  const index = "/repo/docs/specs/index.md";

  it("resolves a relative link against the previewed file's directory", () => {
    // The reported click: `[spec](020-mini-app/spec.md)` in docs/specs/index.md.
    expect(resolveMarkdownLinkTarget("020-mini-app/spec.md", index)).toBe(
      "/repo/docs/specs/020-mini-app/spec.md",
    );
    expect(resolveMarkdownLinkTarget("./a.md", index)).toBe(
      "/repo/docs/specs/a.md",
    );
    expect(resolveMarkdownLinkTarget("../core/x.md", index)).toBe(
      "/repo/docs/core/x.md",
    );
  });

  it("folds `.`/`..` and drops a fragment or query", () => {
    expect(resolveMarkdownLinkTarget("./sub/../a.md", index)).toBe(
      "/repo/docs/specs/a.md",
    );
    expect(resolveMarkdownLinkTarget("a.md#section", index)).toBe(
      "/repo/docs/specs/a.md",
    );
    expect(resolveMarkdownLinkTarget("a.md?raw=1", index)).toBe(
      "/repo/docs/specs/a.md",
    );
  });

  it("percent-decodes the path", () => {
    expect(resolveMarkdownLinkTarget("my%20file.md", index)).toBe(
      "/repo/docs/specs/my file.md",
    );
    // A stray `%` is not a decode error worth losing the click over.
    expect(resolveMarkdownLinkTarget("100%.md", index)).toBe(
      "/repo/docs/specs/100%.md",
    );
  });

  it("keeps an absolute target as it is", () => {
    expect(resolveMarkdownLinkTarget("/repo/other/x.md", index)).toBe(
      "/repo/other/x.md",
    );
  });

  it("resolves a file: URL into a path", () => {
    expect(resolveMarkdownLinkTarget("file:///repo/a.md", index)).toBe(
      "/repo/a.md",
    );
  });

  it("keeps the parent's separator style on Windows paths", () => {
    expect(
      resolveMarkdownLinkTarget("sub\\a.md", "C:\\repo\\docs\\index.md"),
    ).toBe("C:\\repo\\docs\\sub\\a.md");
    expect(
      resolveMarkdownLinkTarget("sub/a.md", "C:\\repo\\docs\\index.md"),
    ).toBe("C:\\repo\\docs\\sub\\a.md");
    expect(
      resolveMarkdownLinkTarget("file:///C:/repo/a.md", "C:\\repo\\docs\\x.md"),
    ).toBe("C:/repo/a.md");
  });

  it("returns null for anything it must not turn into a file read", () => {
    expect(resolveMarkdownLinkTarget("#anchor", index)).toBeNull();
    expect(resolveMarkdownLinkTarget("  ", index)).toBeNull();
    expect(
      resolveMarkdownLinkTarget("https://example.com/a.md", index),
    ).toBeNull();
    expect(resolveMarkdownLinkTarget("http://example.com", index)).toBeNull();
    expect(resolveMarkdownLinkTarget("mailto:a@b.c", index)).toBeNull();
    expect(resolveMarkdownLinkTarget("javascript:alert(1)", index)).toBeNull();
    expect(resolveMarkdownLinkTarget("data:text/html,x", index)).toBeNull();
  });

  it("returns null for a relative link with no base file", () => {
    expect(resolveMarkdownLinkTarget("a.md", "")).toBeNull();
  });
});

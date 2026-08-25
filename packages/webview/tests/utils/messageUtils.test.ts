import { describe, it, expect } from "vitest";
import { toRelativePath } from "../../src/utils/messageUtils";

describe("toRelativePath", () => {
  const workdir = "/home/user/repo";

  it("shows a path inside the workdir relative to it", () => {
    expect(toRelativePath(`${workdir}/src/index.ts`, workdir)).toBe(
      "src/index.ts",
    );
  });

  it("shows the absolute path when outside the workdir", () => {
    expect(toRelativePath("/tmp/other/file.txt", workdir)).toBe(
      "/tmp/other/file.txt",
    );
  });

  it("shows the absolute path when the relative form starts with ..", () => {
    expect(toRelativePath("/home/user/other/file.txt", workdir)).toBe(
      "/home/user/other/file.txt",
    );
  });

  it("shows . when the path equals the workdir", () => {
    expect(toRelativePath(workdir, workdir)).toBe(".");
  });

  it("returns the original path when workdir is unknown", () => {
    expect(toRelativePath(`${workdir}/src/index.ts`, undefined)).toBe(
      `${workdir}/src/index.ts`,
    );
  });

  it("returns the original path when filePath is empty", () => {
    expect(toRelativePath("", workdir)).toBe("");
  });

  it("relativizes win32 backslash paths inside the workdir", () => {
    const winWorkdir = "C:\\Users\\liuyiqi02\\github\\wave-agent";
    expect(
      toRelativePath(
        "C:\\Users\\liuyiqi02\\github\\wave-agent\\packages\\webview\\src\\index.ts",
        winWorkdir,
      ),
    ).toBe("packages/webview/src/index.ts");
  });

  it("relativizes mixed posix/win32 separator styles", () => {
    const winWorkdir = "C:\\Users\\liuyiqi02\\github\\wave-agent";
    expect(
      toRelativePath(
        "C:/Users/liuyiqi02/github/wave-agent/packages/webview/src/index.ts",
        winWorkdir,
      ),
    ).toBe("packages/webview/src/index.ts");
    expect(
      toRelativePath(
        "C:\\Users\\liuyiqi02\\github\\wave-agent\\packages\\webview\\src\\index.ts",
        "C:/Users/liuyiqi02/github/wave-agent",
      ),
    ).toBe("packages/webview/src/index.ts");
  });

  it("normalizes the absolute fallback to posix separators", () => {
    expect(
      toRelativePath(
        "C:\\Users\\liuyiqi02\\other\\file.ts",
        "C:\\Users\\liuyiqi02\\repo",
      ),
    ).toBe("C:/Users/liuyiqi02/other/file.ts");
  });

  it("falls back to the absolute path for a different win32 drive", () => {
    expect(
      toRelativePath("D:\\data\\file.ts", "C:\\Users\\liuyiqi02\\repo"),
    ).toBe("D:/data/file.ts");
  });

  it("shows . for win32 path equal to the workdir", () => {
    expect(toRelativePath("C:\\repo", "C:\\repo")).toBe(".");
  });

  it("collapses .. and . segments before relativizing", () => {
    expect(
      toRelativePath(
        "/home/user/repo/./src/../src/index.ts",
        "/home/user/repo",
      ),
    ).toBe("src/index.ts");
  });
});

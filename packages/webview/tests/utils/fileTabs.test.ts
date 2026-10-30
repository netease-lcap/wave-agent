import { describe, it, expect } from "vitest";
import { fileTabLabels, type FileTabLabel } from "../../src/utils/fileTabs";

/**
 * 标签文案（spec desktop-file-panel.md 场景 4）：正文永远是裸文件名，同名文件才
 * 追加「能把彼此区分开的最短目录尾巴」—— 不是整条相对路径。
 *
 * 这里只喂字符串：既有的 posix 路径、win32 带盘符的路径（反斜杠那条是回归用例，
 * 老的 basename 只切 `/`，会把整条路径当名字）、以及工作目录之外回落绝对路径的
 * 情况。纯字符串函数，与跑测试的机器是什么系统无关。
 */

const label = (
  labels: Map<string, FileTabLabel>,
  path: string,
): FileTabLabel => {
  const found = labels.get(path);
  if (!found) throw new Error(`no label for ${path}`);
  return found;
};

describe("fileTabLabels", () => {
  it("唯一文件名只给名字，后缀为空", () => {
    const labels = fileTabLabels(
      ["/repo/src/app.ts", "/repo/lib/util.ts"],
      "/repo",
    );
    expect(label(labels, "/repo/src/app.ts")).toEqual({
      name: "app.ts",
      suffix: undefined,
      dir: "src",
      relativePath: "src/app.ts",
    });
    expect(label(labels, "/repo/lib/util.ts").suffix).toBeUndefined();
  });

  it("同名取最短一条目录尾巴就够了", () => {
    const labels = fileTabLabels(
      ["/repo/src/index.ts", "/repo/test/index.ts"],
      "/repo",
    );
    expect(label(labels, "/repo/src/index.ts").suffix).toBe("src");
    expect(label(labels, "/repo/test/index.ts").suffix).toBe("test");
  });

  it("一级目录撞车时升到两级，仍不铺整条相对路径", () => {
    const labels = fileTabLabels(
      ["/repo/a/x/index.ts", "/repo/b/x/index.ts"],
      "/repo",
    );
    expect(label(labels, "/repo/a/x/index.ts").suffix).toBe("a/x");
    expect(label(labels, "/repo/b/x/index.ts").suffix).toBe("b/x");
  });

  it("工作目录根上的同名文件没有后缀可加，只给能区分的那一方加", () => {
    const labels = fileTabLabels(
      ["/repo/index.ts", "/repo/src/index.ts"],
      "/repo",
    );
    const root = label(labels, "/repo/index.ts");
    expect(root).toEqual({
      name: "index.ts",
      suffix: undefined,
      dir: undefined,
      relativePath: "index.ts",
    });
    expect(label(labels, "/repo/src/index.ts").suffix).toBe("src");
  });

  it("两个同名文件连目录都相同时不加后缀（加什么也区分不了）", () => {
    const labels = fileTabLabels(
      ["/repo/src/index.ts", "/repo/src/index.ts"],
      "/repo",
    );
    expect(label(labels, "/repo/src/index.ts").suffix).toBeUndefined();
  });

  it("工作目录之外的文件回落到绝对路径参与区分，并保留根", () => {
    const labels = fileTabLabels(
      ["/repo/src/index.ts", "/other/src/index.ts"],
      "/repo",
    );
    expect(label(labels, "/repo/src/index.ts").suffix).toBe("src");
    expect(label(labels, "/other/src/index.ts").suffix).toBe("/other/src");
  });

  it("win32 反斜杠路径也能拆出文件名与后缀（回归：只切 / 会把整条路径当名字）", () => {
    const labels = fileTabLabels(
      ["C:\\work\\a\\src\\index.ts", "C:\\work\\a\\test\\index.ts"],
      "C:\\work\\a",
    );
    expect(label(labels, "C:\\work\\a\\src\\index.ts")).toEqual({
      name: "index.ts",
      suffix: "src",
      dir: "src",
      relativePath: "src/index.ts",
    });
    expect(label(labels, "C:\\work\\a\\test\\index.ts").suffix).toBe("test");
  });

  it("没有 workdir 时按绝对路径的相对形态区分", () => {
    const labels = fileTabLabels(["/repo/src/index.ts", "/repo/test/index.ts"]);
    expect(label(labels, "/repo/src/index.ts").suffix).toBe("src");
    expect(label(labels, "/repo/src/index.ts").relativePath).toBe(
      "/repo/src/index.ts",
    );
  });
});

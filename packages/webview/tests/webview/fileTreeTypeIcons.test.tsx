import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { FileTree, type FileTreeProps } from "../../src/components/FileTree";

/**
 * 文件行类型图标接进目录树后的样子（spec desktop-file-panel.md「文件行按类型显示
 * 图标」场景 1、5、7、9）。解析规则本身在 `pierreFileIcons.test.ts` 里逐条断言，
 * 这里只看「接上去之后哪一行拿到哪颗图形」以及「文件夹与插件端没被牵连」。
 *
 * 断言锚 `data-file-type-icon`（语义：解析出来的图标名），不锚图标字体类名 ——
 * 与 tests 里其它图标断言同一口径。
 */

const ROOT = "/work/a";

const ENTRIES = [
  { name: "src", type: "dir" as const },
  { name: "README.md", type: "file" as const },
  { name: "app.ts", type: "file" as const },
  { name: "logo.png", type: "file" as const },
  { name: "Main.kt", type: "file" as const },
  { name: "Makefile", type: "file" as const },
  { name: "next.config.ts", type: "file" as const },
];

const props = (): FileTreeProps => ({
  root: ROOT,
  expanded: new Set([ROOT]),
  onToggleDir: vi.fn(),
  dirs: { [ROOT]: { entries: ENTRIES, total: ENTRIES.length } },
  onNeedDir: vi.fn(),
  activePath: undefined,
  onOpenFile: vi.fn(),
  revealTick: 0,
  filter: "",
  onFilterChange: vi.fn(),
  filterResults: [],
  filterLoading: false,
  selectedIndex: 0,
  onSelectedIndexChange: vi.fn(),
  onPickResult: vi.fn(),
});

/** 某一行（按名字）里的图标槽位（`.file-tree-icon`；行首的箭头是另一颗 svg）。 */
const iconOf = (name: string) =>
  screen
    .getByText(name)
    .closest("[role=treeitem]")!
    .querySelector("svg.file-tree-icon");

/** 解析出来的图标名（没有类型图标时返回 null）。 */
const iconNameOf = (name: string) =>
  iconOf(name)?.getAttribute("data-file-type-icon") ?? null;

afterEach(() => {
  delete window.waveHostType;
  document.documentElement.removeAttribute("data-theme");
});

describe("桌面端：文件行按类型取图标（场景 1）", () => {
  it("不同扩展名给不同图标，未知/无扩展名落通用文件图标", () => {
    window.waveHostType = "desktop";
    render(<FileTree {...props()} />);
    expect(iconNameOf("app.ts")).toBe("typescript");
    expect(iconNameOf("README.md")).toBe("markdown");
    expect(iconNameOf("logo.png")).toBe("image");
    // 缺口（场景 5）：Kotlin 不在图标集里，落 default。
    expect(iconNameOf("Main.kt")).toBe("default");
    expect(iconNameOf("Makefile")).toBe("default");
  });

  it("文件行图标盒仍是 16px（场景 7：行高 22px，行内不产生位移）", () => {
    window.waveHostType = "desktop";
    render(<FileTree {...props()} />);
    const svg = iconOf("app.ts")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
  });

  it("nextjs 的斜线面引用自身渐变，且 id 逐实例唯一（同屏多颗不撞 id）", () => {
    window.waveHostType = "desktop";
    const twoNext = [
      { name: "next.config.ts", type: "file" as const },
      { name: "next.config.mjs", type: "file" as const },
    ];
    render(
      <FileTree
        {...props()}
        dirs={{ [ROOT]: { entries: twoNext, total: twoNext.length } }}
      />,
    );
    const svgs = screen
      .getAllByText(/^next\.config\./)
      .map((el) => el.closest("[role=treeitem]")!.querySelector("svg")!);
    expect(svgs).toHaveLength(2);

    const gradIds = svgs.map(
      (svg) => svg.querySelector("linearGradient")?.getAttribute("id") ?? "",
    );
    expect(gradIds[0]).not.toBe("");
    expect(gradIds[0]).not.toBe(gradIds[1]);

    for (const [index, svg] of svgs.entries()) {
      // 三颗 path 里恰好一颗走渐变，且真的指向本实例的 <linearGradient>。
      const gradientPaths = [...svg.querySelectorAll("path")].filter((p) =>
        (p.getAttribute("fill") ?? "").startsWith("url(#"),
      );
      expect(gradientPaths).toHaveLength(1);
      expect(gradientPaths[0].getAttribute("fill")).toBe(
        `url(#${gradIds[index]})`,
      );
    }
  });

  it("文件夹行不换图标：仍是设计源的线描图标（场景 1、5）", () => {
    window.waveHostType = "desktop";
    render(<FileTree {...props()} />);
    const folder = iconOf("src")!;
    expect(folder).not.toBeNull();
    expect(folder.hasAttribute("data-file-type-icon")).toBe(false);
    // FolderIcon 是 stroke=currentColor 的线描（类型图标是 fill 型、无 stroke）。
    expect(folder.getAttribute("stroke")).toBe("currentColor");
  });

  it("主题一切就换色，不需要重新渲染（场景 6）", () => {
    window.waveHostType = "desktop";
    render(<FileTree {...props()} />);
    const path = iconOf("app.ts")!.querySelector("path")!;
    // 宿主切主题只改 <html data-theme>，不触 React 重渲染 —— 颜色只能来自 CSS。
    document.documentElement.setAttribute("data-theme", "light");
    const light = getComputedStyle(path).fill;
    document.documentElement.setAttribute("data-theme", "dark");
    const dark = getComputedStyle(path).fill;
    // 图标集给 typescript 的一对：#1a85d4 / #69b1ff。
    expect(light).toBe("rgb(26, 133, 212)");
    expect(dark).toBe("rgb(105, 177, 255)");
  });
});

describe("插件端：目录树仍是 codicon 字形（场景 9）", () => {
  it("文件行不渲染这套类型图标", () => {
    render(<FileTree {...props()} />);
    expect(iconOf("app.ts")).toBeNull();
    const slot = screen
      .getByText("app.ts")
      .closest("[role=treeitem]")!
      .querySelector(".file-tree-icon");
    expect(slot!.tagName).toBe("I");
  });
});

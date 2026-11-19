import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ConversationFileList } from "../../src/components/ConversationFileList";
import { FileTabStrip } from "../../src/components/FileTabStrip";
import { DiffFileTree } from "../../src/components/DiffFileTree";
import type { ConversationFileEntry } from "../../src/utils/conversationFiles";
import type { WorkspaceDiffFile } from "../../src/components/DiffPane";
import type { OpenFileTab } from "../../src/types";

/**
 * 文件类型图标的另外三处落点（spec desktop-file-panel.md「文件行按类型显示图标」）：
 * 设计师 2026-11-18 指出「当前对话的文件」清单与已打开文件的标签上还是通用方框，
 * 而同一个面板右侧的目录树已经是按类型解析的彩色图标；差异面板的文件树按 CC 对齐
 * 一并换。解析规则本身在 `pierreFileIcons.test.ts`、目录树那处在
 * `fileTreeTypeIcons.test.tsx`，这里只钉「这三处接上了、形状与尺寸没变、插件端没被
 * 牵连」。
 *
 * 断言锚 `data-file-type-icon`（语义：解析出来的图标名），不锚图标字体类名 ——
 * 与 tests 里其它图标断言同一口径。
 */

const entry = (
  path: string,
  name = path.slice(path.lastIndexOf("/") + 1),
): ConversationFileEntry => ({
  absolutePath: `/work/${path}`,
  path,
  name,
  displayPath: path,
});

const iconNameOf = (root: Element | null | undefined) =>
  root?.getAttribute("data-file-type-icon") ?? null;

afterEach(() => {
  delete window.waveHostType;
  document.documentElement.removeAttribute("data-theme");
});

// ─── 「当前对话的文件」清单 ───────────────────────────────────────────────────

/** 某一行里的图标槽位（`.file-pane-conversation-file-icon`）。 */
const listIconOf = (label: string) =>
  screen
    .getByText(label)
    .closest("[data-testid=file-pane-conversation-file-row]")!
    .querySelector(".file-pane-conversation-file-icon");

describe("桌面端：当前对话的文件清单按类型取图标", () => {
  const FILES = [
    entry("src/app.ts"),
    entry("src/styles/crimson.css"),
    entry("logo.png"),
    entry("Makefile"),
  ];

  it("每行解析出各自的图标，未知类型落通用文件图标", () => {
    window.waveHostType = "desktop";
    render(<ConversationFileList files={FILES} onOpenFile={vi.fn()} />);
    expect(iconNameOf(listIconOf("app.ts"))).toBe("typescript");
    expect(iconNameOf(listIconOf("crimson.css"))).toBe("css");
    expect(iconNameOf(listIconOf("logo.png"))).toBe("image");
    expect(iconNameOf(listIconOf("Makefile"))).toBe("default");
  });

  it("重名时行标签被换成相对路径，图标仍按文件名解析（不看目录）", () => {
    window.waveHostType = "desktop";
    // `collectConversationFiles` 对重名会把 `name` 改写成相对路径（同一名字的行
    // 才分得开），所以图标不能拿 `name` 去解析 —— 组件取 `absolutePath` 的末段。
    render(
      <ConversationFileList
        files={[
          entry("src/index.ts", "src/index.ts"),
          entry("test/index.ts", "test/index.ts"),
        ]}
        onOpenFile={vi.fn()}
      />,
    );
    expect(iconNameOf(listIconOf("src/index.ts"))).toBe("typescript");
    expect(iconNameOf(listIconOf("test/index.ts"))).toBe("typescript");
  });

  it("图标盒仍是 16px（行高 = 图标 16 + 上下 6，改前改后同一个盒子）", () => {
    window.waveHostType = "desktop";
    render(<ConversationFileList files={FILES} onOpenFile={vi.fn()} />);
    const svg = listIconOf("app.ts")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
  });
});

describe("插件端：当前对话的文件清单不接这套图标", () => {
  it("仍是原来那颗 feather 文件图标", () => {
    render(
      <ConversationFileList
        files={[entry("src/app.ts")]}
        onOpenFile={vi.fn()}
      />,
    );
    const slot = listIconOf("app.ts")!;
    expect(slot.tagName.toLowerCase()).toBe("svg");
    expect(iconNameOf(slot)).toBeNull();
  });
});

// ─── 已打开文件的标签 ─────────────────────────────────────────────────────────

const tabProps = (files: OpenFileTab[]) => ({
  files,
  activeFileId: files[0]?.id,
  workdir: "/work",
  onActivate: vi.fn(),
  onClose: vi.fn(),
  onCloseOthers: vi.fn(),
  onCloseRight: vi.fn(),
  onCloseAll: vi.fn(),
  onReorder: vi.fn(),
});

/** 按顺序取标签带上的图标槽位。 */
const tabIcons = () =>
  screen
    .getAllByTestId("file-tab")
    .map((tab) => tab.querySelector(".file-tab-icon"));

describe("桌面端：已打开文件的标签按类型取图标", () => {
  const FILES: OpenFileTab[] = [
    { id: "f1", path: "/work/src/LoginForm.tsx" },
    { id: "f2", path: "/work/src/styles/crimson.css" },
    { id: "f3", path: "/work/README.md" },
  ];

  it("每个标签的图标与文件名类型一致", () => {
    window.waveHostType = "desktop";
    render(<FileTabStrip {...tabProps(FILES)} />);
    expect(tabIcons().map(iconNameOf)).toEqual(["react", "css", "markdown"]);
  });

  it("图标盒仍是 16px（标签高 24px，行内不产生位移）", () => {
    window.waveHostType = "desktop";
    render(<FileTabStrip {...tabProps(FILES)} />);
    const svg = tabIcons()[0]!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });
});

describe("插件端：已打开文件的标签不接这套图标", () => {
  it("仍是 codicon 字形", () => {
    render(
      <FileTabStrip {...tabProps([{ id: "f1", path: "/work/src/app.ts" }])} />,
    );
    const slot = tabIcons()[0]!;
    expect(slot.tagName.toLowerCase()).toBe("i");
    expect(slot.className).toContain("codicon-file");
    expect(iconNameOf(slot)).toBeNull();
  });
});

// ─── 差异面板的文件树 ─────────────────────────────────────────────────────────

const diffFile = (path: string): WorkspaceDiffFile => ({
  path,
  status: "modified",
  additions: 2,
  deletions: 1,
  hunks: "",
  truncated: false,
  binary: false,
});

const DIFF_FILES = [
  diffFile("src/components/LoginForm.tsx"),
  diffFile("src/styles/crimson.css"),
  diffFile("package.json"),
];

const fileRowIconOf = (label: string) =>
  screen
    .getByText(label)
    .closest("[data-testid=diff-tree-file]")!
    .querySelector(".diff-tree-icon");

const dirRowIconOf = (label: string) =>
  screen
    .getByText(label)
    .closest("[data-testid=diff-tree-dir]")!
    .querySelector(".diff-tree-icon");

describe("桌面端：差异树文件行按类型取图标", () => {
  it("文件行解析出各自的图标，目录行仍是 FolderIcon", () => {
    window.waveHostType = "desktop";
    render(
      <DiffFileTree
        files={DIFF_FILES}
        selectedPath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(iconNameOf(fileRowIconOf("LoginForm.tsx"))).toBe("react");
    expect(iconNameOf(fileRowIconOf("crimson.css"))).toBe("css");
    expect(iconNameOf(fileRowIconOf("package.json"))).toBe("json");

    // 目录行不套类型图标：FolderIcon 是 stroke=currentColor 的线描。
    const dir = dirRowIconOf("src")!;
    expect(dir).not.toBeNull();
    expect(iconNameOf(dir)).toBeNull();
    expect(dir.getAttribute("stroke")).toBe("currentColor");
  });

  it("图标盒仍是 16px（行高 28px 不变）", () => {
    window.waveHostType = "desktop";
    render(
      <DiffFileTree
        files={DIFF_FILES}
        selectedPath={null}
        onSelect={vi.fn()}
      />,
    );
    const svg = fileRowIconOf("LoginForm.tsx")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });
});

describe("插件端：差异树文件行不接这套图标", () => {
  it("文件行与目录行都没有类型图标槽位", () => {
    render(
      <DiffFileTree
        files={DIFF_FILES}
        selectedPath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(fileRowIconOf("LoginForm.tsx")).toBeNull();
    expect(dirRowIconOf("src")).toBeNull();
  });
});

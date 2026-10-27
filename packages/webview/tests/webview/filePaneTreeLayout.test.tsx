import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { FilePane, type FilePaneProps } from "../../src/components/FilePane";
import type { FileViewState, OpenFileTab } from "../../src/types";

vi.mock("../../src/styles/FilePane.css", () => ({}));

/**
 * 树列的几何行为（spec desktop-file-panel.md「文件面板工作区目录树」场景 1-3）：
 * 正文保底、窄面板自动让位、拖到一半即收起、收起后的左缘拖拽带。
 *
 * 宽度靠桩 `clientWidth` 给（jsdom 没有布局），规则本身的分支值已在
 * `fileTreeLayout.test.ts` 里逐条断言，这里验的是「接进面板后真的照做」。
 */

const WORKDIR = "/work/a";

const fileView = (path: string): FileViewState => ({
  path,
  host: "local",
  content: "alpha one\nalpha two\n",
});

const openFile = (id: string, path: string): OpenFileTab => ({
  id,
  path,
  fileView: fileView(path),
});

const vscode = () =>
  ({
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  }) as unknown as FilePaneProps["vscode"];

const setBodyWidth = (width: number) => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
};

const renderPane = (props: Partial<FilePaneProps> = {}) => {
  const handlers = {
    onActivateFile: vi.fn(),
    onCloseFile: vi.fn(),
    onCloseOtherFiles: vi.fn(),
    onCloseFilesRight: vi.fn(),
    onCloseAllFiles: vi.fn(),
    onReorderFile: vi.fn(),
    onOpenFileInPanel: vi.fn(),
    onTreeVisibleChange: vi.fn(),
    onTreeWidthChange: vi.fn(),
  };
  const view = render(
    <FilePane
      files={[openFile("f1", "/work/a/src/app.ts")]}
      activeFileId="f1"
      width={480}
      workdir={WORKDIR}
      treeRoot={WORKDIR}
      vscode={vscode()}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
};

/** 从分隔条拖动：按下 → 移动 → 松开（document 上的监听才收得到）。 */
const dragTreeSplitter = (from: number, to: number) => {
  fireEvent.mouseDown(screen.getByTestId("file-pane-tree-splitter"), {
    clientX: from,
  });
  act(() => {
    fireEvent.mouseMove(document, { clientX: to });
    fireEvent.mouseUp(document);
  });
};

beforeEach(() => {
  setBodyWidth(0);
});

afterEach(() => {
  setBodyWidth(0);
  vi.restoreAllMocks();
});

describe("树列的宽度上限：正文保底（场景 2）", () => {
  it("面板够宽时按 MAX 夹住拖拽", () => {
    setBodyWidth(900);
    const handlers = renderPane({ treeWidth: 200 });
    dragTreeSplitter(200, 1200);
    expect(handlers.onTreeWidthChange).toHaveBeenCalledWith(420);
  });

  it("面板窄时以「正文保底」为上限，而不是 420", () => {
    setBodyWidth(500);
    const handlers = renderPane({ treeWidth: 200 });
    // 500 - 160 = 340
    dragTreeSplitter(200, 420);
    expect(handlers.onTreeWidthChange).toHaveBeenCalledWith(340);
  });

  it("树列按 props 的宽度渲染（宽度上限由上面的夹取负责）", () => {
    setBodyWidth(0);
    renderPane({ treeWidth: 240 });
    const col = screen.getByTestId("file-pane-tree-col");
    expect(col.style.width).toBe("240px");
  });
});

describe("窄面板自动让位（场景 3）", () => {
  it("有打开文件且面板不足 400px 时不渲染树，正文占满", () => {
    setBodyWidth(380);
    renderPane();
    expect(screen.queryByTestId("file-pane-tree-col")).not.toBeInTheDocument();
    expect(document.querySelector(".file-pane-content-col")).not.toBeNull();
  });

  it("让位时工具条开关画成不可用并写明原因，点击不翻转开关", () => {
    setBodyWidth(380);
    const handlers = renderPane();
    const toggle = screen.getByTestId("file-pane-tree-toggle");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-label", "面板过窄，加宽后显示文件树");
    // 「想要」没有被自动让位改写
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(handlers.onTreeVisibleChange).not.toHaveBeenCalled();
  });

  it("同一组 props、只有宽度变化时，树的显隐跟着宽度走", () => {
    setBodyWidth(380);
    const narrow = renderPane();
    expect(screen.queryByTestId("file-pane-tree-col")).not.toBeInTheDocument();
    // 只有宽度变了：同一组 props 重新挂载（jsdom 没有 ResizeObserver 可回声）
    narrow.unmount();
    setBodyWidth(420);
    renderPane();
    expect(screen.getByTestId("file-pane-tree-col")).toBeInTheDocument();
  });

  it("一个文件都没打开时树是主界面，窄也照样显示", () => {
    setBodyWidth(300);
    renderPane({ files: [], activeFileId: undefined });
    expect(screen.getByTestId("file-pane-tree-col")).toBeInTheDocument();
  });

  it("用户主动关掉树时，窄面板不报「让位」（没有「想要」可让）", () => {
    setBodyWidth(380);
    const handlers = renderPane({ treeVisible: false });
    const toggle = screen.getByTestId("file-pane-tree-toggle");
    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(handlers.onTreeVisibleChange).toHaveBeenCalledWith(true);
  });
});

describe("拖到一半即收起 + 左缘拖拽带（场景 1）", () => {
  it("分隔条拖到 80px 以下松手 = 收起树，不记住这个窄宽度", () => {
    setBodyWidth(900);
    const handlers = renderPane({ treeWidth: 200 });
    dragTreeSplitter(200, 40);
    expect(handlers.onTreeVisibleChange).toHaveBeenCalledWith(false);
    expect(handlers.onTreeWidthChange).not.toHaveBeenCalled();
  });

  it("没拖过收起阈值就是正常调宽", () => {
    setBodyWidth(900);
    const handlers = renderPane({ treeWidth: 200 });
    dragTreeSplitter(200, 260);
    expect(handlers.onTreeVisibleChange).not.toHaveBeenCalled();
    expect(handlers.onTreeWidthChange).toHaveBeenCalledWith(260);
  });

  it("树被关掉且面板放得下时，左缘有一条拖拽带，拖出来即恢复", () => {
    setBodyWidth(700);
    const handlers = renderPane({ treeVisible: false, treeWidth: 200 });
    const edge = screen.getByTestId("file-pane-tree-edge");
    fireEvent.mouseDown(edge, { clientX: 0 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 120 });
      fireEvent.mouseUp(document);
    });
    expect(handlers.onTreeVisibleChange).toHaveBeenCalledWith(true);
    expect(handlers.onTreeWidthChange).toHaveBeenCalledWith(140);
  });

  it("面板放不下时不给拖拽带（拖出来也没地方摆）", () => {
    setBodyWidth(350);
    renderPane({ treeVisible: false });
    expect(screen.queryByTestId("file-pane-tree-edge")).not.toBeInTheDocument();
  });
});

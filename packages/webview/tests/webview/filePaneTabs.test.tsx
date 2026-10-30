import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { FilePane, type FilePaneProps } from "../../src/components/FilePane";
import type { FileViewState, OpenFileTab } from "../../src/types";

vi.mock("../../src/styles/FilePane.css", () => ({}));

/**
 * 面板内多标签 / 查找跳行 / 复制路径（spec desktop-file-panel.md
 * 「文件面板已打开文件的标签」「文件面板内查找与跳行」）。
 *
 * 这些用例只驱动 FilePane：它拿到的就是 `files` + `activeFileId`（宿主侧状态由
 * ChatApp 拥有，另在 filePaneEdit/fileAutoRefresh 的集成用例里覆盖）。
 */

const fileView = (
  path: string,
  content = "alpha one\nalpha two\n",
): FileViewState => ({ path, host: "local", content });

const openFile = (id: string, path: string, content?: string): OpenFileTab => ({
  id,
  path,
  fileView: fileView(path, content),
});

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
      files={[
        openFile("f1", "/work/a/src/app.ts"),
        openFile("f2", "/work/a/src/util.ts"),
      ]}
      activeFileId="f1"
      width={480}
      workdir="/work/a"
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("文件面板已打开文件的标签（spec 场景 1-14）", () => {
  it("每个已打开文件一格，激活的那格有激活态（场景 1/2）", () => {
    renderPane();
    const tabs = screen.getAllByTestId("file-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("app.ts");
    expect(tabs[1]).toHaveTextContent("util.ts");
    expect(tabs[0].className).toContain("file-tab--active");
    expect(tabs[1].className).not.toContain("file-tab--active");
  });

  it("同名文件追加最短可区分目录后缀，不铺整条路径（场景 4）", () => {
    renderPane({
      files: [
        openFile("f1", "/work/a/src/index.ts"),
        openFile("f2", "/work/a/test/index.ts"),
      ],
      activeFileId: "f1",
    });
    const tabs = screen.getAllByTestId("file-tab");
    // 名字 + 灰色后缀（读屏念作「index.ts, src」），而不是两个一样的 index.ts。
    expect(tabs[0]).toHaveTextContent("index.ts, src");
    expect(tabs[1]).toHaveTextContent("index.ts, test");
    // 目录部分不占标签宽度：绝对路径一个字符都不进标签。
    expect(tabs[0].textContent).not.toContain("/work/a");
    expect(tabs[1].textContent).not.toContain("/work/a");
    // 悬浮给相对路径。
    expect(tabs[0]).toHaveAttribute("title", "src/index.ts");
  });

  it("唯一文件名只显示文件名、不带后缀（场景 4）", () => {
    renderPane();
    const tabs = screen.getAllByTestId("file-tab");
    expect(tabs[0]).toHaveTextContent(/^app\.ts$/);
    expect(tabs[1]).toHaveTextContent(/^util\.ts$/);
  });

  it("点一格是激活它（场景 4）", () => {
    const handlers = renderPane();
    fireEvent.click(screen.getAllByTestId("file-tab")[1]);
    expect(handlers.onActivateFile).toHaveBeenCalledWith("f2");
  });

  it("× 关掉那一格（场景 5）", () => {
    const handlers = renderPane();
    fireEvent.click(screen.getAllByTestId("file-tab-close")[1]);
    expect(handlers.onCloseFile).toHaveBeenCalledWith("f2");
  });

  it("右键菜单给出四种关闭方式（场景 6）", () => {
    const handlers = renderPane();
    fireEvent.contextMenu(screen.getAllByTestId("file-tab")[0]);
    expect(screen.getByTestId("file-tab-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByText("关闭其他"));
    expect(handlers.onCloseOtherFiles).toHaveBeenCalledWith("f1");

    fireEvent.contextMenu(screen.getAllByTestId("file-tab")[0]);
    fireEvent.click(screen.getByText("关闭右侧"));
    expect(handlers.onCloseFilesRight).toHaveBeenCalledWith("f1");

    fireEvent.contextMenu(screen.getAllByTestId("file-tab")[0]);
    fireEvent.click(screen.getByText("全部关闭"));
    expect(handlers.onCloseAllFiles).toHaveBeenCalled();

    // 菜单点完就收起
    expect(screen.queryByTestId("file-tab-menu")).toBeNull();
  });

  it("Delete / Backspace 关掉激活的那一格（场景 7）", () => {
    const handlers = renderPane();
    const active = screen.getAllByTestId("file-tab")[0];
    fireEvent.keyDown(active, { key: "Delete" });
    expect(handlers.onCloseFile).toHaveBeenCalledWith("f1");
    fireEvent.keyDown(active, { key: "Backspace" });
    expect(handlers.onCloseFile).toHaveBeenCalledTimes(2);
  });

  it("Ctrl/Cmd+Shift+←/→ 把标签左右挪一格（场景 8）", () => {
    const handlers = renderPane();
    const tab = screen.getAllByTestId("file-tab")[0];
    fireEvent.keyDown(tab, {
      key: "ArrowRight",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(handlers.onReorderFile).toHaveBeenCalledWith("f1", 1);
    fireEvent.keyDown(tab, { key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    expect(handlers.onReorderFile).toHaveBeenCalledWith("f1", -1);
  });

  it("只有一个文件时不显示「更多文件」（场景 9）", () => {
    renderPane({ files: [openFile("f1", "/work/a/src/app.ts")] });
    expect(screen.queryByTestId("file-tab-more")).toBeNull();
  });

  it("有标签但没有激活文件时给「未选择文件」，不是列表（场景 14）", () => {
    renderPane({ activeFileId: undefined, conversationFiles: [] });
    expect(screen.getByTestId("file-pane-empty-no-active")).toHaveTextContent(
      "未选择文件",
    );
    expect(screen.queryByTestId("file-pane-empty-none")).toBeNull();
  });

  it("一个文件都没打开时给空态引导（场景 14）", () => {
    renderPane({ files: [], activeFileId: undefined });
    // 1030 评论：标题行「打开的文件会显示在这里」已拿掉，只留引导句。
    expect(screen.getByTestId("file-pane-empty-none")).toHaveTextContent(
      "点击目录树中的文件，或点击消息里的文件路径",
    );
    expect(screen.queryByTestId("file-pane-empty-no-active")).toBeNull();
  });

  it("已删除的文件：内容区提示 + 「关闭标签」（场景 13）", () => {
    const handlers = renderPane({
      files: [{ id: "f1", path: "/work/a/src/gone.ts", deleted: true }],
      activeFileId: "f1",
    });
    expect(screen.getByTestId("file-pane-deleted")).toHaveTextContent(
      "文件已不存在",
    );
    fireEvent.click(screen.getByTestId("file-pane-deleted-close"));
    expect(handlers.onCloseFile).toHaveBeenCalledWith("f1");
  });
});

describe("文件面板内查找与跳行（spec 场景 1-9）", () => {
  const CONTENT = "alpha one\nalpha two\nalpha three\n";

  it("工具条的查找按钮打开查找条，焦点进输入框（场景 1）", () => {
    renderPane({ files: [openFile("f1", "/work/a/src/app.ts", CONTENT)] });
    expect(screen.queryByTestId("file-pane-find")).toBeNull();
    fireEvent.click(screen.getByTestId("file-pane-find-trigger"));
    const input = screen.getByTestId("file-pane-find-input");
    expect(input).toHaveFocus();
  });

  it("Ctrl/Cmd+F 打开查找条，Esc 关闭（场景 1/5）", () => {
    renderPane({ files: [openFile("f1", "/work/a/src/app.ts", CONTENT)] });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.getByTestId("file-pane-find")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("file-pane-find-input"), {
      key: "Escape",
    });
    expect(screen.queryByTestId("file-pane-find")).toBeNull();
  });

  it("输入关键字给出命中数，并把命中的文本标成高亮（场景 2）", () => {
    const { container } = renderPane({
      files: [openFile("f1", "/work/a/src/app.ts", CONTENT)],
    });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByTestId("file-pane-find-input"), {
      target: { value: "two" },
    });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/1");
    const hits = container.querySelectorAll(".file-pane-find-hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toHaveTextContent("two");
  });

  it("回车 / Shift+回车在命中之间跳，并跟着滚到那一行（场景 2/3）", () => {
    const { container } = renderPane({
      files: [openFile("f1", "/work/a/src/app.ts", CONTENT)],
    });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByTestId("file-pane-find-input");
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/3");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("2/3");
    expect(
      container.querySelectorAll(".file-pane-find-hit--current"),
    ).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/3");
  });

  it("区分大小写 / 全词 / 正则三个开关（场景 4）", () => {
    const { container } = renderPane({
      files: [openFile("f1", "/work/a/src/app.ts", "Alpha\nalpha\nbeta\n")],
    });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByTestId("file-pane-find-input");
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/2");

    // 区分大小写：只剩小写那一处。
    fireEvent.click(screen.getByTestId("file-pane-find-case"));
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/1");

    // 全词：`bet` 在 `beta` 里不算整词命中。
    fireEvent.click(screen.getByTestId("file-pane-find-case"));
    fireEvent.change(input, { target: { value: "bet" } });
    fireEvent.click(screen.getByTestId("file-pane-find-word"));
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent(
      "无匹配结果",
    );

    // 正则：`a\w+` 命中 alpha / Alpha / beta 里的词。
    fireEvent.click(screen.getByTestId("file-pane-find-word"));
    fireEvent.click(screen.getByTestId("file-pane-find-regex"));
    fireEvent.change(input, { target: { value: "a\\w+" } });
    expect(
      container.querySelectorAll(".file-pane-find-hit").length,
    ).toBeGreaterThan(0);
  });

  it("非法正则给出可读提示、不崩（场景 3）", () => {
    renderPane({ files: [openFile("f1", "/work/a/src/app.ts", CONTENT)] });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.click(screen.getByTestId("file-pane-find-regex"));
    fireEvent.change(screen.getByTestId("file-pane-find-input"), {
      target: { value: "a(" },
    });
    expect(screen.getByTestId("file-pane-find-count").textContent).toContain(
      "正则表达式无效",
    );
  });

  it("跳行：合法行号滚到那一行，越界给范围提示（场景 7/8）", () => {
    const { container } = renderPane({
      files: [
        openFile(
          "f1",
          "/work/a/src/app.ts",
          Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n") +
            "\n",
        ),
      ],
    });
    fireEvent.click(screen.getByTestId("file-pane-find-trigger"));
    const goto = screen.getByTestId("file-pane-goto-input");

    fireEvent.change(goto, { target: { value: "999" } });
    fireEvent.keyDown(goto, { key: "Enter" });
    expect(screen.getByTestId("file-pane-goto-error")).toHaveTextContent(
      "有效范围 1-80",
    );

    fireEvent.change(goto, { target: { value: "60" } });
    fireEvent.keyDown(goto, { key: "Enter" });
    expect(screen.queryByTestId("file-pane-goto-error")).toBeNull();
    const body = container.querySelector(".file-pane-scroll") as HTMLElement;
    expect(body.scrollTop).toBeGreaterThan(0);
  });

  it("markdown/图片这类没有行概念的视图不打开查找（场景 6）", () => {
    renderPane({
      files: [
        {
          id: "f1",
          path: "/work/a/logo.png",
          fileView: {
            path: "/work/a/logo.png",
            host: "local",
            imageBase64: "data:image/png;base64,AAAA",
          },
        },
      ],
      activeFileId: "f1",
    });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.queryByTestId("file-pane-find")).toBeNull();
  });

  it("换文件时命中计数与高亮不残留（场景 9）", () => {
    const { container, rerender } = renderPane({
      files: [openFile("f1", "/work/a/src/app.ts", CONTENT)],
    });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByTestId("file-pane-find-input"), {
      target: { value: "alpha" },
    });
    expect(screen.getByTestId("file-pane-find-count")).toHaveTextContent("1/3");

    rerender(
      <FilePane
        files={[openFile("f1", "/work/a/src/other.ts", "nothing here\n")]}
        activeFileId="f1"
        width={480}
        workdir="/work/a"
      />,
    );
    expect(container.querySelectorAll(".file-pane-find-hit")).toHaveLength(0);
  });
});

describe("文件面板工具条：复制路径与目录树开关（spec 场景 8、目录树场景 1）", () => {
  it("复制路径写进剪贴板的是完整路径", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPane({ files: [openFile("f1", "/work/a/src/app.ts")] });
    await act(async () => {
      fireEvent.click(screen.getByTestId("file-copy-path"));
    });
    expect(writeText).toHaveBeenCalledWith("/work/a/src/app.ts");
  });

  it("目录树开关按 aria-pressed 反映可见状态", () => {
    const handlers = renderPane({ treeRoot: "/work/a", treeVisible: true });
    const toggle = screen.getByTestId("file-pane-tree-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(handlers.onTreeVisibleChange).toHaveBeenCalledWith(false);
  });

  it("「在文件树中显示」逐级展开父目录并滚到那一行（场景 6）", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: vi.fn(),
      setState: vi.fn(),
    };
    renderPane({
      files: [openFile("f1", "/work/a/src/deep/app.ts")],
      treeRoot: "/work/a",
      vscode,
      onTreeVisibleChange: vi.fn(),
    });
    // 根目录已经请求过；点「在文件树中显示」要连子目录一起补齐。
    fireEvent.click(screen.getByTestId("file-pane-reveal-in-tree"));
    const requested = vscode.postMessage.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg.command === "desktopListDirectory")
      .map((msg) => msg.path);
    expect(requested).toEqual(
      expect.arrayContaining(["/work/a", "/work/a/src", "/work/a/src/deep"]),
    );
  });
});

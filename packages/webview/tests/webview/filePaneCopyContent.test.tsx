import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { FilePane, type FilePaneProps } from "../../src/components/FilePane";
import type { FileViewState } from "../../src/types";

vi.mock("../../src/styles/FilePane.css", () => ({}));

// 编辑器的真实实现在另行构建的 editor.js chunk 里（CodeMirror），jsdom 注入不了；
// 面板只经 path/initialValue/onChange/onSave 与它打交道，用 textarea 顶上。
vi.mock("../../src/components/fileEditor/FileEditor", () => ({
  FileEditor: ({
    path,
    initialValue,
    onChange,
  }: {
    path: string;
    initialValue: string;
    onChange: (value: string) => void;
    onSave: () => void;
  }) => (
    <div data-testid="file-pane-editor" data-path={path}>
      <textarea
        data-testid="file-pane-editor-textarea"
        defaultValue={initialValue}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));

/**
 * 工具条的「复制文件内容」（spec desktop-file-panel.md 场景 23–25）。
 *
 * 与「复制路径」是两颗独立按钮：这里只断言复制进剪贴板的是**内容**，路径那条
 * 在 filePaneTabs.test.tsx 里。
 */

const renderPane = (
  fileView: Partial<FileViewState> = {},
  props: Partial<FilePaneProps> = {},
) => {
  const onToast = vi.fn();
  const path = fileView.path ?? "/work/a/src/app.ts";
  const view = render(
    <FilePane
      files={[
        {
          id: "f1",
          path,
          fileView: {
            path,
            host: "local",
            content: "alpha\nbeta\n",
            ...fileView,
          },
        },
      ]}
      activeFileId="f1"
      width={480}
      workdir="/work/a"
      onToast={onToast}
      {...props}
    />,
  );
  return { ...view, onToast };
};

const stubClipboard = (writeText: ReturnType<typeof vi.fn>) => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
};

const clickCopy = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("file-copy-content"));
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("文件面板工具条：复制文件内容（spec 场景 23–25）", () => {
  it("把面板里的完整内容写进剪贴板并提示成功（场景 23）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { onToast } = renderPane();
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith("alpha\nbeta\n");
    expect(onToast).toHaveBeenCalledWith("内容已复制", "success");
  });

  it("markdown 复制的是源文本，不是渲染后的文字（场景 24）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderPane({
      path: "/work/a/doc/notes.md",
      content: "# 标题\n\n- 一项\n",
    });
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith("# 标题\n\n- 一项\n");
  });

  it("截断的文件只复制已加载内容，提示里说清楚（场景 24）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { onToast } = renderPane({ truncated: true, totalLines: 5000 });
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith("alpha\nbeta\n");
    expect(onToast).toHaveBeenCalledWith(
      "内容已复制（文件已截断，仅复制已加载内容）",
      "success",
    );
  });

  it("编辑态复制编辑器当前值（含未保存修改），不是磁盘旧内容（场景 25）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { onToast } = renderPane({
      content: "alpha\nbeta\n",
      editable: true,
      contentHash: "hash-1",
      draft: "alpha\nbeta\nedited\n",
    });
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith("alpha\nbeta\nedited\n");
    expect(onToast).toHaveBeenCalledWith("内容已复制", "success");
  });

  it("剪贴板两路都失败时给失败提示，不谎报成功（场景 23）", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const { onToast } = renderPane();
    await clickCopy();
    expect(onToast).toHaveBeenCalledWith("复制失败，请手动复制", "error");
  });

  it("图片、读取失败、没有内容的文件不出现这颗按钮（场景 24）", () => {
    for (const fileView of [
      {
        path: "/work/a/pic.png",
        host: "local",
        content: undefined,
        imageBase64: "data:image/png;base64,AA",
      },
      {
        path: "/work/a/src/broken.ts",
        host: "local",
        content: undefined,
        error: "读不到",
      },
      { path: "/work/a/src/empty.ts", host: "local", content: "" },
    ] satisfies FileViewState[]) {
      const { unmount } = renderPane(fileView);
      expect(screen.queryByTestId("file-copy-content")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("有内容时与「复制路径」并列出现", () => {
    renderPane();
    expect(screen.getByTestId("file-copy-content")).toBeInTheDocument();
    expect(screen.getByTestId("file-copy-path")).toBeInTheDocument();
  });
});

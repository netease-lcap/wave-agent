import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { FilePane } from "../../src/components/FilePane";
import type { FilePaneProps } from "../../src/components/FilePane";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import { READ_TOOL_NAME, WRITE_TOOL_NAME } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";
import { createMockVscode, sendCommand, sendHostMessage } from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import type { FileViewState } from "../../src/types";

// The editor itself is CodeMirror loaded from a separately built chunk
// (editor.js); jsdom cannot inject it. The panel only talks to it through
// path/initialValue/onChange/onSave, so a textarea stands in.
vi.mock("../../src/components/fileEditor/FileEditor", () => ({
  FileEditor: ({
    path,
    initialValue,
    onChange,
    onSave,
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
      <button
        type="button"
        data-testid="file-pane-editor-save-key"
        onClick={onSave}
      />
    </div>
  ),
}));

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

const baseFileView = (
  overrides: Partial<FileViewState> = {},
): FileViewState => ({
  path: "/work/a/src/app.ts",
  host: "local",
  content: "alpha one",
  editable: true,
  contentHash: "hash-1",
  ...overrides,
});

const renderPane = (
  fileView: FileViewState | null,
  overrides: Partial<FilePaneProps> = {},
) => {
  const handlers = {
    onStartEdit: vi.fn(),
    onDraftChange: vi.fn(),
    onSaveDraft: vi.fn(),
    onCancelEdit: vi.fn(),
    onReloadDraft: vi.fn(),
    onAddComment: vi.fn(),
  };
  const view = render(
    <FilePane
      fileView={fileView}
      width={400}
      workdir="/work/a"
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, ...view };
};

const typeInEditor = (value: string) =>
  fireEvent.change(screen.getByTestId("file-pane-editor-textarea"), {
    target: { value },
  });

describe("FilePane 面板内编辑（spec desktop-file-panel.md）", () => {
  it("只在宿主说可写时给出编辑入口（场景 1/2）", () => {
    const { unmount } = renderPane(baseFileView());
    expect(screen.getByTestId("file-pane-edit")).toBeInTheDocument();
    unmount();

    // 远端会话 / 工作目录外 / 截断 / 二进制 / 图片 / 读取失败：宿主一律不给
    // `editable`，面板连入口都不出现。
    renderPane(baseFileView({ editable: false }));
    expect(screen.queryByTestId("file-pane-edit")).toBeNull();
  });

  it("截断的文件不给编辑入口（写回会毁掉后半截）", () => {
    renderPane(baseFileView({ truncated: true }));
    expect(screen.queryByTestId("file-pane-edit")).toBeNull();
  });

  it("点编辑是显式动作，编辑态换成「取消 / 保存」并隐藏行评论入口（场景 1/3/12）", () => {
    const handlers = renderPane(baseFileView());
    fireEvent.click(screen.getByTestId("file-pane-edit"));
    expect(handlers.onStartEdit).toHaveBeenCalled();

    handlers.rerender(
      <FilePane
        fileView={baseFileView({ draft: "alpha one" })}
        width={400}
        workdir="/work/a"
        {...handlers}
      />,
    );

    expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("file-pane-edit")).toBeNull();
    expect(screen.getByTestId("file-pane-edit-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("file-pane-edit-save")).toBeInTheDocument();
    // 只读正文整块被编辑器替换：行评论 / 块评论入口都不在了。
    expect(screen.queryByTestId("line-comment-add-1")).toBeNull();
  });

  it("保存把编辑器此刻的全文交上去（不是慢一步的状态镜像）", () => {
    const handlers = renderPane(baseFileView({ draft: "alpha one" }));
    typeInEditor("alpha two");
    expect(handlers.onDraftChange).toHaveBeenCalledWith("alpha two");

    fireEvent.click(screen.getByTestId("file-pane-edit-save"));
    expect(handlers.onSaveDraft).toHaveBeenCalledWith("alpha two");
  });

  it("编辑器里的 Cmd/Ctrl+S 与工具条保存同一条路径", () => {
    const handlers = renderPane(baseFileView({ draft: "alpha one" }));
    typeInEditor("typed");
    fireEvent.click(screen.getByTestId("file-pane-editor-save-key"));
    expect(handlers.onSaveDraft).toHaveBeenCalledWith("typed");
  });

  it("取消交给宿主（有未保存修改时由它先弹确认）", () => {
    const handlers = renderPane(baseFileView({ draft: "alpha edited" }));
    fireEvent.click(screen.getByTestId("file-pane-edit-cancel"));
    expect(handlers.onCancelEdit).toHaveBeenCalled();
  });

  it("磁盘已更新：提示 + 「覆盖 / 重新加载」两个动作（场景 7/8）", () => {
    const handlers = renderPane(
      baseFileView({ draft: "alpha mine", diskChanged: true }),
    );
    expect(screen.getByTestId("file-pane-disk-changed")).toBeInTheDocument();
    // 覆盖 = 按新哈希再写一次（与工具条保存同一条路径）。
    typeInEditor("alpha mine");
    fireEvent.click(screen.getByTestId("file-pane-overwrite"));
    expect(handlers.onSaveDraft).toHaveBeenCalledWith("alpha mine");
    fireEvent.click(screen.getByTestId("file-pane-reload"));
    expect(handlers.onReloadDraft).toHaveBeenCalled();
  });

  it("保存失败：原因可读、草稿还在（场景 10）", () => {
    renderPane(
      baseFileView({ draft: "alpha mine", saveError: "没有写入权限" }),
    );
    expect(screen.getByTestId("file-pane-save-error")).toHaveTextContent(
      "没有写入权限",
    );
    expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 桌面端集成：保存回包、草稿保护与离开前的确认
// ---------------------------------------------------------------------------

const richText = (path: string): Record<string, unknown> => ({
  fileView: baseFileView({ path }),
});

function renderDesktop() {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const openFilePanel = () => {
  fireEvent.click(screen.getByTestId("panel-toggle-btn"));
  fireEvent.click(screen.getByTestId("panel-empty-item-file"));
  expect(screen.getByTestId("file-pane")).toBeInTheDocument();
};

const messagesOf = (
  vscode: ReturnType<typeof createMockVscode>,
  command: string,
) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === command)
    .map(([msg]) => msg);

const readToolMessage = (path: string): Message =>
  ({
    id: "m-read",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        id: "t-read",
        name: READ_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: JSON.stringify({ file_path: path }),
      },
    ],
  }) as unknown as Message;

const writeToolMessage = (path: string, stage: string): Message =>
  ({
    id: "m-write",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        id: "t-write",
        name: WRITE_TOOL_NAME,
        stage,
        success: stage === "end" ? true : undefined,
        parameters: JSON.stringify({ file_path: path }),
      },
    ],
  }) as unknown as Message;

const enterEdit = (draftText: string) => {
  fireEvent.click(screen.getByTestId("file-pane-edit"));
  expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
  if (draftText) typeInEditor(draftText);
};

/** The dialog's answer resolves a Promise, so its continuation runs a tick
 *  later — every caller awaits this. */
const answerDiscard = async (label: "放弃" | "继续编辑") => {
  await act(async () => {
    fireEvent.click(screen.getByText(label));
  });
};

beforeEach(() => {
  prunePanelGroupCache(new Set());
});

afterEach(() => {
  delete window.waveHostType;
});

describe("桌面端面板保存链路", () => {
  it("保存成功：退出编辑态、正文换成新内容并给出「已保存」（场景 4）", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));
    expect(screen.getByText("alpha one")).toBeInTheDocument();

    enterEdit("alpha two");
    fireEvent.click(screen.getByTestId("file-pane-edit-save"));

    const [save] = messagesOf(vscode, "desktopSaveFile");
    expect(save).toMatchObject({
      path: "/work/a/src/app.ts",
      content: "alpha two",
      contentHash: "hash-1",
    });

    act(() => {
      sendCommand("desktopFileSaveResult", {
        requestId: save.requestId,
        status: "saved",
        contentHash: "hash-2",
      });
    });

    expect(screen.queryByTestId("file-pane-editor")).toBeNull();
    expect(screen.getByText("alpha two")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("没改内容时保存不写盘，直接退出编辑态（场景 4）", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));

    enterEdit("");
    fireEvent.click(screen.getByTestId("file-pane-edit-save"));

    expect(messagesOf(vscode, "desktopSaveFile")).toHaveLength(0);
    expect(screen.queryByTestId("file-pane-editor")).toBeNull();
  });

  it("磁盘被改过：不覆盖，提示后由用户选覆盖或重新加载（场景 7）", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));

    enterEdit("alpha mine");
    fireEvent.click(screen.getByTestId("file-pane-edit-save"));
    const [save] = messagesOf(vscode, "desktopSaveFile");

    act(() => {
      sendCommand("desktopFileSaveResult", {
        requestId: save.requestId,
        status: "conflict",
        message: "文件已在磁盘上更新",
        contentHash: "hash-disk",
      });
    });

    // 草稿还在、仍在编辑态，并给出两个动作。
    expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
    expect(screen.getByTestId("file-pane-disk-changed")).toBeInTheDocument();

    // 「覆盖」按回包里的磁盘哈希再写一次。
    fireEvent.click(screen.getByTestId("file-pane-overwrite"));
    const saves = messagesOf(vscode, "desktopSaveFile");
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({
      content: "alpha mine",
      contentHash: "hash-disk",
    });
  });

  it("写盘失败：提示原因、草稿完整保留（场景 10）", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));

    enterEdit("alpha mine");
    fireEvent.click(screen.getByTestId("file-pane-edit-save"));
    const [save] = messagesOf(vscode, "desktopSaveFile");

    act(() => {
      sendCommand("desktopFileSaveResult", {
        requestId: save.requestId,
        status: "error",
        message: "保存失败：磁盘空间不足",
      });
    });

    expect(screen.getByTestId("file-pane-save-error")).toHaveTextContent(
      "保存失败：磁盘空间不足",
    );
    expect(
      (screen.getByTestId("file-pane-editor-textarea") as HTMLTextAreaElement)
        .value,
    ).toBe("alpha mine");
  });
});

describe("桌面端面板草稿守卫", () => {
  it("有未保存修改时打开另一个文件先确认；「继续编辑」什么都不变（场景 6）", async () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.setInitialState({
        messages: [readToolMessage("/work/a/src/other.ts")],
        workdir: "/work/a",
      }),
    );
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));
    enterEdit("alpha mine");

    const before = messagesOf(vscode, "openFile").length;
    act(() => {
      fireEvent.click(
        document.querySelector(".write-tool-path") as HTMLElement,
      );
    });

    expect(screen.getByText("放弃未保存的修改？")).toBeInTheDocument();
    expect(messagesOf(vscode, "openFile")).toHaveLength(before);

    await answerDiscard("继续编辑");
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    expect(messagesOf(vscode, "openFile")).toHaveLength(before);
    expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
  });

  it("确认「放弃」后草稿丢弃、原操作继续执行（场景 5/6）", async () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.setInitialState({
        messages: [readToolMessage("/work/a/src/other.ts")],
        workdir: "/work/a",
      }),
    );
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));
    enterEdit("alpha mine");

    const before = messagesOf(vscode, "openFile").length;
    act(() => {
      fireEvent.click(
        document.querySelector(".write-tool-path") as HTMLElement,
      );
    });
    await answerDiscard("放弃");

    await act(async () => {}); // flush the guard's post-dialog continuation
    const posts = messagesOf(vscode, "openFile");
    expect(posts).toHaveLength(before + 1);
    expect(posts[posts.length - 1]).toMatchObject({
      path: "/work/a/src/other.ts",
    });
  });

  it("清除草稿的取消不弹确认，有修改的取消才弹（场景 5）", async () => {
    window.waveHostType = "desktop";
    renderDesktop();
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));

    enterEdit("");
    fireEvent.click(screen.getByTestId("file-pane-edit-cancel"));
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    expect(screen.queryByTestId("file-pane-editor")).toBeNull();

    enterEdit("alpha mine");
    fireEvent.click(screen.getByTestId("file-pane-edit-cancel"));
    expect(screen.getByText("放弃未保存的修改？")).toBeInTheDocument();
    await answerDiscard("放弃");
    expect(screen.queryByTestId("file-pane-editor")).toBeNull();
  });

  it("agent 写入时不覆盖草稿，只标「磁盘已更新」（场景 8）", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    sendHostMessage(
      fixtures.setInitialState({
        messages: [writeToolMessage("/work/a/src/app.ts", "streaming")],
        workdir: "/work/a",
      }),
    );
    openFilePanel();
    sendCommand("desktopFileContent", richText("/work/a/src/app.ts"));
    enterEdit("alpha mine");
    const before = messagesOf(vscode, "openFile").length;

    act(() => {
      sendCommand("updateToolBlock", {
        params: {
          messageId: "m-write",
          id: "t-write",
          name: WRITE_TOOL_NAME,
          stage: "end",
          success: true,
          parameters: JSON.stringify({ file_path: "/work/a/src/app.ts" }),
        },
      });
    });

    // 没重读（不会吞掉草稿），只把「磁盘变了」告诉面板。
    expect(messagesOf(vscode, "openFile")).toHaveLength(before);
    expect(screen.getByTestId("file-pane-disk-changed")).toBeInTheDocument();
    expect(screen.getByTestId("file-pane-editor")).toBeInTheDocument();
  });
});

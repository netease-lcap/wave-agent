import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from "wave-agent-sdk";
import {
  createMockVscode,
  openFileInDesktopPanel,
  sendCommand,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import {
  collectWriteEditBlocks,
  extractToolTargetPath,
  pathsMatch,
} from "../../src/utils/fileAutoRefresh";
import type { Message } from "wave-agent-sdk";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/** Build a minimal assistant message carrying one Write/Edit tool block. */
const messageWithTool = (
  messageId: string,
  block: {
    id: string;
    name: string;
    stage: "start" | "streaming" | "running" | "end";
    success?: boolean;
    parameters?: string;
  },
): Message =>
  ({
    id: messageId,
    role: "assistant",
    blocks: [{ type: "tool", ...block }],
  }) as unknown as Message;

function renderDesktop(options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({
      workdir: options?.workdir,
      recentWorkdirs: options?.workdir ? [options.workdir] : [],
    }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const openFilePosts = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === "openFile")
    .map(([msg]) => msg);

const toolParams = (parameters: string) =>
  JSON.stringify({ file_path: parameters });

beforeEach(() => {
  prunePanelGroupCache(new Set());
});

afterEach(() => {
  delete window.waveHostType;
});

describe("fileAutoRefresh utils", () => {
  it("collectWriteEditBlocks returns Write/Edit blocks with stage, success and target path", () => {
    const messages = [
      messageWithTool("m1", {
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: toolParams("/work/a/src/a.ts"),
      }),
      messageWithTool("m2", {
        id: "t2",
        name: EDIT_TOOL_NAME,
        stage: "running",
      }),
    ];
    const refs = collectWriteEditBlocks(messages);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      messageId: "m1",
      blockId: "t1",
      stage: "end",
      success: true,
      targetPath: "/work/a/src/a.ts",
    });
    expect(refs[1]).toMatchObject({ blockId: "t2", stage: "running" });
  });

  it("collectWriteEditBlocks skips non-Write/Edit tools and id-less blocks", () => {
    const messages = [
      messageWithTool("m1", {
        id: "t1",
        name: "Read",
        stage: "end",
        success: true,
      }),
      {
        id: "m2",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: WRITE_TOOL_NAME,
            stage: "end",
            success: true,
          },
        ],
      },
    ] as unknown as Message[];
    expect(collectWriteEditBlocks(messages)).toHaveLength(0);
  });

  it("extractToolTargetPath parses file_path and tolerates bad JSON", () => {
    const block = messageWithTool("m1", {
      id: "t1",
      name: WRITE_TOOL_NAME,
      stage: "end",
      success: true,
      parameters: toolParams("src/a.ts"),
    }).blocks[0];
    expect(extractToolTargetPath(block as never)).toBe("src/a.ts");
    expect(
      extractToolTargetPath({
        type: "tool",
        parameters: "{not json",
      } as never),
    ).toBeUndefined();
    expect(extractToolTargetPath({ type: "tool" } as never)).toBeUndefined();
  });

  it("pathsMatch matches exact spellings, separator variants and relative-vs-absolute", () => {
    expect(pathsMatch("/work/a/src/a.ts", "/work/a/src/a.ts")).toBe(true);
    expect(pathsMatch("src\\a.ts", "src/a.ts")).toBe(true);
    expect(pathsMatch("src/a.ts", "/work/a/src/a.ts", "/work/a")).toBe(true);
    expect(pathsMatch("src/b.ts", "/work/a/src/a.ts", "/work/a")).toBe(false);
    // No workdir: a relative tool path cannot be reconciled with an absolute panel path.
    expect(pathsMatch("src/a.ts", "/work/a/src/a.ts")).toBe(false);
    // Case-sensitive by design (remote hosts may differ in case).
    expect(pathsMatch("/Work/A/Src/A.TS", "/work/a/src/a.ts")).toBe(false);
  });

  // specs/desktop/desktop-file-panel.md 场景 7 —— `..` 残留不得导致比对失败
  it("pathsMatch reconciles `..` in either side against the workdir", () => {
    expect(
      pathsMatch("/work/b/src/a.ts", "/work/a/../b/src/a.ts", "/work/a"),
    ).toBe(true);
    expect(pathsMatch("../b/src/a.ts", "/work/b/src/a.ts", "/work/a")).toBe(
      true,
    );
    expect(pathsMatch("./src/a.ts", "/work/a/src/a.ts", "/work/a")).toBe(true);
    // Different file: collapsing must not manufacture a match.
    expect(
      pathsMatch("/work/b/src/b.ts", "/work/a/../b/src/a.ts", "/work/a"),
    ).toBe(false);
  });
});

describe("ChatApp desktop file-panel auto refresh", () => {
  it("re-reads the panel's file when a Write on it completes (spec 场景 1)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("/work/a/src/a.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel(
      "/work/a/src/a.ts",
      { content: "old content" },
      "/work/a",
    );
    expect(screen.getByText("old content")).toBeInTheDocument();
    const before = openFilePosts(vscode).length;

    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });

    const posts = openFilePosts(vscode);
    expect(posts).toHaveLength(before + 1);
    expect(posts[0]).toMatchObject({
      command: "openFile",
      path: "/work/a/src/a.ts",
      host: "local",
    });
    // Soft refresh: old content stays until the host reply lands.
    expect(screen.getByText("old content")).toBeInTheDocument();
  });

  it("matches a relative tool path against the absolute panel path via workdir", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: EDIT_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("src/a.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    const before = openFilePosts(vscode).length;

    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: EDIT_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: toolParams("src/a.ts"),
      },
    });

    expect(openFilePosts(vscode)).toHaveLength(before + 1);
  });

  it("does not refresh for a Write on a different file (spec 场景 3)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("/work/a/src/b.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    const before = openFilePosts(vscode).length;

    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: toolParams("/work/a/src/b.ts"),
      },
    });

    expect(openFilePosts(vscode)).toHaveLength(before);
  });

  it("does not refresh on failure (spec 场景 4)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("/work/a/src/a.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    const before = openFilePosts(vscode).length;

    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: false,
        error: "denied",
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });

    expect(openFilePosts(vscode)).toHaveLength(before);
  });

  it("does not refresh mid-execution, only once on completion (spec 场景 5)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("/work/a/src/a.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    const before = openFilePosts(vscode).length;

    // Still running → no refresh.
    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "running",
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });
    expect(openFilePosts(vscode)).toHaveLength(before);

    // Completed → exactly one refresh, and a repeated end-state update (e.g.
    // result enrichment) must not fire a second one.
    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });
    expect(openFilePosts(vscode)).toHaveLength(before + 1);
    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        result: "enriched",
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });
    expect(openFilePosts(vscode)).toHaveLength(before + 1);
  });

  it("never refreshes for blocks already completed in loaded history", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    // History arrives fully completed (session restore).
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "end",
            success: true,
            parameters: toolParams("/work/a/src/a.ts"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    const before = openFilePosts(vscode).length;
    // Even a repeated end-state update after the panel is open must not fire.
    sendCommand("updateToolBlock", {
      params: {
        messageId: "m1",
        id: "t1",
        name: WRITE_TOOL_NAME,
        stage: "end",
        success: true,
        result: "enriched",
        parameters: toolParams("/work/a/src/a.ts"),
      },
    });
    expect(openFilePosts(vscode)).toHaveLength(before);
  });

  it("never auto-opens a panel for a generated file (spec 场景 1、2)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    // Panel slot starts collapsed with no tab; a finished Write of a page file
    // used to open the preview pane here, and a doc used to open the file pane.
    // Both are gone: writing never touches the panel.
    sendHostMessage(
      fixtures.setInitialState({
        messages: [
          messageWithTool("m1", {
            id: "t1",
            name: WRITE_TOOL_NAME,
            stage: "streaming",
            parameters: toolParams("/work/a/index.html"),
          }),
        ],
        workdir: "/work/a",
      }),
    );
    expect(
      screen.getByTestId("panel-toggle-btn").getAttribute("aria-expanded"),
    ).toBe("false");

    for (const [messageId, blockId, path, name] of [
      ["m1", "t1", "/work/a/index.html", WRITE_TOOL_NAME],
      ["m2", "t2", "/work/a/report.md", WRITE_TOOL_NAME],
      ["m3", "t3", "/work/a/slides.pptx", EDIT_TOOL_NAME],
    ]) {
      sendCommand("updateToolBlock", {
        params: {
          messageId,
          id: blockId,
          name,
          stage: "end",
          success: true,
          parameters: toolParams(path),
        },
      });
    }

    expect(openFilePosts(vscode)).toHaveLength(0);
    expect(
      screen.getByTestId("panel-toggle-btn").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("file-pane")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-pane-empty")).not.toBeInTheDocument();
  });
  it("marks the tab unavailable when the host reports the file gone (spec 场景 13)", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    openFileInDesktopPanel("/work/a/src/a.ts", { content: "old" }, "/work/a");
    expect(screen.queryByTestId("file-pane-deleted")).toBeNull();

    // 宿主把「路径已不在」的读失败标成 missing：面板保留标签、内容区换成
    // 「文件已不存在」+「关闭标签」，而不是一条普通错误横幅。
    sendCommand("desktopFileContent", {
      fileView: {
        path: "/work/a/src/a.ts",
        host: "local",
        error: "文件不存在：/work/a/src/a.ts",
        missing: true,
      },
    });

    expect(screen.getByTestId("file-pane-deleted")).toHaveTextContent(
      "文件已不存在",
    );
    expect(screen.getAllByTestId("file-tab")[0]).toHaveTextContent("已删除");

    // 再读成功一次，标记与提示一起消失。
    sendCommand("desktopFileContent", {
      fileView: { path: "/work/a/src/a.ts", host: "local", content: "back" },
    });
    expect(screen.queryByTestId("file-pane-deleted")).toBeNull();
    expect(screen.getAllByTestId("file-tab")[0]).not.toHaveTextContent(
      "已删除",
    );
  });
});

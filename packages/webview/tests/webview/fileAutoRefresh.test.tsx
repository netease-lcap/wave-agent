import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from "wave-agent-sdk";
import { createMockVscode, sendCommand, sendHostMessage } from "./test-utils";
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

const openFilePanel = () => {
  fireEvent.click(screen.getByTestId("panel-toggle-btn"));
  fireEvent.click(screen.getByTestId("panel-toggle-item-file"));
  expect(screen.getByTestId("file-pane")).toBeInTheDocument();
};

const fillFilePanel = (path: string, content: string) => {
  sendCommand("desktopFileContent", {
    fileView: { path, host: "local", content },
  });
};

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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old content");
    expect(screen.getByText("old content")).toBeInTheDocument();

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
    expect(posts).toHaveLength(1);
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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old");

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

    expect(openFilePosts(vscode)).toHaveLength(1);
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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old");

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

    expect(openFilePosts(vscode)).toHaveLength(0);
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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old");

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

    expect(openFilePosts(vscode)).toHaveLength(0);
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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old");

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
    expect(openFilePosts(vscode)).toHaveLength(0);

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
    expect(openFilePosts(vscode)).toHaveLength(1);
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
    expect(openFilePosts(vscode)).toHaveLength(1);
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
    openFilePanel();
    fillFilePanel("/work/a/src/a.ts", "old");
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
    expect(openFilePosts(vscode)).toHaveLength(0);
  });
});

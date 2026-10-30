import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { SingleFilePane } from "./filePaneHarness";
import type { FileViewState } from "../../src/types";
import type { ConversationFileEntry } from "../../src/utils/conversationFiles";

function makeFileView(overrides: Partial<FileViewState> = {}): FileViewState {
  return {
    path: "/work/a/src/app.ts",
    host: "local",
    content: "const a = 1;\n",
    ...overrides,
  };
}

function entry(name: string, path: string): ConversationFileEntry {
  return {
    absolutePath: path,
    path,
    name,
    displayPath: name,
  };
}

function renderPane(options: {
  fileView?: FileViewState | null;
  listMode?: boolean;
  conversationFiles?: ConversationFileEntry[];
  onOpenFileInPanel?: (path: string) => void;
  onBackToList?: () => void;
}) {
  return render(
    <SingleFilePane
      fileView={options.fileView ?? null}
      width={420}
      workdir="/work/a"
      conversationFiles={options.conversationFiles}
      listMode={options.listMode}
      onOpenFileInPanel={options.onOpenFileInPanel}
      onBackToList={options.onBackToList}
    />,
  );
}

const FILES = [
  entry("index.ts", "/work/a/src/index.ts"),
  entry("README.md", "/work/a/README.md"),
];

describe("FilePane conversation file list", () => {
  it("lists the conversation's files while no file is open", () => {
    renderPane({ conversationFiles: FILES });

    expect(screen.getByTestId("file-pane-conversation-files")).toBeTruthy();
    expect(screen.getByText("当前对话的文件")).toBeTruthy();
    const rows = screen.getAllByTestId("file-pane-conversation-file-row");
    expect(rows.map((r) => r.textContent)).toEqual(["index.ts", "README.md"]);
    // No file is open: neither the placeholder nor the code view shows.
    expect(screen.queryByTestId("file-pane-empty-none")).toBeNull();
    expect(document.querySelector(".file-pane-code")).toBeNull();
  });

  it("opens the clicked row in the panel", () => {
    const onOpenFileInPanel = vi.fn();
    renderPane({ conversationFiles: FILES, onOpenFileInPanel });

    fireEvent.click(screen.getByText("README.md"));

    expect(onOpenFileInPanel).toHaveBeenCalledWith("/work/a/README.md");
  });

  it("keeps the placeholder when the conversation has no files", () => {
    renderPane({ conversationFiles: [] });

    // 1030 评论：空态只剩引导句，`file-pane-empty-none` 挂在这句上。
    expect(screen.getByTestId("file-pane-empty-none")).toHaveTextContent(
      "点击目录树中的文件，或点击消息里的文件路径",
    );
    expect(screen.queryByTestId("file-pane-conversation-files")).toBeNull();
  });

  it("shows the list over a loaded file in list mode, titled 文件", () => {
    renderPane({
      fileView: makeFileView(),
      listMode: true,
      conversationFiles: FILES,
      onBackToList: vi.fn(),
    });

    expect(screen.getByTestId("file-pane-conversation-files")).toBeTruthy();
    expect(document.querySelector(".file-pane-code")).toBeNull();
    // The toolbar drops the path for the plain panel title while listing.
    expect(screen.queryByTestId("file-pane-back-to-list")).toBeNull();
    expect(document.querySelector(".file-pane-path")).toBeNull();
  });

  it("returns to the list from an open file", () => {
    const onBackToList = vi.fn();
    renderPane({
      fileView: makeFileView(),
      conversationFiles: FILES,
      onBackToList,
    });

    expect(document.querySelector(".file-pane-code")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-pane-back-to-list"));
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });

  it("offers no way back to a list that does not exist", () => {
    renderPane({ fileView: makeFileView(), conversationFiles: [] });

    expect(document.querySelector(".file-pane-code")).toBeTruthy();
    expect(screen.queryByTestId("file-pane-back-to-list")).toBeNull();
  });
});

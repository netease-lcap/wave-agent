import { describe, it, expect, vi } from "vitest";
import {
  render,
  fireEvent,
  createEvent,
  screen,
  within,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand, fireInput } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktopApp() {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  return { ...result, vscode };
}

describe("DesktopApp", () => {
  it("should post desktopReady on mount and show loading until workdir state arrives", () => {
    const { vscode } = renderDesktopApp();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopReady",
    });
    expect(screen.getByTestId("desktop-loading")).toBeInTheDocument();
  });

  it("should render sidebar with new-chat button only (no session list), and the workdir selector inside the input", () => {
    renderDesktopApp();

    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });

    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-new-session")).toBeInTheDocument();
    // Session list is removed from the sidebar
    expect(screen.queryByPlaceholderText("搜索关键词")).not.toBeInTheDocument();
    // Workdir selector lives inside the input, showing the placeholder
    expect(screen.getByTestId("input-workdir-row")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-workdir")).toHaveTextContent(
      "选择工作目录…",
    );
    // New-chat stays disabled until a workdir is picked
    expect(screen.getByTestId("desktop-new-session")).toBeDisabled();
  });

  it("should toggle the workdir dropdown and post desktopSelectWorkdir when clicking 浏览…", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    // Closed by default
    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    expect(screen.getByTestId("desktop-workdir-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("desktop-workdir-browse"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectWorkdir",
    });
    // Menu closes after selection
    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();
  });

  it("should close the dropdown when clicking outside", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    expect(screen.getByTestId("desktop-workdir-menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();
  });

  it("should render recent workdirs in the dropdown and post select/remove commands", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: ["/home/user/project-a", "/home/user/project-b"],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    const items = screen.getAllByTestId("desktop-workdir-recent-item");
    expect(items).toHaveLength(2);
    // Two-line entry: basename on top, parent path below
    expect(
      items[0].querySelector(".desktop-workdir-menu-name"),
    ).toHaveTextContent("project-a");
    expect(
      items[0].querySelector(".desktop-workdir-menu-parent"),
    ).toHaveTextContent("/home/user");

    fireEvent.click(items[0]);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectRecentWorkdir",
      path: "/home/user/project-a",
      host: "local",
    });

    // Selecting closed the menu — reopen to remove the other entry
    fireEvent.click(screen.getByTestId("desktop-workdir"));
    const removeBtns = screen.getAllByTestId("desktop-workdir-recent-remove");
    fireEvent.click(removeBtns[1]);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopRemoveRecentWorkdir",
      path: "/home/user/project-b",
      host: "local",
    });
    // Remove click must not trigger selection
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectRecentWorkdir",
      path: "/home/user/project-b",
    });
  });

  it("should hide the workdir selector once the conversation starts", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });

    // New-session state: selector visible inside the input
    expect(screen.getByTestId("input-workdir-row")).toBeInTheDocument();

    sendCommand("updateMessages", {
      messages: [MockDataGenerator.createUserMessage("hi")],
    });

    // Conversation started: selector gone, session list stays out of the sidebar
    expect(screen.queryByTestId("input-workdir-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
  });

  describe("remote directory browser (spec scenarios 20-22)", () => {
    /** Open the workdir dropdown on a remote host and click 浏览…. */
    const openRemoteBrowser = () => {
      fireEvent.click(screen.getByTestId("desktop-workdir"));
      fireEvent.click(screen.getByTestId("desktop-workdir-browse"));
    };

    it("opens the browser on a remote host and lists the home directory", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();

      expect(screen.getByTestId("desktop-remote-browser")).toBeInTheDocument();
      // First open starts at the home directory ('~').
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "~",
          requestId: "1",
        }),
      );

      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs"],
      });

      // Breadcrumbs: root, home, alice (active).
      const crumbs = screen.getByTestId("desktop-remote-browser-crumbs");
      expect(within(crumbs).getByText("/")).toBeInTheDocument();
      expect(within(crumbs).getByText("home")).toBeInTheDocument();
      expect(within(crumbs).getByText("alice")).toHaveClass("active");
      // Directory entries only.
      const items = screen.getAllByTestId("desktop-remote-browser-item");
      expect(items.map((i) => i.textContent)).toEqual(["code", "docs"]);
      // Non-root directories show the … parent entry.
      expect(
        screen.getByTestId("desktop-remote-browser-parent"),
      ).toBeInTheDocument();

      // At the filesystem root the parent entry disappears.
      fireEvent.click(within(crumbs).getByText("/"));
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/",
        dirs: ["home"],
      });
      expect(
        screen.queryByTestId("desktop-remote-browser-parent"),
      ).not.toBeInTheDocument();
      expect(
        screen
          .getAllByTestId("desktop-remote-browser-item")
          .map((i) => i.textContent),
      ).toEqual(["home"]);
    });

    it("navigates into a subdirectory and shows the parent … entry", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs"],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByText("code"));

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "/home/alice/code",
          requestId: "2",
        }),
      );
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice/code",
        dirs: ["app"],
      });
      expect(screen.getByText("app")).toBeInTheDocument();

      // Non-root: the … entry navigates to the parent directory.
      fireEvent.click(screen.getByTestId("desktop-remote-browser-parent"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          path: "/home/alice",
          requestId: "3",
        }),
      );
    });

    it("jumps to a breadcrumb level on click", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code"],
      });
      fireEvent.click(screen.getByText("code"));
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice/code",
        dirs: ["app"],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(
        within(screen.getByTestId("desktop-remote-browser-crumbs")).getByText(
          "home",
        ),
      );

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          path: "/home",
          requestId: "3",
        }),
      );
    });

    it("shows a retryable error and disables selection when listing fails", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        error: "读取远端目录失败：目录不存在或不可读",
      });

      expect(
        screen.getByTestId("desktop-remote-browser-error"),
      ).toHaveTextContent("读取远端目录失败");
      expect(
        screen.getByTestId("desktop-remote-browser-select"),
      ).toBeDisabled();
      expect(
        screen.queryByTestId("desktop-remote-browser-item"),
      ).not.toBeInTheDocument();

      // Retry re-requests the same path (new requestId).
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("desktop-remote-browser-retry"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "~",
          requestId: "2",
        }),
      );

      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice",
        dirs: ["code"],
      });
      expect(screen.getByTestId("desktop-remote-browser-select")).toBeEnabled();
    });

    it("选择此目录 posts desktopSelectRemotePath with the browsed path", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code"],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-remote-browser-select"));

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopSelectRemotePath",
        path: "/home/alice",
        host: "prod",
      });
      // Panel closes after selection.
      expect(
        screen.queryByTestId("desktop-remote-browser"),
      ).not.toBeInTheDocument();
    });

    it("submits a typed path with Enter, bypassing the listing", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "/remote/new" },
      });
      fireEvent.keyDown(screen.getByTestId("desktop-remote-browser-input"), {
        key: "Enter",
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopSelectRemotePath",
        path: "/remote/new",
        host: "prod",
      });
    });

    it("filters subdirectories by keyword and hides non-matching entries", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "docx"],
      });

      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "doc" },
      });

      expect(
        screen
          .getAllByTestId("desktop-remote-browser-item")
          .map((i) => i.textContent),
      ).toEqual(["docs", "docx"]);
    });

    it("highlights every keyword occurrence in matching entries", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "docx"],
      });

      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "oc" },
      });

      const marks = document.querySelectorAll(".desktop-remote-browser-mark");
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) {
        expect(mark.textContent).toBe("oc");
      }
      // Non-matching entries are hidden: code does not contain 'oc'.
      expect(
        screen
          .getAllByTestId("desktop-remote-browser-item")
          .map((i) => i.textContent),
      ).toEqual(["docs", "docx"]);
    });

    it("shows a no-match hint when the keyword filters everything out", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs"],
      });

      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "zzz" },
      });

      expect(
        screen.getByTestId("desktop-remote-browser-empty"),
      ).toHaveTextContent("没有匹配的目录");
      expect(
        screen.queryByTestId("desktop-remote-browser-item"),
      ).not.toBeInTheDocument();
    });

    it("does not submit a bare keyword with Enter — only absolute paths", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });

      openRemoteBrowser();
      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "docs" },
      });
      fireEvent.keyDown(screen.getByTestId("desktop-remote-browser-input"), {
        key: "Enter",
      });

      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopSelectRemotePath" }),
      );
    });

    it("clears the filter keyword when navigating into a subdirectory", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs"],
      });

      fireEvent.change(screen.getByTestId("desktop-remote-browser-input"), {
        target: { value: "doc" },
      });
      // 'docs' is the only filtered entry; click it to navigate in.
      fireEvent.click(screen.getAllByTestId("desktop-remote-browser-item")[0]);
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice/docs",
        dirs: ["api", "old"],
      });

      // The keyword targets the single-level list: navigation resets it.
      expect(
        screen
          .getAllByTestId("desktop-remote-browser-item")
          .map((i) => i.textContent),
      ).toEqual(["api", "old"]);
      expect(
        (screen.getByTestId("desktop-remote-browser-input") as HTMLInputElement)
          .value,
      ).toBe("");
    });

    it("remembers the last visited directory across opens", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code"],
      });
      fireEvent.click(screen.getByText("code"));
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice/code",
        dirs: ["app"],
      });

      // Close with Escape, reopen via 浏览… — location memory restores.
      fireEvent.keyDown(screen.getByTestId("desktop-remote-browser-input"), {
        key: "Escape",
      });
      expect(
        screen.queryByTestId("desktop-remote-browser"),
      ).not.toBeInTheDocument();
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "/home/alice/code",
          requestId: "3",
        }),
      );
    });

    it("moves the selection with ArrowDown/ArrowUp and enters the highlighted dir with Enter", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "notes"],
      });
      const input = screen.getByTestId("desktop-remote-browser-input");

      // No selection initially.
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).not.toHaveClass("selected");

      // ArrowDown highlights the first item; ArrowDown again the second.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).toHaveClass("selected");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[1],
      ).toHaveClass("selected");
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).not.toHaveClass("selected");

      // ArrowUp moves back; at the top it clears the selection.
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).toHaveClass("selected");
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).not.toHaveClass("selected");

      // ArrowDown + Enter navigates into the highlighted subdirectory.
      vscode.postMessage.mockClear();
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "/home/alice/code",
          requestId: "2",
        }),
      );
    });

    it("auto-selects the first filtered match and enters it with Enter", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "notes"],
      });

      // Filter to ['docs'] — typing the keyword selects the first match
      // immediately, no ArrowDown needed.
      const input = screen.getByTestId("desktop-remote-browser-input");
      fireEvent.change(input, { target: { value: "doc" } });
      const items = screen.getAllByTestId("desktop-remote-browser-item");
      expect(items.map((i) => i.textContent)).toEqual(["docs"]);
      expect(items[0]).toHaveClass("selected");

      // Enter enters the filtered highlight, not an unfiltered entry.
      vscode.postMessage.mockClear();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListRemoteDir",
          host: "prod",
          path: "/home/alice/docs",
          requestId: "2",
        }),
      );
    });

    it("re-selects the first match as the keyword changes, and clears when no match", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "notes"],
      });
      const input = screen.getByTestId("desktop-remote-browser-input");

      // Move the highlight away, then retype a keyword — the first match
      // is selected again.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[1],
      ).toHaveClass("selected");
      fireEvent.change(input, { target: { value: "no" } });
      const items = screen.getAllByTestId("desktop-remote-browser-item");
      expect(items.map((i) => i.textContent)).toEqual(["notes"]);
      expect(items[0]).toHaveClass("selected");

      // No matches → nothing selected.
      fireEvent.change(input, { target: { value: "zzz" } });
      expect(
        screen.getByTestId("desktop-remote-browser-empty"),
      ).toHaveTextContent("没有匹配的目录");
      expect(
        screen.queryAllByTestId("desktop-remote-browser-item"),
      ).toHaveLength(0);
    });

    it("clears the selection after navigating and on filter changes", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", { host: "prod", recentWorkdirs: [] });
      sendCommand("setInitialState", { messages: [] });
      vscode.postMessage.mockClear();

      openRemoteBrowser();
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "1",
        resolvedPath: "/home/alice",
        dirs: ["code", "docs", "notes"],
      });
      const input = screen.getByTestId("desktop-remote-browser-input");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).toHaveClass("selected");

      // Navigating into the selected directory resets the highlight.
      fireEvent.keyDown(input, { key: "Enter" });
      sendCommand("desktopRemoteDirList", {
        host: "prod",
        requestId: "2",
        resolvedPath: "/home/alice/code",
        dirs: ["app"],
      });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).not.toHaveClass("selected");

      // Re-selecting then narrowing the filter to no matches clears the
      // highlight (selection index out of filtered range).
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getAllByTestId("desktop-remote-browser-item")[0],
      ).toHaveClass("selected");
      fireEvent.change(input, { target: { value: "zzz" } });
      expect(
        screen.queryAllByTestId("desktop-remote-browser-item"),
      ).toHaveLength(0);
      expect(
        screen.getByTestId("desktop-remote-browser-empty"),
      ).toHaveTextContent("没有匹配的目录");
    });
  });

  it("should render ChatApp with sidebar, no header new-session button but the history button when workdir is set", () => {
    const { vscode } = renderDesktopApp();

    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });

    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    // The header keeps only the 历史对话 button (cross-workdir popup);
    // 新建对话 lives in the sidebar.
    expect(screen.queryByTestId("new-session-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-btn")).toBeInTheDocument();
    // No header more button on desktop — settings/login entries live in the
    // account card menu (sidebar header 更多 was a duplicate, removed 2026-08-29)
    expect(screen.queryByTestId("more-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-more-btn")).not.toBeInTheDocument();
    // ChatApp still announces readiness to the host
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "webviewReady",
    });
  });

  it("should post newSession from the sidebar new-chat button", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-new-session"));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: "newSession" });
  });

  it("shows the side-by-side hint tooltip when hovering the new-chat button", async () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });

    const btn = screen.getByTestId("desktop-new-session");
    // The hint moved off the native title attribute onto the Tooltip.
    expect(btn.getAttribute("title")).toBeNull();
    const container = btn.closest(".tooltip-container") as HTMLElement;
    expect(container).not.toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(container);
    });

    await waitFor(() => {
      const tooltip = document.querySelector(".tooltip-box.visible");
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveTextContent("新对话（Ctrl+Click 并排打开）");
    });
  });

  it("should update the workdir name and enable new-chat when a new workdir state arrives", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });
    expect(screen.getByTestId("desktop-workdir")).toHaveTextContent(
      "选择工作目录…",
    );
    expect(screen.getByTestId("desktop-new-session")).toBeDisabled();

    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/other",
      recentWorkdirs: ["/home/user/other"],
    });
    sendCommand("setInitialState", { messages: [] });

    expect(screen.getByTestId("desktop-workdir")).toHaveTextContent("other");
    expect(screen.getByTestId("desktop-new-session")).toBeEnabled();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("should disable the input area when no workdir is selected, and enable it once a workdir arrives", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });

    expect(screen.getByTestId("message-input")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByTestId("send-btn")).toBeDisabled();
    expect(screen.getByLabelText("添加")).toBeDisabled();
    expect(screen.getByLabelText("快捷指令")).toBeDisabled();
    expect(screen.getByLabelText("权限模式")).toBeDisabled();

    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });

    expect(screen.getByTestId("message-input")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(screen.getByLabelText("添加")).toBeEnabled();
    expect(screen.getByLabelText("快捷指令")).toBeEnabled();
    expect(screen.getByLabelText("权限模式")).toBeEnabled();
  });

  describe("session tree (FR-020)", () => {
    const session = (sessionId: string, title: string) => ({
      sessionId,
      title,
      lastActiveAt: Date.now(),
      hasWorktree: false,
    });

    const groupHeader = (workdir: string) =>
      screen
        .getByTestId(`desktop-session-group-local:${workdir}`)
        .querySelector(".desktop-session-group-header") as HTMLElement;

    it("renders one group per recent directory, all groups expanded by default", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a", "/work/b"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
          {
            host: "local",
            workdir: "/work/b",
            sessions: [session("s2", "hello b")],
          },
        ],
      });

      // Both groups expanded by default: all sessions visible
      expect(screen.getByTestId("desktop-session-item-s1")).toBeInTheDocument();
      expect(screen.getByTestId("desktop-session-item-s2")).toBeInTheDocument();
      // Group headers show directory basenames
      expect(
        screen.getByTestId("desktop-session-group-local:/work/a"),
      ).toHaveTextContent("a");
      expect(
        screen.getByTestId("desktop-session-group-local:/work/b"),
      ).toHaveTextContent("b");
    });

    it("renders a worktree session under its repo root group", () => {
      renderDesktopApp();
      // Worktree session active: current workdir is the worktree path,
      // but the session groups under its repo root (FR-020/FR-023).
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a/.wave/worktrees/gentle-pike-147",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "worktree chat")],
          },
        ],
      });
      sendCommand("updateCurrentSession", {
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a/.wave/worktrees/gentle-pike-147",
          createdAt: "2026-07-20T00:00:00.000Z",
          lastActiveAt: "2026-07-21T00:00:00.000Z",
          latestTotalTokens: 0,
          firstMessage: "worktree chat",
        },
      });

      expect(screen.getByTestId("desktop-session-item-s1")).toBeInTheDocument();
    });

    it("toggles a group on header click", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a", "/work/b"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
          {
            host: "local",
            workdir: "/work/b",
            sessions: [session("s2", "hello b")],
          },
        ],
      });

      // Collapse an expanded-by-default group
      fireEvent.click(groupHeader("/work/b"));
      expect(
        screen.queryByTestId("desktop-session-item-s2"),
      ).not.toBeInTheDocument();

      // Re-expand it
      fireEvent.click(groupHeader("/work/b"));
      expect(screen.getByTestId("desktop-session-item-s2")).toBeInTheDocument();

      // Collapse the other group
      fireEvent.click(groupHeader("/work/a"));
      expect(
        screen.queryByTestId("desktop-session-item-s1"),
      ).not.toBeInTheDocument();
    });

    it("posts desktopSelectSession with the group workdir when a session is clicked", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
        ],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s1"));

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopSelectSession",
        workdir: "/work/a",
        sessionId: "s1",
      });
    });

    it("shows a drag-or-Ctrl hint tooltip on hover over a session item (non-mac)", async () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
        ],
      });

      const item = screen.getByTestId("desktop-session-item-s1");
      // The tooltip wraps the row content, NOT the li — ul > li stays valid DOM.
      expect(item.tagName).toBe("LI");
      expect(item.parentElement?.className).toContain("desktop-session-items");
      const container = item.querySelector(".tooltip-container") as HTMLElement;
      expect(container).not.toBeNull();

      await act(async () => {
        fireEvent.mouseEnter(container);
      });

      await waitFor(() => {
        const tooltip = document.querySelector(".tooltip-box.visible");
        expect(tooltip).not.toBeNull();
        expect(tooltip).toHaveTextContent("可拖拽或 Ctrl+点击 并排打开");
      });
    });

    it("shows the Cmd variant of the session hint on macOS", async () => {
      const originalPlatform = navigator.platform;
      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });
      try {
        renderDesktopApp();
        sendCommand("desktopWorkdirState", {
          workdir: "/work/a",
          recentWorkdirs: ["/work/a"],
        });
        sendCommand("setInitialState", { messages: [] });
        sendCommand("desktopSessionTree", {
          groups: [
            {
              host: "local",
              workdir: "/work/a",
              sessions: [session("s1", "hello a")],
            },
          ],
        });

        const container = screen
          .getByTestId("desktop-session-item-s1")
          .querySelector(".tooltip-container") as HTMLElement;

        await act(async () => {
          fireEvent.mouseEnter(container);
        });

        await waitFor(() => {
          expect(
            document.querySelector(".tooltip-box.visible"),
          ).toHaveTextContent("可拖拽或 Cmd+点击 并排打开");
        });
      } finally {
        Object.defineProperty(navigator, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it("shows a running dot on the streaming current session and marks it current", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a"), session("s2", "hello again")],
          },
        ],
      });
      sendCommand("updateCurrentSession", {
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: "2026-07-20T00:00:00.000Z",
          lastActiveAt: "2026-07-21T00:00:00.000Z",
          latestTotalTokens: 0,
          firstMessage: "hello a",
        },
      });
      sendCommand("startStreaming", {});

      const current = screen.getByTestId("desktop-session-item-s1");
      const runningIcon = current.querySelector(
        ".desktop-session-status-icon.codicon-loading",
      );
      expect(runningIcon).not.toBeNull();
      expect(runningIcon).toHaveAttribute("title", "正在运行");
      expect(current.className).toContain("desktop-session-item--current");
      expect(
        screen
          .getByTestId("desktop-session-item-s2")
          .querySelector(".desktop-session-status-icon"),
      ).toBeNull();
    });

    it("shows a waiting dot on sessions with a pending confirmation, taking precedence over running", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [
              {
                ...session("s1", "waiting one"),
                waitingConfirmation: true,
                running: true,
              },
              session("s2", "plain running"),
            ],
          },
        ],
      });
      sendCommand("updateCurrentSession", {
        session: {
          id: "s2",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: "2026-07-20T00:00:00.000Z",
          lastActiveAt: "2026-07-21T00:00:00.000Z",
          latestTotalTokens: 0,
          firstMessage: "plain running",
        },
      });
      sendCommand("startStreaming", {});

      const waiting = screen.getByTestId("desktop-session-item-s1");
      // Both flags set: waiting wins — shows a bell, no running loader.
      const waitingIcon = waiting.querySelector(
        ".desktop-session-status-icon.codicon-bell",
      );
      expect(waitingIcon).not.toBeNull();
      expect(waitingIcon).toHaveAttribute("title", "等待确认");
      expect(waiting.querySelector(".codicon-loading")).toBeNull();

      const running = screen.getByTestId("desktop-session-item-s2");
      expect(running.querySelector(".codicon-bell")).toBeNull();
      expect(
        running.querySelector(".desktop-session-status-icon.codicon-loading"),
      ).not.toBeNull();
    });

    it("shows 无会话 for an expanded empty group", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [{ host: "local", workdir: "/work/a", sessions: [] }],
      });

      expect(
        screen.getByTestId("desktop-session-group-local:/work/a"),
      ).toHaveTextContent("无会话");
    });

    it("posts desktopDeleteSession after the user confirms", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
        ],
      });
      vscode.postMessage.mockClear();

      // Delete lives inside the row's 更多 menu (并排打开/删除会话).
      fireEvent.click(screen.getByTestId("desktop-session-more-s1"));
      fireEvent.click(screen.getByTestId("desktop-session-menu-delete"));

      // Deletion only proceeds after confirming the in-webview dialog
      expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopDeleteSession" }),
      );

      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

      expect(
        screen.queryByTestId("confirm-dialog-overlay"),
      ).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopDeleteSession",
        sessionId: "s1",
      });
    });

    it("offers 并排打开 and 删除会话 in the row's 更多 menu; 并排打开 posts desktopOpenPane", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
        ],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-more-s1"));

      const menu = screen.getByTestId("desktop-session-menu");
      expect(menu).toHaveTextContent("并排打开");
      expect(menu).toHaveTextContent("删除会话");

      fireEvent.click(screen.getByTestId("desktop-session-menu-split"));

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopOpenPane",
          sessionId: "s1",
        }),
      );
      // The menu closes after activating an item.
      expect(
        screen.queryByTestId("desktop-session-menu"),
      ).not.toBeInTheDocument();
    });

    it("keeps every session main button in the Tab order; 更多 buttons stay out", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a"), session("s2", "hello b")],
          },
        ],
      });

      // Spec 「会话管理」scenario 13: session main buttons are natively
      // Tab-focusable — Tab walks the tree row by row (claude.ai model).
      // Delete buttons never enter the Tab order (←/→ only).
      const mainS1 = screen.getByTestId("desktop-session-main-s1");
      const mainS2 = screen.getByTestId("desktop-session-main-s2");
      expect(mainS1.tabIndex).toBe(0);
      expect(mainS2.tabIndex).toBe(0);
      expect(screen.getByTestId("desktop-session-more-s1").tabIndex).toBe(-1);
      expect(screen.getByTestId("desktop-session-more-s2").tabIndex).toBe(-1);
    });

    it("moves focus between rows with ↑/↓ including wrap-around, and follows with Home/End", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a"), session("s2", "hello b")],
          },
        ],
      });
      const mainS1 = screen.getByTestId("desktop-session-main-s1");
      const mainS2 = screen.getByTestId("desktop-session-main-s2");

      act(() => {
        mainS2.focus();
      });
      // ↓ wraps past the last row to the first.
      fireEvent.keyDown(mainS2, { key: "ArrowDown" });
      expect(document.activeElement).toBe(mainS1);

      fireEvent.keyDown(mainS1, { key: "ArrowUp" });
      expect(document.activeElement).toBe(mainS2);

      fireEvent.keyDown(mainS2, { key: "End" });
      expect(document.activeElement).toBe(mainS2);
      fireEvent.keyDown(mainS2, { key: "Home" });
      expect(document.activeElement).toBe(mainS1);
    });

    it("crosses within one row via ←/→ between the main button and the 更多 button", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a"), session("s2", "hello b")],
          },
        ],
      });
      const mainS1 = screen.getByTestId("desktop-session-main-s1");
      const moreS1 = screen.getByTestId("desktop-session-more-s1");

      act(() => {
        mainS1.focus();
      });
      fireEvent.keyDown(mainS1, { key: "ArrowRight" });
      expect(document.activeElement).toBe(moreS1);
      // Clamped at the row's edge: a second → stays put.
      fireEvent.keyDown(moreS1, { key: "ArrowRight" });
      expect(document.activeElement).toBe(moreS1);
      // ← returns to the row's main button.
      fireEvent.keyDown(moreS1, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(mainS1);

      // Vertical movement from the 更多 button resumes from that row.
      const mainS2 = screen.getByTestId("desktop-session-main-s2");
      act(() => {
        moreS1.focus();
      });
      fireEvent.keyDown(moreS1, { key: "ArrowDown" });
      expect(document.activeElement).toBe(mainS2);
    });

    it("does not delete when the user cancels the confirm dialog", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1", "hello a")],
          },
        ],
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-more-s1"));
      fireEvent.click(screen.getByTestId("desktop-session-menu-delete"));
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

      expect(
        screen.queryByTestId("confirm-dialog-overlay"),
      ).not.toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopDeleteSession" }),
      );
    });

    it("warns about worktree + temp branch cleanup when deleting a worktree session", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [
              {
                sessionId: "wt",
                title: "wt session",
                lastActiveAt: Date.now(),
                hasWorktree: true,
              },
            ],
          },
        ],
      });

      fireEvent.click(screen.getByTestId("desktop-session-more-wt"));
      fireEvent.click(screen.getByTestId("desktop-session-menu-delete"));

      expect(screen.getByTestId("confirm-dialog-overlay")).toHaveTextContent(
        "worktree 目录与临时分支将一并删除",
      );
    });
  });

  describe("worktree controls (FR-022/FR-023)", () => {
    const branches = { branches: ["main", "dev"], current: "main" };

    it("requests branches when a workdir arrives and shows branch selector + checkbox", () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopListGitBranches",
        workdir: "/work/a",
      });
      // Loading placeholder shown while the branch list is being fetched
      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "分支获取中…",
      );

      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });

      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "main",
      );
      expect(screen.queryByText("分支获取中…")).not.toBeInTheDocument();
      const checkbox = screen
        .getByTestId("desktop-worktree-checkbox")
        .querySelector("input");
      expect(checkbox).toBeChecked();
    });

    it("stays hidden when the workdir is not a git repo (result null)", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", { workdir: "/work/a", result: null });

      expect(
        screen.queryByTestId("desktop-worktree-controls"),
      ).not.toBeInTheDocument();
    });

    it("shows a loading placeholder on workdir change until fresh branches arrive", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });
      expect(
        screen.getByTestId("desktop-worktree-controls"),
      ).toBeInTheDocument();

      sendCommand("desktopWorkdirState", {
        workdir: "/work/b",
        recentWorkdirs: ["/work/b", "/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });

      // Stale branch list cleared — loading placeholder shown instead
      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "分支获取中…",
      );

      sendCommand("desktopGitBranches", {
        workdir: "/work/b",
        result: { branches: ["feature", "main"], current: "main" },
      });

      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "main",
      );
    });

    it("selects a branch from the dropdown", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });

      fireEvent.click(screen.getByTestId("desktop-branch-selector"));
      const items = screen.getAllByTestId("desktop-branch-item");
      expect(items).toHaveLength(2);

      fireEvent.click(items[1]);
      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "dev",
      );
      expect(
        screen.queryByTestId("desktop-branch-menu"),
      ).not.toBeInTheDocument();
    });

    it("posts desktopCreateWorktree instead of sendMessage when the checkbox is on", async () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });
      vscode.postMessage.mockClear();

      // Pick dev as the base branch (the checkbox is on by default)
      fireEvent.click(screen.getByTestId("desktop-branch-selector"));
      fireEvent.click(screen.getAllByTestId("desktop-branch-item")[1]);

      const input = screen.getByTestId("message-input");
      input.textContent = "hello worktree";
      await fireInput(input, { inputType: "insertText" });
      fireEvent.click(screen.getByTestId("send-btn"));

      const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
      expect(
        sentMessages.find(
          (m: Record<string, unknown>) => m.command === "sendMessage",
        ),
      ).toBeUndefined();
      expect(
        sentMessages.find(
          (m: Record<string, unknown>) => m.command === "desktopCreateWorktree",
        ),
      ).toEqual({
        command: "desktopCreateWorktree",
        workdir: "/work/a",
        baseBranch: "dev",
        text: "hello worktree",
        images: undefined,
      });
      // Checkbox stays at its checked default for the next session
      expect(
        screen.getByTestId("desktop-worktree-checkbox").querySelector("input"),
      ).toBeChecked();
      // While the host creates the worktree, the checkbox shows the creating
      // indicator and is disabled.
      expect(screen.getByTestId("desktop-worktree-creating")).toHaveTextContent(
        "worktree 创建中…",
      );
      expect(
        screen.getByTestId("desktop-worktree-checkbox").querySelector("input"),
      ).toBeDisabled();
      // The spawned session's setInitialState carries the worktree path as its
      // cwd — the still-visible new-session pickers must keep showing the repo
      // the user picked (/work/a → "a") and the chosen base branch (dev), not
      // flash the worktree path/branch.
      sendCommand("setInitialState", {
        workdir: "/work/wt-a",
        messages: [],
        isAuthenticated: true,
      });
      expect(screen.getByTestId("desktop-workdir")).toHaveTextContent("a");
      expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
        "dev",
      );
      expect(
        screen.getByTestId("desktop-worktree-creating"),
      ).toBeInTheDocument();
      // The host's ack (success or failure) clears the indicator.
      sendCommand("desktopWorktreeCreated", {});
      expect(
        screen.queryByTestId("desktop-worktree-creating"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("desktop-worktree-checkbox").querySelector("input"),
      ).not.toBeDisabled();
      // The first visible message (the forwarded user message) hides the
      // new-session pickers.
      sendCommand("updateMessages", {
        messages: [MockDataGenerator.createUserMessage("hello worktree")],
      });
      expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("desktop-worktree-controls"),
      ).not.toBeInTheDocument();
    });

    it("posts sendMessage normally when the checkbox is off", async () => {
      const { vscode } = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });
      vscode.postMessage.mockClear();

      // Untick the default-checked checkbox
      fireEvent.click(
        screen.getByTestId("desktop-worktree-checkbox").querySelector("input")!,
      );

      const input = screen.getByTestId("message-input");
      input.textContent = "plain message";
      await fireInput(input, { inputType: "insertText" });
      fireEvent.click(screen.getByTestId("send-btn"));

      const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
      expect(
        sentMessages.find(
          (m: Record<string, unknown>) => m.command === "desktopCreateWorktree",
        ),
      ).toBeUndefined();
      expect(
        sentMessages.find(
          (m: Record<string, unknown>) => m.command === "sendMessage",
        ),
      ).toBeDefined();
    });

    it("hides the controls once the conversation starts", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: branches,
      });
      expect(
        screen.getByTestId("desktop-worktree-controls"),
      ).toBeInTheDocument();

      sendCommand("updateMessages", {
        messages: [MockDataGenerator.createUserMessage("hi")],
      });

      expect(
        screen.queryByTestId("desktop-worktree-controls"),
      ).not.toBeInTheDocument();
    });
  });

  describe("split-view panes (FR-032~036)", () => {
    const session = (sessionId: string, title: string) => ({
      sessionId,
      title,
      lastActiveAt: Date.now(),
      hasWorktree: false,
    });

    function renderWithPanes(
      panes: Array<{ paneId: string; sessionId?: string; width?: number }>,
      focusedPaneId: string | null,
    ) {
      const result = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            workdir: "/work/a",
            sessions: [session("s1", "chat one"), session("s2", "chat two")],
          },
        ],
      });
      sendCommand("desktopPanes", { panes, focusedPaneId });
      // The pane-scoped ChatApp instances mount on desktopPanes; initialize
      // each with its pane-tagged empty snapshot so input areas render —
      // pane-scoped instances only accept messages tagged with their paneId.
      for (const p of panes) {
        sendCommand("setInitialState", { messages: [], paneId: p.paneId });
      }
      return result;
    }

    function makeDataTransfer(
      payload?: Record<string, unknown>,
      mime = "application/x-wave-pane",
    ) {
      const store: Record<string, string> = {};
      if (payload) store[mime] = JSON.stringify(payload);
      return {
        get types() {
          return Object.keys(store);
        },
        setData: (type: string, value: string) => {
          store[type] = value;
        },
        getData: (type: string) => store[type] ?? "",
        effectAllowed: "",
        dropEffect: "",
      };
    }

    // jsdom reports 0 widths; mock the row/pane rects to give the layout real sizes.
    function mockRowWidth(width: number) {
      const row = screen.getByTestId("desktop-pane-row");
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        width,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }

    function mockRowsContainerHeight(height: number) {
      const el = screen.getByTestId("desktop-pane-rows");
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width: 1200,
        height,
        top: 0,
        left: 0,
        bottom: height,
        right: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }

    function mockPaneRect(paneId: string, left: number, width: number) {
      const el = screen.getByTestId(`desktop-pane-${paneId}`);
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width,
        height: 600,
        top: 0,
        left,
        bottom: 600,
        right: left + width,
        x: left,
        y: 0,
        toJSON: () => ({}),
      });
    }

    it("renders one paneId-scoped chat container per pushed pane", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
      expect(screen.getByTestId("desktop-pane-pane-0")).toBeInTheDocument();
      expect(screen.getByTestId("desktop-pane-pane-1")).toBeInTheDocument();
      expect(screen.getAllByTestId("chat-container")).toHaveLength(2);
    });

    it("marks the focused pane and posts desktopFocusPane on mousedown of another pane", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      expect(screen.getByTestId("desktop-pane-pane-0").className).toContain(
        "desktop-pane--focused",
      );
      expect(screen.getByTestId("desktop-pane-pane-1").className).not.toContain(
        "desktop-pane--focused",
      );

      vscode.postMessage.mockClear();
      fireEvent.mouseDown(screen.getByTestId("desktop-pane-pane-1"));

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopFocusPane",
        paneId: "pane-1",
      });
    });

    it("does not re-post focus when clicking the already-focused pane", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      vscode.postMessage.mockClear();

      fireEvent.mouseDown(screen.getByTestId("desktop-pane-pane-0"));

      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopFocusPane" }),
      );
    });

    it("highlights every pane-displayed session in the sidebar — focused strong, others weak", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      const s1 = screen.getByTestId("desktop-session-item-s1");
      const s2 = screen.getByTestId("desktop-session-item-s2");
      expect(s1.className).toContain("desktop-session-item--current");
      expect(s1.className).not.toContain("desktop-session-item--visible");
      expect(s2.className).toContain("desktop-session-item--visible");
      expect(s2.className).not.toContain("desktop-session-item--current");
    });

    it("moves the strong sidebar highlight when the focused pane changes", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      sendCommand("desktopPanes", {
        panes: [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        focusedPaneId: "pane-1",
      });

      expect(screen.getByTestId("desktop-session-item-s1").className).toContain(
        "desktop-session-item--visible",
      );
      expect(screen.getByTestId("desktop-session-item-s2").className).toContain(
        "desktop-session-item--current",
      );
    });

    it("does not weak-highlight sessions that no pane displays, nor new-session panes", () => {
      renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }, { paneId: "pane-1" }],
        "pane-1",
      );

      const s1 = screen.getByTestId("desktop-session-item-s1");
      const s2 = screen.getByTestId("desktop-session-item-s2");
      // Focused pane has no session — nothing gets the strong highlight.
      expect(s1.className).toContain("desktop-session-item--visible");
      expect(s1.className).not.toContain("desktop-session-item--current");
      expect(s2.className).not.toContain("desktop-session-item--visible");
      expect(s2.className).not.toContain("desktop-session-item--current");
    });

    it("shows a close button per pane only when more than one pane is open", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      expect(
        screen.getByTestId("desktop-pane-close-pane-0"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("desktop-pane-close-pane-1"),
      ).toBeInTheDocument();
    });

    it("posts desktopClosePane with the paneId when the close button is clicked", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-pane-close-pane-1"));

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopClosePane",
        paneId: "pane-1",
      });
    });

    it("makes sidebar session items draggable and seeds the drag payload on dragstart", () => {
      renderWithPanes([{ paneId: "pane-0", sessionId: "s1" }], "pane-0");

      const item = screen.getByTestId("desktop-session-item-s2");
      expect(item).toHaveAttribute("draggable", "true");

      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(item, { dataTransfer });
      expect(dataTransfer.getData("application/x-wave-session")).toBe(
        JSON.stringify({ workdir: "/work/a", sessionId: "s2" }),
      );
    });

    it("posts desktopSelectSession on a plain click of a sidebar session", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s2"));

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopSelectSession",
        workdir: "/work/a",
        sessionId: "s2",
      });
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopOpenPane" }),
      );
    });

    it("keeps a new-session pane on its own workdir/branch when focus moves to a sibling pane", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }, { paneId: "pane-1" }],
        "pane-1",
      );
      // pane-1 is a fresh (empty) session on its own workdir; pane-0 is an
      // existing session in a different workdir.
      sendCommand("setInitialState", {
        paneId: "pane-1",
        messages: [],
        workdir: "/home/user/project-b",
        isAuthenticated: true,
      });
      sendCommand("setInitialState", {
        paneId: "pane-0",
        messages: [
          {
            id: "m1",
            role: "user",
            blocks: [{ type: "text", content: "hi" }],
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
        workdir: "/home/user/project-a",
        isAuthenticated: true,
      });

      // The host-level workdir follows the focused pane (handleFocusPane rewires
      // it on click); focus now moves to pane-0. pane-1 must keep its OWN dir.
      sendCommand("desktopWorkdirState", {
        workdir: "/home/user/project-a",
        recentWorkdirs: ["/home/user/project-a", "/home/user/project-b"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopPanes", {
        panes: [{ paneId: "pane-0", sessionId: "s1" }, { paneId: "pane-1" }],
        focusedPaneId: "pane-0",
      });

      const pane1 = () => within(screen.getByTestId("desktop-pane-pane-1"));
      expect(pane1().getByTestId("desktop-workdir")).toHaveTextContent(
        "project-b",
      );

      // pane-1 queries branches for its OWN workdir (per-pane isolation) and
      // renders its own branch after the reply — not pane-0's.
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListGitBranches",
          workdir: "/home/user/project-b",
          paneId: "pane-1",
        }),
      );
      sendCommand("desktopGitBranches", {
        paneId: "pane-1",
        workdir: "/home/user/project-b",
        result: { branches: ["b-branch", "main"], current: "b-branch" },
      });
      expect(pane1().getByTestId("desktop-branch-selector")).toHaveTextContent(
        "b-branch",
      );
    });

    it("keeps a pane btw panel open when focus moves to a sibling pane (conversation-scoped, not focus-scoped)", async () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      // pane-0 is bound to conversation s1 (desktop pushes setInitialState
      // with the pane's own session on activation).
      sendCommand("setInitialState", {
        paneId: "pane-0",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      });
      const pane0 = () => within(screen.getByTestId("desktop-pane-pane-0"));

      // Open the /btw panel in pane-0
      const input = pane0().getByTestId("message-input");
      input.textContent = "/btw what is the weather?";
      await fireInput(input, { inputType: "insertText" });
      fireEvent.click(pane0().getByTestId("send-btn"));
      expect(pane0().getByTestId("btw-panel")).toBeInTheDocument();

      // Focus moves to pane-1. handleFocusPane only changes focusedPaneId
      // and pushes desktopPanes/workdir/panel state — it never pushes
      // setInitialState, so pane-0's currentSession is untouched and the
      // panel stays: btw is conversation-level, not focus-level.
      sendCommand("desktopPanes", {
        panes: [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        focusedPaneId: "pane-1",
      });
      expect(pane0().getByTestId("btw-panel")).toBeInTheDocument();
      // The sibling pane never shows it
      expect(
        within(screen.getByTestId("desktop-pane-pane-1")).queryByTestId(
          "btw-panel",
        ),
      ).not.toBeInTheDocument();

      // A host re-push with the SAME session id (e.g. a state refresh)
      // must also keep the panel — only a real conversation switch
      // (different session id) closes it.
      sendCommand("setInitialState", {
        paneId: "pane-0",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      });
      expect(pane0().getByTestId("btw-panel")).toBeInTheDocument();

      // Control: switching pane-0 to a different conversation closes it
      sendCommand("setInitialState", {
        paneId: "pane-0",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "s2",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      });
      expect(pane0().queryByTestId("btw-panel")).not.toBeInTheDocument();
    });

    it("a new-session pane empty during spawn resolves its workdir to recents[0], not a sibling worktree path leaked via the host workdir", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }, { paneId: "pane-1" }],
        "pane-0",
      );
      // Spawn gap: the host-level workdir is a worktree path left over from a
      // sibling worktree session (session activation rewired this.workdir),
      // while recents[0] is the repo root the user last picked. pane-1 is a
      // fresh new-session pane with no setInitialState yet → state.workdir
      // is empty, so effectiveWorkdir must come from recents, not host.workdir.
      const worktreePath = "/work/a/.wave/worktrees/gentle-pike-147";
      sendCommand("desktopWorkdirState", {
        workdir: worktreePath,
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });

      const pane1 = () => within(screen.getByTestId("desktop-pane-pane-1"));
      // effectiveWorkdir must be recents[0] (repo root basename), NOT the
      // host worktree path basename.
      expect(pane1().getByTestId("desktop-workdir")).toHaveTextContent("a");
      expect(pane1().getByTestId("desktop-workdir")).not.toHaveTextContent(
        "gentle-pike-147",
      );

      // Branch query for the new pane goes to the repo root, never the
      // worktree path.
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListGitBranches",
          workdir: worktreePath,
          paneId: "pane-1",
        }),
      );
    });

    it("posts desktopOpenPane on Ctrl+Click of a sidebar session (non-mac platform)", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(1200);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s2"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s2",
      });
    });

    it("posts desktopOpenPane on Cmd+Click of a sidebar session on macOS", () => {
      const originalPlatform = navigator.platform;
      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });
      try {
        const { vscode } = renderWithPanes(
          [{ paneId: "pane-0", sessionId: "s1" }],
          "pane-0",
        );
        mockRowWidth(1200);
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByTestId("desktop-session-main-s2"), {
          metaKey: true,
        });

        expect(vscode.postMessage).toHaveBeenCalledWith({
          command: "desktopOpenPane",
          workdir: "/work/a",
          sessionId: "s2",
        });
      } finally {
        Object.defineProperty(navigator, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it("keeps the plain-click behavior for metaKey on non-mac platforms", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s2"), {
        metaKey: true,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopSelectSession",
        workdir: "/work/a",
        sessionId: "s2",
      });
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopOpenPane" }),
      );
    });

    it("still posts desktopOpenPane when Ctrl+Click targets a session already shown (host dedupes)", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(1200);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s1"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s1",
      });
    });

    it("spills Cmd/Ctrl+Click into a fresh second row when the single row is too narrow for another pane", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(500);
      mockRowsContainerHeight(800);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s2"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s2",
        newRow: "below",
      });
    });

    it("refuses Cmd/Ctrl+Click with a hint when the row is too narrow and the window too short to split", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(500);
      mockRowsContainerHeight(400);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s2"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopOpenPane" }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法添加更多分屏",
      });
    });

    // jsdom lacks DragEvent, so fireEvent's dragOver drops clientX — build
    // the event manually to pin the pointer position (same pattern as the
    // pane-reorder drag tests below).
    function dragOverRow(
      dataTransfer: ReturnType<typeof makeDataTransfer>,
      clientX: number,
      target?: Element,
    ) {
      const el = target ?? screen.getByTestId("desktop-pane-row");
      const event = createEvent.dragOver(el, { dataTransfer });
      Object.defineProperty(event, "clientX", { value: clientX });
      fireEvent(el, event);
    }

    it("shows the insertion indicator wherever a dragged session hovers the pane row", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s3" },
        "application/x-wave-session",
      );

      // Same midpoint rule as pane-header drags: the indicator follows the
      // cursor anywhere over the row, not just near edges.
      dragOverRow(dataTransfer, 200);
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      dragOverRow(dataTransfer, 405);
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      dragOverRow(dataTransfer, 795);
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();
    });

    it("posts desktopOpenPane with insertionIndex when a dragged session drops on a pane half", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      mockRowWidth(1200);
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s3" },
        "application/x-wave-session",
      );

      // Drag over the pane element itself — the row handler picks it up
      // via bubbling (pane-level handlers ignore the session MIME).
      dragOverRow(dataTransfer, 405, screen.getByTestId("desktop-pane-pane-1"));
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row"), {
        dataTransfer,
        clientX: 405,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s3",
        row: 0,
        insertionIndex: 1,
      });
      expect(
        screen.queryByTestId("desktop-pane-drop-indicator"),
      ).not.toBeInTheDocument();
    });

    it("posts desktopOpenPane with the last insertionIndex when a dragged session drops on the right half of the last pane", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      mockRowWidth(1200);
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s3" },
        "application/x-wave-session",
      );

      // Right half of the last pane → boundary past the end, i.e. append.
      dragOverRow(dataTransfer, 700);
      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row"), {
        dataTransfer,
        clientX: 700,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s3",
        row: 0,
        insertionIndex: 2,
      });
    });

    it("honors a sidebar drop into a narrow row like a pane move (no width refusal)", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(500);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s2" },
        "application/x-wave-session",
      );
      vscode.postMessage.mockClear();

      fireEvent.drop(screen.getByTestId("desktop-pane-row"), {
        dataTransfer,
        clientX: 100,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopOpenPane",
          workdir: "/work/a",
          sessionId: "s2",
          row: 0,
        }),
      );
    });

    it("skips the width gate when the dropped session is already visible (host focuses its pane)", () => {
      const { vscode } = renderWithPanes(
        [{ paneId: "pane-0", sessionId: "s1" }],
        "pane-0",
      );
      mockRowWidth(500);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s1" },
        "application/x-wave-session",
      );
      vscode.postMessage.mockClear();

      fireEvent.drop(screen.getByTestId("desktop-pane-row"), {
        dataTransfer,
        clientX: 100,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopOpenPane",
          workdir: "/work/a",
          sessionId: "s1",
        }),
      );
    });

    it("posts desktopMovePane when a pane header is dragged onto another pane edge", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
          { paneId: "pane-2" },
        ],
        "pane-0",
      );
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);
      mockPaneRect("pane-2", 800, 400);

      const header = within(
        screen.getByTestId("desktop-pane-pane-2"),
      ).getByTestId("chat-header");
      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(header, { dataTransfer });
      expect(dataTransfer.getData("application/x-wave-pane")).toBe(
        JSON.stringify({ paneId: "pane-2" }),
      );

      // Left half of pane-0 → insert before it; the indicator shows.
      // jsdom lacks DragEvent, so fireEvent's dragOver drops clientX —
      // build the event manually to pin the pointer position.
      const target = screen.getByTestId("desktop-pane-pane-0");
      const dragOver = createEvent.dragOver(target, { dataTransfer });
      Object.defineProperty(dragOver, "clientX", { value: 100 });
      fireEvent(target, dragOver);
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(target, { dataTransfer, clientX: 100 });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopMovePane",
        paneId: "pane-2",
        toRow: 0,
        toIndex: 0,
      });
      expect(
        screen.queryByTestId("desktop-pane-drop-indicator"),
      ).not.toBeInTheDocument();
    });

    it("does not post desktopMovePane when a pane header drops at its own position", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
          { paneId: "pane-2" },
        ],
        "pane-0",
      );
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);
      mockPaneRect("pane-2", 800, 400);

      const header = within(
        screen.getByTestId("desktop-pane-pane-1"),
      ).getByTestId("chat-header");
      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(header, { dataTransfer });

      // Left half of pane-1 → boundary 1, which equals the pane's own index.
      const target = screen.getByTestId("desktop-pane-pane-1");
      const dragOver = createEvent.dragOver(target, { dataTransfer });
      Object.defineProperty(dragOver, "clientX", { value: 450 });
      fireEvent(target, dragOver);
      vscode.postMessage.mockClear();
      fireEvent.drop(target, { dataTransfer, clientX: 450 });

      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopMovePane" }),
      );
    });

    it("vetoes the pane drag when the press starts on a header button, so buttons stay clickable", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      const pane = screen.getByTestId("desktop-pane-pane-1");
      const header = within(pane).getByTestId("chat-header");
      const toggle = within(pane).getByTestId("panel-toggle-btn");

      // Browsers dispatch dragstart at the draggable header even when
      // the press began on a button inside it; simulate that sequence.
      fireEvent.mouseDown(toggle);
      const dataTransfer = makeDataTransfer();
      const dragStart = createEvent.dragStart(header, { dataTransfer });
      fireEvent(header, dragStart);

      expect(dataTransfer.getData("application/x-wave-pane")).toBe("");
      expect(dragStart.defaultPrevented).toBe(true);

      // A press on the header body still drags normally.
      fireEvent.mouseDown(header);
      const second = makeDataTransfer();
      fireEvent.dragStart(header, { dataTransfer: second });
      expect(second.getData("application/x-wave-pane")).toBe(
        JSON.stringify({ paneId: "pane-1" }),
      );
    });

    it("renders host-pushed pane widths as flex ratios", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1", width: 0.75 },
          { paneId: "pane-1", sessionId: "s2", width: 0.25 },
        ],
        "pane-0",
      );

      expect(screen.getByTestId("desktop-pane-pane-0").style.flex).toContain(
        "75%",
      );
      expect(screen.getByTestId("desktop-pane-pane-1").style.flex).toContain(
        "25%",
      );
    });

    it("previews widths while dragging a separator and posts desktopResizePanes on mouseup", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      mockPaneRect("pane-0", 0, 600);
      mockPaneRect("pane-1", 600, 600);

      fireEvent.mouseDown(screen.getByTestId("desktop-pane-separator-0"), {
        clientX: 600,
      });
      fireEvent.mouseMove(window, { clientX: 660 });

      expect(screen.getByTestId("desktop-pane-pane-0").style.flex).toContain(
        "660px",
      );
      expect(screen.getByTestId("desktop-pane-pane-1").style.flex).toContain(
        "540px",
      );

      vscode.postMessage.mockClear();
      fireEvent.mouseUp(window);

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopResizePanes",
        row: 0,
        widths: [0.55, 0.45],
      });
      // The local preview is cleared — the host pushes the authoritative widths.
      expect(screen.getByTestId("desktop-pane-pane-0").style.flex).toBe("");
    });

    it("clamps the separator drag at the minimum pane width", () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      mockPaneRect("pane-0", 0, 600);
      mockPaneRect("pane-1", 600, 600);

      fireEvent.mouseDown(screen.getByTestId("desktop-pane-separator-0"), {
        clientX: 600,
      });
      fireEvent.mouseMove(window, { clientX: 600 + 10000 });

      expect(screen.getByTestId("desktop-pane-pane-0").style.flex).toContain(
        "840px",
      );
      expect(screen.getByTestId("desktop-pane-pane-1").style.flex).toContain(
        "360px",
      );

      vscode.postMessage.mockClear();
      fireEvent.mouseUp(window);

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopResizePanes",
        row: 0,
        widths: [0.7, 0.3],
      });
    });

    it("routes a pane-tagged host push only to the matching pane", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      const panes = screen.getAllByTestId("chat-container");
      sendCommand("updateMessages", {
        paneId: "pane-1",
        messages: [MockDataGenerator.createUserMessage("hello pane two")],
      });

      expect(panes[0]).not.toHaveTextContent("hello pane two");
      expect(panes[1]).toHaveTextContent("hello pane two");
    });

    it("tags outgoing sendMessage with the paneId of the pane it was sent from", async () => {
      const { vscode } = renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );
      // Both panes start a conversation so the input is enabled.
      sendCommand("updateMessages", {
        paneId: "pane-0",
        messages: [MockDataGenerator.createUserMessage("a")],
      });
      sendCommand("updateMessages", {
        paneId: "pane-1",
        messages: [MockDataGenerator.createUserMessage("b")],
      });
      vscode.postMessage.mockClear();

      const inputs = screen.getAllByTestId("message-input");
      inputs[1].textContent = "from pane two";
      await fireInput(inputs[1], { inputType: "insertText" });
      const sendButtons = screen.getAllByTestId("send-btn");
      fireEvent.click(sendButtons[1]);

      const sent = vscode.postMessage.mock.calls
        .map((c) => c[0])
        .filter((m: Record<string, unknown>) => m.command === "sendMessage");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        paneId: "pane-1",
        text: "from pane two",
      });
    });
  });

  describe("pane rows (two-row layout)", () => {
    const session = (sessionId: string, title: string) => ({
      sessionId,
      title,
      lastActiveAt: Date.now(),
      hasWorktree: false,
    });

    function renderWithRows(
      panes: Array<{
        paneId: string;
        sessionId?: string;
        width?: number;
        row?: 0 | 1;
      }>,
      rowHeights: number[] | undefined,
      focusedPaneId: string | null,
    ) {
      const result = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopSessionTree", {
        groups: [
          {
            workdir: "/work/a",
            sessions: [
              session("s1", "chat one"),
              session("s2", "chat two"),
              session("s3", "chat three"),
            ],
          },
        ],
      });
      sendCommand("desktopPanes", { panes, rowHeights, focusedPaneId });
      return result;
    }

    function makeDataTransfer(
      payload?: Record<string, unknown>,
      mime = "application/x-wave-pane",
    ) {
      const store: Record<string, string> = {};
      if (payload) store[mime] = JSON.stringify(payload);
      return {
        get types() {
          return Object.keys(store);
        },
        setData: (type: string, value: string) => {
          store[type] = value;
        },
        getData: (type: string) => store[type] ?? "",
        effectAllowed: "",
        dropEffect: "",
      };
    }

    // jsdom reports 0 rects; pin real sizes where the layout measures.
    function mockRowsContainerHeight(height: number) {
      const el = screen.getByTestId("desktop-pane-rows");
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width: 1200,
        height,
        top: 0,
        left: 0,
        bottom: height,
        right: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }

    function mockRowRect(testid: string, top: number, height: number) {
      const el = screen.getByTestId(testid);
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width: 1200,
        height,
        top,
        left: 0,
        bottom: top + height,
        right: 1200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    }

    function mockPaneRect(paneId: string, left: number, width: number) {
      const el = screen.getByTestId(`desktop-pane-${paneId}`);
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width,
        height: 600,
        top: 0,
        left,
        bottom: 600,
        right: left + width,
        x: left,
        y: 0,
        toJSON: () => ({}),
      });
    }

    // jsdom lacks DragEvent, so fireEvent's dragOver drops clientX/clientY —
    // build the event manually to pin the pointer position.
    function dragOverAt(
      target: Element,
      dataTransfer: ReturnType<typeof makeDataTransfer>,
      pos: { clientX?: number; clientY?: number },
    ) {
      const event = createEvent.dragOver(target, { dataTransfer });
      if (pos.clientX !== undefined)
        Object.defineProperty(event, "clientX", { value: pos.clientX });
      if (pos.clientY !== undefined)
        Object.defineProperty(event, "clientY", { value: pos.clientY });
      fireEvent(target, event);
    }

    it("renders two rows with a row separator and applies the host row heights", () => {
      renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.6, 0.4],
        "pane-0",
      );

      expect(screen.getByTestId("desktop-row-separator")).toBeInTheDocument();
      expect(screen.getByTestId("desktop-pane-row").style.flex).toContain(
        "60%",
      );
      expect(screen.getByTestId("desktop-pane-row-1").style.flex).toContain(
        "40%",
      );
      expect(
        within(screen.getByTestId("desktop-pane-row")).getByTestId(
          "desktop-pane-pane-0",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("desktop-pane-row-1")).getByTestId(
          "desktop-pane-pane-1",
        ),
      ).toBeInTheDocument();
    });

    it("previews heights while dragging the row separator and posts desktopResizePaneRows on mouseup", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      mockRowsContainerHeight(800);

      fireEvent.mouseDown(screen.getByTestId("desktop-row-separator"), {
        clientY: 400,
      });
      fireEvent.mouseMove(window, { clientY: 500 });

      expect(screen.getByTestId("desktop-pane-row").style.flex).toContain(
        "500px",
      );
      expect(screen.getByTestId("desktop-pane-row-1").style.flex).toContain(
        "300px",
      );

      vscode.postMessage.mockClear();
      fireEvent.mouseUp(window, { clientY: 500 });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopResizePaneRows",
        heights: [500, 300],
      });
      // The local preview is cleared — the host pushes the authoritative heights.
      expect(screen.getByTestId("desktop-pane-row").style.flex).toContain(
        "50%",
      );
    });

    it("clamps the row separator drag at the minimum row height", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      mockRowsContainerHeight(800);

      fireEvent.mouseDown(screen.getByTestId("desktop-row-separator"), {
        clientY: 400,
      });
      fireEvent.mouseMove(window, { clientY: -10000 });
      vscode.postMessage.mockClear();
      fireEvent.mouseUp(window, { clientY: -10000 });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopResizePaneRows",
        heights: [280, 520],
      });
    });

    it("shows the drop zone on the bottom edge band and posts desktopOpenPane with newRow on drop", () => {
      const { vscode } = renderWithRows(
        [{ paneId: "pane-0", sessionId: "s1" }],
        undefined,
        "pane-0",
      );
      mockRowsContainerHeight(800);
      mockRowRect("desktop-pane-row", 0, 600);
      mockPaneRect("pane-0", 0, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s2" },
        "application/x-wave-session",
      );

      dragOverAt(screen.getByTestId("desktop-pane-row"), dataTransfer, {
        clientX: 200,
        clientY: 590,
      });

      const zone = screen.getByTestId("desktop-pane-dropzone");
      expect(zone.className).toContain("desktop-pane-dropzone--below");
      expect(
        screen.queryByTestId("desktop-pane-drop-indicator"),
      ).not.toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row"), { dataTransfer });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s2",
        newRow: "below",
      });
      expect(
        screen.queryByTestId("desktop-pane-dropzone"),
      ).not.toBeInTheDocument();
    });

    it("shows the drop zone on the top edge band and posts newRow: above", () => {
      const { vscode } = renderWithRows(
        [{ paneId: "pane-0", sessionId: "s1" }],
        undefined,
        "pane-0",
      );
      mockRowsContainerHeight(800);
      mockRowRect("desktop-pane-row", 0, 600);
      mockPaneRect("pane-0", 0, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s2" },
        "application/x-wave-session",
      );

      dragOverAt(screen.getByTestId("desktop-pane-row"), dataTransfer, {
        clientX: 200,
        clientY: 10,
      });

      expect(screen.getByTestId("desktop-pane-dropzone").className).toContain(
        "desktop-pane-dropzone--above",
      );

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row"), { dataTransfer });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s2",
        newRow: "above",
      });
    });

    it("shows the drop zone when a session dragover bubbles up from inside a pane", () => {
      const { vscode } = renderWithRows(
        [{ paneId: "pane-0", sessionId: "s1" }],
        undefined,
        "pane-0",
      );
      mockRowsContainerHeight(800);
      mockRowRect("desktop-pane-row", 0, 600);
      mockPaneRect("pane-0", 0, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s2" },
        "application/x-wave-session",
      );

      // The real event targets an element inside the pane (the pane's own
      // onDragOver ignores the session MIME) and bubbles to the row.
      const header = within(
        screen.getByTestId("desktop-pane-pane-0"),
      ).getByTestId("chat-header");
      dragOverAt(header, dataTransfer, { clientX: 200, clientY: 10 });

      expect(screen.getByTestId("desktop-pane-dropzone").className).toContain(
        "desktop-pane-dropzone--above",
      );

      vscode.postMessage.mockClear();
      fireEvent.drop(header, { dataTransfer });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s2",
        newRow: "above",
      });
    });

    it("refuses the edge-band split with a hint when the window is too short", () => {
      const { vscode } = renderWithRows(
        [{ paneId: "pane-0", sessionId: "s1" }],
        undefined,
        "pane-0",
      );
      mockRowsContainerHeight(400);
      mockRowRect("desktop-pane-row", 0, 380);
      mockPaneRect("pane-0", 0, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s2" },
        "application/x-wave-session",
      );

      dragOverAt(screen.getByTestId("desktop-pane-row"), dataTransfer, {
        clientX: 200,
        clientY: 370,
      });

      expect(
        screen.queryByTestId("desktop-pane-dropzone"),
      ).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "窗口高度不足，无法拆分为两行",
      });

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row"), { dataTransfer });

      // No newRow split — the drop falls back to an in-row insertion.
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopOpenPane",
          newRow: "below",
        }),
      );
    });

    it("posts desktopMovePane with newRow when a pane header drops on the bottom edge band", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        undefined,
        "pane-0",
      );
      mockRowsContainerHeight(800);
      mockRowRect("desktop-pane-row", 0, 600);
      mockPaneRect("pane-0", 0, 400);
      mockPaneRect("pane-1", 400, 400);

      const header = within(
        screen.getByTestId("desktop-pane-pane-1"),
      ).getByTestId("chat-header");
      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(header, { dataTransfer });

      const target = screen.getByTestId("desktop-pane-pane-0");
      dragOverAt(target, dataTransfer, { clientX: 100, clientY: 590 });
      expect(screen.getByTestId("desktop-pane-dropzone").className).toContain(
        "desktop-pane-dropzone--below",
      );

      vscode.postMessage.mockClear();
      fireEvent.drop(target, { dataTransfer });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopMovePane",
        paneId: "pane-1",
        newRow: "below",
      });
    });

    it("posts desktopMovePane with toRow/toIndex when a pane header drops on a second-row pane", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      mockPaneRect("pane-1", 0, 400);

      const header = within(
        screen.getByTestId("desktop-pane-pane-0"),
      ).getByTestId("chat-header");
      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(header, { dataTransfer });

      // Left half of pane-1 (the only second-row pane) → insert before it.
      const target = screen.getByTestId("desktop-pane-pane-1");
      dragOverAt(target, dataTransfer, { clientX: 100, clientY: 500 });
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(target, { dataTransfer });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopMovePane",
        paneId: "pane-0",
        toRow: 1,
        toIndex: 0,
      });
    });

    it("posts desktopOpenPane with row: 1 when a dragged session drops on the second row", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      // canAddPane measures the row element; give it a real width (jsdom reports 0).
      mockRowRect("desktop-pane-row-1", 300, 300);
      mockPaneRect("pane-1", 0, 400);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s3" },
        "application/x-wave-session",
      );

      // Right half of the only second-row pane → append after it.
      dragOverAt(screen.getByTestId("desktop-pane-pane-1"), dataTransfer, {
        clientX: 300,
        clientY: 500,
      });
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row-1"), {
        dataTransfer,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s3",
        row: 1,
        insertionIndex: 1,
      });
    });

    it("honors a dragged session drop onto a narrow second row like a pane move", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
          { paneId: "pane-2", sessionId: "s3", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      // Second row: 2 panes in 500px → a third would be ~166px, below the
      // min width. Drops squeeze in like pane moves — no refusal.
      const narrow = {
        width: 500,
        height: 300,
        top: 300,
        left: 0,
        bottom: 600,
        right: 500,
        x: 0,
        y: 300,
        toJSON: () => ({}),
      };
      vi.spyOn(
        screen.getByTestId("desktop-pane-row-1"),
        "getBoundingClientRect",
      ).mockReturnValue(narrow as DOMRect);
      mockPaneRect("pane-2", 250, 250);
      const dataTransfer = makeDataTransfer(
        { workdir: "/work/a", sessionId: "s4" },
        "application/x-wave-session",
      );

      dragOverAt(screen.getByTestId("desktop-pane-pane-2"), dataTransfer, {
        clientX: 400,
        clientY: 500,
      });
      expect(
        screen.getByTestId("desktop-pane-drop-indicator"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      fireEvent.drop(screen.getByTestId("desktop-pane-row-1"), {
        dataTransfer,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopOpenPane",
          workdir: "/work/a",
          sessionId: "s4",
          row: 1,
        }),
      );
    });

    it("spills Cmd/Ctrl+Click into the other row when the focused row is full", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      // Row 0: one pane in 500px → 250px each after adding, below the
      // minimum. Row 1: one pane in 1200px → fits.
      vi.spyOn(
        screen.getByTestId("desktop-pane-row"),
        "getBoundingClientRect",
      ).mockReturnValue({
        width: 500,
        height: 300,
        top: 0,
        left: 0,
        bottom: 300,
        right: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      mockRowRect("desktop-pane-row-1", 300, 300);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s3"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopOpenPane",
        workdir: "/work/a",
        sessionId: "s3",
        row: 1,
      });
    });

    it("refuses Cmd/Ctrl+Click with a hint when both rows are full", () => {
      const { vscode } = renderWithRows(
        [
          { paneId: "pane-0", sessionId: "s1", row: 0 },
          { paneId: "pane-1", sessionId: "s2", row: 1 },
        ],
        [0.5, 0.5],
        "pane-0",
      );
      const narrow = {
        width: 500,
        height: 300,
        top: 0,
        left: 0,
        bottom: 300,
        right: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
      vi.spyOn(
        screen.getByTestId("desktop-pane-row"),
        "getBoundingClientRect",
      ).mockReturnValue(narrow as DOMRect);
      vi.spyOn(
        screen.getByTestId("desktop-pane-row-1"),
        "getBoundingClientRect",
      ).mockReturnValue(narrow as DOMRect);
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("desktop-session-main-s3"), {
        ctrlKey: true,
      });

      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopOpenPane" }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "窗口宽度不足，无法添加更多分屏",
      });
    });
  });

  describe("theme switching", () => {
    function sendInitialState(theme: { effective: "light" | "dark" }) {
      sendCommand("setInitialState", {
        messages: [],
        sessions: [],
        configurationData: {},
        pendingConfirmations: [],
        theme,
      });
    }

    it("applies the initial effective theme to <html data-theme> (FR-018)", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/home/user/project",
        recentWorkdirs: [],
      });
      sendCommand("setInitialState", { messages: [] });
      sendInitialState({ effective: "dark" });

      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("swaps <html data-theme> live on desktopThemeChange without reloading (FR-018)", () => {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/home/user/project",
        recentWorkdirs: [],
      });
      sendCommand("setInitialState", { messages: [] });
      sendInitialState({ effective: "dark" });
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      sendCommand("desktopThemeChange", { effective: "light" });

      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      // Chat is still mounted — no reload/rebuild
      expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    });
  });

  describe("background-session toasts follow the focused pane", () => {
    function renderWithPanes() {
      renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: [],
      });
      sendCommand("setInitialState", { messages: [] });
      sendCommand("desktopPanes", {
        panes: [
          { paneId: "pane-0", sessionId: "s1", host: "local" },
          { paneId: "pane-1", sessionId: "s2", host: "local" },
          { paneId: "pane-2", sessionId: "s3", host: "local" },
        ],
        focusedPaneId: "pane-0",
      });
    }

    function toastForS2() {
      sendCommand("showToast", {
        toast: {
          id: "toast-s2",
          message: "会话「后台任务」已完成",
          actionLabel: "查看",
          action: { type: "focusSession", host: "local", sessionId: "s2" },
        },
      });
    }

    it("removes the toast once its session's pane becomes focused (spec scenario 12)", () => {
      renderWithPanes();
      toastForS2();
      expect(screen.getByText("会话「后台任务」已完成")).toBeInTheDocument();

      // Ctrl+Tab / clicking the pane — the focused pane now shows s2.
      sendCommand("desktopPanes", {
        panes: [
          { paneId: "pane-0", sessionId: "s1", host: "local" },
          { paneId: "pane-1", sessionId: "s2", host: "local" },
          { paneId: "pane-2", sessionId: "s3", host: "local" },
        ],
        focusedPaneId: "pane-1",
      });

      expect(
        screen.queryByText("会话「后台任务」已完成"),
      ).not.toBeInTheDocument();
    });

    it("keeps the toast while another session gains focus", () => {
      renderWithPanes();
      toastForS2();
      expect(screen.getByText("会话「后台任务」已完成")).toBeInTheDocument();

      // Focus moves to an unrelated pane (s3) — the s2 toast stays.
      sendCommand("desktopPanes", {
        panes: [
          { paneId: "pane-0", sessionId: "s1", host: "local" },
          { paneId: "pane-1", sessionId: "s2", host: "local" },
          { paneId: "pane-2", sessionId: "s3", host: "local" },
        ],
        focusedPaneId: "pane-2",
      });

      expect(screen.getByText("会话「后台任务」已完成")).toBeInTheDocument();
    });
  });

  describe("sidebar collapse/expand (spec 侧边栏收起/展开)", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    function renderReady() {
      const result = renderDesktopApp();
      sendCommand("desktopWorkdirState", {
        workdir: "/work/a",
        recentWorkdirs: ["/work/a"],
      });
      sendCommand("setInitialState", { messages: [] });
      return result;
    }

    function renderWithPanes(
      panes: Array<{ paneId: string; sessionId?: string; width?: number }>,
      focusedPaneId: string | null,
    ) {
      const result = renderReady();
      sendCommand("desktopSessionTree", {
        groups: [
          {
            workdir: "/work/a",
            sessions: [
              {
                sessionId: "s1",
                title: "chat one",
                lastActiveAt: Date.now(),
                hasWorktree: false,
              },
              {
                sessionId: "s2",
                title: "chat two",
                lastActiveAt: Date.now(),
                hasWorktree: false,
              },
            ],
          },
        ],
      });
      sendCommand("desktopPanes", { panes, focusedPaneId });
      return result;
    }

    it("collapses the sidebar fully and restores it via the header expand button", () => {
      renderReady();
      expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("desktop-sidebar-collapse"));

      // Fully hidden: not rendered, no reserved space, chat stays.
      expect(screen.queryByTestId("desktop-sidebar")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-container")).toBeInTheDocument();
      // Leftmost chat header shows the expand button (scenario 2).
      expect(screen.getByTestId("desktop-sidebar-expand")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("desktop-sidebar-expand"));
      expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
      expect(
        screen.queryByTestId("desktop-sidebar-expand"),
      ).not.toBeInTheDocument();
    });

    it("persists the collapsed state and restores it on a fresh mount (scenario 7)", () => {
      const first = renderReady();
      fireEvent.click(screen.getByTestId("desktop-sidebar-collapse"));
      expect(localStorage.getItem("wave.desktopSidebarCollapsed")).toBe("1");

      // Remount: a brand-new DesktopApp reads the persisted state.
      first.unmount();
      renderReady();
      expect(screen.queryByTestId("desktop-sidebar")).not.toBeInTheDocument();
      expect(screen.getByTestId("desktop-sidebar-expand")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("desktop-sidebar-expand"));
      expect(localStorage.getItem("wave.desktopSidebarCollapsed")).toBe("0");
      expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    });

    it("split view: expand button only in the leftmost pane; collapse is global (scenarios 4-5)", () => {
      renderWithPanes(
        [
          { paneId: "pane-0", sessionId: "s1" },
          { paneId: "pane-1", sessionId: "s2" },
        ],
        "pane-0",
      );

      fireEvent.click(screen.getByTestId("desktop-sidebar-collapse"));
      expect(screen.queryByTestId("desktop-sidebar")).not.toBeInTheDocument();

      const leftmostHeader = within(
        screen.getByTestId("desktop-pane-pane-0"),
      ).getByTestId("chat-header");
      const rightHeader = within(
        screen.getByTestId("desktop-pane-pane-1"),
      ).getByTestId("chat-header");

      expect(
        within(leftmostHeader).getByTestId("desktop-sidebar-expand"),
      ).toBeInTheDocument();
      expect(
        within(rightHeader).queryByTestId("desktop-sidebar-expand"),
      ).not.toBeInTheDocument();

      // Expanding from the pane restores the sidebar globally.
      fireEvent.click(
        within(leftmostHeader).getByTestId("desktop-sidebar-expand"),
      );
      expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    });
  });
});

describe("history popup (desktop-app.md 历史对话弹窗)", () => {
  const cliSession = {
    id: "session-cli",
    sessionType: "main",
    workdir: "/home/user/other-project",
    firstMessage: "CLI session",
    lastActiveAt: new Date("2023-12-01T11:00:00Z"),
    latestTotalTokens: 200,
  };
  const worktreeSession = {
    id: "session-wt",
    sessionType: "main",
    workdir: "/home/user/project",
    worktree: true,
    branch: "feature/x",
    firstMessage: "Worktree session",
    lastActiveAt: new Date("2023-12-01T10:00:00Z"),
    latestTotalTokens: 100,
  };

  function renderDesktopWithChat() {
    const result = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    return result;
  }

  it("opening the history popup requests the cross-workdir session list", () => {
    const { vscode } = renderDesktopWithChat();
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("history-btn"));

    // Local pane: the popup lists local sessions (host sent along so the host
    // scans the right machine — desktop-app.md 历史对话弹窗 场景 10).
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "listSessions",
      host: "local",
    });
    expect(screen.getByTestId("session-list-popup")).toBeInTheDocument();
  });

  it("a remote pane's popup lists that host's sessions and labels it", () => {
    const { vscode } = renderDesktopWithChat();
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "s-remote", host: "prod" }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [], paneId: "pane-1" });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("history-btn"));

    // The request carries the pane's effective remote host, not the local one
    // (plus the pane id, FR-032).
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "listSessions",
        host: "prod",
      }),
    );
    // The popup labels the host so the user can tell whose sessions are listed.
    expect(screen.getByTestId("session-list-host-label")).toHaveTextContent(
      "prod",
    );
  });

  it("shows workdir, worktree tag and branch label per row", () => {
    renderDesktopWithChat();

    act(() => {
      sendCommand("updateSessions", {
        sessions: [worktreeSession, cliSession],
      });
    });

    fireEvent.click(screen.getByTestId("history-btn"));

    // Worktree session: main-repo path + worktree tag + branch label.
    const wtItem = screen.getByTestId("session-list-item-session-wt");
    expect(wtItem).toHaveTextContent("/home/user/project");
    expect(wtItem).toHaveTextContent("worktree");
    expect(wtItem).toHaveTextContent("feature/x");
    // Plain CLI session: its workdir shown, no tags.
    const cliItem = screen.getByTestId("session-list-item-session-cli");
    expect(cliItem).toHaveTextContent("/home/user/other-project");
    expect(cliItem).not.toHaveTextContent("worktree");
  });

  it("selecting a row posts desktopSelectSession with the row workdir", () => {
    const { vscode } = renderDesktopWithChat();

    act(() => {
      sendCommand("updateSessions", {
        sessions: [cliSession],
      });
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("history-btn"));
    fireEvent.click(screen.getByTestId("session-list-item-session-cli"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopSelectSession",
        workdir: "/home/user/other-project",
        sessionId: "session-cli",
      }),
    );
  });

  it("restoring a remote popup row routes through the popup's host", () => {
    const { vscode } = renderDesktopWithChat();
    const remoteSession = {
      ...cliSession,
      id: "session-remote-cli",
      workdir: "/remote/repo",
    };
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "s-remote", host: "prod" }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [], paneId: "pane-1" });
    act(() => {
      sendCommand("updateSessions", {
        sessions: [remoteSession],
      });
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("history-btn"));
    fireEvent.click(screen.getByTestId("session-list-item-session-remote-cli"));

    // The restore carries the popup host — a remote CLI session is not in the
    // desktop index, so the host needs it to avoid falling back to local.
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopSelectSession",
        workdir: "/remote/repo",
        sessionId: "session-remote-cli",
        host: "prod",
      }),
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { ContextTag } from "../../src/components/ContextTag";
import { FileToolHeader } from "../../src/components/FileToolHeader";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  renderChatApp,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/** Flushes the hook's rAF-deferred initial item focus. */
const flushOpenFocus = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Keyboard accessibility of the remaining custom interactive elements:
 * MoreMenu items, panel-toggle checkboxes, session-history list, context tags,
 * and tool file paths. Popup dropdowns (MoreMenu/PanelToggleMenu) share the
 * roving-tabindex keyboard model: Arrow keys move, Enter/Space activate,
 * Escape closes back to the trigger.
 */
describe("remaining keyboard accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.waveHostType;
  });

  describe("MoreMenu", () => {
    it("makes menu items Tab-focusable and activates 设置 with Enter", () => {
      const { vscode } = renderChatApp();
      fireEvent.click(screen.getByTestId("more-btn"));

      const settings = screen.getByTestId("more-menu-settings");
      expect(settings).toHaveProperty("tabIndex", 0);

      settings.focus();
      fireEvent.keyDown(settings, { key: "Enter" });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "getConfiguration",
      });
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    });

    it("opens focused on the first item; ArrowDown moves roving focus; Escape returns to the trigger", async () => {
      renderChatApp();
      const trigger = screen.getByTestId("more-btn");
      fireEvent.click(trigger);
      await flushOpenFocus();

      // Controlled menus auto-focus their first item after the open frame.
      const settings = screen.getByTestId("more-menu-settings");
      const enterprise = screen.getByTestId("more-menu-enterprise");
      expect(document.activeElement).toBe(settings);

      fireEvent.keyDown(settings, { key: "ArrowDown" });
      expect(document.activeElement).toBe(enterprise);
      expect(enterprise).toHaveProperty("tabIndex", 0);
      expect(settings).toHaveProperty("tabIndex", -1);

      fireEvent.keyDown(enterprise, { key: "Escape" });
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    });

    it("activates the logout item with Space", () => {
      const { vscode } = renderChatApp();
      fireEvent.click(screen.getByTestId("more-btn"));

      const logout = screen.getByTestId("more-menu-logout");
      logout.focus();
      fireEvent.keyDown(logout, { key: " " });

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: "logout" });
    });

    it("closes the menu with Escape", () => {
      renderChatApp();
      fireEvent.click(screen.getByTestId("more-btn"));

      const enterprise = screen.getByTestId("more-menu-enterprise");
      enterprise.focus();
      fireEvent.keyDown(enterprise, { key: "Escape" });

      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    });
  });

  describe("PanelToggleMenu", () => {
    const renderDesktop = () => {
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
    };

    it("makes items Tab-focusable and toggles a panel with Space", () => {
      window.waveHostType = "desktop";
      const { vscode } = renderDesktop();
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      const diffItem = screen.getByTestId("panel-toggle-item-diff");
      // Roving tabindex: only the focused item is a tab stop.
      expect(diffItem).toHaveProperty("tabIndex", -1);

      diffItem.focus();
      fireEvent.keyDown(diffItem, { key: " " });

      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopGetWorkspaceDiff",
      });
      expect(diffItem).toHaveAttribute("aria-checked", "true");
      // Multi-select menu stays open after toggling.
      expect(screen.getByTestId("panel-toggle-menu")).toBeInTheDocument();
    });

    it("moves with Arrow keys without wrapping and skips nothing (disabled stays reachable but inert)", async () => {
      window.waveHostType = "desktop";
      renderDesktop();

      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      await flushOpenFocus();

      // Opening focuses the first item (预览).
      const preview = screen.getByTestId("panel-toggle-item-preview");
      expect(document.activeElement).toBe(preview);

      const kinds = ["preview", "plan", "diff", "terminal", "file"].map(
        (kind) => screen.getByTestId(`panel-toggle-item-${kind}`),
      );
      for (let i = 0; i < kinds.length - 1; i++) {
        fireEvent.keyDown(kinds[i], { key: "ArrowDown" });
        expect(document.activeElement).toBe(kinds[i + 1]);
      }
      // Below the last item: clamped (no wrap to the top).
      fireEvent.keyDown(kinds[kinds.length - 1], { key: "ArrowDown" });
      expect(document.activeElement).toBe(kinds[kinds.length - 1]);
    });

    it("closes the panel menu with Escape", () => {
      window.waveHostType = "desktop";
      renderDesktop();

      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      const previewItem = screen.getByTestId("panel-toggle-item-preview");
      previewItem.focus();
      fireEvent.keyDown(previewItem, { key: "Escape" });

      expect(screen.queryByTestId("panel-toggle-menu")).not.toBeInTheDocument();
    });
  });

  describe("SessionListPopup", () => {
    const sessions = [
      {
        id: "session-1",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "First session hello",
        lastActiveAt: new Date("2023-12-01T10:00:00Z"),
        latestTotalTokens: 150,
      },
      {
        id: "session-2",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "Second session world",
        lastActiveAt: new Date("2023-12-02T10:00:00Z"),
        latestTotalTokens: 200,
      },
    ];

    const openPopup = () => {
      sendCommand("updateSessions", { sessions });
      fireEvent.click(screen.getByTestId("history-btn"));
      return screen.getByTestId("session-list-popup");
    };

    it("moves the roving selection with arrows and restores the session with Enter", () => {
      const { vscode } = renderChatApp();
      openPopup();
      vscode.postMessage.mockClear();

      const search = screen.getByPlaceholderText("搜索关键词");
      // First item selected by default; Enter restores it.
      fireEvent.keyDown(search, { key: "Enter" });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "restoreSession",
          sessionId: "session-1",
        }),
      );
    });

    it("ArrowDown moves selection to the next item", () => {
      const { vscode } = renderChatApp();
      openPopup();
      vscode.postMessage.mockClear();

      const search = screen.getByPlaceholderText("搜索关键词");
      fireEvent.keyDown(search, { key: "ArrowDown" });

      const secondItem = screen.getByTestId("session-list-item-session-2");
      expect(secondItem).toHaveAttribute("aria-selected", "true");
      expect(secondItem).toHaveProperty("tabIndex", 0);
      const firstItem = screen.getByTestId("session-list-item-session-1");
      expect(firstItem).toHaveProperty("tabIndex", -1);

      fireEvent.keyDown(search, { key: "Enter" });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "restoreSession",
          sessionId: "session-2",
        }),
      );
    });

    it("activates a session item with Enter directly", () => {
      const { vscode } = renderChatApp();
      openPopup();
      vscode.postMessage.mockClear();

      const secondItem = screen.getByTestId("session-list-item-session-2");
      secondItem.focus();
      fireEvent.keyDown(secondItem, { key: "Enter" });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "restoreSession",
          sessionId: "session-2",
        }),
      );
      expect(
        screen.queryByTestId("session-list-popup"),
      ).not.toBeInTheDocument();
    });
  });

  describe("ContextTag", () => {
    it("is Tab-focusable and opens the preview with Enter when clickable", () => {
      const onPreview = vi.fn();
      render(
        <ContextTag
          name="img.png"
          path="/a/img.png"
          isImage
          onClick={onPreview}
        />,
      );

      const tag = screen.getByRole("button");
      expect(tag).toHaveProperty("tabIndex", 0);

      tag.focus();
      fireEvent.keyDown(tag, { key: "Enter" });
      expect(onPreview).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(tag, { key: " " });
      expect(onPreview).toHaveBeenCalledTimes(2);
    });

    it("stays out of the tab order when not clickable", () => {
      render(<ContextTag name="file.ts" path="/a/file.ts" />);

      const tag = screen.getByLabelText("/a/file.ts");
      expect(tag).not.toHaveProperty("tabIndex", 0);
      expect(tag.getAttribute("role")).toBeNull();
    });
  });

  describe("FileToolHeader", () => {
    it("makes the file path Tab-focusable and opens it with Enter/Space", () => {
      const onOpenFile = vi.fn();
      render(
        <FileToolHeader
          toolBlock={
            {
              id: "tool-1",
              name: "read",
              stage: "end",
              success: true,
            } as unknown as Parameters<typeof FileToolHeader>[0]["toolBlock"]
          }
          filePath="/home/user/project/src/foo.ts"
          onOpenFile={onOpenFile}
        />,
      );

      const pathEl = document.querySelector(".write-tool-path") as HTMLElement;
      expect(pathEl).toHaveProperty("tabIndex", 0);

      pathEl.focus();
      fireEvent.keyDown(pathEl, { key: "Enter" });
      expect(onOpenFile).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(pathEl, { key: " " });
      expect(onOpenFile).toHaveBeenCalledTimes(2);
    });
  });
});

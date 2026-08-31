import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  sendHostMessage,
  fixtures,
  fireInput,
  createMockVscode,
} from "./test-utils";
import React from "react";
import { ChatApp } from "../../src/components/ChatApp";
import type { VsCodeApi } from "../../src/types";

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("Model, Status, and Login Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/status command", () => {
    it("should open status dialog and show version, sessionId, and workdir", async () => {
      renderChatApp();

      await act(async () => {
        await typeAndSend("/status");
      });

      // Wait for dialog to appear
      await waitFor(() => {
        expect(
          document.querySelector(".configuration-dialog-overlay"),
        ).toBeInTheDocument();
      });

      // StatusDialog sends getStatus on mount and listens for statusResponse
      await act(async () => {
        sendCommand("statusResponse", {
          version: "1.2.3",
          sessionId: "session-abc-123",
          workdir: "/home/user/project",
        });
      });

      const dialog = document.querySelector(
        ".configuration-dialog",
      ) as HTMLElement;
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveTextContent("1.2.3");
      expect(dialog).toHaveTextContent("session-abc-123");
      expect(dialog).toHaveTextContent("/home/user/project");
    });

    it("should close status dialog when close button is clicked", async () => {
      renderChatApp();

      await act(async () => {
        await typeAndSend("/status");
      });

      await waitFor(() => {
        expect(
          document.querySelector(".configuration-dialog-overlay"),
        ).toBeInTheDocument();
      });

      const closeButton = document.querySelector(
        ".configuration-actions .configuration-cancel-btn",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        expect(
          document.querySelector(".configuration-dialog-overlay"),
        ).not.toBeInTheDocument();
      });
    });

    it("Escape while streaming closes the dialog without aborting the conversation", async () => {
      const { vscode } = renderChatApp();

      await act(async () => {
        await typeAndSend("/status");
      });

      await waitFor(() => {
        expect(
          document.querySelector(".configuration-dialog-overlay"),
        ).toBeInTheDocument();
      });

      // The main conversation is streaming — a plain Escape on the input would
      // normally fire onAbortMessage (MessageInput.tsx). The dialog's
      // capture-phase listener must swallow it first (same pattern as the btw
      // panel), so only the dialog closes and the agent loop keeps running.
      await act(async () => {
        sendCommand("startStreaming");
      });

      const input = screen.getByTestId("message-input");
      input.focus();
      await act(async () => {
        fireEvent.keyDown(input, { key: "Escape" });
      });

      expect(
        document.querySelector(".configuration-dialog-overlay"),
      ).not.toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "abortMessage" }),
      );
    });
  });

  describe("/config command", () => {
    it("IDE 模式发送 openSettings（默认全局设置），不再弹配置弹窗", async () => {
      const { vscode } = renderChatApp();

      await act(async () => {
        await typeAndSend("/config");
      });

      const call = vscode.postMessage.mock.calls.find(
        (c) => c[0]?.command === "openSettings",
      );
      expect(call).toBeDefined();
      expect(call?.[0]?.nav).toBeUndefined();
      expect(
        document.querySelector(".configuration-dialog-overlay"),
      ).not.toBeInTheDocument();
    });

    it("desktop 模式打开设置页「全局设置」选项卡并只读展示配置", async () => {
      const mockVscode = createMockVscode();
      const host = {
        type: "desktop",
        host: "local",
        hosts: ["local"],
        recentWorkdirs: [],
        workdir: "/work/a",
        sessionTree: [],
        panes: [],
        focusedPaneId: undefined,
        onSelectWorkdir: () => {},
        onSelectRecentWorkdir: () => {},
        onRemoveRecentWorkdir: () => {},
        onSelectHost: () => {},
        onAddHost: () => {},
        onSelectRemotePath: () => {},
        onListRemoteDir: () => {},
        onSelectSession: () => {},
        onDeleteSession: () => {},
        onOpenPane: () => {},
      } as unknown as React.ComponentProps<typeof ChatApp>["host"];
      render(
        <ChatApp vscode={mockVscode as unknown as VsCodeApi} host={host} />,
      );
      sendHostMessage(fixtures.authStatusResponse());
      sendCommand("configurationResponse", {
        configurationData: { language: "zh-CN", contextLength: 200 },
      });

      const input = screen.getByTestId("message-input");
      input.focus();
      await act(async () => {
        input.textContent = "/config";
        const range = document.createRange();
        range.selectNodeContents(input);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        fireEvent.input(input, { data: "/config", inputType: "insertText" });
      });
      fireEvent.keyDown(input, { key: "Enter" });

      // 设置页「全局设置」选项卡激活（导航项 is-active 且内容区只读展示语言）
      expect(
        await screen.findByText("管理 Wave 的界面、模型和基础行为。"),
      ).toBeInTheDocument();
      const navItem = screen.getByRole("button", { name: /全局设置/ });
      expect(navItem).toHaveClass("is-active");

      // 只读展示：无 select/input/保存按钮，当前值以文本呈现
      expect(
        document.querySelector(".settings-select"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("中文")).toBeInTheDocument();
      expect(screen.getByText("200 K")).toBeInTheDocument();
      expect(
        document.querySelector(".settings-save-btn"),
      ).not.toBeInTheDocument();
      expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "updateConfiguration" }),
      );
    });
  });
});

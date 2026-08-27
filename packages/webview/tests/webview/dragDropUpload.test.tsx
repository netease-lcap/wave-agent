import { render, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatApp } from "../../src/components/ChatApp";
import { createMockVscode, sendCommand } from "./test-utils";
import type { VsCodeApi } from "../../src/types";

/**
 * Desktop drag-and-drop file upload (spec desktop-app.md 文件拖拽上传): a
 * counter-backed overlay on the chat container, a drop that posts the files
 * with the paneId tagged, and an uploadSuccess reply that only inserts into
 * the originating pane's input.
 */

function renderPane(paneId: string) {
  const vscode = createMockVscode();
  const host = {
    type: "desktop",
    workdir: "/work/a",
    recentWorkdirs: [],
    panes: [],
    focusedPaneId: paneId,
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
  const view = render(
    <ChatApp
      vscode={vscode as unknown as VsCodeApi}
      host={host}
      paneId={paneId}
    />,
  );
  return {
    vscode: vscode as unknown as ReturnType<typeof createMockVscode>,
    ...view,
  };
}

const dragEnter = (container: Element) =>
  act(() => {
    fireEvent.dragEnter(container);
  });
const dragLeave = (container: Element) =>
  act(() => {
    fireEvent.dragLeave(container);
  });

describe("Desktop file drag-and-drop upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the overlay while a file hovers the pane and hides it when fully left", () => {
    const { container } = renderPane("pane-1");
    const chatContainer = document.querySelector(
      '[data-testid="chat-container"]',
    )!;
    expect(container.querySelector(".chat-drag-overlay")).toBeNull();

    dragEnter(chatContainer);
    expect(container.querySelector(".chat-drag-overlay")).not.toBeNull();
    expect(
      container.querySelector(".chat-drag-overlay-title"),
    ).toHaveTextContent("释放以上传文件");

    // Leave the pane entirely: counter drops back to zero -> overlay hides.
    dragLeave(chatContainer);
    expect(container.querySelector(".chat-drag-overlay")).toBeNull();
  });

  it("does not flicker on nested dragenter/dragleave passes (counter)", () => {
    const { container } = renderPane("pane-1");
    const chatContainer = document.querySelector(
      '[data-testid="chat-container"]',
    )!;

    // Two enters over child elements, one leave -> still dragging.
    dragEnter(chatContainer);
    dragEnter(chatContainer);
    dragLeave(chatContainer);
    expect(container.querySelector(".chat-drag-overlay")).not.toBeNull();

    // Second leave clears the counter -> overlay hides.
    dragLeave(chatContainer);
    expect(container.querySelector(".chat-drag-overlay")).toBeNull();
  });

  it("drops files: posts uploadFilesToArtifacts tagged with the paneId", async () => {
    const { vscode } = renderPane("pane-1");
    const chatContainer = document.querySelector(
      '[data-testid="chat-container"]',
    )!;

    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    dragEnter(chatContainer);
    await act(async () => {
      fireEvent.drop(chatContainer, {
        dataTransfer: { files: [file] },
      });
    });
    expect(containerHasOverlay(chatContainer)).toBe(false);

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uploadFilesToArtifacts",
          paneId: "pane-1",
        }),
      );
    });
    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    const upload = sent.find(
      (m: { command?: string }) => m.command === "uploadFilesToArtifacts",
    );
    expect(upload.files).toHaveLength(1);
    expect(upload.files[0].name).toBe("a.txt");
  });

  it("uploadSuccess routes by paneId: another pane's reply is ignored", async () => {
    renderPane("pane-1");
    const input = document.querySelector(
      '[data-testid="message-input"]',
    ) as HTMLElement;

    // A reply for a different pane must not insert into this input.
    act(() => {
      sendCommand("uploadSuccess", {
        paneId: "pane-2",
        uploadedFiles: ["artifacts/other-pane.txt"],
      });
    });
    expect(
      input.querySelectorAll("[data-testid='message-input'] .context-tag"),
    ).toHaveLength(0);

    // The reply for this pane inserts the path chip.
    act(() => {
      sendCommand("uploadSuccess", {
        paneId: "pane-1",
        uploadedFiles: ["artifacts/this-pane.txt"],
      });
    });
    await waitFor(() => {
      expect(input.querySelector(".context-tag")).toBeInTheDocument();
    });
    expect(input.textContent).toContain("this-pane.txt");
  });

  it("does not attach drag handlers outside the desktop host", () => {
    const vscode = createMockVscode();
    render(<ChatApp vscode={vscode as unknown as VsCodeApi} />);
    const chatContainer = document.querySelector(
      '[data-testid="chat-container"]',
    )!;
    dragEnter(chatContainer);
    expect(document.querySelector(".chat-drag-overlay")).toBeNull();
  });
});

function containerHasOverlay(chatContainer: Element): boolean {
  return !!chatContainer.querySelector(".chat-drag-overlay");
}

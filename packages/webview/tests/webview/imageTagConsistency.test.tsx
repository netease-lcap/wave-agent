import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

// Minimal valid 1x1 transparent PNG base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * Create a ClipboardEvent with an image file, matching the real paste handler expectations.
 */
function createImagePasteEvent(filename: string): ClipboardEvent {
  const byteCharacters = atob(TINY_PNG_BASE64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: "image/png" });
  const file = new File([blob], filename, { type: "image/png" });

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  return new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer,
  });
}

describe("Image Tag Consistency and Placeholder Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show consistent image tags in input and history with [imageN] placeholders", async () => {
    const { vscode } = renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    // 1. Simulate pasting two images
    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("image1.png"));
    });
    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("image2.png"));
    });

    // Wait for images to be processed and tags to appear
    await waitFor(() => {
      const tags = messageInput.querySelectorAll(".context-tag.is-image");
      expect(tags).toHaveLength(2);
    });

    // 2. Verify tags in input box have "图片 1" and "图片 2"
    const inputTags = messageInput.querySelectorAll(".context-tag.is-image");
    expect(inputTags[0]).toHaveTextContent("图片 1");
    expect(inputTags[1]).toHaveTextContent("图片 2");

    // 3. Clear and send the message
    vscode.postMessage.mockClear();

    const sendButton = screen.getByTestId("send-btn");
    await act(async () => {
      fireEvent.click(sendButton);
    });

    // 4. Verify the markdown sent to extension contains [image1] and [image2]
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    const sendMessage = sentMessages.find((m) => m.command === "sendMessage");
    if (sendMessage) {
      expect(sendMessage.text).toContain("[image1]");
      expect(sendMessage.text).toContain("[image2]");
    }

    // 5. Inject a message into history that uses [image1] and [image2]
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          {
            id: "msg_1",
            role: "user",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [
              {
                type: "text",
                content: "Check these: [image1] and [image2]",
              },
              {
                type: "image",
                imageUrls: [TINY_PNG_DATAURL, TINY_PNG_DATAURL],
              },
            ],
          },
        ],
      });
    });

    // 6. Verify tags in history also show "图片 1" and "图片 2"
    await waitFor(() => {
      const historyTags = document.querySelectorAll(
        ".message.user .context-tag.is-image",
      );
      expect(historyTags).toHaveLength(2);
    });

    const historyTags = document.querySelectorAll(
      ".message.user .context-tag.is-image",
    );
    expect(historyTags[0]).toHaveTextContent("图片 1");
    expect(historyTags[1]).toHaveTextContent("图片 2");
  });

  it("should open image preview modal when clicking history image tag", async () => {
    renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          {
            id: "msg_1",
            role: "user",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [
              {
                type: "text",
                content: "Check this: [image1]",
              },
              {
                type: "image",
                imageUrls: [TINY_PNG_DATAURL],
              },
            ],
          },
        ],
      });
    });

    // Wait for the history tag to render
    await waitFor(() => {
      const historyTags = document.querySelectorAll(
        ".message.user .context-tag.is-image",
      );
      expect(historyTags).toHaveLength(1);
    });

    const historyTag = document.querySelector(
      ".message.user .context-tag.is-image",
    ) as HTMLElement;

    // Click the tag to open preview
    await act(async () => {
      fireEvent.click(historyTag);
    });

    // Verify modal is visible
    await waitFor(() => {
      const modal = document.querySelector(".image-preview-modal");
      expect(modal).toBeInTheDocument();
    });

    const modal = document.querySelector(".image-preview-modal")!;
    expect(modal.querySelector("img")).toBeInTheDocument();

    // Close modal
    const closeBtn = document.querySelector(
      ".image-preview-close",
    ) as HTMLElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    await waitFor(() => {
      expect(
        document.querySelector(".image-preview-modal"),
      ).not.toBeInTheDocument();
    });
  });
});

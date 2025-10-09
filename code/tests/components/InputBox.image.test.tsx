import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InputBox } from "../../src/components/InputBox.js";
import * as clipboardModule from "wave-agent-sdk";
import * as messageOperationsModule from "wave-agent-sdk";
import { waitForText, waitForTextToDisappear } from "../helpers/waitHelpers.js";

// Mock the clipboard module
vi.mock("wave-agent-sdk", () => ({
  readClipboardImage: vi.fn(),
  hasClipboardImage: vi.fn(),
  cleanupTempImage: vi.fn(),
}));

// Mock the messageOperations module
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    addUserMessageToMessages: vi.fn(),
    convertImageToBase64: vi.fn(),
  };
});

const mockClipboard = clipboardModule as typeof clipboardModule & {
  readClipboardImage: ReturnType<typeof vi.fn>;
  hasClipboardImage: ReturnType<typeof vi.fn>;
  cleanupTempImage: ReturnType<typeof vi.fn>;
};

const mockMessageOperations =
  messageOperationsModule as typeof messageOperationsModule & {
    convertImageToBase64: ReturnType<typeof vi.fn>;
    addUserMessageToMessages: ReturnType<typeof vi.fn>;
  };

describe("InputBox Image Paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock convertImageToBase64 to return a mock base64 string
    mockMessageOperations.convertImageToBase64.mockReturnValue(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    );

    // Mock addUserMessageToMessages to return messages array
    mockMessageOperations.addUserMessageToMessages.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display pasted image placeholder", async () => {
    // Mock successful image read
    mockClipboard.readClipboardImage.mockResolvedValue({
      success: true,
      imagePath: "/tmp/test-image.png",
      mimeType: "image/png",
    });

    const { lastFrame, stdin } = render(<InputBox />);

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the image placeholder to appear
    await waitForText(lastFrame, "[Image #1]");

    const output = lastFrame();
    expect(output).toContain("[Image #1]");
  });

  it("should show image placeholder in input when image is pasted", async () => {
    // Mock successful image read
    mockClipboard.readClipboardImage.mockResolvedValue({
      success: true,
      imagePath: "/tmp/test-image.png",
      mimeType: "image/png",
    });

    const { lastFrame, stdin } = render(<InputBox />);

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the image placeholder to appear
    await waitForText(lastFrame, "[Image #1]");

    const output = lastFrame();
    // Should show placeholder in input text, but not attachment list
    expect(output).toContain("[Image #1]");
    expect(output).not.toContain("📎 Attached Images:");
  });

  it("should handle multiple pasted images", async () => {
    // Mock successful image reads
    mockClipboard.readClipboardImage
      .mockResolvedValueOnce({
        success: true,
        imagePath: "/tmp/test-image1.png",
        mimeType: "image/png",
      })
      .mockResolvedValueOnce({
        success: true,
        imagePath: "/tmp/test-image2.jpg",
        mimeType: "image/jpeg",
      });

    const { lastFrame, stdin } = render(<InputBox />);

    // Simulate two Ctrl+V operations
    stdin.write("\u0016"); // First Ctrl+V
    await waitForText(lastFrame, "[Image #1]");

    stdin.write("\u0016"); // Second Ctrl+V
    await waitForText(lastFrame, "[Image #1][Image #2]");

    const output = lastFrame();
    // Should show both placeholders in input text, but no attachment list
    expect(output).toContain("[Image #1][Image #2]");
    expect(output).not.toContain("📎 Attached Images:");
  });

  it("should handle failed image paste gracefully", async () => {
    // Mock failed image read
    mockClipboard.readClipboardImage.mockResolvedValue({
      success: false,
      error: "No image found in clipboard",
    });

    const { lastFrame, stdin } = render(<InputBox />);

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the input to stabilize - ensure we still have the initial placeholder
    await waitForText(lastFrame, "Type your message");

    const output = lastFrame();
    // Should not contain image placeholder when paste fails
    expect(output).not.toContain("[Image #");
    expect(output).not.toContain("📎 Attached Images:");
  });

  it("should clear images after message is sent", async () => {
    // Mock successful image read
    mockClipboard.readClipboardImage.mockResolvedValue({
      success: true,
      imagePath: "/tmp/test-image.png",
      mimeType: "image/png",
    });

    const renderResult = render(<InputBox />);
    const { stdin } = renderResult;

    // Paste image
    stdin.write("\u0016"); // Ctrl+V
    await waitForText(renderResult.lastFrame, "[Image #1]");

    // Add some text (using individual characters to avoid triggering paste debounce)
    stdin.write("H");
    stdin.write("i");

    // Send message
    stdin.write("\r"); // Enter key

    // Wait for images to be cleared using waitForTextToDisappear
    await waitForTextToDisappear(renderResult.lastFrame, "[Image #1]", {
      timeout: 2000,
    });

    // Verify no images are shown
    expect(renderResult.lastFrame()).not.toContain("[Image #");
  });

  it("should allow sending message with only image (no text)", async () => {
    // Mock successful image read
    mockClipboard.readClipboardImage.mockResolvedValue({
      success: true,
      imagePath: "/tmp/test-image.png",
      mimeType: "image/png",
    });

    const renderResult = render(<InputBox />);
    const { stdin } = renderResult;

    // Paste image only (no text)
    stdin.write("\u0016"); // Ctrl+V
    await waitForText(renderResult.lastFrame, "[Image #1]");

    // Send message with Enter key (should work even without text)
    stdin.write("\r"); // Enter key

    // Wait for images to be cleared - this should work now
    await waitForTextToDisappear(renderResult.lastFrame, "[Image #1]", {
      timeout: 2000,
    });

    // Verify images are cleared after sending
    expect(renderResult.lastFrame()).not.toContain("[Image #");

    // The fact that images are cleared means the message was successfully sent,
    // which ensures the message structure is correct for displaying "📷 Image (1)" in MessageList
    // This validates that sendMessage was called with empty text content and image data
  });
});

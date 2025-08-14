import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InputBox } from "../src/components/InputBox";
import { ChatProvider } from "../src/contexts/useChat";
import { FileProvider } from "../src/contexts/useFiles";
import * as clipboardModule from "../src/utils/clipboard";
import * as messageOperationsModule from "../src/utils/messageOperations";
import { waitForTextToDisappear } from "./helpers/waitHelpers";

// Mock the clipboard module
vi.mock("../src/utils/clipboard", () => ({
  readClipboardImage: vi.fn(),
  hasClipboardImage: vi.fn(),
  cleanupTempImage: vi.fn(),
}));

// Mock the messageOperations module
vi.mock("../src/utils/messageOperations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/messageOperations")>();
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

// Mock the context providers
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <FileProvider workdir={process.cwd()}>
    <ChatProvider>{children}</ChatProvider>
  </FileProvider>
);

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

    const { lastFrame, stdin } = render(
      <TestWrapper>
        <InputBox />
      </TestWrapper>,
    );

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the async operation
    await new Promise((resolve) => setTimeout(resolve, 10));

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

    const { lastFrame, stdin } = render(
      <TestWrapper>
        <InputBox />
      </TestWrapper>,
    );

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the async operation
    await new Promise((resolve) => setTimeout(resolve, 10));

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

    const { lastFrame, stdin } = render(
      <TestWrapper>
        <InputBox />
      </TestWrapper>,
    );

    // Simulate two Ctrl+V operations
    stdin.write("\u0016"); // First Ctrl+V
    await new Promise((resolve) => setTimeout(resolve, 100));

    stdin.write("\u0016"); // Second Ctrl+V
    await new Promise((resolve) => setTimeout(resolve, 100));

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

    const { lastFrame, stdin } = render(
      <TestWrapper>
        <InputBox />
      </TestWrapper>,
    );

    // Simulate Ctrl+V
    stdin.write("\u0016"); // Ctrl+V

    // Wait for the async operation
    await new Promise((resolve) => setTimeout(resolve, 10));

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

    const renderResult = render(
      <TestWrapper>
        <InputBox />
      </TestWrapper>,
    );
    const { stdin } = renderResult;

    // Paste image
    stdin.write("\u0016"); // Ctrl+V
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Add some text (using individual characters to avoid triggering paste debounce)
    stdin.write("H");
    stdin.write("i");

    // Send message
    stdin.write("\r"); // Enter key

    // Wait for images to be cleared using waitForTextToDisappear
    await waitForTextToDisappear(renderResult, "[Image #1]", { timeout: 2000 });
  });
});

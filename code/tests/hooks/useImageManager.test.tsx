import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";
import { useImageManager } from "../../src/hooks/useImageManager.js";
import type { ClipboardImageResult } from "wave-agent-sdk";

// Mock the clipboard utils with proper hoisting
const mockReadClipboardImage = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({
  readClipboardImage: mockReadClipboardImage,
}));

describe("useImageManager Hook", () => {
  const mockInsertTextAtCursor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Image Management", () => {
    it("should initialize with empty state", () => {
      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const state = ref.current?.getState();
      expect(state?.attachedImages).toEqual([]);
    });

    it("should add an image correctly", () => {
      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Add an image
      const result = ref.current?.getState();
      const newImage = result?.addImage("/path/to/image.png", "image/png");

      // Rerender to see updated state
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      expect(newImage?.id).toBe(1);
      expect(newImage?.path).toBe("/path/to/image.png");
      expect(newImage?.mimeType).toBe("image/png");

      const updatedState = ref.current?.getState();
      expect(updatedState?.attachedImages).toHaveLength(1);
      expect(updatedState?.attachedImages[0]).toEqual({
        id: 1,
        path: "/path/to/image.png",
        mimeType: "image/png",
      });
    });

    it("should add multiple images with incrementing IDs", () => {
      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const manager = ref.current?.getState();

      // Add first image
      const image1 = manager?.addImage("/path1.png", "image/png");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Add second image
      const updatedManager = ref.current?.getState();
      const image2 = updatedManager?.addImage("/path2.jpg", "image/jpeg");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      expect(image1?.id).toBe(1);
      expect(image2?.id).toBe(2);

      const finalState = ref.current?.getState();
      expect(finalState?.attachedImages).toHaveLength(2);
    });

    it("should remove an image by ID", () => {
      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const manager = ref.current?.getState();

      // Add images
      manager?.addImage("/path1.png", "image/png");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const updatedManager = ref.current?.getState();
      updatedManager?.addImage("/path2.jpg", "image/jpeg");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Remove first image
      const finalManager = ref.current?.getState();
      finalManager?.removeImage(1);
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const finalState = ref.current?.getState();
      expect(finalState?.attachedImages).toHaveLength(1);
      expect(finalState?.attachedImages[0].id).toBe(2);
    });

    it("should clear all images", () => {
      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const manager = ref.current?.getState();

      // Add images
      manager?.addImage("/path1.png", "image/png");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const updatedManager = ref.current?.getState();
      updatedManager?.addImage("/path2.jpg", "image/jpeg");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Clear all images
      const finalManager = ref.current?.getState();
      finalManager?.clearImages();
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const finalState = ref.current?.getState();
      expect(finalState?.attachedImages).toEqual([]);
    });
  });

  describe("Clipboard Paste Functionality", () => {
    it("should successfully paste image from clipboard", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: true,
        imagePath: "/tmp/clipboard-image-123.png",
        mimeType: "image/png",
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const result = await ref.current?.getState()?.handlePasteImage();

      // Rerender to see updated state
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      expect(result).toBe(true);
      expect(mockReadClipboardImage).toHaveBeenCalledOnce();
      expect(mockInsertTextAtCursor).toHaveBeenCalledWith("[Image #1]");

      const state = ref.current?.getState();
      expect(state?.attachedImages).toHaveLength(1);
      expect(state?.attachedImages[0]).toEqual({
        id: 1,
        path: "/tmp/clipboard-image-123.png",
        mimeType: "image/png",
      });
    });

    it("should handle clipboard read failure", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: false,
        error: "No image found in clipboard",
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const result = await ref.current?.getState()?.handlePasteImage();

      expect(result).toBe(false);
      expect(mockReadClipboardImage).toHaveBeenCalledOnce();
      expect(mockInsertTextAtCursor).not.toHaveBeenCalled();
    });

    it("should handle clipboard API exception", async () => {
      mockReadClipboardImage.mockRejectedValue(new Error("API error"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const result = await ref.current?.getState()?.handlePasteImage();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to paste image from clipboard:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should handle missing image path in successful response", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: true,
        // Missing imagePath and mimeType
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const result = await ref.current?.getState()?.handlePasteImage();

      expect(result).toBe(false);
      expect(mockInsertTextAtCursor).not.toHaveBeenCalled();
    });

    it("should handle missing mimeType in successful response", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: true,
        imagePath: "/tmp/clipboard-image-123.png",
        // Missing mimeType
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const result = await ref.current?.getState()?.handlePasteImage();

      expect(result).toBe(false);
      expect(mockInsertTextAtCursor).not.toHaveBeenCalled();
    });

    it("should correctly increment image counter for multiple clipboard pastes", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: true,
        imagePath: "/tmp/clipboard-image.png",
        mimeType: "image/png",
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // First paste
      await ref.current?.getState()?.handlePasteImage();
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Second paste
      await ref.current?.getState()?.handlePasteImage();
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      expect(mockInsertTextAtCursor).toHaveBeenCalledTimes(2);
      expect(mockInsertTextAtCursor).toHaveBeenNthCalledWith(1, "[Image #1]");
      expect(mockInsertTextAtCursor).toHaveBeenNthCalledWith(2, "[Image #2]");

      const state = ref.current?.getState();
      expect(state?.attachedImages).toHaveLength(2);
      expect(state?.attachedImages[0].id).toBe(1);
      expect(state?.attachedImages[1].id).toBe(2);
    });
  });

  describe("Integration Tests", () => {
    it("should work correctly with mixed add and paste operations", async () => {
      const mockClipboardResult: ClipboardImageResult = {
        success: true,
        imagePath: "/tmp/clipboard-image.png",
        mimeType: "image/png",
      };
      mockReadClipboardImage.mockResolvedValue(mockClipboardResult);

      const ref =
        React.createRef<HookTesterRef<ReturnType<typeof useImageManager>>>();
      const { rerender } = render(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Manual add
      ref.current?.getState()?.addImage("/manual/image.jpg", "image/jpeg");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Clipboard paste
      await ref.current?.getState()?.handlePasteImage();
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      // Another manual add
      ref.current?.getState()?.addImage("/another/image.gif", "image/gif");
      rerender(
        <HookTester
          hook={() => useImageManager(mockInsertTextAtCursor)}
          ref={ref}
        />,
      );

      const state = ref.current?.getState();
      expect(state?.attachedImages).toHaveLength(3);
      expect(state?.attachedImages[0]).toEqual({
        id: 1,
        path: "/manual/image.jpg",
        mimeType: "image/jpeg",
      });
      expect(state?.attachedImages[1]).toEqual({
        id: 2,
        path: "/tmp/clipboard-image.png",
        mimeType: "image/png",
      });
      expect(state?.attachedImages[2]).toEqual({
        id: 3,
        path: "/another/image.gif",
        mimeType: "image/gif",
      });

      expect(mockInsertTextAtCursor).toHaveBeenCalledOnce();
      expect(mockInsertTextAtCursor).toHaveBeenCalledWith("[Image #2]");
    });
  });
});

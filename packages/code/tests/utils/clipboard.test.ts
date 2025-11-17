import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readClipboardImage,
  hasClipboardImage,
  cleanupTempImage,
} from "../../src/utils/clipboard.js";

// Mock all the dependencies - use vi.hoisted for proper hoisting
const mockExec = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockJoin = vi.hoisted(() => vi.fn());
const mockTmpdir = vi.hoisted(() => vi.fn());

// Mock child_process with dynamic import support
vi.mock("child_process", () => ({
  exec: mockExec,
}));

// Mock util module
vi.mock("util", () => ({
  promisify: vi.fn(() => mockExec),
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

// Mock path module
vi.mock("path", () => ({
  join: mockJoin,
}));

// Mock os module
vi.mock("os", () => ({
  tmpdir: mockTmpdir,
}));

describe("Clipboard Utils", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock returns
    mockTmpdir.mockReturnValue("/tmp");
    mockJoin.mockImplementation((...paths) => paths.join("/"));
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  });

  describe("readClipboardImage", () => {
    it("should return error for unsupported platform", async () => {
      Object.defineProperty(process, "platform", {
        value: "unsupported",
        writable: true,
      });

      const result = await readClipboardImage();

      expect(result.success).toBe(false);
      expect(result.error).toContain("not supported on platform");
    });

    describe("macOS", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "darwin",
          writable: true,
        });
      });

      it("should return error when no image in clipboard", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "false" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "success" }); // saveScript
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.mimeType).toBe("image/png");
      });

      it("should handle save script failure", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockRejectedValueOnce(new Error("Save failed"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on macOS",
        );
      });

      it("should handle file not created", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "success" }); // saveScript
        mockExistsSync.mockReturnValue(false);

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });
    });

    describe("Windows", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "win32",
          writable: true,
        });
      });

      it("should return error when no image in clipboard", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "false" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "true" }); // saveScript
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.mimeType).toBe("image/png");
      });

      it("should handle PowerShell access failure", async () => {
        mockExec.mockRejectedValueOnce(new Error("PowerShell failed"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to access clipboard on Windows");
      });

      it("should handle save failure", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "false" }); // saveScript failed

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });
    });

    describe("Linux", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
        });
      });

      it("should return error when xclip not available", async () => {
        mockExec.mockRejectedValueOnce(new Error("xclip not found"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("xclip is required");
      });

      it("should return error when no image in clipboard", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockRejectedValueOnce(new Error("No image")); // clipboard check

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }) // clipboard check
          .mockResolvedValueOnce({ stdout: "saved" }); // save image
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.mimeType).toBe("image/png");
      });

      it("should handle save failure", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }) // clipboard check
          .mockRejectedValueOnce(new Error("Save failed")); // save image fails

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to save clipboard image");
      });
    });
  });

  describe("hasClipboardImage", () => {
    it("should return false for unsupported platform", async () => {
      Object.defineProperty(process, "platform", {
        value: "unsupported",
        writable: true,
      });

      const result = await hasClipboardImage();
      expect(result).toBe(false);
    });

    describe("macOS", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "darwin",
          writable: true,
        });
      });

      it("should return true when image is available", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "true" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "false" });

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return false on error", async () => {
        mockExec.mockRejectedValueOnce(new Error("Script failed"));

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });
    });

    describe("Windows", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "win32",
          writable: true,
        });
      });

      it("should return true when image is available", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "true" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "false" });

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });
    });

    describe("Linux", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
        });
      });

      it("should return false when xclip not available", async () => {
        mockExec.mockRejectedValueOnce(new Error("xclip not found"));

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return true when image is available", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }); // clipboard check

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockRejectedValueOnce(new Error("No image")); // clipboard check

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });
    });
  });

  describe("cleanupTempImage", () => {
    it("should do nothing for non-existent file", () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => {
        cleanupTempImage("/path/that/does/not/exist.png");
      }).not.toThrow();

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it("should successfully delete existing file", () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {});

      cleanupTempImage("/tmp/test-image.png");

      expect(mockExistsSync).toHaveBeenCalledWith("/tmp/test-image.png");
      expect(mockUnlinkSync).toHaveBeenCalledWith("/tmp/test-image.png");
    });

    it("should handle deletion errors gracefully", () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      // Mock console.warn to prevent actual output
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(() => {
        cleanupTempImage("/tmp/test-image.png");
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to cleanup temporary image file"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});

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

    it("should handle unexpected errors in readClipboardImage", async () => {
      // Mock process.platform to throw
      Object.defineProperty(process, "platform", {
        get: () => {
          throw new Error("Platform access error");
        },
        configurable: true,
      });

      const result = await readClipboardImage();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read clipboard image");
      expect(result.error).toContain("Platform access error");
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

      it("should handle unexpected errors in readClipboardImageMac", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockImplementationOnce(() => {
            throw new Error("Unexpected error");
          });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on macOS",
        );
        expect(result.error).toContain("Unexpected error");
      });

      it("should handle hasImage check failure", async () => {
        mockExec.mockRejectedValueOnce(new Error("Check failed"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
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

      it("should handle unexpected errors in readClipboardImageWindows", async () => {
        // Mock promisify to throw
        const { promisify } = await import("util");
        vi.mocked(promisify).mockImplementationOnce(() => {
          throw new Error("Promisify failed");
        });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on Windows",
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

      it("should handle file not created after save", async () => {
        mockExec
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }) // clipboard check
          .mockResolvedValueOnce({ stdout: "saved" }); // save image
        mockExistsSync.mockReturnValue(false);

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });

      it("should handle unexpected errors in readClipboardImageLinux", async () => {
        // Mock the first exec call (which xclip) to throw an error that is NOT caught by the inner try-catch
        // Actually, the first try-catch in readClipboardImageLinux catches the error and returns a specific message.
        // To reach the outer catch in readClipboardImage, we need something to throw outside the inner try-catches
        // or make one of the inner try-catches rethrow.
        // But wait, the outer catch is in readClipboardImage, not readClipboardImageLinux.
        // readClipboardImageLinux has its own try-catch that covers everything.

        // Let's look at readClipboardImageLinux again:
        /*
        async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
          try {
            const { exec } = await import("child_process");
            ...
          } catch (err) {
            return {
              success: false,
              error: `Failed to read clipboard image on Linux: ...`,
            };
          }
        }
        */
        // So it should return "Failed to read clipboard image on Linux".
        // The reason it returns "xclip is required..." is because mockExec.mockImplementationOnce
        // is being called for `await execAsync("which xclip");` which is INSIDE a try-catch that returns the xclip message.

        // To trigger the catch(err) at the end of readClipboardImageLinux, we need to throw BEFORE the first inner try-catch.
        // The first inner try-catch starts at line 211.
        // Line 206-208 are:
        // const { exec } = await import("child_process");
        // const { promisify } = await import("util");
        // const execAsync = promisify(exec);

        // If we mock promisify to throw, it should work.
        const { promisify } = await import("util");
        vi.mocked(promisify).mockImplementationOnce(() => {
          throw new Error("Promisify failed");
        });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on Linux",
        );
        expect(result.error).toContain("Promisify failed");
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

      it("should return false when stdout is empty", async () => {
        mockExec.mockResolvedValueOnce({ stdout: "" });

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

      it("should return false on unexpected error", async () => {
        mockExec.mockImplementationOnce(() => {
          throw new Error("Unexpected error");
        });

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

      it("should return false on unexpected error", async () => {
        mockExec.mockImplementationOnce(() => {
          throw new Error("Unexpected error");
        });

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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readClipboardImage,
  hasClipboardImage,
  cleanupTempImage,
} from "../../src/utils/clipboard.js";

// Mock all the dependencies - use vi.hoisted for proper hoisting
const mockExecAsync = vi.hoisted(() => vi.fn());
const mockExecFileAsync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockJoin = vi.hoisted(() => vi.fn());
const mockTmpdir = vi.hoisted(() => vi.fn());

// The clipboard code goes through the SDK's wrapper family (execAsyncHidden /
// execFileAsyncHidden), not raw `child_process` + `promisify` — so the mount
// point is the wrapper's own module. Two separate mocks on purpose: `exec` runs
// through a shell (`which xclip`, `osascript`), `execFile` is argv-only
// (`powershell.exe`), and a shared mock cannot tell the two apart.
vi.mock("wave-agent-sdk", () => ({
  execAsyncHidden: mockExecAsync,
  execFileAsyncHidden: mockExecFileAsync,
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
        mockExecAsync.mockResolvedValueOnce({ stdout: "false" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "success" }); // saveScript
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.mimeType).toBe("image/png");
      });

      it("should handle save script failure", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockRejectedValueOnce(new Error("Save failed"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on macOS",
        );
      });

      it("should handle file not created", async () => {
        mockExecAsync
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
        mockExecAsync
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
        mockExecAsync.mockRejectedValueOnce(new Error("Check failed"));

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
        mockExecFileAsync.mockResolvedValueOnce({ stdout: "false" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExecFileAsync
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "true" }); // saveScript
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.mimeType).toBe("image/png");
      });

      it("should handle PowerShell access failure", async () => {
        mockExecFileAsync.mockRejectedValueOnce(new Error("PowerShell failed"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to access clipboard on Windows");
      });

      it("should handle save failure", async () => {
        mockExecFileAsync
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "false" }); // saveScript failed

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });

      it("should pass the script as argv to powershell.exe (no cmd shell)", async () => {
        // Regression: the script used to be concatenated into a shell command
        // line (`powershell -Command "..."` via exec), which routes through
        // cmd /c and mangles the nested double quotes — PowerShell then exits
        // 0 with empty output, so every paste silently failed on Windows.
        mockExecFileAsync
          .mockResolvedValueOnce({ stdout: "true" }) // hasImage check
          .mockResolvedValueOnce({ stdout: "true" }); // saveScript
        mockExistsSync.mockReturnValue(true);

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "powershell.exe",
          expect.arrayContaining([
            "-NoProfile",
            "-Command",
            expect.stringContaining("Get-Clipboard"),
          ]),
        );
      });

      it("should handle unexpected errors in readClipboardImageWindows", async () => {
        // A launcher that throws synchronously (not a rejection) must land in
        // the same catch. This is the branch the old "make `promisify` throw"
        // case reached through module init — with a static import there is no
        // module-init step left, so the throw moves to the call itself.
        mockExecFileAsync.mockImplementationOnce(() => {
          throw new Error("PowerShell launcher failed");
        });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to access clipboard on Windows");
        expect(result.error).toContain("PowerShell launcher failed");
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
        mockExecAsync.mockRejectedValueOnce(new Error("xclip not found"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("xclip is required");
      });

      it("should return error when no image in clipboard", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockRejectedValueOnce(new Error("No image")); // clipboard check

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No image found in clipboard");
      });

      it("should successfully read image from clipboard", async () => {
        mockExecAsync
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
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }) // clipboard check
          .mockRejectedValueOnce(new Error("Save failed")); // save image fails

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to save clipboard image");
      });

      it("should handle file not created after save", async () => {
        mockExecAsync
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
        // The outer catch only sees what the two inner try/catches do not, i.e.
        // the `tmpdir()` / `join()` pair that builds the temp path between them.
        // That used to be the `await import("child_process")` + `promisify`
        // pair at the top of the function — a static import leaves no such
        // module-init seam, so the injection moves to the one call still there.
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }); // clipboard check
        mockTmpdir.mockImplementationOnce(() => {
          throw new Error("Unexpected failure");
        });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to read clipboard image on Linux",
        );
        expect(result.error).toContain("Unexpected failure");
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
        mockExecAsync.mockResolvedValueOnce({ stdout: "true" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExecAsync.mockResolvedValueOnce({ stdout: "false" });

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return false on error", async () => {
        mockExecAsync.mockRejectedValueOnce(new Error("Script failed"));

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return false when stdout is empty", async () => {
        mockExecAsync.mockResolvedValueOnce({ stdout: "" });

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
        mockExecFileAsync.mockResolvedValueOnce({ stdout: "true" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExecFileAsync.mockResolvedValueOnce({ stdout: "false" });

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return false on unexpected error", async () => {
        mockExecFileAsync.mockImplementationOnce(() => {
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
        mockExecAsync.mockRejectedValueOnce(new Error("xclip not found"));

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return true when image is available", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockResolvedValueOnce({ stdout: "has image" }); // clipboard check

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should return false when no image available", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "xclip found" }) // which xclip
          .mockRejectedValueOnce(new Error("No image")); // clipboard check

        const result = await hasClipboardImage();
        expect(result).toBe(false);
      });

      it("should return false on unexpected error", async () => {
        mockExecAsync.mockImplementationOnce(() => {
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

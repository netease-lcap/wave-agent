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
const mockStatSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockJoin = vi.hoisted(() => vi.fn());
const mockTmpdir = vi.hoisted(() => vi.fn());

// The clipboard code goes through the SDK's wrapper family (execAsyncHidden /
// execFileAsyncHidden), not raw `child_process` + `promisify` — so the mount
// point is the wrapper's own module. Two separate mocks on purpose: `exec` runs
// through a shell (`xclip`, `wl-paste`, `osascript`), `execFile` is argv-only
// (`powershell.exe`), and a shared mock cannot tell the two apart.
vi.mock("wave-agent-sdk", () => ({
  execAsyncHidden: mockExecAsync,
  execFileAsyncHidden: mockExecFileAsync,
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  statSync: mockStatSync,
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
    mockStatSync.mockReturnValue({ size: 128 });
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

      // Both backends live in the same shell command, so "xclip first, wl-paste
      // only if xclip fails" is carried by the command text itself: the order of
      // the `||` operands. These helpers pin that text.
      const commandsRun = () =>
        mockExecAsync.mock.calls.map(([command]) => command);

      const expectFragmentsInOrder = (command: string, fragments: string[]) => {
        let previous = -1;
        for (const fragment of fragments) {
          const at = command.indexOf(fragment);
          expect(at).toBeGreaterThan(previous);
          previous = at;
        }
      };

      it("should probe xclip first and keep wl-paste as the shell fallback", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/png\n" }) // probe
          .mockResolvedValueOnce({ stdout: "" }); // save image

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.imagePath).toContain("/tmp/clipboard-image-");
        expect(result.imagePath).toMatch(/\.png$/);
        expect(result.mimeType).toBe("image/png");

        const [probe, save] = commandsRun();
        expectFragmentsInOrder(probe, [
          'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
          'wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
        ]);
        expectFragmentsInOrder(save, [
          "xclip -selection clipboard -t image/png -o >",
          "wl-paste --type image/png >",
          "xclip -selection clipboard -t image/bmp -o >",
          "wl-paste --type image/bmp >",
        ]);
        // The temp path is handed to both halves of the save chain — a second
        // file would leave a stray artifact per failed attempt.
        expect(save).toContain(result.imagePath);
      });

      it("should not gate the read on a `which xclip` check", async () => {
        // Regression: the read used to start with `which xclip` and return
        // "xclip is required…" on failure, so a Wayland session with xclip
        // installed never reached wl-paste. The first thing run must be the
        // probe, with no PATH check ahead of it.
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/png\n" })
          .mockResolvedValueOnce({ stdout: "" });

        await readClipboardImage();

        const commands = commandsRun();
        expect(commands[0]).toContain("xclip -selection clipboard -t TARGETS");
        expect(commands.some((command) => command.startsWith("which"))).toBe(
          false,
        );
      });

      it("should read bmp when the clipboard only advertises bmp", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/bmp\n" })
          .mockResolvedValueOnce({ stdout: "" });

        const result = await readClipboardImage();

        expect(result.success).toBe(true);
        expect(result.mimeType).toBe("image/bmp");
        expect(result.imagePath).toMatch(/\.bmp$/);
        // Same four-way chain either way; the bytes on disk and the reported
        // mimeType are what stay in sync.
        expectFragmentsInOrder(commandsRun()[1], [
          "xclip -selection clipboard -t image/png -o >",
          "wl-paste --type image/png >",
          "xclip -selection clipboard -t image/bmp -o >",
          "wl-paste --type image/bmp >",
        ]);
      });

      it("should not promise a read for formats the save chain cannot fetch", async () => {
        // The probe matches jpeg/gif/webp but only png and bmp can be saved, so
        // this has to be its own answer instead of a broken temp file.
        mockExecAsync.mockResolvedValueOnce({ stdout: "image/jpeg\n" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("PNG or BMP");
        expect(mockExecAsync).toHaveBeenCalledTimes(1);
      });

      it("should name both backends when neither tool is installed", async () => {
        // Probe fails, and the follow-up `which` says nothing is on PATH.
        mockExecAsync
          .mockRejectedValueOnce(new Error("xclip not found"))
          .mockRejectedValueOnce(new Error("not found"));

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain("No clipboard tool found");
        expect(result.error).toContain("xclip");
        expect(result.error).toContain("wl-clipboard");
        // The install hint only shows up once both read paths are exhausted.
        expect(commandsRun()[0]).toContain("wl-paste -l");
      });

      it("should report an empty clipboard when a tool is installed", async () => {
        mockExecAsync
          .mockRejectedValueOnce(new Error("No image"))
          .mockResolvedValueOnce({ stdout: "/usr/bin/xclip" });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toBe("No image found in clipboard");
      });

      it("should fall back to the empty reason when the save chain fails", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/png\n" }) // probe
          .mockRejectedValueOnce(new Error("Save failed")) // all four attempts
          .mockResolvedValueOnce({ stdout: "/usr/bin/xclip" }); // diagnosis

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toBe("No image found in clipboard");
        expect(commandsRun()[2]).toBe("which xclip || which wl-paste");
      });

      it("should handle file not created after save", async () => {
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/png\n" }) // probe
          .mockResolvedValueOnce({ stdout: "" }); // save image
        mockExistsSync.mockReturnValue(false);

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });

      it("should reject a zero-byte save", async () => {
        // The chain truncates the file before each attempt, so four failed
        // attempts can leave an empty file that still "exists".
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/png\n" })
          .mockResolvedValueOnce({ stdout: "" });
        mockStatSync.mockReturnValue({ size: 0 });

        const result = await readClipboardImage();

        expect(result.success).toBe(false);
        expect(result.error).toContain(
          "Failed to save clipboard image to temporary file",
        );
      });

      it("should handle unexpected errors in readClipboardImageLinux", async () => {
        // The outer catch only sees what the inner try/catches do not — the
        // `tmpdir()` / `join()` pair that builds the temp path after the probe.
        mockExecAsync.mockResolvedValueOnce({ stdout: "image/png\n" });
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

      it("should return true when the clipboard advertises png", async () => {
        // One command: the probe carries both the xclip half and the wl-paste
        // half, and there is no `which xclip` in front of it any more.
        mockExecAsync.mockResolvedValueOnce({ stdout: "image/png\n" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
        expect(mockExecAsync).toHaveBeenCalledTimes(1);
        expect(mockExecAsync.mock.calls[0][0]).toContain(
          "xclip -selection clipboard -t TARGETS",
        );
      });

      it("should count every image format the probe accepts (Claude Code parity)", async () => {
        // CC's `checkImage` greps png|jpeg|jpg|gif|webp|bmp and its reader only
        // looks at the exit status, so any of these answers `true` — including
        // the ones `readClipboardImage` cannot save.
        mockExecAsync.mockResolvedValueOnce({ stdout: "image/jpeg\n" });

        const result = await hasClipboardImage();
        expect(result).toBe(true);
      });

      it("should disagree with readClipboardImage on formats it cannot save", async () => {
        // The asymmetry is CC's, not a bug: check passes, save (png/bmp only)
        // fails, and its reader returns null. Pinned here so nobody "fixes" the
        // predicate back to png/bmp.
        mockExecAsync
          .mockResolvedValueOnce({ stdout: "image/jpeg\n" }) // has: probe
          .mockResolvedValueOnce({ stdout: "image/jpeg\n" }); // read: probe

        expect(await hasClipboardImage()).toBe(true);

        const read = await readClipboardImage();
        expect(read.success).toBe(false);
        expect(read.error).toContain("PNG or BMP");
      });

      it("should return false when both backends fail", async () => {
        mockExecAsync.mockRejectedValueOnce(new Error("No image"));

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

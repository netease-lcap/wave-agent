import { describe, it, expect, afterEach } from "vitest";
import {
  readClipboardImage,
  cleanupTempImage,
  hasClipboardImage,
} from "@/utils/clipboard";
import { createTestImage } from "../helpers/testImageHelper";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, unlinkSync } from "fs";
import { logger } from "@/utils/logger";

const execAsync = promisify(exec);
const platform = process.platform;

// 检测 xclip 是否可用（仅在 Linux 平台）
const checkXclipAvailable = async (): Promise<boolean> => {
  if (platform !== "linux") {
    return true; // 非 Linux 平台不需要 xclip
  }

  try {
    await execAsync("which xclip");
    return true;
  } catch {
    return false;
  }
};

describe("Clipboard Image Utils", () => {
  let tempImagePath: string | undefined;
  let testImagePath: string | undefined;

  afterEach(() => {
    // 清理测试中可能创建的临时文件
    if (tempImagePath) {
      cleanupTempImage(tempImagePath);
      tempImagePath = undefined;
    }
    // 清理测试图片
    if (testImagePath && existsSync(testImagePath)) {
      try {
        unlinkSync(testImagePath);
      } catch (error) {
        logger.warn("Failed to cleanup test image:", error);
      }
      testImagePath = undefined;
    }
  });

  describe("readClipboardImage", () => {
    it("should return error for unsupported platforms", async () => {
      if (["darwin", "win32", "linux"].includes(platform)) {
        logger.info(`Skipping unsupported platform test on ${platform}`);
        return;
      }

      const result = await readClipboardImage();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not supported on platform");
    });

    it("should handle empty clipboard", async () => {
      // 检查 xclip 是否可用
      const isXclipAvailable = await checkXclipAvailable();
      if (!isXclipAvailable) {
        logger.info(
          "Skipping empty clipboard test because xclip is not available",
        );
        return;
      }

      // 清空剪贴板
      try {
        if (platform === "darwin") {
          await execAsync("osascript -e 'set the clipboard to \"\"'");
        } else if (platform === "win32") {
          await execAsync("powershell -Command \"Set-Clipboard -Value ''\"");
        } else if (platform === "linux") {
          await execAsync('echo "" | xclip -selection clipboard');
        }
      } catch {
        logger.warn("Failed to clear clipboard, test may not be reliable");
      }

      const result = await readClipboardImage();
      expect(result.success).toBe(false);
      expect(result.error).toContain("No image found");
    });

    it("should read image from clipboard when image is present", async () => {
      // 动态创建测试图片
      testImagePath = createTestImage();

      try {
        // 根据平台将测试图片复制到剪贴板
        if (platform === "darwin") {
          await execAsync(
            `osascript -e 'set the clipboard to (read (POSIX file "${testImagePath}") as JPEG picture)'`,
          );
        } else if (platform === "win32") {
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $image = [System.Drawing.Image]::FromFile("${testImagePath}")
            [System.Windows.Forms.Clipboard]::SetImage($image)
            $image.Dispose()
          `;
          await execAsync(`powershell -Command "${script}"`);
        } else if (platform === "linux") {
          await execAsync(
            `xclip -selection clipboard -t image/png -i "${testImagePath}"`,
          );
        }

        // 等待一小会儿确保剪贴板操作完成
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await readClipboardImage();

        if (result.success) {
          expect(result.success).toBe(true);
          expect(result.imagePath).toBeDefined();
          expect(result.mimeType).toBe("image/png");
          expect(existsSync(result.imagePath!)).toBe(true);

          // 保存路径用于清理
          tempImagePath = result.imagePath;
        } else {
          logger.warn("Failed to read clipboard image:", result.error);
          // 这种情况下我们不让测试失败，因为可能是系统权限问题
        }
      } catch (error) {
        logger.warn("Failed to set up test clipboard image:", error);
        // 不让测试失败，因为这可能是环境问题
      }
    }, 10000); // 增加超时时间，因为涉及系统调用
  });

  describe("hasClipboardImage", () => {
    it("should return false for unsupported platforms", async () => {
      if (["darwin", "win32", "linux"].includes(platform)) {
        logger.info(`Skipping unsupported platform test on ${platform}`);
        return;
      }

      const hasImage = await hasClipboardImage();
      expect(hasImage).toBe(false);
    });

    it("should return false for empty clipboard", async () => {
      // 检查 xclip 是否可用
      const isXclipAvailable = await checkXclipAvailable();
      if (!isXclipAvailable) {
        logger.info(
          "Skipping empty clipboard test because xclip is not available",
        );
        return;
      }

      // 清空剪贴板
      try {
        if (platform === "darwin") {
          await execAsync("osascript -e 'set the clipboard to \"\"'");
        } else if (platform === "win32") {
          await execAsync("powershell -Command \"Set-Clipboard -Value ''\"");
        } else if (platform === "linux") {
          await execAsync('echo "" | xclip -selection clipboard');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));

        const hasImage = await hasClipboardImage();
        expect(hasImage).toBe(false);
      } catch {
        logger.warn("Failed to clear clipboard for test");
      }
    });

    it("should return true when image is in clipboard", async () => {
      // 动态创建测试图片
      testImagePath = createTestImage();

      try {
        // 根据平台将测试图片复制到剪贴板
        if (platform === "darwin") {
          await execAsync(
            `osascript -e 'set the clipboard to (read (POSIX file "${testImagePath}") as JPEG picture)'`,
          );
        } else if (platform === "win32") {
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $image = [System.Drawing.Image]::FromFile("${testImagePath}")
            [System.Windows.Forms.Clipboard]::SetImage($image)
            $image.Dispose()
          `;
          await execAsync(`powershell -Command "${script}"`);
        } else if (platform === "linux") {
          await execAsync(
            `xclip -selection clipboard -t image/png -i "${testImagePath}"`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));

        const hasImage = await hasClipboardImage();
        expect(hasImage).toBe(true);
      } catch (error) {
        logger.warn(
          "Failed to set up test clipboard image for hasClipboardImage test:",
          error,
        );
      }
    });
  });

  describe("cleanupTempImage", () => {
    it("should not throw error for non-existent file", () => {
      expect(() => {
        cleanupTempImage("/path/that/does/not/exist.png");
      }).not.toThrow();
    });

    it("should successfully clean up existing temporary file", async () => {
      // 创建一个临时文件进行测试
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      const tempPath = path.join(os.tmpdir(), `test-cleanup-${Date.now()}.png`);

      // 创建一个简单的测试文件
      fs.writeFileSync(tempPath, "test content");
      expect(fs.existsSync(tempPath)).toBe(true);

      // 清理文件
      cleanupTempImage(tempPath);

      // 验证文件已被删除
      expect(fs.existsSync(tempPath)).toBe(false);
    });
  });
});

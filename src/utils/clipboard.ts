import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface ClipboardImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  mimeType?: string;
}

/**
 * 读取剪贴板中的图片
 * @returns Promise<ClipboardImageResult> 包含图片路径或错误信息的结果
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  try {
    const platform = process.platform;

    if (platform === 'darwin') {
      return await readClipboardImageMac();
    } else if (platform === 'win32') {
      return await readClipboardImageWindows();
    } else if (platform === 'linux') {
      return await readClipboardImageLinux();
    } else {
      return {
        success: false,
        error: `Clipboard image reading is not supported on platform: ${platform}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to read clipboard image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * macOS 系统读取剪贴板图片
 */
async function readClipboardImageMac(): Promise<ClipboardImageResult> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // 直接尝试读取图片数据来检查是否存在图片
    const testScript = `
      tell application "System Events"
        try
          set imageData to the clipboard as «class PNGf»
          return true
        on error
          return false
        end try
      end tell
    `;

    let hasImage = false;
    try {
      const { stdout: testResult } = await execAsync(`osascript -e '${testScript}'`);
      hasImage = testResult.trim() === 'true';
    } catch {
      hasImage = false;
    }

    if (!hasImage) {
      return {
        success: false,
        error: 'No image found in clipboard',
      };
    }

    // 生成临时文件路径
    const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

    // 使用 osascript 将剪贴板图片保存为文件
    const saveScript = `
      tell application "System Events"
        try
          set imageData to the clipboard as «class PNGf»
          set fileRef to open for access POSIX file "${tempFilePath}" with write permission
          write imageData to fileRef
          close access fileRef
          return true
        on error errMsg
          try
            close access fileRef
          end try
          error errMsg
        end try
      end tell
    `;

    await execAsync(`osascript -e '${saveScript}'`);

    // 验证文件是否创建成功
    if (!existsSync(tempFilePath)) {
      return {
        success: false,
        error: 'Failed to save clipboard image to temporary file',
      };
    }

    return {
      success: true,
      imagePath: tempFilePath,
      mimeType: 'image/png',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read clipboard image on macOS: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Windows 系统读取剪贴板图片
 */
async function readClipboardImageWindows(): Promise<ClipboardImageResult> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // 使用 PowerShell 检查剪贴板是否包含图片
    const checkScript = `
      Add-Type -AssemblyName System.Windows.Forms
      if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        Write-Output "true"
      } else {
        Write-Output "false"
      }
    `;

    try {
      const { stdout } = await execAsync(`powershell -Command "${checkScript}"`);
      const hasImage = stdout.trim() === 'true';

      if (!hasImage) {
        return {
          success: false,
          error: 'No image found in clipboard',
        };
      }

      // 生成临时文件路径
      const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

      // 使用 PowerShell 保存剪贴板图片
      const saveScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $image = [System.Windows.Forms.Clipboard]::GetImage()
        if ($image -ne $null) {
          $image.Save("${tempFilePath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
          Write-Output "true"
        } else {
          Write-Output "false"
        }
      `;

      const { stdout: saveResult } = await execAsync(`powershell -Command "${saveScript}"`);

      if (saveResult.trim() !== 'true' || !existsSync(tempFilePath)) {
        return {
          success: false,
          error: 'Failed to save clipboard image to temporary file',
        };
      }

      return {
        success: true,
        imagePath: tempFilePath,
        mimeType: 'image/png',
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to access clipboard on Windows: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to read clipboard image on Windows: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Linux 系统读取剪贴板图片
 */
async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
  try {
    // Linux 上可以使用 xclip 或 wl-clipboard 等工具
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // 检查是否有 xclip
    try {
      await execAsync('which xclip');
    } catch {
      return {
        success: false,
        error:
          'xclip is required for clipboard image operations on Linux. Please install it: sudo apt-get install xclip',
      };
    }

    // 检查剪贴板是否包含图片
    try {
      await execAsync('xclip -selection clipboard -t image/png -o > /dev/null 2>&1');
    } catch {
      return {
        success: false,
        error: 'No image found in clipboard',
      };
    }

    // 生成临时文件路径
    const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

    // 使用 xclip 保存剪贴板图片
    try {
      await execAsync(`xclip -selection clipboard -t image/png -o > "${tempFilePath}"`);

      if (!existsSync(tempFilePath)) {
        return {
          success: false,
          error: 'Failed to save clipboard image to temporary file',
        };
      }

      return {
        success: true,
        imagePath: tempFilePath,
        mimeType: 'image/png',
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to save clipboard image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to read clipboard image on Linux: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 清理临时图片文件
 * @param imagePath 要清理的图片路径
 */
export function cleanupTempImage(imagePath: string): void {
  try {
    if (existsSync(imagePath)) {
      unlinkSync(imagePath);
    }
  } catch (error) {
    console.warn(`Failed to cleanup temporary image file: ${imagePath}`, error);
  }
}

/**
 * 检查剪贴板是否包含图片（快速检查，不保存文件）
 * @returns Promise<boolean> 是否包含图片
 */
export async function hasClipboardImage(): Promise<boolean> {
  try {
    const platform = process.platform;

    if (platform === 'darwin') {
      return await hasClipboardImageMac();
    } else if (platform === 'win32') {
      return await hasClipboardImageWindows();
    } else if (platform === 'linux') {
      return await hasClipboardImageLinux();
    } else {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * macOS 检查剪贴板是否包含图片
 */
async function hasClipboardImageMac(): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const checkScript = `
      tell application "System Events"
        try
          set imageData to the clipboard as «class PNGf»
          return true
        on error
          return false
        end try
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${checkScript}'`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Windows 检查剪贴板是否包含图片
 */
async function hasClipboardImageWindows(): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const checkScript = `
      Add-Type -AssemblyName System.Windows.Forms
      if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        Write-Output "true"
      } else {
        Write-Output "false"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${checkScript}"`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Linux 检查剪贴板是否包含图片
 */
async function hasClipboardImageLinux(): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // 检查是否有 xclip
    try {
      await execAsync('which xclip');
    } catch {
      return false;
    }

    // 检查剪贴板是否包含图片
    try {
      await execAsync('xclip -selection clipboard -t image/png -o > /dev/null 2>&1');
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

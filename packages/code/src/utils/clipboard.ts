import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface ClipboardImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  mimeType?: string;
}

/**
 * Read image from clipboard
 * @returns Promise<ClipboardImageResult> Result containing image path or error information
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  try {
    const platform = process.platform;

    if (platform === "darwin") {
      return await readClipboardImageMac();
    } else if (platform === "win32") {
      return await readClipboardImageWindows();
    } else if (platform === "linux") {
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
 * Read clipboard image on macOS
 */
async function readClipboardImageMac(): Promise<ClipboardImageResult> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    // Try to read image data directly to check if image exists
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
      const { stdout: testResult } = await execAsync(
        `osascript -e '${testScript}'`,
      );
      hasImage = testResult.trim() === "true";
    } catch {
      hasImage = false;
    }

    if (!hasImage) {
      return {
        success: false,
        error: "No image found in clipboard",
      };
    }

    // Generate temporary file path
    const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

    // Use osascript to save clipboard image as file
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

    // Verify if file was created successfully
    if (!existsSync(tempFilePath)) {
      return {
        success: false,
        error: "Failed to save clipboard image to temporary file",
      };
    }

    return {
      success: true,
      imagePath: tempFilePath,
      mimeType: "image/png",
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read clipboard image on macOS: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Read clipboard image on Windows
 */
async function readClipboardImageWindows(): Promise<ClipboardImageResult> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Use PowerShell to check if clipboard contains image
    const checkScript = `
      Add-Type -AssemblyName System.Windows.Forms
      if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        Write-Output "true"
      } else {
        Write-Output "false"
      }
    `;

    try {
      const { stdout } = await execAsync(
        `powershell -Command "${checkScript}"`,
      );
      const hasImage = stdout.trim() === "true";

      if (!hasImage) {
        return {
          success: false,
          error: "No image found in clipboard",
        };
      }

      // Generate temporary file path
      const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

      // Use PowerShell to save clipboard image
      const saveScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $image = [System.Windows.Forms.Clipboard]::GetImage()
        if ($image -ne $null) {
          $image.Save("${tempFilePath.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
          Write-Output "true"
        } else {
          Write-Output "false"
        }
      `;

      const { stdout: saveResult } = await execAsync(
        `powershell -Command "${saveScript}"`,
      );

      if (saveResult.trim() !== "true" || !existsSync(tempFilePath)) {
        return {
          success: false,
          error: "Failed to save clipboard image to temporary file",
        };
      }

      return {
        success: true,
        imagePath: tempFilePath,
        mimeType: "image/png",
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
 * Read clipboard image on Linux
 */
async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
  try {
    // Linux can use tools like xclip or wl-clipboard
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Check if xclip is available
    try {
      await execAsync("which xclip");
    } catch {
      return {
        success: false,
        error:
          "xclip is required for clipboard image operations on Linux. Please install it: sudo apt-get install xclip",
      };
    }

    // Check if clipboard contains image
    try {
      await execAsync(
        "xclip -selection clipboard -t image/png -o > /dev/null 2>&1",
      );
    } catch {
      return {
        success: false,
        error: "No image found in clipboard",
      };
    }

    // Generate temporary file path
    const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

    // Use xclip to save clipboard image
    try {
      await execAsync(
        `xclip -selection clipboard -t image/png -o > "${tempFilePath}"`,
      );

      if (!existsSync(tempFilePath)) {
        return {
          success: false,
          error: "Failed to save clipboard image to temporary file",
        };
      }

      return {
        success: true,
        imagePath: tempFilePath,
        mimeType: "image/png",
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
 * Clean up temporary image file
 * @param imagePath Path to the image file to clean up
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
 * Check if clipboard contains image (quick check, does not save file)
 * @returns Promise<boolean> Whether it contains image
 */
export async function hasClipboardImage(): Promise<boolean> {
  try {
    const platform = process.platform;

    if (platform === "darwin") {
      return await hasClipboardImageMac();
    } else if (platform === "win32") {
      return await hasClipboardImageWindows();
    } else if (platform === "linux") {
      return await hasClipboardImageLinux();
    } else {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Check if clipboard contains image on macOS
 */
async function hasClipboardImageMac(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
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
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Check if clipboard contains image on Windows
 */
async function hasClipboardImageWindows(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
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
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Check if clipboard contains image on Linux
 */
async function hasClipboardImageLinux(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Check if xclip is available
    try {
      await execAsync("which xclip");
    } catch {
      return false;
    }

    // Check if clipboard contains image
    try {
      await execAsync(
        "xclip -selection clipboard -t image/png -o > /dev/null 2>&1",
      );
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

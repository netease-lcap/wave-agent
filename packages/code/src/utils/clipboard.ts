import {
  unlinkSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
// 静态导入，不走 `await import("child_process")`：本文件顶部已经静态 import 了
// `fs` / `path` / `os`，为 `child_process` 单独绕动态 import 没有任何隔离收益，
// 反而绕开了 .oxlintrc.json 里「子进程一律走 wrapper」的规则 —— exec 的
// `windowsHide` 默认同样是 false，桌面托管的 `wave --stdio` 没有控制台，少一个
// key 就是一次闪窗（Windows 分支这里直接跑 powershell.exe）。
import {
  execAsyncHidden,
  execFileAsyncHidden,
  transcodeBmpToPng,
} from "wave-agent-sdk";

export interface ClipboardImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  mimeType?: string;
}

/**
 * Write text to the system clipboard via the terminal OSC 52 escape sequence.
 * Works in most modern terminals without external tools (mirrors Claude
 * Code's setClipboard). Callers must treat a `false` return as "clipboard
 * unavailable" and still surface the text itself.
 *
 * @param text - Text to copy
 * @returns Promise resolving to true when the sequence was written
 */
export async function setClipboardText(text: string): Promise<boolean> {
  try {
    process.stdout.write(
      `\x1b]52;c;${Buffer.from(text, "utf-8").toString("base64")}\x07`,
    );
    return true;
  } catch {
    // stdout unavailable — clipboard could not be set
    return false;
  }
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
      const { stdout: testResult } = await execAsyncHidden(
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

    await execAsyncHidden(`osascript -e '${saveScript}'`);

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
 * Run a PowerShell script via execFile (no cmd shell), returning stdout.
 *
 * The script must be passed as a single argv element: routing
 * `powershell -Command "<script>"` through exec() / cmd /c mangles the
 * nested double quotes (cmd strips them), so PowerShell receives garbage
 * and exits 0 with empty output — image paste silently failed on Windows.
 */
async function runPowerShellScript(script: string): Promise<string> {
  const { stdout } = await execFileAsyncHidden("powershell.exe", [
    "-NoProfile",
    "-Command",
    script,
  ]);
  return stdout;
}

// Check script shared by the two Windows clipboard functions. Get-Clipboard
// is PowerShell 5.1's built-in cmdlet (same as Claude Code): no WinForms/STA
// ceremony, returns a System.Drawing.Image directly.
const CLIPBOARD_IMAGE_CHECK_SCRIPT = `
  $image = Get-Clipboard -Format Image -ErrorAction SilentlyContinue
  if ($null -ne $image) {
    Write-Output "true"
  } else {
    Write-Output "false"
  }
`;

async function hasPowerShellClipboardImage(): Promise<boolean> {
  const stdout = await runPowerShellScript(CLIPBOARD_IMAGE_CHECK_SCRIPT);
  return stdout.trim() === "true";
}

/**
 * Read clipboard image on Windows
 */
async function readClipboardImageWindows(): Promise<ClipboardImageResult> {
  try {
    try {
      const hasImage = await hasPowerShellClipboardImage();

      if (!hasImage) {
        return {
          success: false,
          error: "No image found in clipboard",
        };
      }

      // Generate temporary file path
      const tempFilePath = join(tmpdir(), `clipboard-image-${Date.now()}.png`);

      // Save the clipboard image via PowerShell (single-quoted path; a single
      // quote in the path is escaped by doubling it). Keeps its own preamble
      // because it needs the $image variable.
      const saveScript = `
        $image = Get-Clipboard -Format Image -ErrorAction SilentlyContinue
        if ($null -ne $image) {
          $image.Save('${tempFilePath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
          Write-Output "true"
        } else {
          Write-Output "false"
        }
      `;

      const saveResult = await runPowerShellScript(saveScript);

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

// ---------------------------------------------------------------------------
// Linux clipboard image reading.
//
// The two backends are xclip (X11) and wl-paste (wl-clipboard, Wayland). Both
// are tried on every read, in that order, with the shell's `||` doing the
// fallback — exactly how Claude Code does it. There is deliberately **no**
// `which xclip` gate in front: "xclip is not installed" and "xclip is installed
// but this is a Wayland-only session, so it sees no clipboard" both make the
// first command fail, and both must fall through to `wl-paste` instead of
// aborting with an "install xclip" hint that sends the user down the wrong path.
// ---------------------------------------------------------------------------

const LINUX_PNG_TARGET = "image/png";
const LINUX_BMP_TARGET = "image/bmp";

/** Lists the clipboard's advertised targets and keeps the image ones. Claude
 *  Code's `checkImage`, verbatim (its non-WSL branch). The exit status comes
 *  from the trailing `grep`, so "xclip missing", "no $DISPLAY", "no compositor"
 *  and "the clipboard holds plain text" are all the same failure — which is
 *  what makes the `||` half reachable for every one of them. */
const LINUX_CHECK_IMAGE_COMMAND =
  'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"';

/** Claude Code's `saveImage`, verbatim: png via xclip, else png via wl-paste,
 *  else the same two for bmp. Redirect placement and `2>/dev/null` match, so a
 *  failing attempt is silent and the next one starts from a clean file. */
function linuxSaveImageCommand(imagePath: string): string {
  return (
    `xclip -selection clipboard -t ${LINUX_PNG_TARGET} -o > "${imagePath}" 2>/dev/null || ` +
    `wl-paste --type ${LINUX_PNG_TARGET} > "${imagePath}" 2>/dev/null || ` +
    `xclip -selection clipboard -t ${LINUX_BMP_TARGET} -o > "${imagePath}" 2>/dev/null || ` +
    `wl-paste --type ${LINUX_BMP_TARGET} > "${imagePath}"`
  );
}

/**
 * Probe what the clipboard advertises, narrowed to the formats the save chain
 * can read back.
 *
 * - `image/png` / `image/bmp` — readable (CC only reads these two, even though
 *   the probe also matches jpeg/gif/webp)
 * - `null` — an image is there, but in a format we cannot read
 * - `undefined` — the probe itself failed: no tool, no display session, or an
 *   empty clipboard. Those three are indistinguishable from the exit status
 *   alone; callers that need to tell them apart look at `PATH` afterwards.
 *
 * Only `readClipboardImageLinux` consumes the narrowing;
 * `hasClipboardImageLinux` deliberately uses the raw exit status instead, so the
 * two disagree for jpeg-only clipboards the same way Claude Code does.
 */
async function probeLinuxClipboardImageType(): Promise<
  string | null | undefined
> {
  let probe: { stdout: string };
  try {
    probe = await execAsyncHidden(LINUX_CHECK_IMAGE_COMMAND);
  } catch {
    return undefined;
  }

  if (probe.stdout.includes(LINUX_PNG_TARGET)) return LINUX_PNG_TARGET;
  if (probe.stdout.includes(LINUX_BMP_TARGET)) return LINUX_BMP_TARGET;
  return null;
}

/**
 * Message for "both read paths failed". Only reached after the read already
 * failed, and only used to pick wording — a `which` here never gates a read.
 * Neither tool on `PATH` means the user needs to install one; otherwise the
 * clipboard simply had nothing we could read.
 */
async function linuxClipboardEmptyReason(): Promise<string> {
  try {
    // Exits 0 when either tool resolves (`which a || which b`).
    await execAsyncHidden("which xclip || which wl-paste");
    return "No image found in clipboard";
  } catch {
    return "No clipboard tool found on Linux. Install xclip (X11) or wl-clipboard (Wayland): sudo apt-get install xclip wl-clipboard";
  }
}

/**
 * Rewrite a just-saved BMP as PNG next to it and return the new path.
 *
 * `image/bmp` is readable but not *sendable*: the model APIs take jpeg / png /
 * gif / webp only, so a BMP handed upstream is a read that looks successful and
 * then fails. Claude Code rewrites the bytes it just read (`bin@323223290`:
 * `if(l.length>=2&&l[0]===66&&l[1]===77)l=await(await UX())(l).png().toBuffer()`)
 * and reports PNG from then on; this does the same via the SDK helper, which owns
 * the magic-byte test and the codec access.
 *
 * Returns `undefined` — keeping the `.bmp` — when the bytes are not BMP, the BMP
 * variant is unsupported, no image codec is installed (normal in host processes),
 * or the rewrite failed. Those are runtime states, not errors: the read still
 * succeeded, the file on disk is honest about what it is, and the rejection now
 * happens one layer down where it can be seen.
 */
async function replaceBmpWithPng(bmpPath: string): Promise<string | undefined> {
  let png: Buffer | undefined;
  try {
    png = await transcodeBmpToPng(readFileSync(bmpPath));
  } catch (error) {
    console.warn("Failed to transcode clipboard BMP image:", error);
    return undefined;
  }

  if (png === undefined) return undefined;

  // Never resolve to the same path: writing the PNG over the source and then
  // unlinking it would delete the only copy.
  const pngPath = `${bmpPath.replace(/\.bmp$/i, "")}.png`;
  try {
    writeFileSync(pngPath, png);
  } catch (error) {
    console.warn("Failed to write transcoded clipboard image:", error);
    return undefined;
  }

  // Callers only ever clean up the path they get back, so the BMP has to go here
  // or every BMP paste leaks one temp file.
  try {
    unlinkSync(bmpPath);
  } catch {
    // Best effort: a stray temp file is not worth failing the paste over.
  }

  return pngPath;
}

/**
 * Read clipboard image on Linux
 */
async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
  try {
    const mimeType = await probeLinuxClipboardImageType();

    if (mimeType === undefined) {
      return { success: false, error: await linuxClipboardEmptyReason() };
    }

    if (mimeType === null) {
      return {
        success: false,
        error:
          "Clipboard image is not available as PNG or BMP, which is all that can be read on Linux",
      };
    }

    const tempFilePath = join(
      tmpdir(),
      `clipboard-image-${Date.now()}.${mimeType === LINUX_BMP_TARGET ? "bmp" : "png"}`,
    );

    try {
      await execAsyncHidden(linuxSaveImageCommand(tempFilePath));
    } catch {
      return { success: false, error: await linuxClipboardEmptyReason() };
    }

    // The chain truncates the file before each attempt, so a failed attempt can
    // leave a zero-byte file behind. The exit status above is the real gate;
    // this keeps a 0-byte "image" from being reported as a successful read.
    if (!existsSync(tempFilePath) || statSync(tempFilePath).size === 0) {
      return {
        success: false,
        error: "Failed to save clipboard image to temporary file",
      };
    }

    if (mimeType === LINUX_BMP_TARGET) {
      const pngPath = await replaceBmpWithPng(tempFilePath);
      if (pngPath !== undefined) {
        return {
          success: true,
          imagePath: pngPath,
          mimeType: LINUX_PNG_TARGET,
        };
      }
    }

    return { success: true, imagePath: tempFilePath, mimeType };
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

    const { stdout } = await execAsyncHidden(`osascript -e '${checkScript}'`);
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
    return await hasPowerShellClipboardImage();
  } catch {
    return false;
  }
}

/**
 * Check if clipboard contains image on Linux
 *
 * Exactly Claude Code's `checkImage`: whatever the probe's `grep -E
 * "image/(png|jpeg|jpg|gif|webp|bmp)"` accepted counts, and only its exit status
 * matters. So a jpeg-only clipboard answers `true` here while
 * `readClipboardImageLinux` fails — CC's `saveImage` only reads PNG and BMP
 * (`bin@323222200`), and its reader returns null after a passing
 * `checkImage` whenever `saveImage` fails (`bin@323223290`:
 * `if((await w(r.checkImage)).exitCode!==0)return null; … (await w(r.saveImage)).exitCode!==0 … return null`).
 *
 * That `has = true` / `read = 失败` gap is upstream behaviour on purpose. Do not
 * narrow this predicate to png/bmp to make the two agree — aligning with Claude
 * Code is the requirement, and narrowing it hides an image the user can see.
 */
async function hasClipboardImageLinux(): Promise<boolean> {
  try {
    await execAsyncHidden(LINUX_CHECK_IMAGE_COMMAND);
    return true;
  } catch {
    return false;
  }
}

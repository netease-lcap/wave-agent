import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

/**
 * Reads the first line of a file efficiently using Node.js readline.
 *
 * @param {string} filePath - The path to the file.
 * @return {Promise<string>} - The first non-empty line of the file, or an empty string otherwise.
 */
export async function readFirstLine(filePath: string): Promise<string> {
  const { createInterface } = await import("node:readline");

  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity, // Handle \r\n properly
  });

  try {
    for await (const line of rl) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        return trimmedLine;
      }
    }
    return "";
  } catch {
    // If reading fails (e.g., file doesn't exist), return empty string
    return "";
  } finally {
    rl.close();
    fileStream.destroy();
  }
}

/**
 * Reads a file from the end and returns the last non-empty line.
 *
 * This version supports files that end with:
 *   - "\n" (Unix-style, including modern macOS)
 *   - "\r\n" (Windows-style)
 *   - "\r" (older Mac-style, HL7, etc.)
 *
 * @param {string} filePath - The path to the file.
 * @param {number} [minLength=1] - Minimum length for the returned line.
 * @return {Promise<string>} - The last non-empty line of the file, or an empty string if no non-empty lines found.
 */
export async function getLastLine(
  filePath: string,
  minLength = 1,
): Promise<string> {
  let fileHandle;
  try {
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;

    if (fileSize === 0) return "";

    fileHandle = await fs.open(filePath, "r");
    const bufferSize = 8 * 1024; // 8KB buffer is usually enough for the last line
    const buffer = Buffer.alloc(bufferSize);

    let lineEnd: number | null = null;
    let lineStart: number | null = null;
    let currentPosition = fileSize;

    while (currentPosition > 0 && lineStart === null) {
      const readSize = Math.min(bufferSize, currentPosition);
      currentPosition -= readSize;

      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        readSize,
        currentPosition,
      );

      for (let i = bytesRead - 1; i >= 0; i--) {
        const charCode = buffer[i];
        if (lineEnd === null) {
          // Still looking for the end of the last non-empty line (skip trailing newlines and whitespace)
          if (charCode > 32) {
            lineEnd = currentPosition + i + 1;
          }
        } else {
          // Looking for the start of the line (the newline before it)
          if (charCode === 10 || charCode === 13) {
            lineStart = currentPosition + i + 1;
            break;
          }
        }
      }
    }

    if (lineEnd === null) return "";
    if (lineStart === null) lineStart = 0;

    const length = lineEnd - lineStart;
    if (length < minLength) return "";

    const resultBuffer = Buffer.alloc(length);
    await fileHandle.read(resultBuffer, 0, length, lineStart);
    const result = resultBuffer.toString("utf8").trim();
    return result.length >= minLength ? result : "";
  } catch {
    // If reading fails (e.g., file doesn't exist), return empty string
    return "";
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

/**
 * Ensures that a pattern is present in the global git ignore file.
 *
 * @param {string} pattern - The pattern to add to global git ignore.
 */
export async function ensureGlobalGitIgnore(pattern: string): Promise<void> {
  try {
    let globalIgnorePath: string;
    try {
      globalIgnorePath = execSync("git config --get core.excludesfile", {
        encoding: "utf8",
      }).trim();
    } catch {
      // If not set, use default paths
      const xdgConfigHome =
        process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
      globalIgnorePath = path.join(xdgConfigHome, "git", "ignore");
    }

    if (!globalIgnorePath) return;

    // Ensure directory exists
    await fs.mkdir(path.dirname(globalIgnorePath), { recursive: true });

    let content = "";
    try {
      content = await fs.readFile(globalIgnorePath, "utf8");
    } catch {
      // File doesn't exist
    }

    const lines = content.split("\n").map((line) => line.trim());
    if (!lines.includes(pattern)) {
      const newContent =
        content.endsWith("\n") || content === ""
          ? `${content}${pattern}\n`
          : `${content}\n${pattern}\n`;
      await fs.writeFile(globalIgnorePath, newContent, "utf8");
    }
  } catch {
    // Ignore errors
  }
}

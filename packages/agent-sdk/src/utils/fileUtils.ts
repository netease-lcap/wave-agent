import fs from "node:fs";

/**
 * Reads the first line of a file efficiently using Node.js readline.
 *
 * @param {string} filePath - The path to the file.
 * @return {Promise<string>} - The first non-empty line of the file, or an empty string otherwise.
 */
export async function readFirstLine(filePath: string): Promise<string> {
  const { createReadStream } = fs;
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
 * Reads a file from the end and returns the first non-empty line.
 *
 * @param {string} filePath - The path to the file.
 * @return {Promise<string>} - The last non-empty line of the file, or an empty string if no non-empty lines found.
 */
export async function getLastLine(filePath: string): Promise<string> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    // Use tail with multiple lines to handle cases where the last line might be empty
    const { stdout } = await execAsync(`tail -n 3 "${filePath}"`);
    const lines = stdout.split(/\r?\n/);

    // Find the first non-empty line working backwards
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length > 0) {
        return line;
      }
    }

    return "";
  } catch {
    // If tail fails (e.g., file doesn't exist), return empty string
    return "";
  }
}

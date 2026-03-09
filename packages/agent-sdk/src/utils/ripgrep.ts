import { fileURLToPath } from "url";
import path from "path";
import process from "process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Detect the current platform and architecture to find the correct bundled ripgrep binary.
 */
function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
  } else if (platform === "linux") {
    return arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
  } else if (platform === "win32") {
    return arch === "arm64" ? "windows-aarch64" : "windows-x86_64";
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

const platformKey = getPlatformKey();
const isWindows = platformKey.startsWith("windows");
const binaryName = isWindows ? "rg.exe" : "rg";

/**
 * Path to the ripgrep binary bundled in the vendor directory.
 */
export const rgPath = path.resolve(
  __dirname,
  `../../vendor/ripgrep/${platformKey}/${binaryName}`,
);

// Ensure the binary is executable on non-Windows platforms
if (!isWindows && fs.existsSync(rgPath)) {
  try {
    const stats = fs.statSync(rgPath);
    if (!(stats.mode & 0o111)) {
      fs.chmodSync(rgPath, 0o755);
    }
  } catch {
    // Silently ignore errors as we might not have write permissions
    // The spawn will fail later with EACCES if it's still not executable
  }
}

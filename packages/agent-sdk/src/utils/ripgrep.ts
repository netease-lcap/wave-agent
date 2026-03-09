import { fileURLToPath } from "url";
import path from "path";
import process from "process";

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

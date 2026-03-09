import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANIFEST_PATH = path.resolve(__dirname, "../bin/rg");
const VENDOR_DIR = path.resolve(__dirname, "../vendor/ripgrep");

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifestContent = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const jsonContent = manifestContent.replace(/^#!.*\n/, "");
  const manifest = JSON.parse(jsonContent);
  const platforms = manifest.platforms;

  if (!fs.existsSync(VENDOR_DIR)) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
  }

  for (const [platform, info] of Object.entries(platforms)) {
    const platformDir = path.join(VENDOR_DIR, platform);
    const isWindows = platform.startsWith("windows");
    const binaryName = isWindows ? "rg.exe" : "rg";
    const binaryPath = path.join(platformDir, binaryName);

    if (fs.existsSync(binaryPath)) {
      if (!isWindows) {
        const stats = fs.statSync(binaryPath);
        if ((stats.mode & 0o777) !== 0o755) {
          try {
            fs.chmodSync(binaryPath, 0o755);
          } catch (e) {
            console.warn(`Failed to set permissions for ${binaryPath}: ${e}`);
          }
        }
      }
      continue;
    }

    console.log(`Installing ripgrep for ${platform}...`);
    fs.mkdirSync(platformDir, { recursive: true });

    const url = info.providers[0].url;
    const tempFile = path.join(platformDir, `download.${info.format}`);

    try {
      // Download using curl
      console.log(`Downloading ${url}...`);
      execSync(`curl -L -o "${tempFile}" "${url}"`, { stdio: "inherit" });

      // Extract
      console.log(`Extracting ${tempFile}...`);
      if (info.format === "tar.gz") {
        // Extract specific file from tar.gz
        const extractDir = path.join(platformDir, "extract");
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`tar -xzf "${tempFile}" -C "${extractDir}"`, {
          stdio: "inherit",
        });
        const extractedBinary = path.join(extractDir, info.path);
        if (fs.existsSync(extractedBinary)) {
          fs.renameSync(extractedBinary, binaryPath);
        } else {
          throw new Error(`Binary not found in archive: ${info.path}`);
        }
        // Clean up extract dir
        fs.rmSync(extractDir, { recursive: true, force: true });
      } else if (info.format === "zip") {
        const extractDir = path.join(platformDir, "extract");
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`unzip -o "${tempFile}" -d "${extractDir}"`, {
          stdio: "inherit",
        });
        const extractedBinary = path.join(extractDir, info.path);
        if (fs.existsSync(extractedBinary)) {
          fs.renameSync(extractedBinary, binaryPath);
        } else {
          throw new Error(`Binary not found in archive: ${info.path}`);
        }
        // Clean up extract dir
        fs.rmSync(extractDir, { recursive: true, force: true });
      }

      // Make executable
      if (!isWindows) {
        fs.chmodSync(binaryPath, 0o755);
      }

      console.log(`Successfully installed ripgrep for ${platform}`);
    } catch (error) {
      console.error(`Failed to install ripgrep for ${platform}:`, error);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VENDOR_DIR = path.resolve(__dirname, "../vendor/ripgrep");

function chmodRecursive(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      chmodRecursive(fullPath);
    } else if (file === "rg" || file === "rg.exe") {
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(fullPath, 0o755);
          console.log(`Set execution permission for ${fullPath}`);
        } catch (e) {
          console.warn(
            `Failed to set execution permission for ${fullPath}: ${e.message}`,
          );
        }
      }
    }
  }
}

chmodRecursive(VENDOR_DIR);

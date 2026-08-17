import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Reads the nearest package.json by walking up from this module's location.
 * Works for both the tsc output (dist/<subdir>/...) and the single-file esbuild
 * bundle (dist/bundle/wave.mjs), whose relative depths differ.
 */
export function readNearestPackageJson(): {
  name: string;
  version: string;
  [key: string]: unknown;
} {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "package.json");
    try {
      return JSON.parse(readFileSync(candidate, "utf-8"));
    } catch {
      // Not here — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("package.json not found above this module");
    }
    dir = parent;
  }
}

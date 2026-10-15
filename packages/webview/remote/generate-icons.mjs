#!/usr/bin/env node
/**
 * Generate the page's home-screen icons from the desktop app's brand icon.
 *
 * One-off (assets are committed under `remote/assets/` and content-hashed at
 * page build time), kept as a script so the day the brand icon changes, this
 * is the whole regen story. `sharp` is a runtime dependency of the CLI package,
 * not of this one — resolving through it keeps a second copy of a native module
 * out of `packages/webview`'s tree.
 *
 * Usage:  node packages/webview/remote/generate-icons.mjs
 *
 * The desktop grid draws an 824×824 rounded rect centered on a transparent
 * 1024 canvas — macOS applies its own corner mask. A home-screen icon is a
 * full-bleed square (iOS rounds it, Android masks it), so the background rect
 * is widened to the whole viewBox and the radius dropped before rendering;
 * otherwise iOS composites the transparent corners onto black.
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const sharp = createRequire(path.join(ROOT, "packages/code/package.json"))(
  "sharp",
);

const svg = readFileSync(
  path.join(ROOT, "packages/desktop/assets/icon.svg"),
  "utf-8",
);
const fullBleed = svg.replace(
  /<rect x="100" y="100" width="824" height="824" rx="185"/,
  '<rect x="0" y="0" width="1024" height="1024"',
);

/** `apple-touch-icon.png` (180, what iOS reads) and the manifest's 512. */
const targets = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-512.png", size: 512 },
];

mkdirSync(path.join(HERE, "assets"), { recursive: true });
for (const { file, size } of targets) {
  await sharp(Buffer.from(fullBleed))
    .resize(size, size)
    .png()
    .toFile(path.join(HERE, "assets", file));
  console.log(`  ${file} ${size}x${size}`);
}

/**
 * Builtin content embedding.
 *
 * Builtin skills/subagents/plugins ship as TS source (src/builtin/*.ts) and are
 * compiled into the bundle. At runtime they are lazily materialized to a
 * content-hashed cache directory under the OS temp dir, so consumers that
 * readdirSync real directories keep working unchanged — including inside
 * esbuild bundles that never ship a `builtin/` dir on disk.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { BUILTIN_CONTENT } from "../builtin/index.js";

const BUILTIN_CACHE_ROOT = "wave-builtin";
const BUILTIN_CACHE_COMPLETE = ".wave-builtin-complete";

/**
 * Content-hash key: sha256 of the sorted `rel\0content` entries, truncated.
 * Any change to builtin content yields a new key, auto-invalidating stale caches.
 */
export function getBuiltinCacheKey(): string {
  const entries = Object.keys(BUILTIN_CONTENT)
    .sort()
    .map((rel) => `${rel}\0${BUILTIN_CONTENT[rel]}`);
  return createHash("sha256")
    .update(entries.join("\0"))
    .digest("hex")
    .slice(0, 16);
}

let _builtinDir: string | undefined;

/**
 * Materialize builtin content to `{tmpdir}/wave-builtin/{contentHash}/` and
 * return the directory. Memoized per process; idempotent across processes via
 * the `.wave-builtin-complete` marker written last (a torn write leaves no
 * marker, so the next run rewrites).
 */
export function ensureBuiltinMaterialized(): string {
  if (_builtinDir) return _builtinDir;
  const dir = join(tmpdir(), BUILTIN_CACHE_ROOT, getBuiltinCacheKey());
  const marker = join(dir, BUILTIN_CACHE_COMPLETE);
  if (!existsSync(marker)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(BUILTIN_CONTENT)) {
      const filePath = join(dir, rel);
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(filePath, content);
    }
    writeFileSync(marker, "");
  }
  _builtinDir = dir;
  return dir;
}

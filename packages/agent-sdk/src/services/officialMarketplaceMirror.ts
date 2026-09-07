/**
 * Builtin official marketplace zip-snapshot mirror fetch.
 *
 * The official marketplace (wave-plugins-official, BUILTIN in MarketplaceService)
 * is hosted on GitHub, which is poorly reachable from CN networks. Instead of a
 * dumb-HTTP git endpoint we mirror the "content-addressed zip + latest pointer +
 * local sentinel" model Claude Code uses for its official marketplace
 * (officialMarketplaceGcs.ts, inc-5046):
 *
 *   1. GET `{base}/latest` (10s timeout) → content-addressed sha
 *   2. Compare against the local sentinel `.wave-market-sha` at the market root
 *      — equal ⇒ no-op (idempotent, one ~40B request per run)
 *   3. GET `{base}/{sha}.zip` (60s timeout) → extract into a `.staging` dir
 *      (path-traversal/absolute-path rejection, size limits, exec-bit restore
 *      from zip external attrs)
 *   4. Atomic swap: rm old market dir + rename staging → market dir, write the
 *      sentinel back
 *
 * Any failure returns null; the caller decides whether to fall through to the
 * existing git path (guarded by a kill switch, mirroring Claude's
 * tengu_plugin_official_mkt_git_fallback flag).
 */

import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { logWarn } from "../utils/globalLogger.js";

/** Sentinel file name stored at the market root holding the last fetched sha. */
export const OFFICIAL_MARKET_SENTINEL_FILE = ".wave-market-sha";
/** Suffix of the staging dir used for atomic swap into the market root. */
const STAGING_SUFFIX = ".staging";

/**
 * Default mirror base URL (prod contract) — files hang directly off this base:
 * `{base}/latest` (pure-text sha) and `{base}/{sha}.zip` (whole-tree snapshot).
 * Trailing slash is normalized away when composing URLs.
 *
 * - PROD: `https://codechat.codewave.163.com/wave-plugins-official/`
 * - TEST（验证用）: `https://codechat.codewave-test.163yun.com/wave-plugins-official/`
 *
 * Override with env var `WAVE_OFFICIAL_MARKET_MIRROR_BASE_URL` (highest
 * precedence). 注意：prod 该 URL 的 ingress/内容尚未上线，镜像请求会 404 → 按既有
 * 设计回退 git 兜底（ALLOW_OFFICIAL_MARKET_GIT_FALLBACK），行为安全。
 */
const DEFAULT_OFFICIAL_MARKET_MIRROR_BASE_URL =
  "https://codechat.codewave.163.com/wave-plugins-official/";

/** Env var override for the mirror base URL (highest precedence). */
export const OFFICIAL_MARKET_MIRROR_BASE_URL_ENV =
  "WAVE_OFFICIAL_MARKET_MIRROR_BASE_URL";

/**
 * Kill switch for the git fallback after a mirror failure (default: allowed).
 * Mirrors Claude Code's `tengu_plugin_official_mkt_git_fallback` flag. When
 * false and the mirror fails, the builtin marketplace update is skipped
 * (retried on next run) instead of hitting GitHub.
 */
export const ALLOW_OFFICIAL_MARKET_GIT_FALLBACK = true;

const LATEST_TIMEOUT_MS = 10_000;
const ZIP_TIMEOUT_MS = 60_000;

// Sanity limits against corrupt/malicious archives (zip bombs). The publisher
// is first-party, so these are corruption guards rather than a trust boundary;
// values follow the Claude Code reference (utils/dxt/zip.ts).
const ZIP_LIMITS = {
  MAX_SINGLE_FILE_SIZE: 512 * 1024 * 1024, // per-file uncompressed
  MAX_TOTAL_SIZE: 1024 * 1024 * 1024, // total uncompressed
  MAX_FILE_COUNT: 100_000,
  MAX_COMPRESSION_RATIO: 50, // uncompressed : compressed
} as const;

/**
 * Resolves the mirror base URL: env var wins, otherwise the built-in constant.
 * Returns null when neither is configured (mirror channel disabled).
 */
export function resolveOfficialMarketplaceMirrorBaseUrl(): string | null {
  const envUrl = process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV];
  const candidate =
    (envUrl && envUrl.trim()) || DEFAULT_OFFICIAL_MARKET_MIRROR_BASE_URL;
  if (!candidate) return null;
  return candidate.replace(/\/+$/, ""); // normalize trailing slashes
}

/**
 * Rejects zip entry paths that would escape the extraction root: absolute
 * paths (POSIX or Windows drive/UNC), `..` segments, and null bytes. Paths
 * use either `/` or `\` as separator. Returns the normalized relative path on
 * success or null for entries that must be skipped (empty/directory-only is
 * handled by the caller via the trailing `/`).
 */
export function sanitizeZipEntryPath(entryPath: string): string | null {
  if (!entryPath || entryPath.includes("\0")) return null;
  if (entryPath.startsWith("/") || entryPath.startsWith("\\")) return null;
  const segments = entryPath.split(/[\\/]/);
  // A drive-letter prefix (Windows "C:/…") must not slip through as relative.
  if (segments[0] && /^[A-Za-z]:$/.test(segments[0])) return null;
  for (const seg of segments) {
    if (seg === "..") return null;
  }
  return entryPath;
}

/**
 * Fetches the official marketplace from the zip-snapshot mirror and extracts
 * it to installLocation. Idempotent — compares the local `.wave-market-sha`
 * sentinel before downloading.
 *
 * @param installLocation where to extract (must be inside marketplacesCacheDir)
 * @param marketplacesCacheDir the marketplace cache root (defense-in-depth:
 *   this function `rm`s installLocation during the atomic swap)
 * @param baseUrl optional explicit base URL (tests); defaults to env/constant
 * @returns the fetched sha on success (including no-op), null on any failure
 *   (unconfigured mirror, network, 404, corrupt zip, unsafe entries). Caller
 *   decides whether to fall through to git.
 */
export async function fetchOfficialMarketplaceFromMirror(
  installLocation: string,
  marketplacesCacheDir: string,
  baseUrl?: string,
): Promise<string | null> {
  // Defense in depth: this function does `rm(installLocation, {recursive})`
  // during the atomic swap. A corrupted known_marketplaces.json could point
  // at the user's project. Refuse any path outside the marketplace cache dir.
  // Same guard as Claude's officialMarketplaceGcs.ts:57-65.
  const cacheDir = resolve(marketplacesCacheDir);
  const resolvedLoc = resolve(installLocation);
  if (resolvedLoc !== cacheDir && !resolvedLoc.startsWith(cacheDir + sep)) {
    logWarn(
      `Official marketplace mirror: refusing install location outside marketplaces cache dir: ${installLocation}`,
    );
    return null;
  }

  const effectiveBase = baseUrl ?? resolveOfficialMarketplaceMirrorBaseUrl();
  if (!effectiveBase) return null; // mirror not configured

  try {
    // 1. Latest pointer — tiny request, hit on every startup.
    const latestText = await httpGetText(
      `${effectiveBase}/latest`,
      LATEST_TIMEOUT_MS,
    );
    const sha = latestText.trim();
    if (!sha) {
      // Empty /latest body — mirror misconfigured. Bail (null), don't lock
      // into a permanently-broken empty-sentinel state.
      throw new Error(
        "Official marketplace mirror: latest pointer returned empty body",
      );
    }
    // sha is interpolated into a URL — keep it a sane opaque token.
    if (!/^[^\s/\\]+$/.test(sha)) {
      throw new Error(
        `Official marketplace mirror: invalid sha from latest pointer`,
      );
    }

    // 2. Sentinel check.
    const currentSha = await readFile(
      join(installLocation, OFFICIAL_MARKET_SENTINEL_FILE),
      "utf8",
    )
      .then((s) => s.trim())
      .catch(() => null); // ENOENT — first fetch, proceed to download
    if (currentSha === sha) return sha;

    // 3. Download zip and extract to a staging dir, then atomic-swap into
    //    place. A crash mid-extract leaves a .staging dir (rm'd on the next
    //    run) rather than a half-written installLocation.
    const zipBuf = await httpGetBuffer(
      `${effectiveBase}/${sha}.zip`,
      ZIP_TIMEOUT_MS,
    );
    const zipState: ZipValidationState = {
      fileCount: 0,
      totalUncompressed: 0,
      compressedSize: zipBuf.length,
    };
    const files = unzipSync(new Uint8Array(zipBuf), {
      filter: (file) => {
        validateZipEntry(file.name, file.originalSize, zipState);
        return true;
      },
    });
    // fflate doesn't surface external_attr, so parse the central directory
    // ourselves to recover exec bits. Without this, hooks/scripts extract as
    // 0644 and fail to execute — git clone preserves +x natively, so the zip
    // path must too.
    const modes = parseZipModes(zipBuf);

    const staging = `${installLocation}${STAGING_SUFFIX}`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    for (const [entryName, data] of Object.entries(files)) {
      if (!entryName || entryName.endsWith("/")) continue; // dir entries
      const rel = sanitizeZipEntryPath(entryName);
      if (!rel) continue; // validated in filter; skip defensively
      const dest = join(staging, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
      const mode = modes[entryName];
      if (mode && mode & 0o111) {
        // Only chmod when an exec bit is set — skip plain files to save
        // syscalls. Swallow EPERM/ENOTSUP (read-only mounts) — losing +x is
        // better than aborting mid-extraction.
        await chmod(dest, mode & 0o777).catch(() => {});
      }
    }
    await writeFile(join(staging, OFFICIAL_MARKET_SENTINEL_FILE), sha);

    // 4. Atomic swap: rm old, rename staging. Brief window where
    //    installLocation doesn't exist — acceptable for a background refresh
    //    (next run re-downloads if it crashes here).
    await rm(installLocation, { recursive: true, force: true });
    await rename(staging, installLocation);

    return sha;
  } catch (error) {
    logWarn(
      `Official marketplace mirror fetch failed (falling back per caller policy): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

interface ZipValidationState {
  fileCount: number;
  totalUncompressed: number;
  compressedSize: number;
}

/**
 * Validates one zip entry (called from the fflate filter). Throws to abort the
 * whole extraction when an entry is unsafe or the archive exceeds limits.
 */
export function validateZipEntry(
  name: string,
  originalSize: number,
  state: ZipValidationState,
): void {
  state.fileCount++;
  if (state.fileCount > ZIP_LIMITS.MAX_FILE_COUNT) {
    throw new Error(
      `Official marketplace zip contains too many files (${state.fileCount}, max ${ZIP_LIMITS.MAX_FILE_COUNT})`,
    );
  }
  const clean = sanitizeZipEntryPath(name);
  if (!clean) {
    // Reject unsafe entries (path traversal, absolute paths, null bytes).
    // Directory entries are validated too — a `../` dir entry aborts.
    throw new Error(`Official marketplace zip contains unsafe path: "${name}"`);
  }
  if (originalSize > ZIP_LIMITS.MAX_SINGLE_FILE_SIZE) {
    throw new Error(
      `Official marketplace zip entry "${name}" too large (${originalSize} bytes, max ${ZIP_LIMITS.MAX_SINGLE_FILE_SIZE})`,
    );
  }
  state.totalUncompressed += originalSize;
  if (state.totalUncompressed > ZIP_LIMITS.MAX_TOTAL_SIZE) {
    throw new Error(
      `Official marketplace zip total size exceeds ${ZIP_LIMITS.MAX_TOTAL_SIZE} bytes`,
    );
  }
  if (
    state.compressedSize > 0 &&
    state.totalUncompressed / state.compressedSize >
      ZIP_LIMITS.MAX_COMPRESSION_RATIO
  ) {
    throw new Error(
      `Official marketplace zip suspicious compression ratio (>${ZIP_LIMITS.MAX_COMPRESSION_RATIO}:1) — possible zip bomb`,
    );
  }
}

async function httpGetText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

async function httpGetBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Parse Unix file modes from a zip's central directory.
 *
 * fflate's `unzipSync` returns only `Record<string, Uint8Array>` — it does not
 * surface the external file attributes stored in the central directory, so
 * executable bits would be lost (everything extracts as 0644). Returns
 * `name → mode` for entries created on a Unix host (`versionMadeBy` high byte
 * === 3); other entries are omitted and extract with default mode.
 *
 * Format per PKZIP APPNOTE.TXT §4.3.12 (central directory) and §4.3.16 (EOCD).
 * ZIP64 is not handled — returns `{}` on archives >4GB or >65535 entries,
 * which is fine for marketplace zips.
 */
export function parseZipModes(data: Uint8Array): Record<string, number> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const modes: Record<string, number> = {};

  // 1. Find the End of Central Directory record (sig 0x06054b50). Scan
  //    backwards from the trailing 22 + max-comment bytes.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return modes; // malformed — the unzip error surfaces separately

  const entryCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  // 2. Walk central directory entries (sig 0x02014b50). Each entry has a
  //    46-byte fixed header followed by variable-length name/extra/comment.
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const versionMadeBy = buf.readUInt16LE(off + 4);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const externalAttr = buf.readUInt32LE(off + 38);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);

    // versionMadeBy high byte = host OS. 3 = Unix. For Unix zips the high 16
    // bits of externalAttr hold st_mode (file type + permission bits).
    if (versionMadeBy >> 8 === 3) {
      const mode = (externalAttr >>> 16) & 0xffff;
      if (mode) modes[name] = mode;
    }

    off += 46 + nameLen + extraLen + commentLen;
  }

  return modes;
}

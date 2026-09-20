/**
 * Minimal npm-tarball reader: gunzip + ustar extraction, no dependencies.
 *
 * The runtime-dependency installer (`runtimeDeps.ts`) downloads packages
 * straight from the registry instead of shelling out to npm, so it needs to
 * turn a `.tgz` into files. Node ships gzip (`zlib`) but not tar, and pulling in
 * a tar package would drag a dependency into the CLI bundle for one code path.
 *
 * Scope is deliberately narrow — this reads *npm* tarballs, not tar in general:
 *
 * - npm wraps every entry in a top-level `package/` directory; that wrapper is
 *   stripped, so returned paths are relative to the package root. Anything not
 *   under it is an unexpected layout and throws rather than guessing.
 * - Regular files (`0`) and directories (`5`) are supported. Everything else —
 *   GNU long names (`L`), pax headers (`x`), symlinks (`2`) — throws: npm
 *   publishes none of them, and silently skipping an entry would leave a
 *   half-installed package that only fails later.
 * - The 512-byte ustar `prefix` field is honoured, so paths beyond 100 bytes
 *   resolve correctly.
 * - Permission bits are reported (`mode`), not applied — some packages ship an
 *   executable payload (`@vscode/ripgrep-*` holds `bin/rg` at `0o755`), and
 *   whoever writes the files has to set the exec bit itself.
 *
 * Tarball integrity (sha512 from the registry) is verified by the caller before
 * extraction, so this module does not re-checksum headers.
 */
import { gunzipSync } from "node:zlib";

const BLOCK_SIZE = 512;

export interface TarballEntry {
  /** Path relative to the package root (the leading `package/` is removed). */
  path: string;
  kind: "file" | "directory";
  /** File contents; empty for directories. */
  data: Uint8Array;
  /**
   * Unix permission bits from the header (e.g. `0o755`). Callers that only write
   * files may ignore it, but an executable payload (the ripgrep binary) is
   * unusable without the exec bit.
   */
  mode: number;
}

/** Read a NUL-terminated (or full-length) utf8 field out of a tar header. */
function readField(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end++;
  return Buffer.from(block.subarray(offset, end)).toString("utf8");
}

/** Reject anything that could escape the target directory. */
function assertSafeRelativePath(path: string): void {
  if (path.startsWith("/") || path.split("/").some((seg) => seg === "..")) {
    throw new Error(`Refusing unsafe path in npm tarball: ${path}`);
  }
}

/**
 * Decompress and list an npm tarball. Directory entries are returned (empty
 * `data`) so callers can recreate empty directories, but a caller that just
 * writes files may ignore them.
 */
export function extractNpmTarball(tarball: Uint8Array): TarballEntry[] {
  const tar = gunzipSync(tarball);
  const entries: TarballEntry[] = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;

    // A zeroed block marks the end of the archive (conventionally two of them).
    if (header.every((byte) => byte === 0)) break;

    const name = readField(header, 0, 100);
    const size = Number.parseInt(readField(header, 124, 12).trim(), 8);
    const mode = Number.parseInt(readField(header, 100, 8).trim(), 8);
    const typeFlag = String.fromCharCode(header[156]);
    const prefix = readField(header, 345, 155);
    const fullPath = prefix ? `${prefix}/${name}` : name;

    if (!Number.isInteger(size) || size < 0) {
      throw new Error(`Corrupt npm tarball: bad size field for ${fullPath}`);
    }

    const data = tar.subarray(offset, offset + size);
    if (data.length < size) {
      throw new Error(`Corrupt npm tarball: truncated entry ${fullPath}`);
    }
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (fullPath === "package") continue; // the wrapper directory itself
    if (!fullPath.startsWith("package/")) {
      throw new Error(`Unexpected npm tarball layout: ${fullPath}`);
    }
    const path = fullPath.slice("package/".length);
    if (path === "") continue;
    assertSafeRelativePath(path);

    if (typeFlag === "5") {
      entries.push({ path, kind: "directory", data: new Uint8Array(0), mode });
      continue;
    }
    if (typeFlag === "0" || typeFlag === "\0") {
      entries.push({ path, kind: "file", data: Buffer.from(data), mode });
      continue;
    }
    throw new Error(
      `Unsupported tar entry type "${typeFlag}" in npm tarball: ${fullPath}`,
    );
  }

  return entries;
}

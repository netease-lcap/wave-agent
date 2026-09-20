import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractNpmTarball } from "../../src/utils/npmTarball.js";

const BLOCK_SIZE = 512;

/** One ustar header block. Only the fields npm actually uses are filled in. */
function headerBlock(
  name: string,
  size: number,
  typeFlag: string,
  prefix = "",
  mode = 0o644,
): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  block.write(name, 0, 100, "utf8");
  block.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "utf8");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  block.write(`${typeFlag}\0`, 156, 2, "utf8");
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");
  block.write(prefix, 345, 155, "utf8");
  return block;
}

/**
 * A header + zero-padded payload, ready to concatenate into an archive. Paths
 * over 100 bytes are split at the last slash into the ustar `prefix` field,
 * exactly as a real tar writer would.
 */
function entry(
  fullPath: string,
  content: string | Buffer = "",
  typeFlag = "0",
  mode = 0o644,
): Buffer {
  const data = Buffer.from(content);
  const padded = Buffer.alloc(Math.ceil(data.length / BLOCK_SIZE) * BLOCK_SIZE);
  data.copy(padded);
  const slash = fullPath.lastIndexOf("/");
  const split = fullPath.length > 100 && slash !== -1;
  return Buffer.concat([
    headerBlock(
      split ? fullPath.slice(slash + 1) : fullPath,
      data.length,
      typeFlag,
      split ? fullPath.slice(0, slash) : "",
      mode,
    ),
    padded,
  ]);
}

/** Wrap entries in a real gzip stream, terminated by two zero blocks. */
function tarball(...entries: Buffer[]): Uint8Array {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(BLOCK_SIZE * 2)]));
}

function readEntries(...entries: Buffer[]) {
  return extractNpmTarball(tarball(...entries));
}

describe("extractNpmTarball", () => {
  it("strips the package/ wrapper and preserves nested paths and bytes", () => {
    const entries = readEntries(
      entry("package", "", "5"),
      entry("package/package.json", '{"name":"sharp"}'),
      entry("package/lib/colour.js", "module.exports = 1;\n"),
      entry("package/lib/empty.js", ""),
    );

    expect(entries.map((e) => e.path)).toEqual([
      "package.json",
      "lib/colour.js",
      "lib/empty.js",
    ]);
    expect(entries[0].kind).toBe("file");
    expect(Buffer.from(entries[0].data).toString("utf8")).toBe(
      '{"name":"sharp"}',
    );
    expect(Buffer.from(entries[1].data).toString("utf8")).toBe(
      "module.exports = 1;\n",
    );
    expect(entries[2].data.length).toBe(0);
  });

  it("keeps directory entries so empty directories can be recreated", () => {
    const entries = readEntries(
      entry("package", "", "5"),
      entry("package/lib", "", "5"),
      entry("package/lib/index.js", "x"),
    );
    expect(entries).toEqual([
      { path: "lib", kind: "directory", data: new Uint8Array(0), mode: 0o644 },
      {
        path: "lib/index.js",
        kind: "file",
        data: Buffer.from("x"),
        mode: 0o644,
      },
    ]);
  });

  it("reports the permission bits npm publishes for a binary payload", () => {
    // `@vscode/ripgrep-<platform>-<arch>` ships bin/rg as a regular file with
    // the exec bit set — the installer has to restore it or every spawn fails
    // with EACCES.
    const entries = readEntries(
      entry("package/bin/rg", "ELF", "0", 0o755),
      entry("package/lib/index.js", "export const rgPath = 1;"),
    );

    expect(entries[0].mode).toBe(0o755);
    expect(entries[0].mode & 0o111).toBe(0o111);
    expect(entries[1].mode & 0o111).toBe(0);
  });

  it("reads the ustar prefix field used for long paths", () => {
    const fullPath =
      "package/build/Release/obj.target/deep/nested/very/very/long/" +
      "directory/chain/that/exceeds/one/hundred/characters/file.node";
    expect(fullPath.length).toBeGreaterThan(100);

    const entries = readEntries(entry(fullPath, "native"));
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(fullPath.slice("package/".length));
    expect(Buffer.from(entries[0].data).toString("utf8")).toBe("native");
  });

  it("reads data past a payload that is not block-aligned", () => {
    const entries = readEntries(
      entry("package/a.txt", "1234567"),
      entry("package/b.txt", "abcdefg"),
    );
    expect(entries.map((e) => Buffer.from(e.data).toString("utf8"))).toEqual([
      "1234567",
      "abcdefg",
    ]);
  });

  it("throws on entry types npm never publishes instead of skipping them", () => {
    expect(() => readEntries(entry("package/link", "", "2"))).toThrow(
      /Unsupported tar entry type "2"/,
    );
    expect(() => readEntries(entry("package/longname", "", "L"))).toThrow(
      /Unsupported tar entry type "L"/,
    );
  });

  it("refuses paths that escape the target directory", () => {
    expect(() => readEntries(entry("package/../../etc/passwd", "x"))).toThrow(
      /unsafe path/,
    );
  });

  it("throws on a layout that is not an npm tarball", () => {
    expect(() => readEntries(entry("plain.txt", "x"))).toThrow(
      /Unexpected npm tarball layout/,
    );
  });

  it("throws on a corrupt size field rather than guessing", () => {
    const block = headerBlock("package/bad", 0, "0");
    // Overwrite the octal size with spaces, as a garbled header would.
    block.write("            ", 124, 12, "utf8");
    expect(() => extractNpmTarball(tarball(block))).toThrow(
      /Corrupt npm tarball/,
    );
  });

  it("throws when an entry is truncated mid-payload", () => {
    const header = headerBlock("package/big.bin", 4096, "0");
    expect(() =>
      extractNpmTarball(gzipSync(Buffer.concat([header, Buffer.alloc(512)]))),
    ).toThrow(/truncated entry/);
  });

  it("rejects input that is not gzip", () => {
    expect(() =>
      extractNpmTarball(Buffer.from("this is not a tarball")),
    ).toThrow();
  });
});

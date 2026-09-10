import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  statSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, ...mocks },
  };
});

const { statSync, openSync, readSync, closeSync } = mocks;

import { readTailTextSync } from "../../src/utils/fileUtils.js";

/** Make readSync copy `data` into the caller's buffer and report its length. */
function serve(data: string) {
  readSync.mockImplementation(
    (
      _fd: number,
      buffer: Buffer,
      offset: number,
      _length: number,
      _position: number,
    ) => {
      const bytes = Buffer.from(data, "utf8");
      bytes.copy(buffer, offset);
      return bytes.length;
    },
  );
}

describe("readTailTextSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openSync.mockReturnValue(7);
  });

  it("returns '' for an empty file without opening it", () => {
    statSync.mockReturnValue({ size: 0 });

    expect(readTailTextSync("/tmp/empty.log")).toBe("");
    expect(openSync).not.toHaveBeenCalled();
  });

  it("returns '' when the file cannot be read (missing / permission / race)", () => {
    statSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => readTailTextSync("/tmp/gone.log")).not.toThrow();
    expect(readTailTextSync("/tmp/gone.log")).toBe("");
  });

  it("reads the whole file when it is smaller than the window", () => {
    const content = "line one\nline two\n";
    statSync.mockReturnValue({ size: Buffer.byteLength(content) });
    serve(content);

    expect(readTailTextSync("/tmp/small.log")).toBe(content);
    expect(readSync).toHaveBeenCalledWith(
      7,
      expect.any(Buffer),
      0,
      Buffer.byteLength(content),
      0,
    );
    expect(closeSync).toHaveBeenCalledWith(7);
  });

  it("reads only the tail window of a large file and drops the partial first line", () => {
    const maxBytes = 64 * 1024;
    // The window starts mid-line, so its first line is partial.
    const windowText = "ncomplete-tail-line\nfull line A\nfull line B\n";
    statSync.mockReturnValue({ size: 5 * 1024 * 1024 });
    serve(windowText);

    const result = readTailTextSync("/tmp/big.log");

    expect(readSync).toHaveBeenCalledWith(
      7,
      expect.any(Buffer),
      0,
      maxBytes,
      5 * 1024 * 1024 - maxBytes,
    );
    expect(result).toBe("full line A\nfull line B\n");
  });

  it("honors a custom window size", () => {
    const windowText = "partial\nrest\n";
    statSync.mockReturnValue({ size: 5000 });
    serve(windowText);

    expect(readTailTextSync("/tmp/big.log", 100)).toBe("rest\n");
    expect(readSync).toHaveBeenCalledWith(7, expect.any(Buffer), 0, 100, 4900);
  });

  it("closes the file handle when reading throws", () => {
    statSync.mockReturnValue({ size: 100 });
    readSync.mockImplementation(() => {
      throw new Error("EIO");
    });

    expect(readTailTextSync("/tmp/bad.log")).toBe("");
    expect(closeSync).toHaveBeenCalledWith(7);
  });
});

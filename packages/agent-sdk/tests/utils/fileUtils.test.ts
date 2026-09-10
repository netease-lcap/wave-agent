import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import { readFirstLine } from "../../src/utils/fileUtils.js";
import { Readable } from "node:stream";

vi.mock("node:fs/promises");
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: vi.fn(),
  };
});

describe("fileUtils - readFirstLine", () => {
  it("should read the first non-empty line", async () => {
    const { createReadStream } = await import("node:fs");
    const mockStream = Readable.from([
      "\n",
      "  \n",
      "first line\n",
      "second line\n",
    ]);
    vi.mocked(createReadStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createReadStream>,
    );

    const result = await readFirstLine("test.txt");
    expect(result).toBe("first line");
  });

  it("should return empty string if file is empty", async () => {
    const { createReadStream } = await import("node:fs");
    const mockStream = Readable.from(["\n", "  \n"]);
    vi.mocked(createReadStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createReadStream>,
    );

    const result = await readFirstLine("test.txt");
    expect(result).toBe("");
  });

  it("should return empty string if reading fails", async () => {
    const { createReadStream } = await import("node:fs");
    const mockStream = new Readable({
      read() {
        this.emit("error", new Error("Read error"));
      },
    });
    vi.mocked(createReadStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createReadStream>,
    );

    const result = await readFirstLine("test.txt");
    expect(result).toBe("");
  });
});

describe("fileUtils - getLastLine", () => {
  it("should return empty string if file doesn't exist", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
    const { getLastLine } = await import("../../src/utils/fileUtils.js");
    const result = await getLastLine("non-existent.txt");
    expect(result).toBe("");
  });
});

describe("fileUtils - readTailLines", () => {
  /** A file handle whose reads are served from `content` at any position. */
  const handleFor = (content: string) => {
    const bytes = Buffer.from(content, "utf8");
    return {
      read: vi.fn(
        async (buffer: Buffer, offset: number, length: number, pos: number) => {
          const slice = bytes.subarray(pos, pos + length);
          slice.copy(buffer, offset);
          return { bytesRead: slice.length };
        },
      ),
      close: vi.fn(async () => {}),
    };
  };

  const mockFile = (content: string) => {
    vi.mocked(fs.stat).mockResolvedValue({
      size: Buffer.byteLength(content),
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    vi.mocked(fs.open).mockResolvedValue(
      handleFor(content) as unknown as Awaited<ReturnType<typeof fs.open>>,
    );
  };

  it("returns the trailing lines when the window covers the whole file", async () => {
    const { readTailLines } = await import("../../src/utils/fileUtils.js");
    mockFile('{"a":1}\n{"b":2}\n');

    const lines = await readTailLines("s.jsonl");

    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("drops the partial first line when the window starts mid-line", async () => {
    const { readTailLines } = await import("../../src/utils/fileUtils.js");
    // 20 bytes; a 12-byte window starts inside "BBBB", so only the complete
    // trailing lines may be returned (the caller parses them as JSON).
    mockFile("AAAA\nBBBB\nCCCC\nDDDD\n");

    const lines = await readTailLines("s.jsonl", 12);

    expect(lines).toEqual(["CCCC", "DDDD"]);
  });

  it("returns an empty array when the file is missing", async () => {
    const { readTailLines } = await import("../../src/utils/fileUtils.js");
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));

    expect(await readTailLines("nope.jsonl")).toEqual([]);
  });
});

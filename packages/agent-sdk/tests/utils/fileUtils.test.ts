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

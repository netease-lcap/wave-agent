import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { getLastLine } from "../src/utils/fileUtils.js";

vi.mock("node:fs/promises");

describe("getLastLine", () => {
  const mockFileHandle = {
    read: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.open).mockResolvedValue(
      mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
    );
  });

  it("should return empty string for an empty file", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 0 } as unknown as Awaited<
      ReturnType<typeof fs.stat>
    >);

    const result = await getLastLine("empty.txt");
    expect(result).toBe("");
    expect(fs.stat).toHaveBeenCalledWith("empty.txt");
  });

  it("should return empty string if file does not exist", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("File not found"));

    const result = await getLastLine("nonexistent.txt");
    expect(result).toBe("");
  });

  it("should return the only line in a single-line file", async () => {
    const content = "Hello World";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        buffer.copy(targetBuffer, offset, position, position + length);
        return Promise.resolve({ bytesRead: length, buffer: targetBuffer });
      },
    );

    const result = await getLastLine("single.txt");
    expect(result).toBe(content);
  });

  it("should return the last line in a multi-line file", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("multi.txt");
    expect(result).toBe("Line 3");
  });

  it("should skip trailing newlines", async () => {
    const content = "Line 1\nLine 2\n\n\n";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("trailing.txt");
    expect(result).toBe("Line 2");
  });

  it("should handle \r\n (Windows) EOL markers", async () => {
    const content = "Line 1\r\nLine 2\r\n";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("windows.txt");
    expect(result).toBe("Line 2");
  });

  it("should handle \r (Legacy Mac) EOL markers", async () => {
    const content = "Line 1\rLine 2\r";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("mac.txt");
    expect(result).toBe("Line 2");
  });

  it("should handle UTF-8 characters", async () => {
    const content = "Line 1\n你好，世界";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("utf8.txt");
    expect(result).toBe("你好，世界");
  });

  it("should respect minLength parameter", async () => {
    const content = "Line 1\nShort";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("minlength.txt", 10);
    expect(result).toBe("");

    const result2 = await getLastLine("minlength.txt", 5);
    expect(result2).toBe("Short");
  });

  it("should handle large lines exceeding buffer size", async () => {
    const bufferSize = 8 * 1024;
    const largeLine = "A".repeat(bufferSize + 100);
    const content = "First Line\n" + largeLine;
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );
    const result = await getLastLine("large.txt");
    expect(result).toBe(largeLine);
    expect(mockFileHandle.read).toHaveBeenCalled();
  });

  it("should return empty string if file only contains newlines", async () => {
    const content = "\n\n\n";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("newlines.txt");
    expect(result).toBe("");
  });

  it("should skip whitespace-only lines at the end", async () => {
    const content = "Line 1\nLine 2\n   \n\t\n";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("whitespace.txt");
    expect(result).toBe("Line 2");
  });

  it("should trim leading whitespace from the last line", async () => {
    const content = "Line 1\n  Line 2  ";
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("leading_whitespace.txt");
    expect(result).toBe("Line 2");
  });

  it("should handle file where last line is exactly buffer size", async () => {
    const bufferSize = 8 * 1024;
    const lastLine = "B".repeat(bufferSize);
    const content = "First Line\n" + lastLine;
    const buffer = Buffer.from(content);
    vi.mocked(fs.stat).mockResolvedValue({
      size: buffer.length,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    mockFileHandle.read.mockImplementation(
      (targetBuffer, offset, length, position) => {
        const bytesToRead = Math.min(length, buffer.length - position);
        buffer.copy(targetBuffer, offset, position, position + bytesToRead);
        return Promise.resolve({
          bytesRead: bytesToRead,
          buffer: targetBuffer,
        });
      },
    );

    const result = await getLastLine("exact_buffer.txt");
    expect(result).toBe(lastLine);
  });
});

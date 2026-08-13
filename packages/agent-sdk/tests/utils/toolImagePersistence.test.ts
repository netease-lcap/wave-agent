import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock os
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  };
});

// Mock logger
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { persistToolImages } from "../../src/utils/toolImagePersistence.js";

describe("toolImagePersistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should persist an image to /tmp/wave-mcp-images with .png extension", () => {
    const result = persistToolImages([
      { data: "aGVsbG8=", mediaType: "image/png" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].data).toBe("aGVsbG8=");
    expect(result[0].mediaType).toBe("image/png");
    expect(result[0].path).toMatch(
      /[/\\]wave-mcp-images[/\\]mcp-image_\d+_[a-z0-9]+\.png$/,
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join("/tmp", "wave-mcp-images"),
      { recursive: true },
    );
  });

  it("should write the decoded base64 bytes to the file", () => {
    const base64 = Buffer.from("test image bytes").toString("base64");
    persistToolImages([{ data: base64, mediaType: "image/png" }]);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(filePath).toMatch(
      /[/\\]wave-mcp-images[/\\]mcp-image_\d+_[a-z0-9]+\.png$/,
    );
    expect(Buffer.isBuffer(content)).toBe(true);
    expect((content as Buffer).toString()).toBe("test image bytes");
  });

  it("should map mimeType to the correct extension", () => {
    const result = persistToolImages([
      { data: "aGVsbG8=", mediaType: "image/jpeg" },
      { data: "aGVsbG8=", mediaType: "image/webp" },
      { data: "aGVsbG8=", mediaType: "image/svg+xml" },
    ]);

    expect(result[0].path).toMatch(/\.jpg$/);
    expect(result[1].path).toMatch(/\.webp$/);
    expect(result[2].path).toMatch(/\.svg$/);
  });

  it("should fall back to .png for unknown or missing mimeType", () => {
    const result = persistToolImages([
      { data: "aGVsbG8=", mediaType: "application/octet-stream" },
      { data: "aGVsbG8=" },
    ]);

    expect(result[0].path).toMatch(/\.png$/);
    expect(result[1].path).toMatch(/\.png$/);
  });

  it("should strip a data: URL prefix before decoding", () => {
    const base64 = Buffer.from("payload").toString("base64");
    const result = persistToolImages([
      { data: `data:image/png;base64,${base64}`, mediaType: "image/png" },
    ]);

    const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect((content as Buffer).toString()).toBe("payload");
    expect(result[0].path).toMatch(/\.png$/);
  });

  it("should persist multiple images with distinct paths", () => {
    const result = persistToolImages([
      { data: "YQ==", mediaType: "image/png" },
      { data: "Yg==", mediaType: "image/jpeg" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBeDefined();
    expect(result[1].path).toBeDefined();
    expect(result[0].path).not.toBe(result[1].path);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("should return the image without path on write failure", () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("disk full");
    });

    const result = persistToolImages([
      { data: "aGVsbG8=", mediaType: "image/png" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBeUndefined();
    expect(result[0].data).toBe("aGVsbG8=");
  });

  it("should return the image without path on mkdir failure", () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error("permission denied");
    });

    const result = persistToolImages([
      { data: "aGVsbG8=", mediaType: "image/png" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBeUndefined();
  });
});

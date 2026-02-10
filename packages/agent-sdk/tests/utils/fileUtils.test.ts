import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ensureGlobalGitIgnore,
  readFirstLine,
} from "../../src/utils/fileUtils.js";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { Readable } from "node:stream";

vi.mock("node:fs/promises");
vi.mock("node:child_process");
vi.mock("node:os");
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

describe("fileUtils - ensureGlobalGitIgnore", () => {
  const mockHomedir = "/home/user";
  const defaultGlobalIgnorePath = path.join(
    mockHomedir,
    ".config",
    "git",
    "ignore",
  );

  beforeEach(() => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    vi.mocked(homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("should add pattern to global ignore file if not present", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockResolvedValue("existing-pattern\n");
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "existing-pattern\nnew-pattern\n",
      "utf8",
    );
  });

  it("should not add pattern if already present", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockResolvedValue("existing-pattern\nnew-pattern\n");

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should create file if it doesn't exist", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "new-pattern\n",
      "utf8",
    );
  });

  it("should use default path if git config fails", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git config failed");
    });
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "new-pattern\n",
      "utf8",
    );
  });
});

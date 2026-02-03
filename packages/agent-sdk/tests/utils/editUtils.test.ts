import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import os from "os";
import { saveEditErrorSnapshot } from "../../src/utils/editUtils.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("fs/promises");
vi.mock("os");
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...actual,
    join: vi.fn((...args) => args.join("/")),
    basename: vi.fn((p) => p.split("/").pop()),
  };
});
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("saveEditErrorSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.tmpdir).mockReturnValue("/tmp");
  });

  it("should create directory and write files correctly", async () => {
    const filePath = "/path/to/file.ts";
    const oldString = "old content";
    const currentContent = "current content";
    const toolName = "editTool";

    const result = await saveEditErrorSnapshot(
      filePath,
      oldString,
      currentContent,
      toolName,
    );

    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/wave-agent-edit-errors/"),
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("old_string.txt"),
      oldString,
      "utf-8",
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("file_content.txt"),
      currentContent,
      "utf-8",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Edit error snapshot saved to:"),
    );
    expect(result).toContain("/tmp/wave-agent-edit-errors/");
  });

  it("should return null and log error if saving fails", async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("Failed to create dir"));

    const result = await saveEditErrorSnapshot(
      "/path/to/file.ts",
      "old",
      "current",
      "editTool",
    );

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to save edit error snapshot: Error: Failed to create dir",
      ),
    );
  });
});

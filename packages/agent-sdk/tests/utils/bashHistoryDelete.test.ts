import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  deleteBashCommandFromHistory,
  BashHistory,
} from "../../src/utils/bashHistory.js";
import { BASH_HISTORY_FILE } from "../../src/utils/constants.js";

vi.mock("fs");
vi.mock("../../src/utils/constants.js", () => ({
  BASH_HISTORY_FILE: "/mock/path/bash-history.json",
  DATA_DIRECTORY: "/mock/path",
}));

// Mock logger to suppress output
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("deleteBashCommandFromHistory", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "development"; // Bypass the test environment check in saveBashHistory
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should delete a specific command from history and save to file", () => {
    const workdir = "/test/workdir";
    const mockHistory = {
      version: 1,
      commands: [
        { command: "ls", timestamp: 1000, workdir },
        { command: "cd ..", timestamp: 2000, workdir },
        { command: "ls", timestamp: 3000, workdir: "/other/dir" },
      ],
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify(mockHistory) as unknown as ReturnType<
        typeof fs.readFileSync
      >,
    );

    deleteBashCommandFromHistory("ls", workdir);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [filePath, data] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(filePath).toBe(BASH_HISTORY_FILE);

    const savedHistory = JSON.parse(data as string) as BashHistory;

    expect(savedHistory.commands).toHaveLength(2);
    expect(savedHistory.commands).toContainEqual({
      command: "cd ..",
      timestamp: 2000,
      workdir,
    });
    expect(savedHistory.commands).toContainEqual({
      command: "ls",
      timestamp: 3000,
      workdir: "/other/dir",
    });
    expect(
      savedHistory.commands.find(
        (c) => c.command === "ls" && c.workdir === workdir,
      ),
    ).toBeUndefined();
  });

  it("should delete all instances of a command if workdir is not provided", () => {
    const mockHistory = {
      version: 1,
      commands: [
        { command: "ls", timestamp: 1000, workdir: "/dir1" },
        { command: "cd ..", timestamp: 2000, workdir: "/dir2" },
        { command: "ls", timestamp: 3000, workdir: "/dir3" },
      ],
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockHistory));

    deleteBashCommandFromHistory("ls");

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, data] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const savedHistory = JSON.parse(data as string) as BashHistory;

    expect(savedHistory.commands).toHaveLength(1);
    expect(savedHistory.commands[0].command).toBe("cd ..");
  });

  it("should not save if command is not found", () => {
    const workdir = "/test/workdir";
    const mockHistory = {
      version: 1,
      commands: [{ command: "ls", timestamp: 1000, workdir }],
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify(mockHistory) as unknown as ReturnType<
        typeof fs.readFileSync
      >,
    );

    deleteBashCommandFromHistory("non-existent", workdir);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should handle errors gracefully", () => {
    vi.mocked(fs.existsSync).mockImplementation(() => {
      throw new Error("FS Error");
    });

    // Should not throw
    expect(() => deleteBashCommandFromHistory("ls", "/any")).not.toThrow();
  });
});

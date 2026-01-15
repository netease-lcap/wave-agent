import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  searchBashHistory,
  getRecentBashCommands,
} from "../../src/utils/bashHistory.js";

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

describe("bashHistory search and recent", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  const mockHistory = {
    version: 1,
    commands: [
      { command: "ls", timestamp: 1000, workdir: "/dir1" },
      { command: "cd ..", timestamp: 2000, workdir: "/dir2" },
      { command: "grep test", timestamp: 3000, workdir: "/dir1" },
    ],
  };

  it("searchBashHistory should not filter by workdir", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockHistory));

    // Search from /dir2 should still find commands from /dir1
    const results = searchBashHistory("ls", 10);
    expect(results).toHaveLength(1);
    expect(results[0].command).toBe("ls");
    expect(results[0].workdir).toBe("/dir1");
  });

  it("getRecentBashCommands should not filter by workdir", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockHistory));

    // Get recent from /dir2 should return all commands
    const results = getRecentBashCommands(10);
    expect(results).toHaveLength(3);
    // Should be sorted by timestamp descending
    expect(results[0].command).toBe("grep test");
    expect(results[1].command).toBe("cd ..");
    expect(results[2].command).toBe("ls");
  });
});

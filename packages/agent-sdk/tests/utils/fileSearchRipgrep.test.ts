import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchFilesRipgrep } from "../../src/utils/fileSearchRipgrep.js";
import type { ChildProcess } from "child_process";

// Mock the rgPath from @vscode/ripgrep
vi.mock("@vscode/ripgrep", () => ({
  rgPath: "/usr/bin/rg", // Mock path to ripgrep
}));

// Mock child_process spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  statSync: vi.fn(),
  promises: {
    stat: vi.fn(),
  },
}));

// Mock fileFilter
vi.mock("../../src/utils/fileFilter.js", () => ({
  getGlobIgnorePatterns: vi.fn(() => ["node_modules/**", ".git/**"]),
}));

import { spawn } from "child_process";
import * as fs from "fs";

describe("fileSearchRipgrep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle empty query by searching common file types", async () => {
    // Mock spawn to return successful results
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation(() => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              callback("test.ts\ntest.js\n");
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === "close") {
            callback(0); // Success exit code
          }
        }),
      } as unknown as ChildProcess;
      return mockProcess;
    });

    // Mock fs.promises.stat
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtime: new Date(),
    } as fs.Stats);

    const results = await searchFilesRipgrep("", {
      workingDirectory: "/test",
      maxResults: 10,
    });

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  it("should handle query with ignoreCase option", async () => {
    // Mock spawn to simulate different results for case-sensitive vs case-insensitive
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((command, args) => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              // Check if --iglob is used (case-insensitive)
              if (args?.includes("--iglob")) {
                callback("TestFile.JS\ntest.js\n");
              } else {
                callback("test.js\n");
              }
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === "close") {
            callback(0);
          }
        }),
      } as unknown as ChildProcess;
      return mockProcess;
    });

    // Mock fs.promises.stat
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtime: new Date(),
    } as fs.Stats);

    const resultsWithoutIgnoreCase = await searchFilesRipgrep("test", {
      ignoreCase: false,
      maxResults: 10,
    });

    const resultsWithIgnoreCase = await searchFilesRipgrep("test", {
      ignoreCase: true,
      maxResults: 10,
    });

    expect(resultsWithoutIgnoreCase).toBeDefined();
    expect(resultsWithIgnoreCase).toBeDefined();
  });

  it("should handle ripgrep errors gracefully", async () => {
    // Mock spawn to simulate error
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation(() => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              callback("Error message");
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === "close") {
            callback(2); // Error exit code
          }
        }),
      } as unknown as ChildProcess;
      return mockProcess;
    });

    const results = await searchFilesRipgrep("test", {
      workingDirectory: "/test",
    });

    expect(results).toEqual([]);
  });
});

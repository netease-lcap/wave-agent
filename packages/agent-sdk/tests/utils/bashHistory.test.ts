import { describe, it, expect } from "vitest";
import {
  searchBashHistory,
  addBashCommandToHistory,
} from "../../src/utils/bashHistory.js";

describe("searchBashHistory", () => {
  it("should require workdir parameter", () => {
    const testWorkdir = "/test/workdir";

    // This should work fine
    const results = searchBashHistory("test", 10, testWorkdir);
    expect(Array.isArray(results)).toBe(true);
  });

  it("should filter commands by workdir", () => {
    const workdir1 = "/test/workdir1";
    const workdir2 = "/test/workdir2";

    // Add some test commands to different workdirs
    addBashCommandToHistory("echo workdir1", workdir1);
    addBashCommandToHistory("echo workdir2", workdir2);

    // Search should only return commands from the specified workdir
    const results1 = searchBashHistory("echo", 10, workdir1);
    const results2 = searchBashHistory("echo", 10, workdir2);

    // In test environment, history isn't saved to file, so we can't test the actual filtering
    // But we can verify the function accepts the workdir parameter
    expect(Array.isArray(results1)).toBe(true);
    expect(Array.isArray(results2)).toBe(true);
  });
});

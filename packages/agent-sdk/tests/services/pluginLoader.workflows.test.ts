import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginLoader } from "../../src/services/pluginLoader.js";

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const VALID = `export const meta = { name: "scan", description: "Scan a repo" };\nreturn 1;`;
const INVALID = `export const meta = { name: "scan" };\nreturn 1;`;

/**
 * Resolved fixture path: `loadWorkflows` builds child paths with `path.join`, so
 * the expectation has to be produced by the same function — on Windows that
 * means backslashes plus a drive letter, never the POSIX literal.
 */
const PLUGIN_PATH = path.resolve("/plugins/demo");

function dirent(name: string, isFile: boolean) {
  return { name, isFile: () => isFile };
}

describe("PluginLoader.loadWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads *.js files, naming each by its file stem", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      dirent("scan.js", true),
      dirent("notes.md", true),
      dirent("nested", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readFile).mockResolvedValue(VALID);

    const workflows = await PluginLoader.loadWorkflows(PLUGIN_PATH);

    expect(workflows).toEqual([
      {
        name: "scan",
        description: "Scan a repo",
        path: path.join(PLUGIN_PATH, "workflows", "scan.js"),
        meta: { name: "scan", description: "Scan a repo" },
      },
    ]);
    // Only the .js file was read.
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it("skips a file whose meta fails validation without failing the plugin", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      dirent("broken.js", true),
      dirent("scan.js", true),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readFile).mockImplementation(async (filePath) =>
      String(filePath).endsWith("broken.js") ? INVALID : VALID,
    );

    const workflows = await PluginLoader.loadWorkflows(PLUGIN_PATH);

    expect(workflows.map((workflow) => workflow.name)).toEqual(["scan"]);
  });

  it("returns an empty list when the plugin ships no workflows", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(PluginLoader.loadWorkflows(PLUGIN_PATH)).resolves.toEqual([]);
  });
});

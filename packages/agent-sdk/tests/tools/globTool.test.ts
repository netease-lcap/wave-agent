import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import { Container } from "@/utils/container.js";
import { VCS_DIRECTORIES } from "@/utils/vcsDirectories.js";

const WORKDIR = path.resolve("/fake/project");
const SRC = path.join(WORKDIR, "src");

const testContext: ToolContext = {
  workdir: WORKDIR,
  taskManager: new TaskManager(new Container(), "test-session"),
};

// The ripgrep binary is resolved per call (the CLI installs the dependency
// itself), so both the path and the spawn are mocked: this suite asserts what
// Glob *asks* ripgrep for, and the binary's own matching is verified on a real
// machine instead of being re-implemented here.
const rgProbe = vi.hoisted(() => ({ path: "/mock/rg" as string | undefined }));
vi.mock("@/utils/ripgrep.js", () => ({
  getRgPath: () => rgProbe.path,
  resolveRipgrep: () => rgProbe.path,
  resetRipgrep: () => {},
}));

vi.mock("@/utils/runCommand.js", () => ({ runCommand: vi.fn() }));

// The installer Glob kicks when ripgrep is missing — mocked so no case touches
// the network.
vi.mock("@/utils/runtimeDeps.js", () => ({
  ensureRuntimeDeps: vi.fn(async () => ({ available: true })),
}));

import { runCommand } from "@/utils/runCommand.js";
import { ensureRuntimeDeps } from "@/utils/runtimeDeps.js";

/** stdout exactly as ripgrep would produce it: one relative path per line. */
const output = (...files: string[]) =>
  files.length === 0
    ? { stdout: "", stderr: "", exitCode: 1, error: false }
    : {
        stdout: `${files.join("\n")}\n`,
        stderr: "",
        exitCode: 0,
        error: false,
      };

const run = (args: Record<string, unknown>) =>
  globTool.execute(args, testContext);

describe("globTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rgProbe.path = "/mock/rg";
    vi.mocked(runCommand).mockResolvedValue(output() as never);
  });

  it("should be properly configured", () => {
    expect(globTool.name).toBe("Glob");
    expect(globTool.config.type).toBe("function");
    if (
      globTool.config.type === "function" &&
      globTool.config.function.parameters
    ) {
      expect(globTool.config.function.name).toBe("Glob");
      expect(globTool.config.function.description).toBe(
        "Fast file pattern matching tool that works with any codebase size",
      );
      expect(globTool.config.function.parameters.required).toEqual(["pattern"]);
    }
  });

  it("returns the matching files as workdir-relative paths", async () => {
    vi.mocked(runCommand).mockResolvedValue(
      output(
        path.join("src", "index.ts"),
        path.join("src", "utils.ts"),
      ) as never,
    );

    const result = await run({ pattern: "**/*.ts" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("src/index.ts\nsrc/utils.ts");
    expect(result.shortResult).toBe("Found 2 files");
    expect(result.data).toEqual({
      durationMs: expect.any(Number),
      numFiles: 2,
      filenames: [path.join("src", "index.ts"), path.join("src", "utils.ts")],
      truncated: false,
    });
  });

  it("walks the workdir with ripgrep and the Claude Code defaults", async () => {
    await run({ pattern: "**/*.ts" });

    const [command, args, cwd] = vi.mocked(runCommand).mock.calls[0];
    expect(command).toBe("/mock/rg");
    expect(cwd).toBe(WORKDIR);
    expect(args).toEqual([
      "--files",
      "--glob",
      "**/*.ts",
      "--sort=modified",
      "--no-ignore",
      "--hidden",
      // `--no-ignore` walks `.git` like any other directory, so the exclusion
      // has to be spelled out — one `--glob !<dir>` per VCS directory.
      ...VCS_DIRECTORIES.flatMap((dir) => ["--glob", `!${dir}`]),
    ]);
  });

  it("excludes every VCS directory from the walk", async () => {
    await run({ pattern: "**/*" });

    const args = vi.mocked(runCommand).mock.calls[0][1];
    const excludes = args.filter((_arg, index) => args[index - 1] === "--glob");
    expect(excludes).toEqual(
      expect.arrayContaining(VCS_DIRECTORIES.map((dir) => `!${dir}`)),
    );
  });

  it("rewrites a Windows-style pattern so ripgrep does not read `\\` as an escape", async () => {
    await run({ pattern: "src\\**\\*.ts" });

    const args = vi.mocked(runCommand).mock.calls[0][1];
    expect(args[args.indexOf("--glob") + 1]).toBe("src/**/*.ts");
  });

  it("leaves the pattern's case alone (matching is case-sensitive, as in ripgrep)", async () => {
    // Recorded rather than 'fixed': ripgrep's glob matching is a string match,
    // so `*.TS` does not find `a.ts` even on a case-insensitive filesystem.
    await run({ pattern: "**/*.TS" });

    const args = vi.mocked(runCommand).mock.calls[0][1];
    expect(args[args.indexOf("--glob") + 1]).toBe("**/*.TS");
    expect(args).not.toContain("--glob-case-insensitive");
  });

  it("searches inside a relative `path`", async () => {
    vi.mocked(runCommand).mockResolvedValue(output("a.ts") as never);

    const result = await run({ pattern: "*.ts", path: "src" });

    const [, args, cwd] = vi.mocked(runCommand).mock.calls[0];
    expect(cwd).toBe(SRC);
    expect(args[args.indexOf("--glob") + 1]).toBe("*.ts");
    // Relative to the walk root, i.e. `src` — not to the workdir.
    expect(result.content).toBe("src/a.ts");
  });

  it("splits an absolute pattern into walk root and glob", async () => {
    await run({ pattern: path.join(SRC, "**", "*.ts") });

    const [, args, cwd] = vi.mocked(runCommand).mock.calls[0];
    expect(cwd).toBe(SRC);
    expect(args[args.indexOf("--glob") + 1]).toBe("**/*.ts");
  });

  it("reports no matches without inventing an error", async () => {
    vi.mocked(runCommand).mockResolvedValue(output() as never);

    const result = await run({ pattern: "**/*.nope" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("No files found");
    expect(result.shortResult).toBe("No files found");
  });

  it("truncates at `limit` and says so", async () => {
    const files = Array.from({ length: 150 }, (_, i) => `file${i}.ts`);
    vi.mocked(runCommand).mockResolvedValue(output(...files) as never);

    const result = await run({ pattern: "**/*.ts" });

    const lines = result.content.split("\n");
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe("file0.ts");
    expect(lines[99]).toBe("file99.ts");
    expect(lines[100]).toBe(
      "(Results are truncated. Consider using a more specific path or pattern.)",
    );
    expect(result.shortResult).toBe("Found 150 files (showing first 100)");
    // `numFiles` counts what was handed over (CC takes `filenames.length`), so
    // the truncation itself is only visible through `truncated`.
    expect(result.data).toEqual({
      durationMs: expect.any(Number),
      numFiles: 100,
      filenames: expect.arrayContaining(["file0.ts", "file99.ts"]),
      truncated: true,
    });
  });

  it("honours a custom limit", async () => {
    vi.mocked(runCommand).mockResolvedValue(
      output("a.ts", "b.ts", "c.ts") as never,
    );

    const result = await run({ pattern: "**/*.ts", limit: 2 });

    expect(result.content.split("\n")).toHaveLength(3);
    expect(result.content).toContain("Results are truncated");
    expect(result.shortResult).toBe("Found 3 files (showing first 2)");
  });

  it("fails readably when ripgrep is not installed", async () => {
    rgProbe.path = undefined;

    const result = await run({ pattern: "**/*.ts" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ripgrep is not available");
    // The install is kicked for entry points that do not await it at startup.
    expect(ensureRuntimeDeps).toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("surfaces a walk failure instead of reporting zero files", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: "",
      stderr: "no such file or directory",
      exitCode: 2,
      error: true,
    } as never);

    const result = await run({ pattern: "**/*.ts", path: "does-not-exist" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no such file or directory");
  });

  it("keeps partial results when ripgrep only warns about unreadable files", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: "src/a.ts\n",
      stderr: "permission denied",
      exitCode: 2,
      error: true,
    } as never);

    const result = await run({ pattern: "**/*.ts" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("src/a.ts");
  });

  it("returns errors for a missing or non-string pattern", async () => {
    await expect(run({})).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("pattern parameter is required"),
    });
    await expect(run({ pattern: 123 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining(
        "pattern parameter is required and must be a string",
      ),
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("formats compact parameters", () => {
    expect(
      globTool.formatCompactParams?.({ pattern: "**/*.ts" }, testContext),
    ).toBe("**/*.ts");
    expect(
      globTool.formatCompactParams?.(
        { pattern: "*.js", path: path.join(WORKDIR, "src") },
        testContext,
      ),
    ).toBe("*.js in src");
  });
});

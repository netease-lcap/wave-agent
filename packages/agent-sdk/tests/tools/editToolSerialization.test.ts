import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, stat, unlink, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { editTool } from "@/tools/editTool.js";
import type { ToolContext } from "@/tools/types.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";

/**
 * Integration tests using real filesystem to verify that serialized Edit
 * calls (as aiManager does for non-concurrency-safe tools) apply all changes
 * correctly, and that the staleness check catches external modifications.
 */
describe("editTool serialization (real fs)", () => {
  let tempFile: string;
  let context: ToolContext;

  beforeEach(async () => {
    tempFile = join(
      tmpdir(),
      `wave-edit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
    );
    await writeFile(tempFile, "line1\nline2\nline3\nline4\nline5\n", "utf-8");

    // Simulate a prior Read: populate readFileState with current mtime + hash
    const stats = await stat(tempFile);
    const content = await readFile(tempFile, "utf-8");
    const readFileState = new Map<
      string,
      { mtime: number; hash: string; offset?: number; limit?: number }
    >();
    readFileState.set(tempFile, {
      mtime: stats.mtime.getTime(),
      hash: createHash("sha256").update(content).digest("hex"),
    });

    context = {
      workdir: tmpdir(),
      taskManager: new TaskManager(new Container(), "test-session"),
      readFileState,
    };
  });

  afterEach(async () => {
    try {
      await unlink(tempFile);
    } catch {
      // ignore
    }
  });

  it("should apply all edits when called sequentially (serialized)", async () => {
    // Simulate serialized execution — what aiManager does for non-safe tools
    await editTool.execute(
      { file_path: tempFile, old_string: "line1", new_string: "LINE1" },
      context,
    );
    await editTool.execute(
      { file_path: tempFile, old_string: "line2", new_string: "LINE2" },
      context,
    );
    await editTool.execute(
      { file_path: tempFile, old_string: "line3", new_string: "LINE3" },
      context,
    );

    const content = await readFile(tempFile, "utf-8");
    expect(content).toBe("LINE1\nLINE2\nLINE3\nline4\nline5\n");
  });

  it("should fail with staleness error when file modified externally", async () => {
    // Externally modify the file and bump mtime forward by 10 seconds
    await writeFile(
      tempFile,
      "line1\nline2\nMODIFIED\nline4\nline5\n",
      "utf-8",
    );
    const future = new Date(Date.now() + 10_000);
    await utimes(tempFile, future, future);

    const result = await editTool.execute(
      { file_path: tempFile, old_string: "line1", new_string: "LINE1" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("unexpectedly modified");
  });

  it("should allow subsequent edit after readFileState is updated", async () => {
    // First edit succeeds and updates readFileState
    const r1 = await editTool.execute(
      { file_path: tempFile, old_string: "line1", new_string: "LINE1" },
      context,
    );
    expect(r1.success).toBe(true);

    // Second edit to the same file should also succeed (staleness check passes
    // because readFileState was updated after the first write)
    const r2 = await editTool.execute(
      { file_path: tempFile, old_string: "line2", new_string: "LINE2" },
      context,
    );
    expect(r2.success).toBe(true);

    const content = await readFile(tempFile, "utf-8");
    expect(content).toContain("LINE1");
    expect(content).toContain("LINE2");
  });
});

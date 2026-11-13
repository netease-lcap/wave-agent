import { describe, it, expect } from "vitest";
import type { Message, ToolBlock } from "wave-agent-sdk";
import {
  collectTurnDiffs,
  parseUnifiedDiff,
} from "../../src/utils/sessionDiff.js";

const userMessage = (text: string, isMeta = false): Message => ({
  id: `user-${text}`,
  role: "user",
  timestamp: new Date().toISOString(),
  isMeta,
  blocks: [{ type: "text", content: text, stage: "end" }],
});

const assistantMessage = (blocks: ToolBlock[]): Message => ({
  id: `assistant-${blocks.length}-${blocks[0]?.parameters ?? ""}`,
  role: "assistant",
  timestamp: new Date().toISOString(),
  blocks,
});

const toolBlock = (
  name: string,
  params: Record<string, unknown>,
  extra: Partial<ToolBlock> = {},
): ToolBlock => ({
  type: "tool",
  name,
  parameters: JSON.stringify(params),
  stage: "end",
  success: true,
  ...extra,
});

const editBlock = (
  filePath: string,
  oldString: string,
  newString: string,
  startLineNumber = 1,
): ToolBlock => ({
  ...toolBlock(
    "Edit",
    { file_path: filePath, old_string: oldString, new_string: newString },
    { success: true },
  ),
  startLineNumber,
});

const writeBlock = (filePath: string, content: string): ToolBlock =>
  toolBlock("Write", { file_path: filePath, content });

describe("parseUnifiedDiff", () => {
  it("tags hunk headers, additions, deletions and context rows", () => {
    const lines = parseUnifiedDiff(
      ["@@ -1,2 +1,2 @@", " context", "-old", "+new"].join("\n"),
    );
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "context", text: "context" },
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  it("drops the no-newline-at-end-of-file marker", () => {
    const lines = parseUnifiedDiff(
      ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new"].join(
        "\n",
      ),
    );
    expect(lines.map((line) => line.kind)).toEqual(["hunk", "remove", "add"]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("collectTurnDiffs", () => {
  it("turns an Edit into one file with its hunk", () => {
    const turns = collectTurnDiffs([
      userMessage("fix the greeting"),
      assistantMessage([editBlock("/repo/src/a.ts", "hello", "hi", 3)]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].promptPreview).toBe("fix the greeting");
    expect(turns[0].files).toHaveLength(1);
    const file = turns[0].files[0];
    expect(file.path).toBe("/repo/src/a.ts");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    expect(file.lines[0]).toEqual({
      kind: "hunk",
      text: "@@ -3,1 +3,1 @@",
    });
    expect(file.lines.slice(1)).toEqual([
      { kind: "remove", text: "hello" },
      { kind: "add", text: "hi" },
    ]);
  });

  it("renders a Write as pure additions under a 0,0 hunk", () => {
    const turns = collectTurnDiffs([
      userMessage("add a file"),
      assistantMessage([writeBlock("/repo/src/new.ts", "a\nb\n")]),
    ]);

    const file = turns[0].files[0];
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
    expect(file.lines[0]).toEqual({ kind: "hunk", text: "@@ -0,0 +1,2 @@" });
    expect(file.lines.slice(1)).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("merges repeated edits of the same file within one turn", () => {
    const turns = collectTurnDiffs([
      userMessage("two edits"),
      assistantMessage([editBlock("/repo/a.ts", "one", "1")]),
      assistantMessage([editBlock("/repo/a.ts", "two", "2")]),
    ]);

    expect(turns[0].files).toHaveLength(1);
    expect(turns[0].files[0].additions).toBe(2);
    expect(turns[0].files[0].deletions).toBe(2);
    const hunks = turns[0].files[0].lines.filter(
      (line) => line.kind === "hunk",
    );
    expect(hunks).toHaveLength(2);
  });

  it("ignores unfinished, failed and non-file tool blocks", () => {
    const turns = collectTurnDiffs([
      userMessage("try things"),
      assistantMessage([
        editBlock("/repo/a.ts", "x", "y"),
        toolBlock(
          "Edit",
          { file_path: "/repo/b.ts", old_string: "x", new_string: "y" },
          { stage: "running" },
        ),
        toolBlock(
          "Edit",
          { file_path: "/repo/c.ts", old_string: "x", new_string: "y" },
          { success: false },
        ),
        toolBlock("Bash", { command: "ls" }),
      ]),
    ]);

    expect(turns[0].files.map((file) => file.path)).toEqual(["/repo/a.ts"]);
  });

  it("skips turns that changed no files and reports turns newest first", () => {
    const turns = collectTurnDiffs([
      userMessage("first"),
      assistantMessage([editBlock("/repo/a.ts", "one", "1")]),
      userMessage("no edits here"),
      assistantMessage([toolBlock("Bash", { command: "ls" })]),
      userMessage("second"),
      assistantMessage([editBlock("/repo/b.ts", "two", "2")]),
    ]);

    expect(turns.map((turn) => turn.turnIndex)).toEqual([3, 1]);
    expect(turns.map((turn) => turn.promptPreview)).toEqual([
      "second",
      "first",
    ]);
  });

  it("ignores meta user messages so they do not start a turn", () => {
    const turns = collectTurnDiffs([
      userMessage("real prompt"),
      assistantMessage([editBlock("/repo/a.ts", "one", "1")]),
      userMessage("injected meta", true),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].turnIndex).toBe(1);
  });

  it("relativizes absolute paths against the workspace root", () => {
    const workdir = process.platform === "win32" ? "C:\\repo" : "/repo";
    const filePath =
      process.platform === "win32" ? "C:\\repo\\src\\a.ts" : "/repo/src/a.ts";
    const turns = collectTurnDiffs(
      [
        userMessage("edit"),
        assistantMessage([editBlock(filePath, "one", "1")]),
      ],
      workdir,
    );

    expect(turns[0].files[0].path).toBe("src/a.ts");
  });

  it("truncates a long prompt preview", () => {
    const turns = collectTurnDiffs([
      userMessage("x".repeat(200)),
      assistantMessage([editBlock("/repo/a.ts", "one", "1")]),
    ]);

    expect(turns[0].promptPreview).toHaveLength(40);
    expect(turns[0].promptPreview.endsWith("…")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type { Message, MessageBlock, ToolBlock } from "../../src/types";
import { collectConversationFiles } from "../../src/utils/conversationFiles";

// Browser-side string paths: the derivation never touches node's `path` module
// (the webview bundle has none), so separators stay `/` on every platform.
const WORKDIR = "/work/project";

function toolBlock(
  name: string,
  filePath: string,
  overrides: Partial<ToolBlock> = {},
): ToolBlock {
  return {
    type: "tool",
    name,
    stage: "end",
    success: true,
    parameters: JSON.stringify({ file_path: filePath }),
    ...overrides,
  };
}

let seq = 0;
function message(...blocks: MessageBlock[]): Message {
  seq += 1;
  return {
    id: `m-${seq}`,
    role: "assistant",
    blocks,
    timestamp: "2026-10-20T00:00:00.000Z",
  };
}

describe("collectConversationFiles", () => {
  it("lists files read, written and edited, newest first", () => {
    const files = collectConversationFiles(
      [
        message(toolBlock("Read", "src/a.ts")),
        message(toolBlock("Write", "src/b.ts")),
        message(toolBlock("Edit", "src/c.ts")),
      ],
      WORKDIR,
    );

    expect(files.map((f) => f.name)).toEqual(["c.ts", "b.ts", "a.ts"]);
    expect(files.map((f) => f.path)).toEqual([
      "src/c.ts",
      "src/b.ts",
      "src/a.ts",
    ]);
    expect(files.map((f) => f.absolutePath)).toEqual([
      "/work/project/src/c.ts",
      "/work/project/src/b.ts",
      "/work/project/src/a.ts",
    ]);
    expect(files.map((f) => f.displayPath)).toEqual([
      "src/c.ts",
      "src/b.ts",
      "src/a.ts",
    ]);
  });

  it("keeps one entry per file and moves a re-touched file to the front", () => {
    const files = collectConversationFiles(
      [
        // The same file hit twice, spelled absolutely then relatively: one row.
        message(toolBlock("Read", "/work/project/src/a.ts")),
        message(toolBlock("Write", "src/b.ts")),
        message(toolBlock("Edit", "src/a.ts")),
      ],
      WORKDIR,
    );

    expect(files.map((f) => f.absolutePath)).toEqual([
      "/work/project/src/a.ts",
      "/work/project/src/b.ts",
    ]);
    // The row keeps the spelling of its most recent hit.
    expect(files[0].path).toBe("src/a.ts");
  });

  it("skips calls that are still running, failed, or have no path", () => {
    const files = collectConversationFiles(
      [
        message(toolBlock("Read", "src/streaming.ts", { stage: "running" })),
        message(toolBlock("Read", "src/failed.ts", { success: false })),
        message(
          toolBlock("Edit", "ignored", { parameters: JSON.stringify({}) }),
        ),
        message(toolBlock("Read", "src/kept.ts")),
      ],
      WORKDIR,
    );

    expect(files.map((f) => f.name)).toEqual(["kept.ts"]);
  });

  it("ignores tools that are not about one file", () => {
    const files = collectConversationFiles(
      [
        message(toolBlock("Bash", "src/a.ts")),
        message(toolBlock("Grep", "src/a.ts")),
        message(toolBlock("Glob", "src/a.ts")),
      ],
      WORKDIR,
    );

    expect(files).toEqual([]);
  });

  it("leaves artifacts out: an artifact is a URL, not a file", () => {
    const files = collectConversationFiles(
      [
        message(
          toolBlock("Artifact", "docs/report.html", {
            result: "Artifact published: https://host/code/artifact/abc123",
          }),
        ),
      ],
      WORKDIR,
    );

    expect(files).toEqual([]);
  });

  it("shows the relative path when two files share a name", () => {
    const files = collectConversationFiles(
      [
        message(toolBlock("Write", "src/app/index.ts")),
        message(toolBlock("Read", "docs/app/index.ts")),
        message(toolBlock("Read", "src/unique.ts")),
      ],
      WORKDIR,
    );

    const nameByPath = new Map(files.map((f) => [f.displayPath, f.name]));
    expect(nameByPath.get("docs/app/index.ts")).toBe("docs/app/index.ts");
    expect(nameByPath.get("src/app/index.ts")).toBe("src/app/index.ts");
    // The unambiguous file keeps its bare name.
    expect(nameByPath.get("src/unique.ts")).toBe("unique.ts");
  });

  it("falls back to the raw spelling when there is no workdir", () => {
    const files = collectConversationFiles(
      [message(toolBlock("Read", "src/a.ts"))],
      undefined,
    );

    expect(files).toHaveLength(1);
    expect(files[0].absolutePath).toBe("src/a.ts");
    expect(files[0].path).toBe("src/a.ts");
    expect(files[0].displayPath).toBe("src/a.ts");
  });

  it("returns nothing for a conversation that touched no file", () => {
    expect(collectConversationFiles([], WORKDIR)).toEqual([]);
    expect(
      collectConversationFiles(
        [message({ type: "text", content: "hi" })],
        WORKDIR,
      ),
    ).toEqual([]);
  });
});

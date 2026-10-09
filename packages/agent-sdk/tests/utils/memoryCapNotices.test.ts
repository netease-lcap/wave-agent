import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  appendMemoryCapNotice,
  buildEntrypointCapNotice,
  buildMemoryFileCapNotice,
} from "@/utils/memoryCapNotices.js";
import {
  MAX_MEMORY_DESCRIPTION_CHARS,
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_FILE_LINES,
  MEMORY_CAP_TARGET_RATIO,
} from "@/constants/memory.js";
import type { ToolResult } from "@/tools/types.js";

vi.mock("node:fs/promises");

const MEMORY_DIR = "/home/user/.wave/projects/repo-hash/memory";

function target(cap: number): number {
  return Math.floor(cap * MEMORY_CAP_TARGET_RATIO);
}

function result(content = "Wrote file"): ToolResult {
  return { success: true, content };
}

describe("buildEntrypointCapNotice", () => {
  it("stays silent while the index is small and its lines are short", () => {
    expect(
      buildEntrypointCapNotice("- [a](a.md) — one line\n- [b](b.md) — another"),
    ).toBeNull();
  });

  it("stays silent for an empty index", () => {
    expect(buildEntrypointCapNotice("   \n\n ")).toBeNull();
  });

  it("warns once the index crosses the warning ratio for characters", () => {
    // 150 lines of 140 characters: 84% of the character cap, 75% of the line cap,
    // so the character dimension is the one that gets named.
    const raw = Array.from({ length: 150 }, () => "x".repeat(140)).join("\n");

    const notice = buildEntrypointCapNotice(raw);

    expect(notice).toContain("MEMORY.md is 21149 characters");
    expect(notice).toContain(
      `approaching the ${MAX_MEMORY_ENTRYPOINT_CHARS}-character read limit`,
    );
    expect(notice).toContain(
      `Compact it to under ${target(MAX_MEMORY_ENTRYPOINT_CHARS)} characters`,
    );
    expect(notice).not.toContain("Error:");
  });

  it("warns once the index crosses the warning ratio for lines", () => {
    const raw = Array.from({ length: 170 }, () => "short").join("\n");

    const notice = buildEntrypointCapNotice(raw);

    expect(notice).toContain("MEMORY.md is 170 lines");
    expect(notice).toContain(
      `approaching the ${MAX_MEMORY_ENTRYPOINT_LINES}-line read limit`,
    );
    expect(notice).toContain(
      `Compact it to under ${target(MAX_MEMORY_ENTRYPOINT_LINES)} lines`,
    );
  });

  it("says the write succeeded and names the consequence once the cap is passed", () => {
    const raw = Array.from({ length: 200 }, () => "x".repeat(130)).join("\n");

    const notice = buildEntrypointCapNotice(raw);

    expect(notice).toContain(
      "Error: this write left MEMORY.md at 26199 characters",
    );
    expect(notice).toContain(
      `over its ${MAX_MEMORY_ENTRYPOINT_CHARS}-character read limit`,
    );
    expect(notice).toContain("The write succeeded");
    expect(notice).toContain(
      "entries at the end are already invisible to readers",
    );
    expect(notice).toContain(
      `under ${target(MAX_MEMORY_ENTRYPOINT_CHARS)} characters now`,
    );
  });

  it("names the over-long index lines", () => {
    const raw = `${"x".repeat(200)}\n- [b](b.md) — short\n${"y".repeat(151)}`;

    const notice = buildEntrypointCapNotice(raw);

    expect(notice).toContain(
      "2 index line(s) exceed the ~150-character guidance",
    );
    expect(notice).toContain("line 1, line 3");
    expect(notice).not.toContain("+");
  });

  it("caps the over-long line listing at five and counts the rest", () => {
    const raw = Array.from({ length: 7 }, () => "x".repeat(151)).join("\n");

    const notice = buildEntrypointCapNotice(raw);

    expect(notice).toContain("7 index line(s) exceed");
    expect(notice).toContain("line 1, line 2, line 3, line 4, line 5");
    expect(notice).toContain("(+2 more over-long lines)");
  });

  it("reports the size and the over-long lines together", () => {
    const lines = [
      ...Array.from({ length: 168 }, () => "x"),
      "y".repeat(200),
      "y".repeat(200),
    ];

    const notice = buildEntrypointCapNotice(lines.join("\n"));

    expect(notice?.split("\n\n")).toHaveLength(2);
    expect(notice).toContain("MEMORY.md is 170 lines");
    expect(notice).toContain("2 index line(s) exceed");
    expect(notice).toContain("line 169, line 170");
  });
});

describe("buildMemoryFileCapNotice", () => {
  it("stays silent for a small file with a usable description", () => {
    expect(
      buildMemoryFileCapNotice("Some body text", "topic.md", "One fact"),
    ).toBeNull();
  });

  it("counts bytes rather than characters", () => {
    // 2000 CJK characters are 6000 bytes: over the byte cap while the character
    // count looks small, which is exactly why the file cap is measured in bytes.
    const raw = "中".repeat(2000);

    const notice = buildMemoryFileCapNotice(raw, "topic.md", "One fact");

    expect(notice).toContain(
      "Error: this write left the memory file topic.md at 6000 bytes",
    );
    expect(notice).toContain(`over its ${MAX_MEMORY_FILE_BYTES}-byte limit`);
    expect(notice).toContain(
      `under ${target(MAX_MEMORY_FILE_BYTES)} bytes now`,
    );
  });

  it("warns when the line count is approaching the cap", () => {
    const raw = Array.from({ length: 170 }, () => "x").join("\n");

    const notice = buildMemoryFileCapNotice(raw, "topic.md", "One fact");

    expect(notice).toContain("The memory file topic.md is 170 lines");
    expect(notice).toContain(
      `approaching the ${MAX_MEMORY_FILE_LINES}-line limit`,
    );
  });

  it("flags a file that is past the line cap", () => {
    const raw = Array.from({ length: 250 }, () => "x").join("\n");

    const notice = buildMemoryFileCapNotice(raw, "topic.md", "One fact");

    expect(notice).toContain(
      "Error: this write left the memory file topic.md at 250 lines",
    );
    expect(notice).toContain(`over its ${MAX_MEMORY_FILE_LINES}-line limit`);
    expect(notice).toContain(
      "a topic file is read whole whenever it is opened",
    );
  });

  it("flags a missing description", () => {
    const notice = buildMemoryFileCapNotice("Body", "topic.md", null);

    expect(notice).toContain("no frontmatter `description`");
    expect(notice).toContain("cannot be summarised into the MEMORY.md index");
  });

  it("flags a description that is too long", () => {
    const notice = buildMemoryFileCapNotice(
      "Body",
      "topic.md",
      "x".repeat(MAX_MEMORY_DESCRIPTION_CHARS + 50),
    );

    expect(notice).toContain(
      `\`description\` is ${MAX_MEMORY_DESCRIPTION_CHARS + 50} characters`,
    );
    expect(notice).toContain(
      `shorten it to one specific line (about ${MAX_MEMORY_DESCRIPTION_CHARS / 2} characters)`,
    );
  });

  it("reports only the frontmatter problem for an empty file", () => {
    const notice = buildMemoryFileCapNotice("   ", "topic.md", null);

    expect(notice).not.toContain("bytes");
    expect(notice).not.toContain("lines");
    expect(notice).toContain("no frontmatter `description`");
  });
});

describe("appendMemoryCapNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips a failed write", async () => {
    const toolResult: ToolResult = { success: false, content: "boom" };

    await appendMemoryCapNotice(
      "Write",
      { file_path: `${MEMORY_DIR}/MEMORY.md` },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
    expect(toolResult.content).toBe("boom");
  });

  it("skips a tool that does not write files", async () => {
    const toolResult = result();

    await appendMemoryCapNotice(
      "Read",
      { file_path: `${MEMORY_DIR}/MEMORY.md` },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
  });

  it("skips when auto-memory is off", async () => {
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: `${MEMORY_DIR}/MEMORY.md` },
      toolResult,
      MEMORY_DIR,
      undefined,
    );

    expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
  });

  it("never reads a file outside the memory directory", async () => {
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: "/tmp/elsewhere/MEMORY.md" },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
    expect(toolResult.content).toBe("Wrote file");
  });

  it("skips a non-string file_path", async () => {
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: 42 },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
  });

  it("leaves the result alone when the file cannot be read back", async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: `${MEMORY_DIR}/MEMORY.md` },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(toolResult.content).toBe("Wrote file");
  });

  it("appends the index notice to the write result", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      Array.from({ length: 200 }, () => "x".repeat(130)).join(
        "\n",
      ) as unknown as Awaited<ReturnType<typeof fsPromises.readFile>>,
    );
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: `${MEMORY_DIR}/MEMORY.md` },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(toolResult.content).toContain(
      "Wrote file\n\nError: this write left MEMORY.md",
    );
  });

  it("appends the topic-file notice using its frontmatter description", async () => {
    const raw = [
      "---",
      "name: Topic",
      "description: One fact",
      "type: project",
      "---",
      "",
      "中".repeat(2000),
    ].join("\n");
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      raw as unknown as Awaited<ReturnType<typeof fsPromises.readFile>>,
    );
    const toolResult = result();

    await appendMemoryCapNotice(
      "Edit",
      { file_path: `${MEMORY_DIR}/topic.md` },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(toolResult.content).toContain(
      `the memory file topic.md at ${Buffer.byteLength(raw, "utf-8")} bytes`,
    );
    expect(toolResult.content).not.toContain("no frontmatter");
  });

  it("reads the description itself instead of trusting the write payload", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      "---\ntype: project\n---\nBody" as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      {
        file_path: "topic.md",
        content: "---\ndescription: in the payload\n---",
      },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    expect(toolResult.content).toContain("no frontmatter `description`");
  });

  it("resolves a relative path against the workdir", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      "- [a](a.md) — one" as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    const toolResult = result();

    await appendMemoryCapNotice(
      "Write",
      { file_path: "MEMORY.md" },
      toolResult,
      MEMORY_DIR,
      MEMORY_DIR,
    );

    // The implementation resolves the relative path with `path.resolve`, so the
    // expectation has to as well: on Windows `join` keeps the root-relative form
    // (`\home\user\…`) while `resolve` adds the drive (`D:\home\user\…`).
    expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
      path.resolve(MEMORY_DIR, "MEMORY.md"),
      "utf-8",
    );
    expect(toolResult.content).toBe("Wrote file");
  });
});

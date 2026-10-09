import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import {
  buildMemoryEntrypoint,
  formatMemoryManifest,
  scanMemoryFiles,
  type MemoryHeader,
} from "@/utils/memoryIndex.js";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_CAP_TARGET_RATIO,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
} from "@/constants/memory.js";

vi.mock("node:fs/promises");

const MEMORY_DIR = "/home/user/.wave/projects/repo-hash/memory";

function header(overrides: Partial<MemoryHeader> = {}): MemoryHeader {
  return {
    filename: "feedback_testing.md",
    filePath: `${MEMORY_DIR}/feedback_testing.md`,
    mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5),
    description: "Prefer explicit assertions",
    type: "feedback",
    ...overrides,
  };
}

describe("scanMemoryFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists md topic files with their frontmatter, excluding the index", async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      "MEMORY.md",
      "user_role.md",
      "notes.txt",
    ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      [
        "---",
        "type: user",
        "description: Senior engineer",
        "---",
        "",
        "Body",
      ].join("\n") as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5),
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    const memories = await scanMemoryFiles(MEMORY_DIR);

    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      filename: "user_role.md",
      description: "Senior engineer",
      type: "user",
    });
  });

  it("reads a folded description instead of its `>-` indicator", async () => {
    // 记忆文件用折叠写法写 description 时，清单里以前会退化成 ">-"，提取子代理
    // 就看不到这条记忆讲什么（spec core/memory-management 场景 13）。
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      "topic.md",
    ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      [
        "---",
        "type: project",
        "description: >-",
        "  第一行描述",
        "  第二行描述",
        "---",
        "",
        "Body",
      ].join("\n") as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5),
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    const memories = await scanMemoryFiles(MEMORY_DIR);

    expect(memories[0].description).toBe("第一行描述 第二行描述");
    expect(formatMemoryManifest(memories)).toBe(
      "- [project] topic.md (2026-01-02T03:04:05.000Z): 第一行描述 第二行描述",
    );
  });

  it("sorts newest first and caps the listing at 200 files", async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue(
      Array.from(
        { length: 250 },
        (_, i) => `note-${i}.md`,
      ) as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
    );
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      "no frontmatter here" as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    // Note N was modified N ms after the epoch, so the newest is note-249.
    vi.mocked(fsPromises.stat).mockImplementation(
      async (filePath) =>
        ({
          mtimeMs: Number(/\d+/.exec(String(filePath))?.[0] ?? 0),
        }) as unknown as Awaited<ReturnType<typeof fsPromises.stat>>,
    );

    const memories = await scanMemoryFiles(MEMORY_DIR);

    expect(memories).toHaveLength(200);
    expect(memories[0].filename).toBe("note-249.md");
    expect(memories[199].filename).toBe("note-50.md");
  });

  it("keeps a legacy file without frontmatter", async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      "legacy.md",
    ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      "Just prose, no frontmatter" as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >,
    );
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: 0,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    const memories = await scanMemoryFiles(MEMORY_DIR);

    expect(memories).toHaveLength(1);
    expect(memories[0].description).toBeNull();
    expect(memories[0].type).toBeUndefined();
  });

  it("returns an empty list when the directory does not exist", async () => {
    vi.mocked(fsPromises.readdir).mockRejectedValue({ code: "ENOENT" });

    expect(await scanMemoryFiles(MEMORY_DIR)).toEqual([]);
  });

  it("skips an unreadable file instead of dropping the whole scan", async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      "good.md",
      "bad.md",
    ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).endsWith("bad.md")) {
        throw new Error("EACCES");
      }
      return "---\ntype: project\n---\n" as unknown as Awaited<
        ReturnType<typeof fsPromises.readFile>
      >;
    });
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: 0,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    const memories = await scanMemoryFiles(MEMORY_DIR);

    expect(memories.map((m) => m.filename)).toEqual(["good.md"]);
  });
});

describe("formatMemoryManifest", () => {
  it("writes one line per memory with type, timestamp and description", () => {
    const manifest = formatMemoryManifest([header()]);

    expect(manifest).toBe(
      "- [feedback] feedback_testing.md (2026-01-02T03:04:05.000Z): Prefer explicit assertions",
    );
  });

  it("omits the type tag and the description when they are absent", () => {
    const manifest = formatMemoryManifest([
      header({ type: undefined, description: null }),
      header({ type: undefined, description: "Only a description" }),
      header({ type: "project", description: null }),
    ]);

    expect(manifest.split("\n")).toEqual([
      "- feedback_testing.md (2026-01-02T03:04:05.000Z)",
      "- feedback_testing.md (2026-01-02T03:04:05.000Z): Only a description",
      "- [project] feedback_testing.md (2026-01-02T03:04:05.000Z)",
    ]);
  });

  it("returns an empty string for an empty directory", () => {
    expect(formatMemoryManifest([])).toBe("");
  });
});

describe("buildMemoryEntrypoint", () => {
  it("derives one index line per topic file from its description", () => {
    const entrypoint = buildMemoryEntrypoint([
      header(),
      header({
        filename: "user_role.md",
        description: "Senior engineer",
        type: "user",
      }),
    ]);

    expect(entrypoint.split("\n").filter(Boolean)).toEqual([
      "- [feedback_testing](feedback_testing.md) — Prefer explicit assertions",
      "- [user_role](user_role.md) — Senior engineer",
    ]);
  });

  it("keeps a link for a file with no description", () => {
    expect(buildMemoryEntrypoint([header({ description: null })])).toBe(
      "- [feedback_testing](feedback_testing.md)\n",
    );
  });

  it("collapses whitespace and clamps the description to the line guidance", () => {
    const entrypoint = buildMemoryEntrypoint([
      header({ description: `  first\n\n  ${"x".repeat(300)}  ` }),
    ]);

    const [line] = entrypoint.split("\n");
    expect(line).toHaveLength(MEMORY_INDEX_LINE_GUIDANCE_CHARS);
    expect(
      line.startsWith("- [feedback_testing](feedback_testing.md) — first "),
    ).toBe(true);
    expect(line).not.toContain("\n");
  });

  it("skips a file whose name cannot be linked to", () => {
    const entrypoint = buildMemoryEntrypoint([
      header({ filename: "weird (1).md" }),
      header({ filename: "bracket[1].md" }),
      header({ filename: "ok.md" }),
    ]);

    expect(entrypoint).toBe("- [ok](ok.md) — Prefer explicit assertions\n");
  });

  it("uses the basename as the title and keeps the relative path in the link", () => {
    expect(buildMemoryEntrypoint([header({ filename: "sub/topic.md" })])).toBe(
      "- [topic](sub/topic.md) — Prefer explicit assertions\n",
    );
  });

  it("caps the index at the target line count", () => {
    const memories = Array.from({ length: 200 }, (_, i) =>
      header({ filename: `note-${i}.md`, description: null }),
    );

    const lines = buildMemoryEntrypoint(memories).split("\n").filter(Boolean);

    expect(lines).toHaveLength(
      Math.floor(MAX_MEMORY_ENTRYPOINT_LINES * MEMORY_CAP_TARGET_RATIO),
    );
    expect(lines[0]).toBe("- [note-0](note-0.md)");
    // The tail is dropped, never the head — the newest files sort first.
    expect(lines).not.toContain("- [note-199](note-199.md)");
  });

  it("caps the index at the target character count before the line count", () => {
    const memories = Array.from({ length: 200 }, (_, i) =>
      header({ filename: `note-${i}.md`, description: "x".repeat(400) }),
    );

    const entrypoint = buildMemoryEntrypoint(memories);
    const lines = entrypoint.split("\n").filter(Boolean);

    expect(entrypoint.length).toBeLessThanOrEqual(
      Math.floor(MAX_MEMORY_ENTRYPOINT_CHARS * MEMORY_CAP_TARGET_RATIO),
    );
    expect(lines.length).toBeLessThan(
      Math.floor(MAX_MEMORY_ENTRYPOINT_LINES * MEMORY_CAP_TARGET_RATIO),
    );
  });

  it("returns an empty string when there is nothing to index", () => {
    expect(buildMemoryEntrypoint([])).toBe("");
  });
});

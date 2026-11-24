import { describe, it, expect, vi, beforeEach } from "vitest";
import { grepTool } from "@/tools/grepTool.js";
import {
  renderGrepResultData,
  type GrepResultData,
} from "@/tools/resultData/grep.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext } from "@/tools/types.js";

/**
 * `Grep` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` 逐字相等；期望值一律手写字面量，不从
 * `content` 抄——抄一遍只能证明两边用了同一个渲染器。
 *
 * 三个 output mode 各走一遍：`files_with_matches`（默认）、`content`、`count`，
 * 外加分页、空结果、cwd 回收提示。
 */

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager(new Container(), "test-session"),
};

// ripgrep 二进制与进程都按 globTool.test.ts / resultData.test.ts 的口径 mock：
// 这里断言的是「渲染器与数据形状」，二进制本身的匹配行为在真机上验。
const rgProbe = vi.hoisted(() => ({ path: "/mock/rg" as string | undefined }));
vi.mock("@/utils/ripgrep.js", () => ({
  getRgPath: () => rgProbe.path,
  resolveRipgrep: () => rgProbe.path,
  resetRipgrep: () => {},
}));
vi.mock("@/utils/runCommand.js", () => ({ runCommand: vi.fn() }));
vi.mock("@/utils/runtimeDeps.js", () => ({
  ensureRuntimeDeps: vi.fn(async () => ({ available: true })),
}));

import { runCommand } from "@/utils/runCommand.js";

/** stdout exactly as ripgrep would produce it, one line per hit. */
const rgOutput = (...lines: string[]) => ({
  stdout: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
  stderr: "",
  exitCode: lines.length === 0 ? 1 : 0,
  error: false,
});

/**
 * 我方那条「没有结果」的出口提示（CC 没有这句，见 `resultData/grep.ts` 的
 * `NO_RESULTS_HINT`），在测试里手写一份：这样提示文案改了这条断言才会炸。
 */
const NO_RESULTS_HINT =
  "Suggestion: specify the 'path' field to search in ignored or other directories (e.g., 'node_modules'), as the default search path is the current working directory and respects .gitignore.";

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: { content: string; data?: unknown }) => {
  expect(renderGrepResultData(result.data as GrepResultData)).toBe(
    result.content,
  );
};

describe("Grep: data → 文本 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rgProbe.path = "/mock/rg";
    vi.mocked(runCommand).mockResolvedValue(rgOutput() as never);
  });

  describe("files_with_matches（默认模式）", () => {
    it("列表前有一行 Found N files", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput("src/a.ts", "src/b.ts") as never,
      );

      const result = await grepTool.execute({ pattern: "export" }, testContext);

      expect(result.content).toBe("Found 2 files\nsrc/a.ts\nsrc/b.ts");
      expect(result.data).toEqual({
        mode: "files_with_matches",
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
        // 这页没被截断：分页前的总数就是这一页的数。
        numMatches: 2,
        truncated: false,
      });
      expectRendersBack(result);
    });

    it("只有一个文件时用单数（CC 的 plural）", async () => {
      vi.mocked(runCommand).mockResolvedValue(rgOutput("only.ts") as never);

      const result = await grepTool.execute({ pattern: "export" }, testContext);

      expect(result.content).toBe("Found 1 file\nonly.ts");
      expectRendersBack(result);
    });

    it("截断时把 limit 拼在同一行，不另起一行", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput("src/a.ts", "src/b.ts") as never,
      );

      const result = await grepTool.execute(
        { pattern: "export", head_limit: 1 },
        testContext,
      );

      expect(result.content).toBe("Found 1 file limit: 1\nsrc/a.ts");
      expect(result.data).toEqual({
        mode: "files_with_matches",
        numFiles: 1,
        filenames: ["src/a.ts"],
        // 分页前是 2 个文件、这一页只留 1 个 —— 短结果那句 `(showing 1 of 2)`
        // 就是这么来的。
        numMatches: 2,
        truncated: true,
        appliedLimit: 1,
      });
      expectRendersBack(result);
    });

    it("一个都没有时照 CC 说 No files found", async () => {
      const result = await grepTool.execute(
        { pattern: "NONEXISTENT" },
        testContext,
      );

      expect(result.content).toBe(`No files found. ${NO_RESULTS_HINT}`);
      expect(result.data).toEqual({
        mode: "files_with_matches",
        numFiles: 0,
        filenames: [],
        numMatches: 0,
      });
      expectRendersBack(result);
    });
  });

  describe("content", () => {
    it("正文就是匹配行本身，不带任何页眉", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput(
          "src/a.ts:1:export const a = 1",
          "src/b.ts:3:export const b = 2",
        ) as never,
      );

      const result = await grepTool.execute(
        { pattern: "export", output_mode: "content" },
        testContext,
      );

      expect(result.content).toBe(
        "src/a.ts:1:export const a = 1\nsrc/b.ts:3:export const b = 2",
      );
      expect(result.data).toEqual({
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "src/a.ts:1:export const a = 1\nsrc/b.ts:3:export const b = 2",
        numLines: 2,
        numMatches: 2,
        truncated: false,
      });
      expectRendersBack(result);
    });

    it("head_limit 截断后附一行 pagination", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput(
          "src/a.ts:1:export const a = 1",
          "src/b.ts:3:export const b = 2",
        ) as never,
      );

      const result = await grepTool.execute(
        { pattern: "export", output_mode: "content", head_limit: 1 },
        testContext,
      );

      expect(result.content).toBe(
        "src/a.ts:1:export const a = 1\n\n[Showing results with pagination = limit: 1]",
      );
      expect(result.data).toEqual({
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "src/a.ts:1:export const a = 1",
        numLines: 1,
        numMatches: 2,
        truncated: true,
        appliedLimit: 1,
      });
      expectRendersBack(result);
    });

    it("offset 生效时也附 pagination，且只有 offset（没有 limit）", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput(
          "src/a.ts:1:match1",
          "src/b.ts:2:match2",
          "src/c.ts:3:match3",
        ) as never,
      );

      const result = await grepTool.execute(
        { pattern: "match", output_mode: "content", offset: 1 },
        testContext,
      );

      expect(result.content).toBe(
        "src/b.ts:2:match2\nsrc/c.ts:3:match3\n\n[Showing results with pagination = offset: 1]",
      );
      expect(result.data).toEqual({
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "src/b.ts:2:match2\nsrc/c.ts:3:match3",
        numLines: 2,
        numMatches: 3,
        truncated: false,
        appliedOffset: 1,
      });
      expectRendersBack(result);
    });

    it("一个都没有时照 CC 说 No matches found", async () => {
      const result = await grepTool.execute(
        { pattern: "NONEXISTENT", output_mode: "content" },
        testContext,
      );

      expect(result.content).toBe(`No matches found. ${NO_RESULTS_HINT}`);
      expect(result.data).toEqual({
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "",
        numLines: 0,
        numMatches: 0,
      });
      expectRendersBack(result);
    });
  });

  describe("count", () => {
    it("正文是 路径:计数 行，末尾空一行再给合计", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput("src/a.ts:2", "src/b.ts:3") as never,
      );

      const result = await grepTool.execute(
        { pattern: "export", output_mode: "count" },
        testContext,
      );

      expect(result.content).toBe(
        "src/a.ts:2\nsrc/b.ts:3\n\nFound 5 total occurrences across 2 files.",
      );
      expect(result.data).toEqual({
        mode: "count",
        numFiles: 2,
        filenames: [],
        content: "src/a.ts:2\nsrc/b.ts:3",
        // `count` 模式的 `numMatches` 是各文件计数之和，不被分页前的行数盖掉。
        numMatches: 5,
        truncated: false,
      });
      expectRendersBack(result);
    });

    it("一个文件一条匹配时合计用单数", async () => {
      vi.mocked(runCommand).mockResolvedValue(rgOutput("only.ts:1") as never);

      const result = await grepTool.execute(
        { pattern: "export", output_mode: "count" },
        testContext,
      );

      expect(result.content).toBe(
        "only.ts:1\n\nFound 1 total occurrence across 1 file.",
      );
      expectRendersBack(result);
    });

    it("一个都没有时给出 0 的合计，而不是只说没有", async () => {
      const result = await grepTool.execute(
        { pattern: "NONEXISTENT", output_mode: "count" },
        testContext,
      );

      expect(result.content).toBe(
        `No matches found. ${NO_RESULTS_HINT}\n\nFound 0 total occurrences across 0 files.`,
      );
      expect(result.data).toEqual({
        mode: "count",
        numFiles: 0,
        filenames: [],
        content: "",
        numMatches: 0,
      });
      expectRendersBack(result);
    });
  });

  describe("cwd 回收提示", () => {
    it("提示在正文最前面，且能从 data 重建（我方扩展字段）", async () => {
      vi.mocked(runCommand).mockResolvedValue(rgOutput("src/a.ts") as never);

      const context: ToolContext = {
        ...testContext,
        aiManager: {
          consumeCwdRecovery: vi.fn().mockReturnValue({
            from: "/repo/.wave/worktrees/feat-a",
            to: "/repo",
          }),
        } as unknown as ToolContext["aiManager"],
      };

      const result = await grepTool.execute({ pattern: "export" }, context);

      expect(result.content).toBe(
        "Note: working directory /repo/.wave/worktrees/feat-a no longer exists; session working directory recovered to /repo.\nFound 1 file\nsrc/a.ts",
      );
      expect(result.data).toEqual({
        mode: "files_with_matches",
        numFiles: 1,
        filenames: ["src/a.ts"],
        numMatches: 1,
        truncated: false,
        cwdRecovery: {
          from: "/repo/.wave/worktrees/feat-a",
          to: "/repo",
        },
      });
      expectRendersBack(result);
    });
  });

  describe("渲染器本身", () => {
    it("mode 缺省按 files_with_matches 渲染（CC 的默认参数）", () => {
      expect(renderGrepResultData({ numFiles: 1, filenames: ["a.ts"] })).toBe(
        "Found 1 file\na.ts",
      );
    });

    it("没有截断也没有跳行时不出 pagination", () => {
      expect(
        renderGrepResultData({
          mode: "content",
          numFiles: 0,
          filenames: [],
          content: "a.ts:1:x",
          numLines: 1,
        }),
      ).toBe("a.ts:1:x");
    });
  });
});

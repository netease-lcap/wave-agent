import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { writeTool } from "@/tools/writeTool.js";
import { editTool } from "@/tools/editTool.js";
import {
  hasToolResultRenderer,
  renderToolResultData,
} from "@/tools/resultData/index.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：每个工具的 `data` 经它自己的渲染器还原出来
 * 的文本，必须与工具当场产出的 `content` **逐字相等**。这里是阶段 2「落盘只留
 * `data`」的前置——没有这条，读路径就没有资格丢掉 `content`。
 *
 * 断言的期望值是手写的字面量，不是从 `content` 抄来的：抄一遍只能证明两边用了
 * 同一个渲染器，证明不了措辞没漂。
 */

const WORKDIR = path.resolve("/fake/project");

const testContext: ToolContext = {
  workdir: WORKDIR,
  taskManager: new TaskManager(new Container(), "test-session"),
};

// ripgrep 与原子写都按 globTool.test.ts / writeTool.test.ts 的口径 mock：这组
// 用例断言的是「渲染器与数据形状」，二进制本身的匹配行为在真机上验。
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
vi.mock("fs/promises");
vi.mock("@/utils/atomicWrite.js", async () => {
  const fsp = await import("fs/promises");
  return {
    atomicWriteFile: vi.fn((filePath: string, data: string) =>
      fsp.writeFile(filePath, data, "utf-8"),
    ),
  };
});

import { runCommand } from "@/utils/runCommand.js";
import { readFile, mkdir, writeFile } from "fs/promises";

/** stdout exactly as ripgrep would produce it: one relative path per line. */
const rgOutput = (...files: string[]) => ({
  stdout: files.length === 0 ? "" : `${files.join("\n")}\n`,
  stderr: "",
  exitCode: files.length === 0 ? 1 : 0,
  error: false,
});

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (toolName: string, result: { content: string }) => {
  expect(
    renderToolResultData(toolName, (result as { data?: unknown }).data),
  ).toBe(result.content);
};

describe("data → 文本渲染器 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rgProbe.path = "/mock/rg";
    vi.mocked(runCommand).mockResolvedValue(rgOutput() as never);
  });

  describe("Glob", () => {
    it("无匹配时渲染回同一句话", async () => {
      const result = await globTool.execute({ pattern: "*.ts" }, testContext);

      expect(result.content).toBe("No files found");
      expectRendersBack("Glob", result);
      expect(result.data).toEqual({
        durationMs: expect.any(Number),
        numFiles: 0,
        filenames: [],
        truncated: false,
      });
    });

    it("只给出 workdir 相对路径（照 CC 的 toRelativePath）", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput("src/a.ts", "src/b.ts") as never,
      );

      const result = await globTool.execute(
        { pattern: "**/*.ts" },
        testContext,
      );

      // `filenames` 过的是 `getDisplayPath()`，它**故意**把相对路径翻成正斜杠
      // （Windows 的反斜杠插进 shell 字符串会当转义符，见 src/utils/path.ts）。
      // 契约本身就是 POSIX 拼写，所以期望值写死正斜杠：拿 `path.join` 造出来的
      // 反斜杠在 Windows 上必然对不上。
      expect(result.content).toBe("src/a.ts\nsrc/b.ts");
      expectRendersBack("Glob", result);
      expect(result.data).toEqual({
        durationMs: expect.any(Number),
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
        truncated: false,
      });
    });

    it("截断时把提示原样带上，numFiles 是截断后的数量", async () => {
      vi.mocked(runCommand).mockResolvedValue(
        rgOutput("a.ts", "b.ts") as never,
      );

      const result = await globTool.execute(
        { pattern: "*.ts", limit: 1 },
        testContext,
      );

      expect(result.content).toBe(
        "a.ts\n(Results are truncated. Consider using a more specific path or pattern.)",
      );
      expectRendersBack("Glob", result);
      expect(result.data).toEqual({
        durationMs: expect.any(Number),
        numFiles: 1,
        filenames: ["a.ts"],
        truncated: true,
      });
    });
  });

  describe("Write", () => {
    beforeEach(() => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);
    });

    it("新建文件", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

      const result = await writeTool.execute(
        { file_path: "/test/new.js", content: "console.log('Hello World');" },
        testContext,
      );

      expect(result.content).toBe(
        `File created successfully at: ${path.resolve("/test/new.js")}`,
      );
      expect(result.data).toEqual({
        type: "create",
        filePath: path.resolve("/test/new.js"),
        // 一行正文；新文件没有旧内容，所以「删 0 行」。
        linesAdded: 1,
        linesRemoved: 0,
      });
      expectRendersBack("Write", result);
    });

    it("覆盖已有文件", async () => {
      vi.mocked(readFile).mockResolvedValue("old");

      const result = await writeTool.execute(
        { file_path: "/test/file.js", content: "line1\nline2" },
        testContext,
      );

      expect(result.content).toBe(
        `The file ${path.resolve("/test/file.js")} has been updated successfully.`,
      );
      expect(result.data).toEqual({
        type: "update",
        filePath: path.resolve("/test/file.js"),
        // 新内容是 2 行，被覆盖的 "old" 是 1 行。
        linesAdded: 2,
        linesRemoved: 1,
      });
      expectRendersBack("Write", result);
    });

    it("内容一致时不写字，但照 update 的措辞回话（CC 形状里没有第三种状态）", async () => {
      vi.mocked(readFile).mockResolvedValue("same");

      const result = await writeTool.execute(
        { file_path: "same.txt", content: "same" },
        testContext,
      );

      expect(result.content).toBe(
        `The file ${path.resolve(WORKDIR, "same.txt")} has been updated successfully.`,
      );
      expectRendersBack("Write", result);
    });
  });

  describe("Edit", () => {
    beforeEach(() => {
      vi.mocked(readFile).mockResolvedValue("hello world\n");
    });

    it("单次替换", async () => {
      const result = await editTool.execute(
        { file_path: "/test/a.ts", old_string: "world", new_string: "there" },
        testContext,
      );

      expect(result.content).toBe(
        `The file ${path.resolve("/test/a.ts")} has been updated successfully.`,
      );
      expectRendersBack("Edit", result);
    });

    it("replace_all 声明全部替换成功", async () => {
      vi.mocked(readFile).mockResolvedValue("a a a");

      const result = await editTool.execute(
        {
          file_path: "/test/a.ts",
          old_string: "a",
          new_string: "b",
          replace_all: true,
        },
        testContext,
      );

      expect(result.content).toBe(
        `The file ${path.resolve("/test/a.ts")} has been updated. All occurrences were successfully replaced.`,
      );
      expectRendersBack("Edit", result);
    });
  });

  describe("Read", () => {
    /** 文本读的 `data`，各用例只覆盖自己关心的字段。 */
    const textData = (over: Record<string, unknown> = {}) => ({
      type: "text",
      file: {
        filePath: "/p/a.ts",
        content: "alpha\nbeta",
        numLines: 2,
        startLine: 1,
        totalLines: 2,
        ...over,
      },
    });

    it("正文就是「行号 + 内容」，没有页眉、分隔线与剩余行数提示", () => {
      expect(renderToolResultData("Read", textData())).toBe(
        "1\talpha\n2\tbeta",
      );
    });

    it("分页读从真实行号起算，末尾不加任何提示", () => {
      expect(
        renderToolResultData(
          "Read",
          textData({ startLine: 3, totalLines: 10 }),
        ),
      ).toBe("3\talpha\n4\tbeta");
    });

    it("空文件给一句 warning 而不是空串", () => {
      expect(
        renderToolResultData(
          "Read",
          textData({ content: "", numLines: 0, totalLines: 0 }),
        ),
      ).toBe(
        "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>",
      );
    });

    it("offset 越过文件尾也给 warning，并说明文件实际有几行", () => {
      expect(
        renderToolResultData(
          "Read",
          textData({ content: "", numLines: 0, startLine: 5, totalLines: 2 }),
        ),
      ).toBe(
        "<system-reminder>Warning: the file exists but is shorter than the provided offset (5). The file has 2 lines.</system-reminder>",
      );
    });

    it("图片没有文本形态（CC 渲成 image block）", () => {
      expect(
        renderToolResultData("Read", {
          type: "image",
          file: {
            base64: "AA==",
            type: "image/png",
            originalSize: 1,
          },
        }),
      ).toBeUndefined();
    });
  });

  describe("注册表", () => {
    it("表里没有的名字返回 undefined，而不是空串", () => {
      // MCP / 插件工具不在表里：阶段 2 只能退回 `ToolBlock.result`。
      expect(
        renderToolResultData("mcp__unknown__tool", { x: 1 }),
      ).toBeUndefined();
    });

    it("`Eval` 不是 REPL 的历史名，表里查不到", () => {
      // `Eval` 是 Claude Code 自己那个 tool 的名字，我们从未注册过（历史是
      // `Exec` → `REPL`），所以这条名字只能退回 `ToolBlock.result`，不能借用
      // REPL 的渲染器。
      expect(
        renderToolResultData("Eval", { ok: true, stdout: ["hi"] }),
      ).toBeUndefined();
    });

    it("data 缺失时返回 undefined（阶段 2 读老转录靠它退回 result）", () => {
      expect(renderToolResultData("Glob", undefined)).toBeUndefined();
    });

    it("内置工具整表都在（MCP / 插件工具不在这张表里）", () => {
      for (const name of [
        "Agent",
        "Artifact",
        "ArtifactComments",
        "AskUserQuestion",
        "Bash",
        "CronCreate",
        "CronDelete",
        "CronList",
        "Edit",
        "EnterPlanMode",
        "EnterWorktree",
        "ExitPlanMode",
        "ExitWorktree",
        "Glob",
        "Grep",
        "kb_get_doc",
        "kb_search",
        "kb_suggest",
        "LSP",
        "Poll",
        "PowerShell",
        "Read",
        "REPL",
        "SendUserFile",
        "Skill",
        "TaskCreate",
        "TaskGet",
        "TaskList",
        "TaskStop",
        "TaskUpdate",
        "WebFetch",
        "WebSearch",
        "Workflow",
        "Write",
      ]) {
        expect(hasToolResultRenderer(name), name).toBe(true);
      }
    });

    it("没有文本形态时返回 undefined，让调用方退回 content", () => {
      // 阶段 2 之后 `undefined` 只剩这一个含义：这段结果本来就没有纯文本形态。
      // Read 的 image 分支是红图块（CC 渲成 image block），正文在 `images` 里。
      expect(
        renderToolResultData("Read", {
          type: "image",
          file: { base64: "AA==", type: "image/png", originalSize: 1 },
        }),
      ).toBeUndefined();
      // 反面对照：正文搬进 `data` 的五支现在都渲得出全文，不再是 undefined 的
      // 来源 —— 子代理报告、技能正文、artifact 全文 / 列表、知识库全文。
      // （artifact 的评论族已随上游 #3059 搬到独立工具 `ArtifactComments`，不在这张表里。）
      for (const [name, data] of [
        [
          "Agent",
          {
            status: "completed",
            agentId: "a1",
            content: "报告正文",
            totalToolUseCount: 1,
            totalDurationMs: 2,
            totalTokens: 3,
          },
        ],
        ["Skill", { success: true, commandName: "specify", content: "正文" }],
        [
          "Artifact",
          {
            action: "read",
            url: "https://example.com/code/artifact/abc",
            ownership: "owner",
            body: "<html></html>",
          },
        ],
        [
          "Artifact",
          {
            action: "list",
            scope: "mine",
            artifacts: [],
            truncated: false,
            maxLimit: 50,
          },
        ],
        [
          "ArtifactComments",
          {
            action: "read",
            url: "https://example.com/code/artifact/abc",
            unresolved_count: 0,
            threads: [],
          },
        ],
        [
          "SendUserFile",
          {
            attachments: [
              {
                path: "/fake/project/report.md",
                size: 12,
                isImage: false,
                name: "report.md",
                kind: "text",
              },
            ],
          },
        ],
        [
          "kb_get_doc",
          {
            status: "ok",
            title: "员工手册",
            content: "全文",
          },
        ],
      ] as const) {
        expect(renderToolResultData(name, data), name).toEqual(
          expect.any(String),
        );
      }
    });
  });
});

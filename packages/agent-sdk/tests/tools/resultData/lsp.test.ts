import { describe, it, expect } from "vitest";
import { lspTool } from "@/tools/lspTool.js";
import {
  isLspOperation,
  renderLspResultData,
  type LspResultData,
} from "@/tools/resultData/lsp.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：渲染 `data` 得到的文本必须与工具当场产出的
 * `content` 逐字相等。期望值一律手写字面量，不从 `content` 抄——抄一遍只能证明
 * 两边用了同一个渲染器。
 *
 * LSP 的文本口径就是 CC 的 `formatters.ts`（九个 operation 各一支），所以这里按
 * operation 逐个断文案 + 计数：`resultCount` / `fileCount` 是 CC 的 outputSchema
 * 里那两个给 UI 摘要用的计数，口径照 `LSPTool.ts:636-829`（截断前的总数，不是
 * 我们 `content` 里实际摊出来的条数）。
 */

const WORKDIR = "/test/workdir";

/** fixture 的 file:// URI。路径不带盘符，Windows 上 `path.win32.relative` 同样能相对化。 */
const uri = (relPath: string) => `file://${WORKDIR}/${relPath}`;

const pos = (line: number, character: number) => ({ line, character });
const range = (line: number, character: number) => ({
  start: pos(line, character),
  end: pos(line, character + 1),
});
const location = (relPath: string, line: number, character: number) => ({
  uri: uri(relPath),
  range: range(line, character),
});

/** manager 的原始回执就是 LSP 响应的 JSON（工具自己 `JSON.parse` 后排版）。 */
const lspContext = (payload: unknown): ToolContext =>
  ({
    workdir: WORKDIR,
    taskManager: new TaskManager(new Container(), "test-session"),
    lspManager: {
      execute: async () => ({
        success: true,
        content: JSON.stringify(payload),
      }),
    },
  }) as unknown as ToolContext;

const exec = async (
  operation: string,
  payload: unknown,
  args: { filePath?: string; line?: number; character?: number } = {},
): Promise<ToolResult> =>
  lspTool.execute(
    {
      operation,
      filePath: args.filePath ?? "src/main.ts",
      line: args.line ?? 1,
      character: args.character ?? 1,
    },
    lspContext(payload),
  );

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(renderLspResultData(result.data as LspResultData)).toBe(
    result.content,
  );
};

describe("LSP data → 文本渲染器 golden", () => {
  describe("goToDefinition / goToImplementation", () => {
    it("单条 Location：一句 Defined in，计数 1/1", async () => {
      const result = await exec("goToDefinition", location("src/a.ts", 10, 5), {
        line: 5,
        character: 10,
      });

      expect(result.content).toBe("Defined in src/a.ts:11:6");
      expect(result.data).toStrictEqual({
        operation: "goToDefinition",
        result: "Defined in src/a.ts:11:6",
        // 入参原样回填，不是解析后的绝对路径（CC `LSPTool.ts:386`）。
        filePath: "src/main.ts",
        resultCount: 1,
        fileCount: 1,
      });
      expectRendersBack(result);
    });

    it("LocationLink 走同一支，计数按 target 位置算", async () => {
      const result = await exec("goToDefinition", {
        targetUri: uri("src/link.ts"),
        targetRange: range(5, 0),
      });

      expect(result.content).toBe("Defined in src/link.ts:6:1");
      expectRendersBack(result);
      expect(result.data).toMatchObject({ resultCount: 1, fileCount: 1 });
    });

    it("多条定义：页眉报总数，计数 2 条 / 2 个文件", async () => {
      const result = await exec("goToDefinition", [
        location("src/a.ts", 10, 5),
        location("src/b.ts", 20, 0),
      ]);

      expect(result.content).toBe(
        "Found 2 definitions:\n  src/a.ts:11:6\n  src/b.ts:21:1",
      );
      expect(result.data).toStrictEqual({
        operation: "goToDefinition",
        result: "Found 2 definitions:\n  src/a.ts:11:6\n  src/b.ts:21:1",
        filePath: "src/main.ts",
        resultCount: 2,
        fileCount: 2,
      });
      expectRendersBack(result);
    });

    it("goToImplementation 复用同一套文案，operation 如实回填", async () => {
      const result = await exec(
        "goToImplementation",
        location("src/impl.ts", 6, 2),
      );

      expect(result.content).toBe("Defined in src/impl.ts:7:3");
      expect(result.data).toMatchObject({
        operation: "goToImplementation",
        resultCount: 1,
        fileCount: 1,
      });
      expectRendersBack(result);
    });
  });

  describe("findReferences", () => {
    it("跨两个文件：按文件分组，计数 2 条 / 2 个文件", async () => {
      const result = await exec("findReferences", [
        location("src/a.ts", 10, 5),
        location("src/b.ts", 4, 1),
      ]);

      expect(result.content).toBe(
        "Found 2 references across 2 files:\n\nsrc/a.ts:\n  Line 11:6\n\nsrc/b.ts:\n  Line 5:2",
      );
      expect(result.data).toStrictEqual({
        operation: "findReferences",
        result:
          "Found 2 references across 2 files:\n\nsrc/a.ts:\n  Line 11:6\n\nsrc/b.ts:\n  Line 5:2",
        filePath: "src/main.ts",
        resultCount: 2,
        fileCount: 2,
      });
      expectRendersBack(result);
    });

    it("没有命中：保留我方那句定位提示，计数 0/0", async () => {
      const result = await exec("findReferences", []);

      expect(result.content).toBe(
        "No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.\n\nPlease check if the character offset is correct and points to a valid symbol.",
      );
      expect(result.data).toStrictEqual({
        operation: "findReferences",
        result:
          "No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.\n\nPlease check if the character offset is correct and points to a valid symbol.",
        filePath: "src/main.ts",
        resultCount: 0,
        fileCount: 0,
      });
      expectRendersBack(result);
    });
  });

  describe("hover", () => {
    it("带 range：报位置再给正文，计数 1/1", async () => {
      const result = await exec("hover", {
        contents: "This is a hover message",
        range: range(4, 2),
      });

      expect(result.content).toBe(
        "Hover info at 5:3:\n\nThis is a hover message",
      );
      expect(result.data).toStrictEqual({
        operation: "hover",
        result: "Hover info at 5:3:\n\nThis is a hover message",
        filePath: "src/main.ts",
        resultCount: 1,
        fileCount: 1,
      });
      expectRendersBack(result);
    });

    it("没有 range：正文原样交出，不多一个字", async () => {
      const result = await exec("hover", {
        contents: { kind: "markdown", value: "### Header" },
      });

      expect(result.content).toBe("### Header");
      expect(result.data).toMatchObject({ resultCount: 1, fileCount: 1 });
      expectRendersBack(result);
    });
  });

  describe("documentSymbol", () => {
    it("DocumentSymbol 形态：嵌套的 children 也计入 resultCount", async () => {
      const result = await exec("documentSymbol", [
        {
          name: "MyClass",
          kind: 5,
          range: range(0, 0),
          selectionRange: range(0, 0),
          children: [
            {
              name: "myMethod",
              kind: 6,
              range: range(2, 4),
              selectionRange: range(2, 4),
            },
          ],
        },
      ]);

      expect(result.content).toBe(
        "Document symbols:\nMyClass (Class) - Line 1\n  myMethod (Method) - Line 3",
      );
      expect(result.data).toStrictEqual({
        operation: "documentSymbol",
        result:
          "Document symbols:\nMyClass (Class) - Line 1\n  myMethod (Method) - Line 3",
        filePath: "src/main.ts",
        // 父 + 子 = 2；CC `LSPTool.ts:714-716` 用 `countSymbols` 递归数。
        resultCount: 2,
        fileCount: 1,
      });
      expectRendersBack(result);
    });

    it("SymbolInformation 形态：转交 workspace 排版，计数是扁平条数", async () => {
      const result = await exec("documentSymbol", [
        {
          name: "GlobalSym",
          kind: 12,
          location: location("src/main.ts", 10, 0),
        },
      ]);

      expect(result.content).toBe(
        "Found 1 symbol in workspace:\n\nsrc/main.ts:\n  GlobalSym (Function) - Line 11",
      );
      expect(result.data).toMatchObject({ resultCount: 1, fileCount: 1 });
      expectRendersBack(result);
    });

    it("空文档：不给定位提示（这一支 CC 也只有一句话）", async () => {
      const result = await exec("documentSymbol", []);

      expect(result.content).toBe(
        "No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.",
      );
      expect(result.data).toMatchObject({ resultCount: 0, fileCount: 0 });
      expectRendersBack(result);
    });
  });

  describe("workspaceSymbol", () => {
    it("同一文件两个符号：结果 2 条、文件 1 个", async () => {
      const result = await exec(
        "workspaceSymbol",
        [
          {
            name: "GlobalVar",
            kind: 13,
            location: location("src/globals.ts", 5, 0),
          },
          {
            name: "helper",
            kind: 12,
            location: location("src/globals.ts", 8, 0),
          },
        ],
        { filePath: "", line: 0, character: 0 },
      );

      expect(result.content).toBe(
        "Found 2 symbols in workspace:\n\nsrc/globals.ts:\n  GlobalVar (Variable) - Line 6\n  helper (Function) - Line 9",
      );
      expect(result.data).toStrictEqual({
        operation: "workspaceSymbol",
        result:
          "Found 2 symbols in workspace:\n\nsrc/globals.ts:\n  GlobalVar (Variable) - Line 6\n  helper (Function) - Line 9",
        filePath: "",
        resultCount: 2,
        fileCount: 1,
      });
      expectRendersBack(result);
    });
  });

  describe("call hierarchy", () => {
    const callItem = (name: string, relPath: string, line: number) => ({
      name,
      kind: 12,
      uri: uri(relPath),
      range: range(line, 0),
      selectionRange: range(line, 0),
    });

    it("prepareCallHierarchy 单条：一句 Call hierarchy item", async () => {
      const result = await exec("prepareCallHierarchy", [
        callItem("myFunc", "src/main.ts", 10),
      ]);

      expect(result.content).toBe(
        "Call hierarchy item: myFunc (Function) - src/main.ts:11",
      );
      expect(result.data).toStrictEqual({
        operation: "prepareCallHierarchy",
        result: "Call hierarchy item: myFunc (Function) - src/main.ts:11",
        filePath: "src/main.ts",
        resultCount: 1,
        fileCount: 1,
      });
      expectRendersBack(result);
    });

    it("prepareCallHierarchy 多条：两个文件算 2", async () => {
      const result = await exec("prepareCallHierarchy", [
        callItem("myFunc", "src/main.ts", 10),
        callItem("other", "src/b.ts", 2),
      ]);

      expect(result.content).toBe(
        "Found 2 call hierarchy items:\n  myFunc (Function) - src/main.ts:11\n  other (Function) - src/b.ts:3",
      );
      expect(result.data).toMatchObject({ resultCount: 2, fileCount: 2 });
      expectRendersBack(result);
    });

    it("incomingCalls：带上调用点位置", async () => {
      const result = await exec("incomingCalls", [
        {
          from: callItem("caller", "src/other.ts", 5),
          fromRanges: [range(6, 5)],
        },
      ]);

      expect(result.content).toBe(
        "Found 1 incoming call:\n\nsrc/other.ts:\n  caller (Function) - Line 6 [calls at: 7:6]",
      );
      expect(result.data).toStrictEqual({
        operation: "incomingCalls",
        result:
          "Found 1 incoming call:\n\nsrc/other.ts:\n  caller (Function) - Line 6 [calls at: 7:6]",
        filePath: "src/main.ts",
        resultCount: 1,
        fileCount: 1,
      });
      expectRendersBack(result);
    });

    it("outgoingCalls：标注 called from", async () => {
      const result = await exec("outgoingCalls", [
        {
          to: callItem("callee", "src/lib.ts", 20),
          fromRanges: [range(12, 5)],
        },
      ]);

      expect(result.content).toBe(
        "Found 1 outgoing call:\n\nsrc/lib.ts:\n  callee (Function) - Line 21 [called from: 13:6]",
      );
      expect(result.data).toMatchObject({ resultCount: 1, fileCount: 1 });
      expectRendersBack(result);
    });

    it("没有调用关系：固定句子 + 计数 0/0", async () => {
      const result = await exec("outgoingCalls", []);

      expect(result.content).toBe(
        "No outgoing calls found (this function calls nothing)",
      );
      expect(result.data).toMatchObject({ resultCount: 0, fileCount: 0 });
      expectRendersBack(result);
    });
  });

  describe("失败分支不放 data", () => {
    it("manager 报错：success=false + error，data 不填", async () => {
      const result = await lspTool.execute(
        {
          operation: "hover",
          filePath: "src/main.ts",
          line: 1,
          character: 1,
        },
        {
          workdir: WORKDIR,
          taskManager: new TaskManager(new Container(), "test-session"),
          lspManager: {
            execute: async () => ({
              success: false,
              content: "LSP server not found",
            }),
          },
        } as unknown as ToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("LSP server not found");
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
    });

    it("回执不是 JSON：整次调用失败，data 不填", async () => {
      const result = await lspTool.execute(
        {
          operation: "hover",
          filePath: "src/main.ts",
          line: 1,
          character: 1,
        },
        {
          workdir: WORKDIR,
          taskManager: new TaskManager(new Container(), "test-session"),
          lspManager: {
            execute: async () => ({ success: true, content: "not json" }),
          },
        } as unknown as ToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("LSP operation failed");
      expect(result.data).toBeUndefined();
    });
  });

  describe("九值枚举之外", () => {
    it("未知 operation 退回原始 JSON，不编一个假 data", async () => {
      const result = await exec("renameSymbol", { ok: true });

      expect(result.content).toBe('{\n  "ok": true\n}');
      expect(result.data).toBeUndefined();
    });

    it("isLspOperation 只认 CC 那九个值", () => {
      expect(isLspOperation("goToDefinition")).toBe(true);
      expect(isLspOperation("outgoingCalls")).toBe(true);
      expect(isLspOperation("renameSymbol")).toBe(false);
    });
  });

  it("renderLspResultData：纯函数，原样交出 result（CC 的 `content: output.result`）", () => {
    expect(
      renderLspResultData({
        operation: "hover",
        result: "line one\nline two",
        filePath: "src/a.ts",
      }),
    ).toBe("line one\nline two");
  });
});

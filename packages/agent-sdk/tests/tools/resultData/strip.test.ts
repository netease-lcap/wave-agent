import { describe, it, expect } from "vitest";
import { stripToolResultDataForStorage } from "../../../src/tools/resultData/strip.js";
import type { BashResultData } from "../../../src/tools/resultData/bash.js";
import type { PowerShellResultData } from "../../../src/tools/resultData/powershell.js";
import type {
  ReadImageResultData,
  ReadTextResultData,
} from "../../../src/tools/resultData/read.js";

/**
 * `data` 落盘前的减重（issue #3055 阶段 2 · 双写）：照 CC 的 `stripForStorage`
 * 逐工具剥掉大块载荷，形状与宿主卡片要的短标量都留着。
 *
 * 两条最容易写坏的不变式，这里各有用例盯着：**入参不被修改**（原件还要给模型侧
 * tool_result、mod 的 `tool_response`、REPL 用），以及**不需要剥的时候返回同一个
 * 引用**（调用方靠引用相等判断「没变」）。
 */

function readTextData(): ReadTextResultData {
  return {
    type: "text",
    file: {
      filePath: "/work/src/index.ts",
      content: "line one\nline two\nline three",
      numLines: 3,
      startLine: 1,
      totalLines: 120,
    },
  };
}

function readImageData(): ReadImageResultData {
  return {
    type: "image",
    file: {
      base64: "iVBORw0KGgoAAAANSUhEUg==",
      type: "image/png",
      originalSize: 4096,
      dimensions: { originalWidth: 800, originalHeight: 600 },
    },
  };
}

function bashData(): BashResultData {
  return {
    stdout: "total 0\n-rw-r--r--  1 me me 0 a.txt",
    stderr: "Shell cwd was reset to /work/src",
    interrupted: false,
    interruptedReason: "Command timed out after 2 minutes",
    exitCode: 0,
    backgroundTaskId: "task-7",
    persistedOutputPath: "/tmp/wave/output.txt",
    persistedOutputSize: 123456,
    timeoutMs: 120000,
  };
}

function powershellData(): PowerShellResultData {
  return {
    stdout: "total 0\n-rw-r--r--  1 me me 0 a.txt",
    stderr: "Shell cwd was reset to /work/src",
    interrupted: false,
    exitCode: 1,
    backgroundTaskId: "task-9",
    persistedOutputPath: "/tmp/wave/ps-output.txt",
    persistedOutputSize: 42,
  };
}

describe("stripToolResultDataForStorage", () => {
  it("Read text：正文清成空串，行数与路径原样保留", () => {
    const stripped = stripToolResultDataForStorage(
      "Read",
      readTextData(),
    ) as ReadTextResultData;

    expect(stripped.file.content).toBe("");
    expect(stripped.file.numLines).toBe(3);
    expect(stripped.file.startLine).toBe(1);
    expect(stripped.file.totalLines).toBe(120);
    expect(stripped.file.filePath).toBe("/work/src/index.ts");
    expect(stripped.type).toBe("text");
  });

  it("Read image：base64 清成空串，mime / 尺寸 / 字节数原样保留", () => {
    const stripped = stripToolResultDataForStorage(
      "Read",
      readImageData(),
    ) as ReadImageResultData;

    expect(stripped.file.base64).toBe("");
    expect(stripped.file.type).toBe("image/png");
    expect(stripped.file.originalSize).toBe(4096);
    expect(stripped.file.dimensions).toEqual({
      originalWidth: 800,
      originalHeight: 600,
    });
  });

  it("不改入参：剥完原件上还是全文", () => {
    const text = readTextData();
    const image = readImageData();
    const bash = bashData();

    stripToolResultDataForStorage("Read", text);
    stripToolResultDataForStorage("Read", image);
    stripToolResultDataForStorage("Bash", bash);

    expect(text).toEqual({
      type: "text",
      file: {
        filePath: "/work/src/index.ts",
        content: "line one\nline two\nline three",
        numLines: 3,
        startLine: 1,
        totalLines: 120,
      },
    });
    expect(image.file.base64).toBe("iVBORw0KGgoAAAANSUhEUg==");
    expect(bash.stdout).toBe("total 0\n-rw-r--r--  1 me me 0 a.txt");
    expect(bash.stderr).toBe("Shell cwd was reset to /work/src");
  });

  it("Bash：stdout / stderr 清成空串，退出码与后台三态原样保留", () => {
    const stripped = stripToolResultDataForStorage(
      "Bash",
      bashData(),
    ) as BashResultData;

    expect(stripped.stdout).toBe("");
    expect(stripped.stderr).toBe("");
    expect(stripped.exitCode).toBe(0);
    expect(stripped.interrupted).toBe(false);
    expect(stripped.interruptedReason).toBe(
      "Command timed out after 2 minutes",
    );
    expect(stripped.backgroundTaskId).toBe("task-7");
    expect(stripped.persistedOutputPath).toBe("/tmp/wave/output.txt");
    expect(stripped.persistedOutputSize).toBe(123456);
    expect(stripped.timeoutMs).toBe(120000);
  });

  it("PowerShell：与 Bash 同源，stdout / stderr 清成空串，退出码等原样保留", () => {
    const stripped = stripToolResultDataForStorage(
      "PowerShell",
      powershellData(),
    ) as PowerShellResultData;

    expect(stripped.stdout).toBe("");
    expect(stripped.stderr).toBe("");
    expect(stripped.exitCode).toBe(1);
    expect(stripped.interrupted).toBe(false);
    expect(stripped.backgroundTaskId).toBe("task-9");
    expect(stripped.persistedOutputPath).toBe("/tmp/wave/ps-output.txt");
    expect(stripped.persistedOutputSize).toBe(42);
  });

  it("MCP 形状（表外工具）：图片块删掉 data 键，其余键与文本块原样", () => {
    const imageBlock = { type: "image", data: "AAA", mimeType: "image/png" };
    const blocks: Array<Record<string, unknown>> = [
      { type: "text", text: "hi" },
      imageBlock,
    ];

    const stripped = stripToolResultDataForStorage(
      "mcp__demo__screenshot",
      blocks,
    ) as Array<Record<string, unknown>>;

    expect(stripped).toEqual([
      { type: "text", text: "hi" },
      { type: "image", mimeType: "image/png" },
    ]);
    expect("data" in stripped[1]!).toBe(false);
    // 入参那份 base64 还在（剥的只是落盘副本）。
    expect(imageBlock.data).toBe("AAA");
    // 文本块连对象身份都没换。
    expect(stripped[0]).toBe(blocks[0]);
  });

  it("不需要剥的工具返回同一个引用", () => {
    const data = { filePath: "/work/a.ts", linesAdded: 2, linesRemoved: 1 };

    expect(stripToolResultDataForStorage("Write", data)).toBe(data);
    expect(stripToolResultDataForStorage("Edit", data)).toBe(data);
    expect(stripToolResultDataForStorage("REPL", data)).toBe(data);
    // 表外工具里没有图片块的形状：连数组都不重建。
    const textBlocks = [{ type: "text", text: "hi" }];
    expect(stripToolResultDataForStorage("mcp__demo__search", textBlocks)).toBe(
      textBlocks,
    );
  });

  it("data 是 undefined 时返回 undefined", () => {
    expect(stripToolResultDataForStorage("Read", undefined)).toBeUndefined();
    expect(stripToolResultDataForStorage("Bash", undefined)).toBeUndefined();
    expect(
      stripToolResultDataForStorage("mcp__demo__search", undefined),
    ).toBeUndefined();
  });
});

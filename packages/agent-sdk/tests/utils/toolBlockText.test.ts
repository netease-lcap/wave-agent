import { describe, it, expect } from "vitest";
import {
  messageForHost,
  messagesForHost,
  toolBlockForHost,
  toolBlockText,
  toolBlockUpdateForHost,
} from "@/utils/toolBlockText.js";
import type { Message, TextBlock, ToolBlock } from "@/types/messaging.js";

/**
 * `toolBlockText` 是阶段 2 之后「一段工具结果的文本」的唯一出口：新转录只有 `data`
 * （现渲），老转录只有 `result`（直接读），写入侧判定 `data` 重建不出这段文本时
 * 两者并存（`result` 更新）。期望值是手写字面量。
 */
describe("toolBlockText", () => {
  it("新转录：只有 data，按工具名用渲染器重建文本", () => {
    expect(
      toolBlockText({
        name: "Grep",
        data: {
          mode: "files_with_matches",
          numFiles: 2,
          filenames: ["a.ts", "b.ts"],
        },
      }),
    ).toBe("Found 2 files\na.ts\nb.ts");
  });

  it("老转录：只有 result，原样读出来", () => {
    expect(
      toolBlockText({ name: "Grep", result: "Found 1 file\nlegacy.ts" }),
    ).toBe("Found 1 file\nlegacy.ts");
  });

  it("两者并存时 result 优先（写入侧只在 data 重建不出这段文本时才写它）", () => {
    expect(
      toolBlockText({
        name: "Grep",
        result: "模型当时读到的那份",
        data: {
          mode: "files_with_matches",
          numFiles: 2,
          filenames: ["a.ts", "b.ts"],
        },
      }),
    ).toBe("模型当时读到的那份");
  });

  it("表外工具（没有渲染器）：只有 result 可用", () => {
    expect(
      toolBlockText({ name: "mcp__demo__search", result: "mcp hit" }),
    ).toBe("mcp hit");
    expect(toolBlockText({ name: "mcp__demo__search", data: { x: 1 } })).toBe(
      undefined,
    );
  });

  it("没有文本形态的结果返回 undefined（Read 的 pdf 档）", () => {
    expect(toolBlockText({ name: "Read", data: { type: "pdf" } })).toBe(
      undefined,
    );
  });

  it("name 缺失时当作没有渲染器，不抛错", () => {
    expect(toolBlockText({ result: "raw" })).toBe("raw");
    expect(toolBlockText({ data: { x: 1 } })).toBe(undefined);
  });
});

/**
 * 反方向：新转录只有 `data`，而四端 UI 仍只读 `ToolBlock.result`，所以会话数据
 * 离开 agent 进程之前要把文本补回去（issue #3055 阶段 2 · C）。期望值是手写字面量。
 */
describe("宿主侧注入：data → result", () => {
  const dataOnly: ToolBlock = {
    type: "tool",
    id: "call_grep",
    name: "Grep",
    stage: "end",
    data: {
      mode: "files_with_matches",
      numFiles: 2,
      filenames: ["a.ts", "b.ts"],
    },
  };

  it("新格式块：缺 result 时按 data 现渲补上，原块不动", () => {
    const hydrated = toolBlockForHost(dataOnly);

    expect(hydrated.result).toBe("Found 2 files\na.ts\nb.ts");
    // 只补不改：原块没有 result，注入不是就地写回。
    expect(dataOnly.result).toBeUndefined();
    // 其它字段照搬同一份（`data` 不复制）。
    expect(hydrated.data).toBe(dataOnly.data);
    expect(hydrated.name).toBe("Grep");
    expect(hydrated.id).toBe("call_grep");
  });

  it("老格式块：已有 result 时原样返回（连对象身份都不变）", () => {
    const legacy: ToolBlock = {
      type: "tool",
      name: "Grep",
      stage: "end",
      result: "Found 1 file\nlegacy.ts",
    };

    expect(toolBlockForHost(legacy)).toBe(legacy);
  });

  it("两者并存时 result 优先，不用 data 覆盖", () => {
    const both: ToolBlock = {
      type: "tool",
      name: "Grep",
      stage: "end",
      result: "模型当时读到的那份",
      data: {
        mode: "files_with_matches",
        numFiles: 2,
        filenames: ["a.ts", "b.ts"],
      },
    };

    expect(toolBlockForHost(both)).toBe(both);
  });

  it("表外工具、渲不出文本的结果、没有 data 的块都原样返回", () => {
    const mcp: ToolBlock = {
      type: "tool",
      name: "mcp__demo__search",
      stage: "end",
      data: { hits: 1 },
    };
    expect(toolBlockForHost(mcp)).toBe(mcp);

    const image: ToolBlock = {
      type: "tool",
      name: "Read",
      stage: "end",
      data: { type: "image" },
    };
    expect(toolBlockForHost(image)).toBe(image);

    const noData: ToolBlock = { type: "tool", name: "Grep", stage: "start" };
    expect(toolBlockForHost(noData)).toBe(noData);
  });

  it("消息视图：只换要补的工具块，文本块与老格式块保住身份", () => {
    const text: TextBlock = { type: "text", content: "我先找一下" };
    const legacy: ToolBlock = {
      type: "tool",
      name: "Grep",
      stage: "end",
      result: "Found 1 file\nlegacy.ts",
    };
    const message: Message = {
      id: "m1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [text, legacy, dataOnly],
    };

    const hydrated = messageForHost(message);

    expect(hydrated).not.toBe(message);
    expect(hydrated.id).toBe("m1");
    expect(hydrated.blocks[0]).toBe(text);
    expect(hydrated.blocks[1]).toBe(legacy);
    expect((hydrated.blocks[2] as ToolBlock).result).toBe(
      "Found 2 files\na.ts\nb.ts",
    );
    // 内存里的原消息一个字节都不变（转录不会因此多存一份文本）。
    expect((message.blocks[2] as ToolBlock).result).toBeUndefined();
  });

  it("无需补的消息 / 列表原样返回，连数组身份都保住", () => {
    const message: Message = {
      id: "m2",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "text", content: "done" },
        {
          type: "tool",
          name: "Grep",
          stage: "end",
          result: "Found 1 file\nlegacy.ts",
        },
      ],
    };

    expect(messageForHost(message)).toBe(message);
    const list = [message];
    expect(messagesForHost(list)).toBe(list);
  });

  it("推送帧：end 帧补 result，start 帧原样返回", () => {
    const endFrame = {
      id: "call_bash",
      messageId: "m1",
      name: "Bash",
      stage: "end" as const,
      success: true,
      data: { stdout: "hi", exitCode: 0, interrupted: false },
    };
    expect(toolBlockUpdateForHost(endFrame).result).toBe("hi");
    expect(endFrame).not.toHaveProperty("result");

    const startFrame = {
      id: "call_bash",
      messageId: "m1",
      name: "Bash",
      stage: "start" as const,
      parameters: '{"command":"echo hi"}',
    };
    expect(toolBlockUpdateForHost(startFrame)).toBe(startFrame);
  });
});

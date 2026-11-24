import { describe, it, expect, vi } from "vitest";
import { resolve } from "path";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import type { Message } from "../../src/types/index.js";
import type { ToolBlock } from "../../src/types/messaging.js";
import type { ToolBlockUpdateCallbackParams } from "../../src/utils/messageOperations.js";

/**
 * issue #3055 阶段 2 · C：**推给宿主的工具块更新**要把文本补回去。
 *
 * 新转录的块只有 `data`，而四端 UI 只读 `ToolBlock.result`，所以
 * `updateToolBlock` / `addToolBlockToMessage` / `finalizeAbortedToolBlocks` 这三条
 * 推送路径统一走 `MessageManager.emitToolBlockUpdated`，文本由 `data` 现渲。
 * 只补不改：老转录（已有 `result`）、表外工具、渲不出文本的结果原样返回。期望值是
 * 手写字面量。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setGlobalLogger: vi.fn(),
  isLoggerConfigured: () => true,
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(0),
  };
});

const WORKDIR = resolve("/fake/project");

function assistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    blocks: [{ type: "text", content: "我跑一下命令" }],
    timestamp: new Date(0).toISOString(),
  };
}

function createManager(
  onToolBlockUpdated: (params: ToolBlockUpdateCallbackParams) => void = () =>
    undefined,
): MessageManager {
  const manager = new MessageManager(new Container(), {
    workdir: WORKDIR,
    callbacks: { onToolBlockUpdated },
  });
  manager.setMessages([assistantMessage("m1")]);
  return manager;
}

function storedBlock(manager: MessageManager, id: string): ToolBlock {
  for (const message of manager.getMessages()) {
    for (const block of message.blocks) {
      if (block.type === "tool" && block.id === id) return block;
    }
  }
  throw new Error(`tool block ${id} not found`);
}

describe("MessageManager 推给宿主的工具块更新", () => {
  it("新格式（只有 data）：帧里补上渲染文本，内存里的块不被写回", () => {
    const frames: ToolBlockUpdateCallbackParams[] = [];
    const manager = createManager((params) => frames.push(params));
    // 工具调用总是先有一个 running 的块（参数流式阶段建好），结束帧再来补结果。
    const toolBlockId = manager.addToolBlockToMessage("m1", {
      name: "Bash",
      stage: "start",
      parameters: '{"command":"echo hi"}',
    });
    frames.length = 0;

    manager.updateToolBlock({
      id: toolBlockId,
      messageId: "m1",
      name: "Bash",
      stage: "end",
      success: true,
      data: { stdout: "hi", exitCode: 0, interrupted: false },
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]!.result).toBe("hi");
    expect(frames[0]!.data).toEqual({
      stdout: "hi",
      exitCode: 0,
      interrupted: false,
    });
    // 只补不改：补出来的文本不回到内存里的块（转录因此不会多存一份）。
    expect(storedBlock(manager, toolBlockId).result).toBeUndefined();
    expect(storedBlock(manager, toolBlockId).data).toEqual({
      stdout: "hi",
      exitCode: 0,
      interrupted: false,
    });
  });

  it("老格式（已有 result）：帧里原样，不被 data 覆盖", () => {
    const frames: ToolBlockUpdateCallbackParams[] = [];
    const manager = createManager((params) => frames.push(params));

    manager.updateToolBlock({
      id: "call_legacy",
      messageId: "m1",
      name: "Bash",
      stage: "end",
      success: true,
      result: "legacy output",
    });

    expect(frames[0]!.result).toBe("legacy output");
    expect(frames[0]!.data).toBeUndefined();
  });

  it("表外工具（没有渲染器）与渲不出文本的结果：帧里保持没有 result", () => {
    const frames: ToolBlockUpdateCallbackParams[] = [];
    const manager = createManager((params) => frames.push(params));

    manager.updateToolBlock({
      id: "call_mcp",
      messageId: "m1",
      name: "mcp__demo__search",
      stage: "end",
      success: true,
      data: { hits: 1 },
    });
    manager.updateToolBlock({
      id: "call_image",
      messageId: "m1",
      name: "Read",
      stage: "end",
      success: true,
      data: { type: "image" },
    });

    expect(frames[0]!.result).toBeUndefined();
    expect(frames[1]!.result).toBeUndefined();
  });

  it("新建块（addToolBlockToMessage）同样补文本", () => {
    const frames: ToolBlockUpdateCallbackParams[] = [];
    const manager = createManager((params) => frames.push(params));

    manager.addToolBlockToMessage("m1", {
      name: "Grep",
      stage: "end",
      data: {
        mode: "files_with_matches",
        numFiles: 2,
        filenames: ["a.ts", "b.ts"],
      },
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]!.result).toBe("Found 2 files\na.ts\nb.ts");
    // 新建时只带 data，不留一个空的 result。
    expect(storedBlock(manager, frames[0]!.id).result).toBeUndefined();
  });
});

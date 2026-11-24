import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as sessionService from "@/services/session.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import * as fs from "fs/promises";
import type { Message, MessageBlock, ToolBlock } from "@/types/index.js";

/**
 * issue #3055 阶段 2 · C：**拉取**会话数据时把工具结果的文本补回去。
 *
 * 新转录的块只有 `data`，而四端 UI 只读 `ToolBlock.result`；渲染器只在 SDK 里
 * （webview 拿不到），所以 `Agent.messages` / `Agent.getMessagePage` 这两个宿主读
 * 路径在返回前用 `data` 现渲。老转录、表外工具、渲不出文本的结果原样返回。
 * 期望值是手写字面量。
 */

vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  }),
  compactMessages: vi.fn().mockResolvedValue({
    content: "compacted",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));
vi.mock("@/services/session", async () => {
  const actual = await vi.importActual("@/services/session");
  return {
    ...actual,
    generateSessionId: vi.fn(() => "test-session-id"),
    handleSessionRestoration: vi.fn(),
    loadSessionFromJsonl: vi.fn(),
    appendMessages: vi.fn(),
    setSessionCustomTitle: vi.fn(),
    reAppendSessionMetadata: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("fs/promises");

const mockMemoryServiceInstance = {
  getUserMemoryContent: vi.fn().mockResolvedValue(""),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue(""),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
  getAutoMemoryDirectory: vi.fn().mockReturnValue("/test/auto-memory"),
  ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
  getAutoMemoryContent: vi.fn().mockResolvedValue(""),
};

vi.mock("@/services/memory", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
}));

const { instance: mockToolManagerInstance } = createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

const BASH_DATA = { stdout: "hi", exitCode: 0, interrupted: false };

/** 一条 assistant 消息：文本块 + 一块新格式 + 一块老格式 + 表外工具 + 图片档。 */
function seededMessages(): Message[] {
  return [
    {
      id: "m1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "text", content: "我跑一下命令" },
        {
          type: "tool",
          id: "call_bash",
          name: "Bash",
          stage: "end",
          success: true,
          data: BASH_DATA,
        },
        {
          type: "tool",
          id: "call_legacy",
          name: "Bash",
          stage: "end",
          success: true,
          result: "legacy output",
        },
        {
          type: "tool",
          id: "call_mcp",
          name: "mcp__demo__search",
          stage: "end",
          success: true,
          data: { hits: 1 },
        },
        {
          type: "tool",
          id: "call_image",
          name: "Read",
          stage: "end",
          success: true,
          data: { type: "image" },
        },
      ],
    },
  ];
}

function toolBlock(blocks: MessageBlock[], id: string): ToolBlock {
  const block = blocks.find(
    (candidate): candidate is ToolBlock =>
      candidate.type === "tool" && candidate.id === id,
  );
  if (!block) throw new Error(`tool block ${id} not found`);
  return block;
}

describe("Agent 拉取会话数据时补上工具结果文本", () => {
  let agent: Agent;
  let seeded: Message[];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(sessionService.handleSessionRestoration).mockResolvedValue(
      undefined,
    );
    vi.mocked(fs.readdir).mockResolvedValue([]);
    seeded = seededMessages();
    agent = await Agent.create({
      workdir: "/test/host-tool-text",
      messages: seeded,
    });
  });

  afterEach(async () => {
    if (agent) await agent.destroy();
  });

  it("agent.messages：新格式块现渲出 result，老格式 / 表外 / 图片档不动", () => {
    const blocks = agent.messages[0]!.blocks;

    expect(toolBlock(blocks, "call_bash").result).toBe("hi");
    expect(toolBlock(blocks, "call_bash").data).toEqual(BASH_DATA);
    expect(toolBlock(blocks, "call_legacy").result).toBe("legacy output");
    expect(toolBlock(blocks, "call_legacy").data).toBeUndefined();
    expect(toolBlock(blocks, "call_mcp").result).toBeUndefined();
    expect(toolBlock(blocks, "call_image").result).toBeUndefined();

    // 只补不改：注入不写回 SDK 手里那份消息（转录不会多存一份文本）。
    expect(toolBlock(seeded[0]!.blocks, "call_bash").result).toBeUndefined();
  });

  it("agent.getMessagePage：同一口径（首屏分页也补）", async () => {
    const page = await agent.getMessagePage({});
    const blocks = page.messages[0]!.blocks;

    expect(toolBlock(blocks, "call_bash").result).toBe("hi");
    expect(toolBlock(blocks, "call_legacy").result).toBe("legacy output");
    expect(toolBlock(blocks, "call_mcp").result).toBeUndefined();
    expect(toolBlock(seeded[0]!.blocks, "call_bash").result).toBeUndefined();
  });
});

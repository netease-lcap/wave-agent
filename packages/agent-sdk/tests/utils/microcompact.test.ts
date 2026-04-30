import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  microcompactMessages,
  type MicrocompactOptions,
} from "../../src/utils/microcompact.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";
import type { Message, ToolBlock } from "../../src/types/index.js";

const options: MicrocompactOptions = {
  timeThresholdMS: 30 * 60 * 1000, // 30 minutes
  recentResultsToKeep: 2,
};

function createUserMsg(content = "user"): Message {
  return {
    id: generateMessageId(),
    role: "user",
    blocks: [{ type: "text", content }],
    timestamp: new Date().toISOString(),
  };
}

function createAssistantMsg(
  id: string,
  content = "",
  toolBlocks: Omit<ToolBlock, "stage">[] = [],
): Message {
  return {
    id,
    role: "assistant",
    blocks: [
      ...(content ? [{ type: "text" as const, content }] : []),
      ...toolBlocks.map((t) => ({
        ...t,
        stage: "end" as const,
      })),
    ],
    timestamp: new Date().toISOString(),
  };
}

function createTimedToolBlock(
  ts: number,
  name = "read",
  result = "result-content",
  shortResult?: string,
): ToolBlock {
  return {
    type: "tool",
    name,
    result,
    shortResult,
    stage: "end",
    timestamp: ts,
  };
}

describe("microcompactMessages", () => {
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000; // fixed time
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return unchanged messages when no assistant messages exist", () => {
    const msgs = [createUserMsg("hello")];
    const result = microcompactMessages(msgs, options);
    expect(result).toBe(msgs);
  });

  it("should return unchanged messages when no completed tool blocks exist", () => {
    const msgs = [
      createUserMsg("hello"),
      {
        id: "a1",
        role: "assistant" as const,
        blocks: [{ type: "text" as const, content: "hi" }],
        timestamp: new Date().toISOString(),
      },
    ];
    const result = microcompactMessages(msgs, options);
    expect(result).toBe(msgs);
  });

  it("should return unchanged messages when within time threshold", () => {
    const toolTs = now - 1000; // 1 second ago
    const msgs: Message[] = [
      createUserMsg("hello"),
      createAssistantMsg("a1", "", [createTimedToolBlock(toolTs)]),
    ];
    const result = microcompactMessages(msgs, options);
    expect(result).toBe(msgs);
  });

  it("should clear old tool results when time threshold is exceeded", () => {
    // All tools must be older than the threshold for microcompact to trigger
    const recentTs = now - 61 * 60 * 1000; // just over 1 hour ago (past 30min threshold)
    const oldTs = now - 5 * 60 * 60 * 1000; // 5 hours ago
    const msgs: Message[] = [
      createUserMsg("task"),
      createAssistantMsg("a1", "", [
        createTimedToolBlock(oldTs, "read", "old-result", "old-short"),
      ]),
      createUserMsg("done"),
      createAssistantMsg("a2", "done!", [
        createTimedToolBlock(recentTs, "write", "new-result", "new-short"),
      ]),
    ];

    const result = microcompactMessages(msgs, {
      ...options,
      recentResultsToKeep: 1,
    });

    // Recent tool should be preserved
    const a2Blocks = result[3].blocks;
    const writeBlock = a2Blocks.find(
      (b) => b.type === "tool" && b.name === "write",
    );
    expect(writeBlock).toBeDefined();
    expect((writeBlock as ToolBlock).result).toBe("new-result");
    expect((writeBlock as ToolBlock).shortResult).toBe("new-short");

    // Old tool should be cleared
    const a1Blocks = result[1].blocks;
    const readBlock = a1Blocks.find(
      (b) => b.type === "tool" && b.name === "read",
    );
    expect(readBlock).toBeDefined();
    expect((readBlock as ToolBlock).result).toBe(
      "[Old tool result content cleared]",
    );
    expect((readBlock as ToolBlock).shortResult).toBeUndefined();
  });

  it("should keep N most recent tool results", () => {
    const ts1 = now - 5 * 60 * 60 * 1000;
    const ts2 = now - 4 * 60 * 60 * 1000;
    const ts3 = now - 3 * 60 * 60 * 1000;
    const ts4 = now - 2 * 60 * 60 * 1000;
    const ts5 = now - 60 * 60 * 1000;

    const msgs: Message[] = [
      createUserMsg("task"),
      createAssistantMsg("a1", "", [createTimedToolBlock(ts1, "tool1", "r1")]),
      createAssistantMsg("a2", "", [createTimedToolBlock(ts2, "tool2", "r2")]),
      createAssistantMsg("a3", "", [createTimedToolBlock(ts3, "tool3", "r3")]),
      createAssistantMsg("a4", "", [createTimedToolBlock(ts4, "tool4", "r4")]),
      createAssistantMsg("a5", "", [createTimedToolBlock(ts5, "tool5", "r5")]),
    ];

    const result = microcompactMessages(msgs, {
      ...options,
      recentResultsToKeep: 2,
    });

    // Only tool4 and tool5 should be preserved (most recent)
    const toolBlocks = result
      .map((msg, mi) =>
        msg.blocks
          .map((b, bi) => ({ mi, bi, block: b }))
          .filter((x) => x.block.type === "tool"),
      )
      .flat();

    const preserved = toolBlocks.filter(
      (t) =>
        (t.block as ToolBlock).result !== "[Old tool result content cleared]",
    );
    const cleared = toolBlocks.filter(
      (t) =>
        (t.block as ToolBlock).result === "[Old tool result content cleared]",
    );

    expect(preserved).toHaveLength(2);
    expect(cleared).toHaveLength(3);
  });

  it("should not mutate the original messages", () => {
    const oldTs = now - 2 * 60 * 60 * 1000;
    const msgs: Message[] = [
      createUserMsg("hello"),
      createAssistantMsg("a1", "", [
        createTimedToolBlock(oldTs, "read", "original"),
      ]),
    ];

    microcompactMessages(msgs, options);

    const originalBlock = msgs[1].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(originalBlock.result).toBe("original");
  });

  it("should handle multiple tool blocks in a single message", () => {
    const oldTs = now - 5 * 60 * 60 * 1000; // all past threshold
    const msgs: Message[] = [
      createUserMsg("task"),
      {
        id: "a1",
        role: "assistant",
        blocks: [
          createTimedToolBlock(oldTs, "read", "r1"),
          createTimedToolBlock(oldTs + 1000, "grep", "r2"),
          createTimedToolBlock(oldTs + 2000, "edit", "r3"),
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const result = microcompactMessages(msgs, {
      ...options,
      recentResultsToKeep: 1,
    });

    // Only the most recent tool (edit) should be preserved
    const toolBlocks = result[1].blocks.filter(
      (b) => b.type === "tool",
    ) as ToolBlock[];

    const preserved = toolBlocks.filter(
      (b) => b.result !== "[Old tool result content cleared]",
    );
    expect(preserved).toHaveLength(1);
    expect(preserved[0].name).toBe("edit");
  });

  it("should preserve non-tool blocks unchanged", () => {
    const oldTs = now - 5 * 60 * 60 * 1000;
    const msgs: Message[] = [
      createUserMsg("task"),
      createAssistantMsg("a1", "thinking...", [createTimedToolBlock(oldTs)]),
    ];

    const result = microcompactMessages(msgs, options);

    const textBlock = result[1].blocks.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    expect(textBlock).toMatchObject({ type: "text", content: "thinking..." });
  });
});

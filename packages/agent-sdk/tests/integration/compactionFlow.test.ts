import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  groupMessagesByApiRound,
  getLastApiRounds,
} from "../../src/utils/groupMessagesByApiRound.js";
import { microcompactMessages } from "../../src/utils/microcompact.js";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";
import type { Message, ToolBlock } from "../../src/types/index.js";

describe("Integration: Compaction Flow (API-round grouping + microcompact + API conversion)", () => {
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createUserMsg(content = "user"): Message {
    return {
      id: generateMessageId(),
      role: "user",
      blocks: [{ type: "text", content }],
    };
  }

  function createAssistantMsg(
    id: string,
    content = "",
    tools: Omit<ToolBlock, "stage">[] = [],
  ): Message {
    return {
      id,
      role: "assistant",
      blocks: [
        ...(content ? [{ type: "text" as const, content }] : []),
        ...tools.map((t) => ({ ...t, stage: "end" as const })),
      ],
    };
  }

  function createToolBlock(
    ts: number,
    name = "read",
    result = "result",
  ): ToolBlock {
    return { type: "tool", name, result, stage: "end", timestamp: ts };
  }

  it("should microcompact old tools, then group by API round, then convert for API", () => {
    // Simulate a long agentic session with old tool results
    const oldTs = now - 5 * 60 * 60 * 1000;
    const recentTs = now - 2 * 60 * 60 * 1000;

    const messages: Message[] = [
      createUserMsg("Analyze this codebase"),
      createAssistantMsg("a1", "Let me read the files", [
        createToolBlock(oldTs, "read", "large file content 1"),
      ]),
      createAssistantMsg("a2", "Searching for references", [
        createToolBlock(oldTs + 1000, "grep", "grep results"),
      ]),
      createAssistantMsg("a3", "Editing files", [
        createToolBlock(oldTs + 2000, "edit", "edit result"),
      ]),
      // User asks follow-up
      createUserMsg("Now optimize the performance"),
      createAssistantMsg("a4", "Reading updated files", [
        createToolBlock(recentTs, "read", "updated file"),
      ]),
      createAssistantMsg("a5", "Done optimizing"),
    ];

    // Step 1: Microcompact clears old tool results
    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 2,
    });

    // Step 2: Group by API round to find logical boundaries
    const rounds = groupMessagesByApiRound(microcompacted);

    // Step 3: Get last N rounds for compaction
    const preservedMessages = getLastApiRounds(microcompacted, 2);

    // Step 4: Convert for API
    const apiMessages = convertMessagesForAPI(preservedMessages);

    // Verify microcompact cleared old tools but kept recent ones
    const a1Block = microcompacted[1].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(a1Block.result).toBe("[Old tool result content cleared]");

    const a4Block = microcompacted[5].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(a4Block.result).toBe("updated file");

    // Verify API-round grouping preserves structure
    // Rounds: [[user, a1], [a2], [a3], [user, a4], [a5]]
    expect(rounds).toHaveLength(5);

    // getLastApiRounds(2) returns last 2 rounds: [user, a4] and [a5]
    expect(preservedMessages).toHaveLength(3);
    expect(preservedMessages.map((m) => m.id)).toEqual([
      messages[4].id,
      messages[5].id,
      messages[6].id,
    ]);

    // Verify API conversion works with preserved messages
    expect(apiMessages.length).toBeGreaterThan(0);
    expect(apiMessages.some((m) => m.role === "user")).toBe(true);
    expect(apiMessages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("should not split tool_use/tool_result pairs when using getLastApiRounds", () => {
    // In agentic mode, an assistant message may have multiple tool blocks
    // The API-round grouping should keep them together
    const user = createUserMsg("refactor this module");
    const assistant: Message = {
      id: "a1",
      role: "assistant",
      blocks: [
        { type: "text", content: "Starting refactoring" },
        {
          type: "tool",
          name: "read",
          stage: "end",
          result: "file content",
          timestamp: now,
        },
        {
          type: "tool",
          name: "edit",
          stage: "end",
          result: "edit result",
          timestamp: now + 1,
        },
        {
          type: "tool",
          name: "write",
          stage: "end",
          result: "write result",
          timestamp: now + 2,
        },
      ],
    };

    const messages = [user, assistant];

    // Microcompact should not clear any tools (all same timestamp, within threshold)
    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 1,
    });

    // Group by API round
    const rounds = groupMessagesByApiRound(microcompacted);
    expect(rounds).toHaveLength(1); // user + assistant with same id = 1 round

    // getLastApiRounds(1) should return both messages together
    const lastRound = getLastApiRounds(microcompacted, 1);
    expect(lastRound).toHaveLength(2);
    expect(lastRound[1].blocks.filter((b) => b.type === "tool")).toHaveLength(
      3,
    );

    // All tool results should be preserved
    const toolBlocks = lastRound[1].blocks.filter(
      (b) => b.type === "tool",
    ) as ToolBlock[];
    toolBlocks.forEach((tb) => {
      expect(tb.result).not.toBe("[Old tool result content cleared]");
    });
  });

  it("should handle compaction scenario with mixed old and recent tools across multiple API rounds", () => {
    // Simulate: user prompt → multiple assistant turns (tool loop) → user follow-up → assistant
    const veryOldTs = now - 10 * 60 * 60 * 1000;
    const oldTs = now - 4 * 60 * 60 * 1000;
    const recentTs = now - 1 * 60 * 60 * 1000;

    const messages: Message[] = [
      createUserMsg("Build a REST API"),
      createAssistantMsg("a1", "Planning...", [
        createToolBlock(veryOldTs, "read", "requirements doc"),
      ]),
      createAssistantMsg("a2", "Creating models", [
        createToolBlock(oldTs, "write", "model.ts content"),
      ]),
      createAssistantMsg("a3", "Adding routes", [
        createToolBlock(oldTs + 5000, "write", "routes.ts content"),
      ]),
      // User follow-up
      createUserMsg("Add authentication"),
      createAssistantMsg("a4", "Reading model", [
        createToolBlock(recentTs, "read", "model with auth"),
      ]),
      createAssistantMsg("a5", "Auth routes added"),
    ];

    // Microcompact: keep 2 most recent
    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 2,
    });

    // API-round grouping: [[user,a1], [a2], [a3], [user,a4], [a5]]
    const rounds = groupMessagesByApiRound(microcompacted);
    expect(rounds).toHaveLength(5);

    // Old tools cleared
    const a1Tool = microcompacted[1].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    const a2Tool = microcompacted[2].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(a1Tool.result).toBe("[Old tool result content cleared]");
    expect(a2Tool.result).toBe("[Old tool result content cleared]");

    // Recent tools preserved (a4 read is most recent, a3 write is second most recent)
    const a3Tool = microcompacted[3].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    const a4Tool = microcompacted[5].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(a4Tool.result).toBe("model with auth");
    expect(a3Tool.result).toBe("routes.ts content");

    // getLastApiRounds(2) = last 2 rounds: [user,a4] and [a5]
    const lastTwo = getLastApiRounds(microcompacted, 2);
    expect(lastTwo.length).toBe(3);

    // API conversion of preserved messages
    const apiMsgs = convertMessagesForAPI(lastTwo);
    expect(apiMsgs.length).toBeGreaterThan(0);

    // Verify the structure: should include the user follow-up and assistant response
    const userApiMsgs = apiMsgs.filter((m) => m.role === "user");
    const assistantApiMsgs = apiMsgs.filter((m) => m.role === "assistant");
    expect(userApiMsgs.length).toBeGreaterThan(0);
    expect(assistantApiMsgs.length).toBeGreaterThan(0);
  });

  it("should handle edge case: all tools are old but within N recent results", () => {
    const ts = now - 5 * 60 * 60 * 1000;
    const messages: Message[] = [
      createUserMsg("task"),
      createAssistantMsg("a1", "", [createToolBlock(ts, "tool1", "r1")]),
      createAssistantMsg("a2", "", [createToolBlock(ts + 1000, "tool2", "r2")]),
    ];

    // Keep all 2 recent results — nothing should be cleared
    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 5, // more than total tool count
    });

    const tool1 = microcompacted[1].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    const tool2 = microcompacted[2].blocks.find(
      (b) => b.type === "tool",
    ) as ToolBlock;
    expect(tool1.result).toBe("r1");
    expect(tool2.result).toBe("r2");
  });

  it("should preserve compact block as its own round when chaining getLastApiRounds after previous compaction", () => {
    // Scenario: session has been compacted before, new compaction needed
    const compactMsg: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "compact",
          content: "Previous summary",
          sessionId: "old-session",
        },
      ],
    };

    const messages: Message[] = [
      compactMsg,
      createUserMsg("continue working"),
      createAssistantMsg("a1", "Working on it", [
        createToolBlock(now - 60 * 60 * 1000, "read", "file"),
      ]),
      createUserMsg("update status"),
      createAssistantMsg("a2", "Almost done"),
    ];

    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 1,
    });

    // Rounds: [compactMsg], [user, a1], [user, a2]
    const rounds = groupMessagesByApiRound(microcompacted);
    expect(rounds).toHaveLength(3);

    // The compact block is its own round
    expect(rounds[0].messages).toHaveLength(1);
    expect(rounds[0].messages[0].blocks[0].type).toBe("compact");

    // getLastApiRounds(2) = [user, a1] + [user, a2]
    const lastTwo = getLastApiRounds(microcompacted, 2);
    expect(lastTwo.length).toBe(4);

    // API conversion should work
    const apiMsgs = convertMessagesForAPI(lastTwo);
    expect(apiMsgs.length).toBeGreaterThan(0);
  });

  it("should handle compact block as own round followed by mixed conversation", () => {
    // Scenario: session compacted, then continues with new conversation
    const compactMsg: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "compact",
          content: "Initial work summarized",
          sessionId: "s1",
        },
      ],
    };

    // Post-compact conversation with tool loops
    const toolTs = now - 5 * 60 * 60 * 1000;
    const messages: Message[] = [
      compactMsg,
      createUserMsg("next task"),
      createAssistantMsg("b1", "thinking", [
        createToolBlock(toolTs, "read", "data"),
      ]),
      createAssistantMsg("b2", "writing result", [
        createToolBlock(toolTs + 1000, "write", "output"),
      ]),
    ];

    const microcompacted = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 1,
    });

    // Rounds: [compact], [user, b1], [b2]
    const rounds = groupMessagesByApiRound(microcompacted);
    expect(rounds).toHaveLength(3);

    // getLastApiRounds(2) = [user, b1] + [b2]
    const lastTwo = getLastApiRounds(microcompacted, 2);
    expect(lastTwo).toHaveLength(3);
    expect(lastTwo.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("should verify full pipeline: microcompact → api-round grouping → getLastApiRounds → convertForAPI", () => {
    // End-to-end pipeline test simulating what aiManager does before calling compactMessages
    const ts1 = now - 8 * 60 * 60 * 1000;
    const ts2 = now - 7 * 60 * 60 * 1000;
    const ts3 = now - 3 * 60 * 60 * 1000;

    const messages: Message[] = [
      createUserMsg("Create a React component"),
      createAssistantMsg("a1", "Reading docs", [
        createToolBlock(ts1, "read", "doc content"),
      ]),
      createAssistantMsg("a2", "Writing component", [
        createToolBlock(ts2, "write", "Component.tsx"),
      ]),
      createUserMsg("Add tests"),
      createAssistantMsg("a3", "Creating test file", [
        createToolBlock(ts3, "write", "Component.test.tsx"),
      ]),
      createAssistantMsg("a4", "Tests passing"),
    ];

    // Pipeline step 1: microcompact
    const step1 = microcompactMessages(messages, {
      timeThresholdMS: 30 * 60 * 1000,
      recentResultsToKeep: 1,
    });

    // Verify old tools cleared, recent preserved
    const a1Tool = step1[1].blocks.find((b) => b.type === "tool") as ToolBlock;
    const a3Tool = step1[4].blocks.find((b) => b.type === "tool") as ToolBlock;
    expect(a1Tool.result).toBe("[Old tool result content cleared]");
    expect(a3Tool.result).toBe("Component.test.tsx");

    // Pipeline step 2: group by API round
    const step2 = groupMessagesByApiRound(step1);
    // Rounds: [[user,a1], [a2], [user,a3], [a4]]
    expect(step2).toHaveLength(4);

    // Pipeline step 3: get last 2 rounds for compaction
    const step3 = getLastApiRounds(step1, 2);
    // Should be: [user, a3] + [a4]
    expect(step3).toHaveLength(3);

    // Pipeline step 4: convert for API
    const step4 = convertMessagesForAPI(step3);
    expect(step4.length).toBeGreaterThan(0);

    // Verify API message structure is valid
    const roles = step4.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});

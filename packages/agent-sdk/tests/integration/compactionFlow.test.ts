import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  groupMessagesByApiRound,
  getLastApiRounds,
} from "../../src/utils/groupMessagesByApiRound.js";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";
import type { Message, ToolBlock } from "../../src/types/index.js";

describe("Integration: Compaction Flow (API-round grouping + API conversion)", () => {
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
      timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
    };
  }

  function createToolBlock(
    ts: number,
    name = "read",
    result = "result",
  ): ToolBlock {
    return { type: "tool", name, result, stage: "end", timestamp: ts };
  }

  it("should group by API round, then convert for API", () => {
    const messages: Message[] = [
      createUserMsg("Analyze this codebase"),
      createAssistantMsg("a1", "Let me read the files", [
        createToolBlock(now, "read", "large file content 1"),
      ]),
      createAssistantMsg("a2", "Searching for references", [
        createToolBlock(now + 1000, "grep", "grep results"),
      ]),
      createAssistantMsg("a3", "Editing files", [
        createToolBlock(now + 2000, "edit", "edit result"),
      ]),
      // User asks follow-up
      createUserMsg("Now optimize the performance"),
      createAssistantMsg("a4", "Reading updated files", [
        createToolBlock(now + 3000, "read", "updated file"),
      ]),
      createAssistantMsg("a5", "Done optimizing"),
    ];

    // Step 1: Group by API round to find logical boundaries
    const rounds = groupMessagesByApiRound(messages);

    // Step 2: Get last N rounds for compaction
    const preservedMessages = getLastApiRounds(messages, 2);

    // Step 3: Convert for API
    const apiMessages = convertMessagesForAPI(preservedMessages);

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
      timestamp: new Date().toISOString(),
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

    // Group by API round
    const rounds = groupMessagesByApiRound(messages);
    expect(rounds).toHaveLength(1); // user + assistant with same id = 1 round

    // getLastApiRounds(1) should return both messages together
    const lastRound = getLastApiRounds(messages, 1);
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

  it("should handle compaction scenario with multiple API rounds", () => {
    // Simulate: user prompt → multiple assistant turns (tool loop) → user follow-up → assistant
    const messages: Message[] = [
      createUserMsg("Build a REST API"),
      createAssistantMsg("a1", "Planning...", [
        createToolBlock(now, "read", "requirements doc"),
      ]),
      createAssistantMsg("a2", "Creating models", [
        createToolBlock(now + 5000, "write", "model.ts content"),
      ]),
      createAssistantMsg("a3", "Adding routes", [
        createToolBlock(now + 10000, "write", "routes.ts content"),
      ]),
      // User follow-up
      createUserMsg("Add authentication"),
      createAssistantMsg("a4", "Reading model", [
        createToolBlock(now + 15000, "read", "model with auth"),
      ]),
      createAssistantMsg("a5", "Auth routes added"),
    ];

    // API-round grouping: [[user,a1], [a2], [a3], [user,a4], [a5]]
    const rounds = groupMessagesByApiRound(messages);
    expect(rounds).toHaveLength(5);

    // getLastApiRounds(2) = last 2 rounds: [user,a4] and [a5]
    const lastTwo = getLastApiRounds(messages, 2);
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
      timestamp: new Date().toISOString(),
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

    // Rounds: [compactMsg], [user, a1], [user, a2]
    const rounds = groupMessagesByApiRound(messages);
    expect(rounds).toHaveLength(3);

    // The compact block is its own round
    expect(rounds[0].messages).toHaveLength(1);
    expect(rounds[0].messages[0].blocks[0].type).toBe("compact");

    // getLastApiRounds(2) = [user, a1] + [user, a2]
    const lastTwo = getLastApiRounds(messages, 2);
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
      timestamp: new Date().toISOString(),
    };

    // Post-compact conversation with tool loops
    const messages: Message[] = [
      compactMsg,
      createUserMsg("next task"),
      createAssistantMsg("b1", "thinking", [
        createToolBlock(now, "read", "data"),
      ]),
      createAssistantMsg("b2", "writing result", [
        createToolBlock(now + 1000, "write", "output"),
      ]),
    ];

    // Rounds: [compact], [user, b1], [b2]
    const rounds = groupMessagesByApiRound(messages);
    expect(rounds).toHaveLength(3);

    // getLastApiRounds(2) = [user, b1] + [b2]
    const lastTwo = getLastApiRounds(messages, 2);
    expect(lastTwo).toHaveLength(3);
    expect(lastTwo.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("should verify full pipeline: api-round grouping → getLastApiRounds → convertForAPI", () => {
    // End-to-end pipeline test simulating what aiManager does before calling compactMessages
    const messages: Message[] = [
      createUserMsg("Create a React component"),
      createAssistantMsg("a1", "Reading docs", [
        createToolBlock(now, "read", "doc content"),
      ]),
      createAssistantMsg("a2", "Writing component", [
        createToolBlock(now + 5000, "write", "Component.tsx"),
      ]),
      createUserMsg("Add tests"),
      createAssistantMsg("a3", "Creating test file", [
        createToolBlock(now + 10000, "write", "Component.test.tsx"),
      ]),
      createAssistantMsg("a4", "Tests passing"),
    ];

    // Pipeline step 1: group by API round
    const step1 = groupMessagesByApiRound(messages);
    // Rounds: [[user,a1], [a2], [user,a3], [a4]]
    expect(step1).toHaveLength(4);

    // Pipeline step 2: get last 2 rounds for compaction
    const step2 = getLastApiRounds(messages, 2);
    // Should be: [user, a3] + [a4]
    expect(step2).toHaveLength(3);

    // Pipeline step 3: convert for API
    const step3 = convertMessagesForAPI(step2);
    expect(step3.length).toBeGreaterThan(0);

    // Verify API message structure is valid
    const roles = step3.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});

import { describe, it, expect } from "vitest";
import {
  groupMessagesByApiRound,
  getLastApiRounds,
} from "../../src/utils/groupMessagesByApiRound.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";
import type { Message } from "../../src/types/index.js";

function createUserMsg(content = "user msg"): Message {
  return {
    id: generateMessageId(),
    role: "user",
    blocks: [{ type: "text", content }],
  };
}

function createAssistantMsg(id: string, content = "assistant msg"): Message {
  return {
    id,
    role: "assistant",
    blocks: [{ type: "text", content }],
  };
}

function createCompactMsg(content = "compacted"): Message {
  return {
    id: generateMessageId(),
    role: "assistant",
    blocks: [{ type: "compact", content, sessionId: "session-1" }],
  };
}

describe("groupMessagesByApiRound", () => {
  it("should return empty for empty messages", () => {
    expect(groupMessagesByApiRound([])).toEqual([]);
  });

  it("should group a single message as one round", () => {
    const msg = createUserMsg("hello");
    const rounds = groupMessagesByApiRound([msg]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].messages).toEqual([msg]);
  });

  it("should group normal conversation into rounds", () => {
    const user1 = createUserMsg("hello");
    const assist1 = createAssistantMsg("a1", "hi");
    const user2 = createUserMsg("help me");
    const assist2 = createAssistantMsg("a2", "ok");

    const rounds = groupMessagesByApiRound([user1, assist1, user2, assist2]);

    expect(rounds).toHaveLength(2);
    expect(rounds[0].messages).toEqual([user1, assist1]);
    expect(rounds[1].messages).toEqual([user2, assist2]);
  });

  it("should group agentic tool loop (one user, many assistant turns) into separate rounds", () => {
    const user = createUserMsg("do a task");
    const a1 = createAssistantMsg("a1", "thinking...");
    const a2 = createAssistantMsg("a2", "calling tool...");
    const a3 = createAssistantMsg("a3", "done");

    const rounds = groupMessagesByApiRound([user, a1, a2, a3]);

    // user+a1 form one round (first API call-response), a2 and a3 are
    // separate rounds (subsequent recursive API calls)
    expect(rounds).toHaveLength(3);
    expect(rounds[0].messages).toEqual([user, a1]);
    expect(rounds[1].messages).toEqual([a2]);
    expect(rounds[2].messages).toEqual([a3]);
  });

  it("should group compact block as its own round", () => {
    const compact = createCompactMsg("summary");
    const user = createUserMsg("continue");
    const assist = createAssistantMsg("a1", "ok");

    const rounds = groupMessagesByApiRound([compact, user, assist]);

    // compact is its own round, user+assist form one round
    expect(rounds).toHaveLength(2);
    expect(rounds[0].messages).toEqual([compact]);
    expect(rounds[1].messages).toEqual([user, assist]);
  });

  it("should keep assistant with multiple tool blocks in same round (same id)", () => {
    const user = createUserMsg("do something");
    const assistant: Message = {
      id: "a1",
      role: "assistant",
      blocks: [
        { type: "tool", stage: "end" },
        { type: "tool", stage: "end" },
        { type: "text", content: "done" },
      ],
    };

    const rounds = groupMessagesByApiRound([user, assistant]);

    // user+assistant form one round (first API call-response)
    expect(rounds).toHaveLength(1);
    expect(rounds[0].messages).toEqual([user, assistant]);
  });

  it("should estimate tokens per round", () => {
    const msg = createUserMsg("hello world"); // 11 chars
    const rounds = groupMessagesByApiRound([msg]);
    expect(rounds[0].estimatedTokens).toBeGreaterThan(0);
    // ~11 chars / 4 ≈ 3 tokens
    expect(rounds[0].estimatedTokens).toBe(Math.ceil(11 / 4));
  });
});

describe("getLastApiRounds", () => {
  it("should return all messages when fewer rounds exist than requested", () => {
    const user = createUserMsg("hello");
    const assist = createAssistantMsg("a1", "hi");
    const all = [user, assist];

    const result = getLastApiRounds(all, 5);
    expect(result).toEqual(all);
  });

  it("should return only the last N complete rounds", () => {
    const user1 = createUserMsg("msg1");
    const assist1 = createAssistantMsg("a1", "reply1");
    const user2 = createUserMsg("msg2");
    const assist2 = createAssistantMsg("a2", "reply2");
    const user3 = createUserMsg("msg3");
    const assist3 = createAssistantMsg("a3", "reply3");

    const all = [user1, assist1, user2, assist2, user3, assist3];

    // Rounds: [[user1,assist1], [user2,assist2], [user3,assist3]]
    const result = getLastApiRounds(all, 2);
    expect(result).toEqual([user2, assist2, user3, assist3]);
  });

  it("should never split a tool call pair", () => {
    const user = createUserMsg("task");
    const a1 = createAssistantMsg("a1", "thinking");
    const a2 = createAssistantMsg("a2", "tool result");

    const all = [user, a1, a2];

    // Rounds: [[user, a1], [a2]]
    // Last 1 round should be just a2
    const result1 = getLastApiRounds(all, 1);
    expect(result1).toEqual([a2]);

    // Last 2 rounds should include user+a1 + a2
    const result2 = getLastApiRounds(all, 2);
    expect(result2).toEqual([user, a1, a2]);
  });

  it("should handle compact block correctly in getLastApiRounds", () => {
    const compact = createCompactMsg("summary");
    const user = createUserMsg("continue");
    const assist = createAssistantMsg("a1", "ok");

    const all = [compact, user, assist];

    // Rounds: [[compact], [user, assist]]
    // Last 2 rounds: all messages
    const result = getLastApiRounds(all, 2);
    expect(result).toEqual([compact, user, assist]);
  });

  it("should handle empty messages", () => {
    expect(getLastApiRounds([], 3)).toEqual([]);
  });
});

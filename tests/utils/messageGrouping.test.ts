import { describe, it, expect } from "vitest";
import { processMessageGroups } from "@/utils/messageGrouping.js";
import type { Message } from "@/types.js";

const createMessage = (
  role: "user" | "assistant",
  content: string,
): Message => ({
  role,
  blocks: [{ type: "text", content }],
});

describe("processMessageGroups", () => {
  it("should handle empty messages array", () => {
    const result = processMessageGroups([]);
    expect(result).toEqual([]);
  });

  it("should not add group info to single messages", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi"),
      createMessage("user", "How are you?"),
    ];

    const result = processMessageGroups(messages);

    expect(result[0].groupInfo).toBeUndefined();
    expect(result[1].groupInfo).toBeUndefined();
    expect(result[2].groupInfo).toBeUndefined();
  });

  it("should group consecutive assistant messages", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi"),
      createMessage("assistant", "How can I help?"),
      createMessage("assistant", "I'm here to assist."),
      createMessage("user", "Thanks"),
    ];

    const result = processMessageGroups(messages);

    // First message (user) - no group info
    expect(result[0].groupInfo).toBeUndefined();

    // Second message (assistant) - group start
    expect(result[1].groupInfo).toEqual({
      isGroupStart: true,
      isGroupMember: true,
      groupRange: "2-4",
    });

    // Third message (assistant) - group member
    expect(result[2].groupInfo).toEqual({
      isGroupStart: false,
      isGroupMember: true,
      groupRange: "2-4",
    });

    // Fourth message (assistant) - group member
    expect(result[3].groupInfo).toEqual({
      isGroupStart: false,
      isGroupMember: true,
      groupRange: "2-4",
    });

    // Fifth message (user) - no group info
    expect(result[4].groupInfo).toBeUndefined();
  });

  it("should handle multiple separate assistant groups", () => {
    const messages = [
      createMessage("assistant", "First group start"),
      createMessage("assistant", "First group end"),
      createMessage("user", "User message"),
      createMessage("assistant", "Second group start"),
      createMessage("assistant", "Second group middle"),
      createMessage("assistant", "Second group end"),
    ];

    const result = processMessageGroups(messages);

    // First group (messages 1-2)
    expect(result[0].groupInfo?.groupRange).toBe("1-2");
    expect(result[0].groupInfo?.isGroupStart).toBe(true);
    expect(result[1].groupInfo?.groupRange).toBe("1-2");
    expect(result[1].groupInfo?.isGroupStart).toBe(false);

    // User message - no group
    expect(result[2].groupInfo).toBeUndefined();

    // Second group (messages 4-6)
    expect(result[3].groupInfo?.groupRange).toBe("4-6");
    expect(result[3].groupInfo?.isGroupStart).toBe(true);
    expect(result[4].groupInfo?.groupRange).toBe("4-6");
    expect(result[4].groupInfo?.isGroupStart).toBe(false);
    expect(result[5].groupInfo?.groupRange).toBe("4-6");
    expect(result[5].groupInfo?.isGroupStart).toBe(false);
  });

  it("should handle only assistant messages", () => {
    const messages = [
      createMessage("assistant", "Message 1"),
      createMessage("assistant", "Message 2"),
      createMessage("assistant", "Message 3"),
    ];

    const result = processMessageGroups(messages);

    expect(result[0].groupInfo?.groupRange).toBe("1-3");
    expect(result[0].groupInfo?.isGroupStart).toBe(true);
    expect(result[1].groupInfo?.groupRange).toBe("1-3");
    expect(result[1].groupInfo?.isGroupStart).toBe(false);
    expect(result[2].groupInfo?.groupRange).toBe("1-3");
    expect(result[2].groupInfo?.isGroupStart).toBe(false);
  });

  it("should handle only user messages", () => {
    const messages = [
      createMessage("user", "Message 1"),
      createMessage("user", "Message 2"),
      createMessage("user", "Message 3"),
    ];

    const result = processMessageGroups(messages);

    expect(result[0].groupInfo).toBeUndefined();
    expect(result[1].groupInfo).toBeUndefined();
    expect(result[2].groupInfo).toBeUndefined();
  });

  it("should handle single assistant message", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there"),
      createMessage("user", "Bye"),
    ];

    const result = processMessageGroups(messages);

    expect(result[0].groupInfo).toBeUndefined();
    expect(result[1].groupInfo).toBeUndefined(); // Single assistant message
    expect(result[2].groupInfo).toBeUndefined();
  });
});

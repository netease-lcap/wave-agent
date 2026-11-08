import { describe, it, expect } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";

function createManager() {
  return new MessageManager(new Container(), {
    callbacks: {},
    workdir: "/test",
  });
}

describe("MessageManager - thinking signatures", () => {
  it("splits the merged reasoning block back into the blocks the endpoint signed", () => {
    const manager = createManager();
    manager.addAssistantMessage();

    // Streaming concatenates the thinking deltas of every block into one block —
    // the block boundaries the endpoint signed are lost on the way in.
    manager.appendCurrentMessageReasoning("first thought");
    manager.appendCurrentMessageReasoning("second thought");

    manager.attachThinkingSignatures([
      { thinking: "first thought", signature: "sig-1" },
      { thinking: "second thought", signature: "sig-2" },
    ]);

    const blocks = manager.getMessages().slice(-1)[0].blocks;
    const reasoning = blocks.filter((block) => block.type === "reasoning");
    expect(reasoning).toEqual([
      expect.objectContaining({
        type: "reasoning",
        content: "first thought",
        stage: "end",
        signature: "sig-1",
      }),
      expect.objectContaining({
        type: "reasoning",
        content: "second thought",
        stage: "end",
        signature: "sig-2",
      }),
    ]);
  });

  it("splits a newline-joined block from the non-streaming path", () => {
    const manager = createManager();
    manager.addAssistantMessage();
    manager.appendCurrentMessageReasoning("first\nsecond");

    manager.attachThinkingSignatures([
      { thinking: "first", signature: "sig-1" },
      { thinking: "second", signature: "sig-2" },
    ]);

    const reasoning = manager
      .getMessages()
      .slice(-1)[0]
      .blocks.filter((block) => block.type === "reasoning");
    expect(reasoning.map((block) => block.content)).toEqual([
      "first",
      "second",
    ]);
  });

  it("parks a redacted payload on the message instead of an empty block", () => {
    const manager = createManager();
    manager.addAssistantMessage();
    manager.appendCurrentMessageContent("answer");

    manager.attachThinkingSignatures([{ thinking: "", redacted: "opaque" }]);

    const message = manager.getMessages().slice(-1)[0];
    // Nothing may render for a redacted block: it has no text, and the user is
    // not meant to see anything at all.
    expect(
      message.blocks.filter((block) => block.type === "reasoning"),
    ).toEqual([]);
    expect(message.redactedThinking).toEqual(["opaque"]);
  });

  it("attaches the signature in place when both sides have one block but the text was normalized", () => {
    const manager = createManager();
    manager.addAssistantMessage();
    manager.appendCurrentMessageReasoning("trimmed thought");

    manager.attachThinkingSignatures([
      { thinking: "  trimmed thought  ", signature: "sig-1" },
    ]);

    const reasoning = manager
      .getMessages()
      .slice(-1)[0]
      .blocks.filter((block) => block.type === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toEqual(
      expect.objectContaining({
        content: "trimmed thought",
        signature: "sig-1",
      }),
    );
  });

  it("leaves the blocks unsigned when the boundaries cannot be reconstructed", () => {
    const manager = createManager();
    manager.addAssistantMessage();
    manager.appendCurrentMessageReasoning("something else entirely");

    manager.attachThinkingSignatures([
      { thinking: "first", signature: "sig-1" },
      { thinking: "second", signature: "sig-2" },
    ]);

    const reasoning = manager
      .getMessages()
      .slice(-1)[0]
      .blocks.filter((block) => block.type === "reasoning");
    // Replaying a thinking block whose signature does not belong to its text is
    // rejected by the endpoint, so nothing is attached at all.
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toEqual(
      expect.objectContaining({ content: "something else entirely" }),
    );
    expect((reasoning[0] as { signature?: string }).signature).toBeUndefined();
  });

  it("is a no-op without thinking blocks or a trailing assistant message", () => {
    const manager = createManager();
    manager.attachThinkingSignatures([]);
    expect(manager.getMessages()).toHaveLength(0);

    manager.setMessages([
      {
        id: "user-1",
        role: "user",
        blocks: [{ type: "text", content: "hi" }],
        timestamp: new Date().toISOString(),
      },
    ]);
    manager.attachThinkingSignatures([
      { thinking: "thought", signature: "sig-1" },
    ]);
    expect(manager.getMessages()[0].blocks).toEqual([
      { type: "text", content: "hi" },
    ]);
  });
});

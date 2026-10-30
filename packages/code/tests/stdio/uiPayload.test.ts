import { describe, it, expect } from "vitest";
import type { Message, ToolBlockUpdateCallbackParams } from "wave-agent-sdk";
import {
  messageForRemote,
  messageForUi,
  messagesForUi,
  resultForRemote,
  toolBlockUpdateForUi,
} from "../../src/stdio/uiPayload.js";

/**
 * Specs/ui/stdio-transport.md「工具图片的字节不下发 UI」：the bytes live on
 * `ToolBlock.images` and never reach a UI, while the agent's own copy keeps
 * them. These cover the cut itself; the bridge/CLI-host wiring is asserted in
 * agentBridge.test.ts and remoteNotifications.test.ts.
 */

const IMAGE = { data: "aGVsbG8=", mediaType: "image/png" };

function messageWithToolImage(): Message {
  return {
    id: "m1",
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [
      { type: "text", content: "look at this" },
      {
        type: "tool",
        id: "t1",
        name: "Read",
        stage: "end",
        result: "Image file processed: a.png",
        shortResult: "Image processed (image/png)",
        success: true,
        images: [IMAGE],
      },
    ],
  };
}

function messageWithoutImages(): Message {
  return {
    id: "m2",
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: "no pictures here" }],
  };
}

describe("messageForUi", () => {
  it("drops the tool block's image bytes and keeps the rest of the block", () => {
    const trimmed = messageForUi(messageWithToolImage());
    const block = trimmed.blocks[1];

    expect(block.type).toBe("tool");
    if (block.type !== "tool") throw new Error("expected a tool block");
    expect(block.images).toBeUndefined();
    expect("images" in block).toBe(false);
    expect(block.shortResult).toBe("Image processed (image/png)");
    expect(block.result).toBe("Image file processed: a.png");
    expect(block.stage).toBe("end");
  });

  it("leaves the source message untouched, so the agent keeps the bytes", () => {
    const source = messageWithToolImage();
    messageForUi(source);

    const block = source.blocks[1];
    if (block.type !== "tool") throw new Error("expected a tool block");
    expect(block.images).toEqual([IMAGE]);
  });

  it("returns the same object when there is nothing to trim", () => {
    const source = messageWithoutImages();
    expect(messageForUi(source)).toBe(source);
  });

  it("does not touch images the user attached (only tool blocks are cut)", () => {
    const source: Message = {
      id: "m3",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "image", imageUrls: ["data:image/png;base64,aGVsbG8="] },
      ],
    };

    expect(messageForUi(source)).toBe(source);
  });
});

describe("messagesForUi", () => {
  it("keeps the same array when no message carries images", () => {
    const page = [messageWithoutImages()];
    expect(messagesForUi(page)).toBe(page);
  });

  it("replaces only the messages that carry images", () => {
    const plain = messageWithoutImages();
    const page = [plain, messageWithToolImage()];
    const trimmed = messagesForUi(page);

    expect(trimmed).not.toBe(page);
    expect(trimmed[0]).toBe(plain);
    expect(trimmed[1]).not.toBe(page[1]);
    expect(page[1].blocks[1]).toMatchObject({ images: [IMAGE] });
  });
});

describe("messageForRemote", () => {
  /**
   * Spec remote/remote-channel.md「远端通道只开一个白名单」场景 10: the page gets
   * no image bytes (one screenshot blows the frame budget), but the tag layout
   * must survive — `[imageN]` is positional.
   */
  it("blanks user image bytes and drops their host paths, keeping length and order", () => {
    const source: Message = {
      id: "m4",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "text", content: "compare [image0] and [image1]" },
        {
          type: "image",
          imageUrls: ["data:image/png;base64,aGVsbG8=", "/tmp/copy.png"],
          imagePaths: ["/tmp/wave-image-a.png", "/tmp/copy.png"],
        },
      ],
    };

    const remote = messageForRemote(source);
    const block = remote.blocks[1];

    if (block.type !== "image") throw new Error("expected an image block");
    expect(block.imageUrls).toEqual(["", ""]);
    expect("imagePaths" in block).toBe(false);
    expect(remote.blocks[0]).toEqual(source.blocks[0]);
  });

  it("leaves the source message untouched, so the GUI hosts keep the bytes", () => {
    const source: Message = {
      id: "m5",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "image", imageUrls: ["data:image/png;base64,aGVsbG8="] },
      ],
    };

    messageForRemote(source);

    expect(source.blocks[0]).toMatchObject({
      imageUrls: ["data:image/png;base64,aGVsbG8="],
    });
  });

  it("cuts tool image bytes too", () => {
    const remote = messageForRemote(messageWithToolImage());
    expect("images" in remote.blocks[1]).toBe(false);
  });

  it("returns the same object when there is nothing to cut", () => {
    const source = messageWithoutImages();
    expect(messageForRemote(source)).toBe(source);
  });
});

describe("resultForRemote", () => {
  it("rewrites the messages of a getMessages result", () => {
    const result = {
      messages: [messageWithoutImages(), messageWithToolImage()],
      hasMore: false,
    };

    const remote = resultForRemote(result) as typeof result;

    expect(remote.hasMore).toBe(false);
    expect(remote.messages[0]).toBe(result.messages[0]);
    expect("images" in remote.messages[1].blocks[1]).toBe(false);
  });

  it("passes anything that is not a message list through untouched", () => {
    const result = { sessionId: "s1" };
    expect(resultForRemote(result)).toBe(result);
    expect(resultForRemote(null)).toBe(null);
  });
});

describe("toolBlockUpdateForUi", () => {
  it("returns the same params when the frame carries no images", () => {
    const params: ToolBlockUpdateCallbackParams = {
      messageId: "m1",
      id: "t1",
      name: "Read",
      stage: "end",
      result: "done",
    };

    expect(toolBlockUpdateForUi(params)).toBe(params);
  });

  it("drops images and keeps every other field", () => {
    const params: ToolBlockUpdateCallbackParams = {
      messageId: "m1",
      id: "t1",
      name: "Read",
      stage: "end",
      result: "Image file processed: a.png",
      success: true,
      images: [IMAGE],
    };

    const trimmed = toolBlockUpdateForUi(params);

    expect("images" in trimmed).toBe(false);
    expect(trimmed).toMatchObject({
      messageId: "m1",
      id: "t1",
      name: "Read",
      stage: "end",
      result: "Image file processed: a.png",
      success: true,
    });
    // The caller's object is not mutated: the agent's own callback payload keeps
    // its bytes (the CLI's TUI reads `images.length` off the block, not here).
    expect(params.images).toEqual([IMAGE]);
  });
});

/**
 * Payload trimming for everything this process sends **to a UI**
 * (docs/specs/ui/stdio-transport.md「工具图片的字节不下发 UI」).
 *
 * Tool images arrive as base64 on `ToolBlock.images` (Read on a picture, MCP
 * tools returning image content). No UI renders them — the webview's only read
 * of the field sits in a branch that never runs for a tool block, the CLI shows
 * a count — while one screenshot can be well over a megabyte of base64, and a
 * remote-hosted page cannot even receive a frame that large. So every message
 * leaving this process for a host goes through here: notifications,
 * `getMessages`, `getFullMessageThread`, and the remote relay that is fed by
 * the same frames.
 *
 * **The agent's own copy is untouched.** The SDK still holds the bytes, the
 * next request still sends them to the model, and the transcript on disk keeps
 * them. This is a wire cut, not a memory model: stripping `images` where the
 * SDK writes the block would break the next turn, so do not move it there.
 *
 * Copies are shallow and made only where the field is actually present — the
 * common message (no images) keeps its identity and costs nothing.
 */

import type {
  Message,
  ToolBlock,
  ToolBlockUpdateCallbackParams,
} from "wave-agent-sdk";

/** A message whose tool blocks carry no image bytes. */
export function messageForUi(message: Message): Message {
  const { blocks } = message;
  if (!Array.isArray(blocks)) return message;
  const trimmed = blocks.map((block) =>
    block.type === "tool" && hasImages(block) ? withoutImages(block) : block,
  );
  const changed = trimmed.some((block, index) => block !== blocks[index]);
  return changed ? { ...message, blocks: trimmed } : message;
}

/** `messageForUi` over a page / list, preserving the array when nothing changed. */
export function messagesForUi(messages: Message[]): Message[] {
  const trimmed = messages.map(messageForUi);
  const changed = trimmed.some((message, index) => message !== messages[index]);
  return changed ? trimmed : messages;
}

/** A `toolBlockUpdated` frame whose block carries no image bytes. */
export function toolBlockUpdateForUi(
  params: ToolBlockUpdateCallbackParams,
): ToolBlockUpdateCallbackParams {
  if (!params.images || params.images.length === 0) return params;
  const { images, ...rest } = params;
  void images;
  return rest;
}

function hasImages(block: ToolBlock): boolean {
  return Array.isArray(block.images) && block.images.length > 0;
}

function withoutImages(block: ToolBlock): ToolBlock {
  const { images, ...rest } = block;
  void images;
  return rest;
}

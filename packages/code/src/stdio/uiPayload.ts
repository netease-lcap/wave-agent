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
 * `getMessages` and the remote relay that is fed by the same frames.
 *
 * **The agent's own copy is untouched.** The SDK still holds the bytes, the
 * next request still sends them to the model, and the transcript on disk keeps
 * them. This is a wire cut, not a memory model: stripping `images` where the
 * SDK writes the block would break the next turn, so do not move it there.
 *
 * **User pasted images are different.** Their bytes live in the message block
 * (spec ui/image-pasting.md「已发送图片的标签点开就能看」) so every GUI host can
 * preview them without asking anybody for a file — those go out to local hosts
 * untouched, and only the remote Web page gets them cut (`messageForRemote`,
 * spec ui/remote-control.md「远端通道只开一个白名单」场景 10).
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

/**
 * The remote Web page's copy of a message: `messageForUi`, plus user image
 * bytes blanked out (docs/specs/ui/remote-control.md「远端通道只开一个白名单」
 * 场景 10).
 *
 * Image bytes stay in the block for GUI hosts (they preview them in place), but
 * they must not go over the relay: one screenshot is commonly 1–3 MB of base64,
 * far past the 512 KiB frame budget, and the page could not use the bytes even
 * if they arrived. The array keeps its **length and order** — the `[imageN]`
 * tags in the text block are positional — so the page still shows a tag per
 * image, just not a clickable one. `imagePaths` goes too: it is a path on the
 * session host, which the page cannot read.
 */
export function messageForRemote(message: Message): Message {
  const forUi = messageForUi(message);
  const { blocks } = forUi;
  if (!Array.isArray(blocks)) return forUi;
  let changed = false;
  const blanked = blocks.map((block) => {
    if (block.type !== "image") return block;
    const { imagePaths, ...rest } = block;
    if (!imagePaths && !rest.imageUrls?.length) return block;
    changed = true;
    return { ...rest, imageUrls: (rest.imageUrls ?? []).map(() => "") };
  });
  return changed ? { ...forUi, blocks: blanked } : forUi;
}

/**
 * `messageForRemote` over the `getMessages` answer — the shape the remote
 * service actually holds (an untyped JSON result). Anything that is not a
 * message list passes through untouched.
 */
export function resultForRemote(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const { messages, ...rest } = result as { messages?: unknown };
  if (!Array.isArray(messages)) return result;
  return {
    ...rest,
    messages: messages.map((message) => messageForRemote(message as Message)),
  };
}

function hasImages(block: ToolBlock): boolean {
  return Array.isArray(block.images) && block.images.length > 0;
}

function withoutImages(block: ToolBlock): ToolBlock {
  const { images, ...rest } = block;
  void images;
  return rest;
}

import type { ImageBlock, Message } from "../types/index.js";
import { imageFileCacheKey, planOutboundImage } from "./imageRewrite.js";
import { convertImageToBase64 } from "./messageOperations.js";
import { taskNotificationToXml } from "./notificationXml.js";
import { ChatCompletionMessageToolCall } from "openai/resources";
import { recoverTruncatedJson, stripAnsiColors } from "./stringUtils.js";
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources.js";
import { logger } from "./globalLogger.js";

/**
 * The host-side file an image's bytes were written to, for the
 * `[Image source: <path>]` metadata. `imagePaths` is the authority (it covers
 * inline data URLs too); a block value that is already a path is its own source.
 */
function imageSourcePath(
  block: ImageBlock,
  imageUrl: string,
  index: number,
): string | undefined {
  return (
    block.imagePaths?.[index] ??
    (imageUrl.startsWith("data:") ? undefined : imageUrl)
  );
}

/**
 * Safely handle tool call parameters, ensuring a legal JSON string is returned.
 * Attempts to recover truncated JSON (e.g., missing closing braces).
 * @param args Tool call parameters
 * @returns Legal JSON string
 */
function safeToolArguments(args: string): string {
  if (!args) {
    return "{}";
  }

  try {
    // Try to parse as JSON to validate format
    JSON.parse(args);
    return args;
  } catch {
    // Attempt to recover truncated JSON
    const recovered = recoverTruncatedJson(args);
    try {
      JSON.parse(recovered);
      return recovered;
    } catch {
      // Truly malformed JSON — return sanitized fallback
      return JSON.stringify({
        invalid_arguments: args,
      });
    }
  }
}

/**
 * Options for converting messages to API format.
 */
export interface ConvertMessagesOptions {
  /** When false, images are stripped and replaced with text placeholders. */
  supportsVision?: boolean;
}

/**
 * Convert message format to API call format, stopping when a compacted message is encountered.
 * Messages with no meaningful content or tool calls are filtered out.
 *
 * Async because every outbound image is routed through `planOutboundImage`,
 * which may have to re-encode an oversized image with the optional `sharp`
 * codec (`utils/imageRewrite.ts`). Images that are already inside the budget —
 * the common case — take a synchronous fast path and come out byte-identical.
 *
 * @param messages Message list
 * @param options Optional conversion options (e.g. supportsVision)
 * @returns Converted API message format list
 */
export async function convertMessagesForAPI(
  messages: Message[],
  options?: ConvertMessagesOptions,
): Promise<ChatCompletionMessageParam[]> {
  const supportsVision = options?.supportsVision !== false;
  const recentMessages: ChatCompletionMessageParam[] = [];

  const startIndex = messages.length - 1;
  for (let i = startIndex; i >= 0; i--) {
    const message = messages[i];

    // Check if a compaction block is encountered, if so, stop iteration
    if (
      message.role === "assistant" &&
      message.blocks.some((block) => block.type === "compact")
    ) {
      // Add the content of the compaction block as an assistant message to the history
      const compactBlock = message.blocks.find(
        (block) => block.type === "compact",
      );
      if (compactBlock && compactBlock.type === "compact") {
        recentMessages.unshift({
          role: "user",
          content: compactBlock.content,
        });
      }
      break;
    }

    // Skip empty assistant messages (no blocks or all blocks are empty)
    if (message.role === "assistant" && message.blocks.length === 0) {
      continue;
    }

    if (message.role === "assistant") {
      // First check if there is a tool block, if so, add the tool message first
      // Filter out incomplete tool blocks (no result or still running)
      const toolBlocks = message.blocks.filter(
        (block) => block.type === "tool",
      );
      const completedToolIds = new Set<string>(); // Record completed tool IDs

      if (toolBlocks.length > 0) {
        // Collect image user messages to place after all tool messages
        const imageUserMessages: ChatCompletionMessageParam[] = [];

        for (const toolBlock of toolBlocks) {
          // Only add completed tool blocks (i.e., stage is 'end')
          if (toolBlock.id && toolBlock.stage === "end") {
            completedToolIds.add(toolBlock.id);

            // Always add a proper tool message to satisfy tool_call_id pairing
            recentMessages.unshift({
              tool_call_id: toolBlock.id,
              role: "tool",
              content: stripAnsiColors(toolBlock.result || ""),
            });

            // If there are images, also prepare a user message with image content
            if (toolBlock.images && toolBlock.images.length > 0) {
              if (supportsVision) {
                const contentParts: ChatCompletionContentPart[] = [];

                for (const image of toolBlock.images) {
                  const imageUrl = image.data.startsWith("data:")
                    ? image.data
                    : `data:${image.mediaType || "image/png"};base64,${image.data}`;

                  // Tool-produced images (Read screenshots, MCP results, Exec
                  // output) go through the same outbound budget as attachments:
                  // an image the gateway would reject is shrunk, or omitted with
                  // an actionable note, instead of failing the whole request.
                  const plan = await planOutboundImage({
                    dataUrl: imageUrl,
                    cacheKey: imageUrl,
                    sourcePath: image.path,
                  });

                  if (plan.kind === "omit") {
                    contentParts.push({ type: "text", text: plan.note });
                    continue;
                  }
                  contentParts.push({
                    type: "image_url",
                    image_url: {
                      url: plan.dataUrl,
                      detail: "auto",
                    },
                  });
                  // Images shrunk on the way into the list carry their note on
                  // the block (utils/toolImageIngest.ts). This pass sees an
                  // in-budget image and returns no note of its own, so keep the
                  // ingest-time one — the model still needs the mapping back.
                  const note = plan.note ?? image.note;
                  if (note) {
                    contentParts.push({ type: "text", text: note });
                  }
                }

                imageUserMessages.push({
                  role: "user",
                  content: contentParts,
                });
              } else {
                // Non-vision model: replace images with a text placeholder and
                // append [Image source: <path>] metadata for MCP images that
                // were persisted to temp files, so the main model can delegate
                // recognition to a vision subagent (which reads the path with
                // the Read tool). Images without a persisted path (e.g. legacy
                // history) fall back to the placeholder only.
                const contentParts: ChatCompletionContentPart[] = [
                  {
                    type: "text",
                    text: "[Tool returned an image, but the current model does not support image recognition]",
                  },
                ];
                toolBlock.images.forEach((image) => {
                  if (image.path) {
                    contentParts.push({
                      type: "text",
                      text: `[Image source: ${image.path}]`,
                    });
                  }
                });
                imageUserMessages.push({
                  role: "user",
                  content: contentParts,
                });
              }
            }
          }
        }

        // Insert image user messages after all tool messages but before the
        // assistant message (which will be unshifted next). Since tool messages
        // were unshifted to the front, we splice images right after them.
        if (imageUserMessages.length > 0) {
          // Tool messages are at indices 0..N-1, existing messages start at N
          const toolMsgCount = completedToolIds.size;
          recentMessages.splice(toolMsgCount, 0, ...imageUserMessages);
        }
      }

      // Construct the content of the assistant message
      let content = "";
      let tool_calls: ChatCompletionMessageToolCall[] | undefined = undefined;

      // Construct content from text blocks - filter out empty content
      const textBlocks = message.blocks.filter(
        (block) =>
          block.type === "text" &&
          block.content &&
          block.content.trim().length > 0,
      );
      if (textBlocks.length > 0) {
        content = textBlocks
          .map((block) => (block.type === "text" ? block.content : ""))
          .join("\n");
      }

      // Extract reasoning content from reasoning blocks
      const reasoningBlocks = message.blocks.filter(
        (block) =>
          block.type === "reasoning" &&
          block.content &&
          block.content.trim().length > 0,
      );
      let reasoning_content: string | undefined;
      if (reasoningBlocks.length > 0) {
        reasoning_content = reasoningBlocks
          .map((block) => (block.type === "reasoning" ? block.content : ""))
          .join("\n");
      }

      // Construct tool calls from tool blocks
      if (toolBlocks.length > 0) {
        tool_calls = toolBlocks
          .filter(
            (toolBlock) => toolBlock.id && completedToolIds.has(toolBlock.id),
          )
          .map((toolBlock) => ({
            id: toolBlock.id!,
            type: "function",
            function: {
              name: toolBlock.name || "",
              arguments: safeToolArguments(
                String(toolBlock.parameters || "{}"),
              ),
            },
          }));

        if (tool_calls.length === 0) {
          tool_calls = undefined;
        }
      }

      // Construct assistant message - only add if there is meaningful content,
      // tool calls, or reasoning content. Reasoning-only messages (a truncated
      // turn that produced nothing but thinking) must be preserved so the next
      // round can continue from the previous reasoning instead of starting
      // over (aligned with Claude Code's thinking trajectory preservation).
      const hasContent = content && content.trim().length > 0;
      const hasToolCalls = tool_calls && tool_calls.length > 0;
      const hasReasoning =
        reasoning_content && reasoning_content.trim().length > 0;

      if (hasContent || hasToolCalls || hasReasoning) {
        // OpenAI-compatible upstreams reject assistant messages where neither
        // content nor tool_calls is set — a reasoning_content-only message
        // gets stripped and returns 400 "content or tool_calls must be set"
        // (this is fine for Claude Code, whose thinking blocks ARE content).
        // When a turn produced only thinking (interrupted/truncated
        // mid-reasoning), the thinking stays on its native reasoning_content
        // field (the channel reasoning models natively continue from), and
        // content carries an explanatory note so the request stays valid and
        // the model knows the thinking was cut off and auto-preserved.
        // Tool calls are meaningful content of their own — a reasoning +
        // tool-call turn is not truncated, so no note is injected.
        const fallbackContent = hasContent
          ? content
          : hasReasoning && !hasToolCalls
            ? "[Note: The reasoning above was cut off before completion. It was auto-preserved from an interrupted or truncated turn — continue from where it left off, or disregard it if no longer relevant.]"
            : undefined;

        const assistantMessage: ChatCompletionMessageParam = {
          role: "assistant",
          content: fallbackContent,
          tool_calls,
          // Sent whenever reasoning exists: alongside real text it is the
          // turn's own thinking; in the fallback case it carries the
          // preserved thinking itself (content only holds the note).
          ...(reasoning_content ? { reasoning_content } : {}),
          ...(message.additionalFields ? { ...message.additionalFields } : {}),
        } as ChatCompletionMessageParam;

        recentMessages.unshift(assistantMessage);
      }
    } else if (message.role === "user") {
      // User messages converted to standard format
      const contentParts: ChatCompletionContentPart[] = [];

      for (const block of message.blocks) {
        // Add text content - only if it has meaningful content
        if (
          block.type === "text" &&
          block.content &&
          block.content.trim().length > 0
        ) {
          const textForApi = block.customCommandContent ?? block.content;
          contentParts.push({
            type: "text",
            text: textForApi,
          });
        }

        // If there is an image, add image content
        if (
          block.type === "image" &&
          block.imageUrls &&
          block.imageUrls.length > 0
        ) {
          if (!supportsVision) {
            // Non-vision model: replace images with a text placeholder
            contentParts.push({
              type: "text",
              text: "[User shared an image, but the current model does not support image recognition]",
            });
            // Append source path metadata so the main model can delegate
            // recognition to a vision subagent (which reads the path with the
            // Read tool). The path comes from `imagePaths` — the host-side file
            // the bytes were also written to — falling back to the block value
            // itself for images that only exist as a file.
            block.imageUrls.forEach((imageUrl: string, index: number) => {
              const sourcePath = imageSourcePath(block, imageUrl, index);
              if (sourcePath) {
                contentParts.push({
                  type: "text",
                  text: `[Image source: ${sourcePath}]`,
                });
              }
            });
          } else {
            for (const [index, imageUrl] of block.imageUrls.entries()) {
              // Check if it's already base64, convert if not
              const isDataUrl = imageUrl.startsWith("data:image/");
              let finalImageUrl = imageUrl;
              if (!isDataUrl) {
                // If it's a file path, it needs to be converted to base64.
                // Unreadable/empty/unknown-format files come back as
                // undefined: skip the image rather than send an empty payload.
                let converted: string | undefined;
                try {
                  converted = convertImageToBase64(imageUrl);
                } catch (error) {
                  logger.error(
                    "Failed to convert image path to base64:",
                    imageUrl,
                    error,
                  );
                  // Skip this image, do not add to content
                  continue;
                }
                if (!converted) {
                  logger.warn("Skipping unusable image file:", imageUrl);
                  continue;
                }
                finalImageUrl = converted;
              }

              // Outbound budget: an image the vision gateway would reject, or
              // one over our own size budget, is shrunk here (or replaced by an
              // actionable note when it cannot be). See utils/imageRewrite.ts.
              const plan = await planOutboundImage({
                dataUrl: finalImageUrl,
                cacheKey: isDataUrl
                  ? finalImageUrl
                  : imageFileCacheKey(imageUrl),
                sourcePath: imageSourcePath(block, imageUrl, index),
              });

              if (plan.kind === "omit") {
                contentParts.push({ type: "text", text: plan.note });
                continue;
              }

              contentParts.push({
                type: "image_url",
                image_url: {
                  url: plan.dataUrl,
                  detail: "auto",
                },
              });

              // Tell the model when the image it sees is not the full-size
              // original, so it can map coordinates back.
              if (plan.note) {
                contentParts.push({ type: "text", text: plan.note });
              }

              // Aligned with Claude Code: append the image's source path as text
              // metadata so the model can reference the file with tools (e.g. a
              // vision-model subagent reading the image). Inline data URLs get
              // one too, from `imagePaths` — the host wrote the bytes to a file.
              const sourcePath = imageSourcePath(block, imageUrl, index);
              if (sourcePath) {
                contentParts.push({
                  type: "text",
                  text: `[Image source: ${sourcePath}]`,
                });
              }
            }
          }
        }

        // If there is a tool block in user message, add its result
        if (block.type === "tool" && block.stage === "end" && block.result) {
          contentParts.push({
            type: "text",
            text: `<local-command-stdout>\n${stripAnsiColors(block.result)}\n</local-command-stdout>`,
          });
        }

        // If there is a task notification block, convert it back to XML
        if (block.type === "task_notification") {
          // The lead-in has to match the status: a workflow that crossed a size
          // threshold is still running, and calling that "completed a task"
          // would tell the model the opposite of what happened. A rewaking hook
          // has no task to report on, so it gets its own wording instead of
          // being described as a background agent that "completed a task".
          const lead =
            block.status === "running"
              ? "A background task is still running:"
              : block.taskType === "hook"
                ? "A hook reported a blocking error:"
                : "A background agent completed a task:";
          contentParts.push({
            type: "text",
            text: `${lead}\n${taskNotificationToXml(block)}`,
          });
        }
      }

      // Only add user message if there is meaningful content
      if (contentParts.length > 0) {
        // Filter out empty text parts
        const meaningfulParts = contentParts.filter((part) => {
          if (part.type === "text") {
            return part.text && part.text.trim().length > 0;
          }
          return true; // Keep image parts
        });

        if (meaningfulParts.length > 0) {
          recentMessages.unshift({
            role: "user",
            content: meaningfulParts,
          });
        }
      }
    }
  }

  return recentMessages;
}

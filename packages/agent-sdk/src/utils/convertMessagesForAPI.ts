import type { Message } from "../types/index.js";
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
 * @param messages Message list
 * @param options Optional conversion options (e.g. supportsVision)
 * @returns Converted API message format list
 */
export function convertMessagesForAPI(
  messages: Message[],
  options?: ConvertMessagesOptions,
): ChatCompletionMessageParam[] {
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

        toolBlocks.forEach((toolBlock) => {
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

                toolBlock.images.forEach((image) => {
                  const imageUrl = image.data.startsWith("data:")
                    ? image.data
                    : `data:${image.mediaType || "image/png"};base64,${image.data}`;

                  contentParts.push({
                    type: "image_url",
                    image_url: {
                      url: imageUrl,
                      detail: "auto",
                    },
                  });
                });

                imageUserMessages.push({
                  role: "user",
                  content: contentParts,
                });
              } else {
                // Non-vision model: replace images with a text placeholder
                imageUserMessages.push({
                  role: "user",
                  content:
                    "[Tool returned an image, but the current model does not support image recognition]",
                });
              }
            }
          }
        });

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

      // Construct assistant message - only add if there is meaningful content or tool calls
      const hasContent = content && content.trim().length > 0;
      const hasToolCalls = tool_calls && tool_calls.length > 0;

      if (hasContent || hasToolCalls) {
        const assistantMessage: ChatCompletionMessageParam = {
          role: "assistant",
          content: hasContent ? content : undefined,
          tool_calls,
          ...(reasoning_content ? { reasoning_content } : {}),
          ...(message.additionalFields ? { ...message.additionalFields } : {}),
        } as ChatCompletionMessageParam;

        recentMessages.unshift(assistantMessage);
      }
    } else if (message.role === "user") {
      // User messages converted to standard format
      const contentParts: ChatCompletionContentPart[] = [];

      message.blocks.forEach((block) => {
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
          } else {
            block.imageUrls.forEach((imageUrl: string) => {
              // Check if it's already base64, convert if not
              let finalImageUrl = imageUrl;
              if (!imageUrl.startsWith("data:image/")) {
                // If it's a file path, it needs to be converted to base64
                try {
                  finalImageUrl = convertImageToBase64(imageUrl);
                } catch (error) {
                  logger.error(
                    "Failed to convert image path to base64:",
                    imageUrl,
                    error,
                  );
                  // Skip this image, do not add to content
                  return;
                }
              }

              contentParts.push({
                type: "image_url",
                image_url: {
                  url: finalImageUrl,
                  detail: "auto",
                },
              });
            });
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
          contentParts.push({
            type: "text",
            text: taskNotificationToXml(block),
          });
        }
      });

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

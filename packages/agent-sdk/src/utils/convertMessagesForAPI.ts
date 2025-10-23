import type { Message } from "../types.js";
import { convertImageToBase64 } from "./messageOperations.js";
import { ChatCompletionMessageToolCall } from "openai/resources";
import { stripAnsiColors } from "./stringUtils.js";
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources.js";

/**
 * Safely handle tool call parameters, ensuring a legal JSON string is returned
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
    // logger.error(`Invalid tool arguments: ${args}`);
    // If not valid JSON, return a fallback empty object
    return "{}";
  }
}

/**
 * Convert message format to API call format, stopping when a compressed message is encountered
 * @param messages Message list
 * @returns Converted API message format list
 */
export function convertMessagesForAPI(
  messages: Message[],
): ChatCompletionMessageParam[] {
  const recentMessages: ChatCompletionMessageParam[] = [];

  const startIndex = messages.length - 1;
  for (let i = startIndex; i >= 0; i--) {
    const message = messages[i];

    // Check if a compression block is encountered, if so, stop iteration
    if (
      message.role === "assistant" &&
      message.blocks.some((block) => block.type === "compress")
    ) {
      // Add the content of the compression block as an assistant message to the history
      const compressBlock = message.blocks.find(
        (block) => block.type === "compress",
      );
      if (compressBlock && compressBlock.type === "compress") {
        recentMessages.unshift({
          role: "system",
          content: `[Compressed Message Summary] ${compressBlock.content}`,
        });
      }
      break;
    }

    // Skip empty assistant messages
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
        toolBlocks.forEach((toolBlock) => {
          // Only add completed tool blocks (i.e., not running)
          if (toolBlock.id && !toolBlock.isRunning) {
            completedToolIds.add(toolBlock.id);

            // Check for image data
            if (toolBlock.images && toolBlock.images.length > 0) {
              // If there is an image, create a user message instead of a tool message
              const contentParts: ChatCompletionContentPart[] = [];

              // Add tool result as text
              const toolResultText = `Tool result for ${toolBlock.name || "unknown tool"}:\n${stripAnsiColors(toolBlock.result || "")}`;
              contentParts.push({
                type: "text",
                text: toolResultText,
              });

              // Add image
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

              // Add user message
              recentMessages.unshift({
                role: "user",
                content: contentParts,
              });
            } else {
              // Normal tool message
              recentMessages.unshift({
                tool_call_id: toolBlock.id,
                role: "tool",
                content: stripAnsiColors(toolBlock.result || ""),
              });
            }
          }
        });
      }

      // Construct the content of the assistant message
      let content = "";
      let tool_calls: ChatCompletionMessageToolCall[] | undefined = undefined;

      // Construct content from text blocks
      const textBlocks = message.blocks.filter(
        (block) => block.type === "text",
      );
      if (textBlocks.length > 0) {
        content = textBlocks.map((block) => block.content || "").join("\n");
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

      // Construct assistant message - only add if there is content or tool calls
      if (content || tool_calls) {
        const assistantMessage: ChatCompletionMessageParam = {
          role: "assistant",
          content,
          tool_calls,
        };

        recentMessages.unshift(assistantMessage);
      }
    } else if (message.role === "user") {
      // User messages converted to standard format
      const contentParts: ChatCompletionContentPart[] = [];

      message.blocks.forEach((block) => {
        // Add text content
        if (block.type === "text" && block.content) {
          contentParts.push({
            type: "text",
            text: block.content,
          });
        }

        // Handle custom command blocks - pass full content as text to AI
        if (block.type === "custom_command" && block.content) {
          contentParts.push({
            type: "text",
            text: block.content,
          });
        }

        // If there is an image, add image content
        if (
          block.type === "image" &&
          block.imageUrls &&
          block.imageUrls.length > 0
        ) {
          block.imageUrls.forEach((imageUrl: string) => {
            // Check if it's already base64, convert if not
            let finalImageUrl = imageUrl;
            if (!imageUrl.startsWith("data:image/")) {
              // If it's a file path, it needs to be converted to base64
              try {
                finalImageUrl = convertImageToBase64(imageUrl);
              } catch (error) {
                console.error(
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
      });

      if (contentParts.length > 0) {
        recentMessages.unshift({
          role: "user",
          content: contentParts,
        });
      }
    }
  }

  return recentMessages;
}

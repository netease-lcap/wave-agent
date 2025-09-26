import type { Message } from "../types";
import { convertImageToBase64 } from "./messageOperations";
import { logger } from "./logger";
import { ChatCompletionMessageToolCall } from "openai/resources";
import { stripAnsiColors } from "./stringUtils";
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources.js";

/**
 * 安全处理工具调用参数，确保返回合法的 JSON 字符串
 * @param args 工具调用参数
 * @returns 合法的 JSON 字符串
 */
function safeToolArguments(args: string): string {
  if (!args) {
    return "{}";
  }

  try {
    // 尝试解析为 JSON 以验证格式
    JSON.parse(args);
    return args;
  } catch {
    logger.error(`Invalid tool arguments: ${args}`);
    // 如果不是合法的 JSON，返回兜底的空对象
    return "{}";
  }
}

/**
 * 转换消息格式为API调用格式，遇到压缩消息时停止
 * @param messages 消息列表
 * @returns 转换后的API消息格式列表
 */
export function convertMessagesForAPI(
  messages: Message[],
): ChatCompletionMessageParam[] {
  const recentMessages: ChatCompletionMessageParam[] = [];

  const startIndex = messages.length - 1;
  for (let i = startIndex; i >= 0; i--) {
    const message = messages[i];

    // 检查是否遇到压缩块，如果遇到则停止遍历
    if (
      message.role === "assistant" &&
      message.blocks.some((block) => block.type === "compress")
    ) {
      // 将压缩块的内容作为助手消息添加到历史中
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

    // 跳过空的助手消息
    if (message.role === "assistant" && message.blocks.length === 0) {
      continue;
    }

    if (message.role === "assistant") {
      // 先检查是否有 tool block，如果有则先添加 tool 消息
      // 过滤掉未完成的 tool blocks（没有 result 或正在运行中的）
      const toolBlocks = message.blocks.filter(
        (block) => block.type === "tool",
      );
      const completedToolIds = new Set<string>(); // 记录已完成的工具ID

      if (toolBlocks.length > 0) {
        toolBlocks.forEach((toolBlock) => {
          // 只添加已完成的 tool blocks
          if (toolBlock.attributes?.id && !toolBlock.attributes.isStreaming) {
            completedToolIds.add(toolBlock.attributes.id);

            // 检查是否有图片数据
            if (toolBlock.images && toolBlock.images.length > 0) {
              // 如果有图片，创建用户消息而不是 tool 消息
              const contentParts: ChatCompletionContentPart[] = [];

              // 添加工具结果作为文本
              const toolResultText = `Tool result for ${toolBlock.attributes.name || "unknown tool"}:\n${stripAnsiColors(toolBlock.result || "")}`;
              contentParts.push({
                type: "text",
                text: toolResultText,
              });

              // 添加图片
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

              // 添加用户消息
              recentMessages.unshift({
                role: "user",
                content: contentParts,
              });
            } else {
              // 正常的 tool 消息
              recentMessages.unshift({
                tool_call_id: toolBlock.attributes.id,
                role: "tool",
                content: stripAnsiColors(toolBlock.result || ""),
              });
            }
          }
        });
      }

      // 构建助手消息的内容
      let content = "";
      let tool_calls: ChatCompletionMessageToolCall[] | undefined = undefined;

      // 从文本块中构建内容
      const textBlocks = message.blocks.filter(
        (block) => block.type === "text",
      );
      if (textBlocks.length > 0) {
        content = textBlocks.map((block) => block.content || "").join("\n");
      }

      // 从工具块中构建工具调用
      if (toolBlocks.length > 0) {
        tool_calls = toolBlocks
          .filter(
            (toolBlock) =>
              toolBlock.attributes?.id &&
              completedToolIds.has(toolBlock.attributes.id),
          )
          .map((toolBlock) => ({
            id: toolBlock.attributes!.id!,
            type: "function",
            function: {
              name: toolBlock.attributes!.name || "",
              arguments: safeToolArguments(
                String(toolBlock.parameters || "{}"),
              ),
            },
          }));

        if (tool_calls.length === 0) {
          tool_calls = undefined;
        }
      }

      // 构建助手消息 - 只有在有内容或工具调用时才添加
      if (content || tool_calls) {
        const assistantMessage: ChatCompletionMessageParam = {
          role: "assistant",
          content,
          tool_calls,
        };

        recentMessages.unshift(assistantMessage);
      }
    } else if (message.role === "user") {
      // 用户消息转换为标准格式
      const contentParts: ChatCompletionContentPart[] = [];

      message.blocks.forEach((block) => {
        // 添加文本内容
        if (block.type === "text" && block.content) {
          contentParts.push({
            type: "text",
            text: block.content,
          });
        }

        // 如果有图片，添加图片内容
        if (
          block.type === "image" &&
          block.attributes?.imageUrls &&
          block.attributes.imageUrls.length > 0
        ) {
          block.attributes.imageUrls.forEach((imageUrl: string) => {
            // 检查是否已经是base64格式，如果不是则转换
            let finalImageUrl = imageUrl;
            if (!imageUrl.startsWith("data:image/")) {
              // 如果是文件路径，需要转换为base64
              try {
                finalImageUrl = convertImageToBase64(imageUrl);
              } catch (error) {
                console.error(
                  "Failed to convert image path to base64:",
                  imageUrl,
                  error,
                );
                // 跳过这个图片，不添加到content中
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

/**
 * 将最近的消息转换为 markdown 字符串
 * @param messages ChatCompletionMessageParam 数组
 * @returns markdown 格式的字符串
 */
export function convertMessagesToMarkdown(
  messages: ChatCompletionMessageParam[],
): string {
  if (!messages || messages.length === 0) {
    return "暂无消息记录";
  }

  let markdown = "";

  messages.forEach((message) => {
    markdown += `## ${message.role}\n\n`;

    if (message.role === "user") {
      // 用户消息：直接展示content内容
      if (Array.isArray(message.content)) {
        message.content.forEach((part) => {
          if (part.type === "text") {
            markdown += `${part.text}\n\n`;
          } else if (part.type === "image_url") {
            markdown += `![图片](${part.image_url.url})\n\n`;
          }
        });
      } else if (typeof message.content === "string") {
        markdown += `${message.content}\n\n`;
      }
    } else if (message.role === "assistant") {
      // 助手消息：content用xml语法，tool_calls用json语法
      if (message.content) {
        markdown += `### Content\n\n\`\`\`xml\n${message.content}\n\`\`\`\n\n`;
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        markdown += `### Tool Calls\n\n\`\`\`json\n${JSON.stringify(message.tool_calls, null, 2)}\n\`\`\`\n\n`;
      }
    } else if (message.role === "tool") {
      // 工具消息：用json语法显示工具调用结果
      markdown += `**Tool Call ID:** ${message.tool_call_id}\n\n`;
      markdown += `**Result:**\n\n\`\`\`json\n${message.content}\n\`\`\`\n\n`;
    }

    markdown += "---\n\n";
  });

  return markdown;
}

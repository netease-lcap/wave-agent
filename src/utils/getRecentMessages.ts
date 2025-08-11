import type { ChatMessage, ChatCompletionContentPart } from '../types/common';
import type { Message } from '../types';
import { convertImageToBase64 } from './messageOperations';
import { logger } from './logger';
import { ChatCompletionMessageToolCall } from 'openai/resources';
import { stripAnsiColors } from '../types/common';

/**
 * 安全处理工具调用参数，确保返回合法的 JSON 字符串
 * @param args 工具调用参数
 * @returns 合法的 JSON 字符串
 */
function safeToolArguments(args: string): string {
  if (!args) {
    return '{}';
  }

  try {
    // 尝试解析为 JSON 以验证格式
    JSON.parse(args);
    return args;
  } catch {
    logger.error(`Invalid tool arguments: ${args}`);
    // 如果不是合法的 JSON，返回兜底的空对象
    return '{}';
  }
}

/**
 * 获取最近的消息历史，用于发送给AI
 * @param messages 消息列表
 * @param userMsgCount 用户消息数量限制，默认为3
 * @returns 格式化后的消息列表
 */
export function getRecentMessages(messages: Message[], userMsgCount: number = 3): ChatMessage[] {
  const recentMessages: ChatMessage[] = [];
  let userMessageCount = 0;

  const startIndex = messages.length - 1;
  for (let i = startIndex; i >= 0 && userMessageCount < userMsgCount; i--) {
    const message = messages[i];

    // 跳过空的助手消息
    if (message.role === 'assistant' && message.blocks.length === 0) {
      continue;
    }

    if (message.role === 'assistant') {
      // 先检查是否有 tool block，如果有则先添加 tool 消息
      // 过滤掉未完成的 tool blocks（没有 result 或正在运行中的）
      const toolBlocks = message.blocks.filter((block) => block.type === 'tool');
      const completedToolIds = new Set<string>(); // 记录已完成的工具ID

      if (toolBlocks.length > 0) {
        toolBlocks.forEach((toolBlock) => {
          // 只添加已完成的 tool blocks
          if (toolBlock.attributes?.id && !toolBlock.attributes.isStreaming) {
            completedToolIds.add(toolBlock.attributes.id);
            recentMessages.unshift({
              tool_call_id: toolBlock.attributes.id,
              role: 'tool',
              content: stripAnsiColors(toolBlock.result || ''),
            });
          }
        });
      }

      // 构建助手消息的内容
      let content = '';
      let tool_calls: ChatCompletionMessageToolCall[] | undefined = undefined;

      // 从文本块中构建内容
      const textBlocks = message.blocks.filter((block) => block.type === 'text');
      if (textBlocks.length > 0) {
        content = textBlocks.map((block) => block.content || '').join('\n');
      }

      // 从工具块中构建工具调用
      if (toolBlocks.length > 0) {
        tool_calls = toolBlocks
          .filter((toolBlock) => toolBlock.attributes?.id && completedToolIds.has(toolBlock.attributes.id))
          .map((toolBlock) => ({
            id: toolBlock.attributes!.id!,
            type: 'function',
            function: {
              name: toolBlock.attributes!.name || '',
              arguments: safeToolArguments(String(toolBlock.parameters || '{}')),
            },
          }));

        if(tool_calls.length===0){
          tool_calls = undefined
        }
      }
      

      // 构建助手消息 - 只有在有内容或工具调用时才添加
      if (content || tool_calls) {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content,
          tool_calls,
        };

        recentMessages.unshift(assistantMessage);
      }
    } else if (message.role === 'user') {
      // 用户消息转换为标准格式
      const contentParts: ChatCompletionContentPart[] = [];

      message.blocks.forEach((block) => {
        // 添加文本内容
        if (block.type === 'text' && block.content) {
          contentParts.push({
            type: 'text',
            text: block.content,
          });
        }

        // 如果有图片，添加图片内容
        if (block.type === 'image' && block.attributes?.imageUrls && block.attributes.imageUrls.length > 0) {
          block.attributes.imageUrls.forEach((imageUrl: string) => {
            // 检查是否已经是base64格式，如果不是则转换
            let finalImageUrl = imageUrl;
            if (!imageUrl.startsWith('data:image/')) {
              // 如果是文件路径，需要转换为base64
              try {
                finalImageUrl = convertImageToBase64(imageUrl);
              } catch (error) {
                console.error('Failed to convert image path to base64:', imageUrl, error);
                // 跳过这个图片，不添加到content中
                return;
              }
            }

            contentParts.push({
              type: 'image_url',
              image_url: {
                url: finalImageUrl,
                detail: 'auto',
              },
            });
          });
        }
      });

      if (contentParts.length > 0) {
        recentMessages.unshift({
          role: 'user',
          content: contentParts,
        });
        userMessageCount++;
      }
    }
  }

  return recentMessages;
}

/**
 * 将最近的消息转换为 markdown 字符串
 * @param messages ChatMessage 数组
 * @returns markdown 格式的字符串
 */
export function convertMessagesToMarkdown(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return '暂无消息记录';
  }

  let markdown = '';

  messages.forEach((message) => {
    markdown += `## ${message.role}\n\n`;

    if (message.role === 'user') {
      // 用户消息：直接展示content内容
      if (Array.isArray(message.content)) {
        message.content.forEach((part) => {
          if (part.type === 'text') {
            markdown += `${part.text}\n\n`;
          } else if (part.type === 'image_url') {
            markdown += `![图片](${part.image_url.url})\n\n`;
          }
        });
      } else if (typeof message.content === 'string') {
        markdown += `${message.content}\n\n`;
      }
    } else if (message.role === 'assistant') {
      // 助手消息：content用xml语法，tool_calls用json语法
      if (message.content) {
        markdown += `### Content\n\n\`\`\`xml\n${message.content}\n\`\`\`\n\n`;
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        markdown += `### Tool Calls\n\n\`\`\`json\n${JSON.stringify(message.tool_calls, null, 2)}\n\`\`\`\n\n`;
      }
    } else if (message.role === 'tool') {
      // 工具消息：用json语法显示工具调用结果
      markdown += `**Tool Call ID:** ${message.tool_call_id}\n\n`;
      markdown += `**Result:**\n\n\`\`\`json\n${message.content}\n\`\`\`\n\n`;
    }

    markdown += '---\n\n';
  });

  return markdown;
}
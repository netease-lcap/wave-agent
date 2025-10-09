import type { Message } from "../types.js";
import { readFileSync } from "fs";
import { extname } from "path";
import { logger } from "./logger.js";

// Parameter interfaces for message operations
export interface AddUserMessageParams {
  messages: Message[];
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
}

export interface UpdateAnswerBlockParams {
  messages: Message[];
  content: string;
}

export interface AddToolBlockParams {
  messages: Message[];
  attributes: { id: string; name: string };
}

export interface UpdateToolBlockParams {
  messages: Message[];
  id: string;
  parameters: string;
  result?: string;
  success?: boolean;
  error?: string;
  isRunning?: boolean;
  name?: string;
  shortResult?: string;
  images?: Array<{ data: string; mediaType?: string }>;
}

// AIManager specific interfaces (without messages parameter)
export interface AIManagerToolBlockUpdateParams {
  toolId: string;
  args?: string;
  result?: string;
  success?: boolean;
  error?: string;
  isRunning?: boolean;
  name?: string;
  shortResult?: string;
}

export interface AddDiffBlockParams {
  messages: Message[];
  path: string;
  diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>;
  original: string;
  modified: string;
  warning?: string;
}

export interface AddErrorBlockParams {
  messages: Message[];
  error: string;
}

export interface AddCompressBlockParams {
  messages: Message[];
  insertIndex: number;
  compressContent: string;
}

export interface AddMemoryBlockParams {
  messages: Message[];
  content: string;
  isSuccess: boolean;
  memoryType?: "project" | "user";
  storagePath?: string;
}

export interface AddCommandOutputParams {
  messages: Message[];
  command: string;
}

export interface UpdateCommandOutputParams {
  messages: Message[];
  command: string;
  output: string;
}

export interface CompleteCommandParams {
  messages: Message[];
  command: string;
  exitCode: number;
}

/**
 * 从 messages 数组中提取用户消息的文本内容
 */
export const extractUserInputHistory = (messages: Message[]): string[] => {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => {
      // 提取所有文本块的内容并合并
      const textBlocks = message.blocks.filter(
        (block) => block.type === "text",
      );
      return textBlocks
        .map((block) => block.content)
        .join(" ")
        .trim();
    })
    .filter((text) => text.length > 0); // 过滤掉空文本
};

/**
 * 将图片文件路径转换为base64格式
 * @param imagePath 图片文件路径
 * @returns base64格式的图片数据URL
 */
export const convertImageToBase64 = (imagePath: string): string => {
  try {
    const imageBuffer = readFileSync(imagePath);
    const ext = extname(imagePath).toLowerCase().substring(1);

    // 根据文件扩展名确定MIME类型
    let mimeType = "image/png"; // 默认
    switch (ext) {
      case "jpg":
      case "jpeg":
        mimeType = "image/jpeg";
        break;
      case "png":
        mimeType = "image/png";
        break;
      case "gif":
        mimeType = "image/gif";
        break;
      case "webp":
        mimeType = "image/webp";
        break;
      case "bmp":
        mimeType = "image/bmp";
        break;
      default:
        mimeType = "image/png";
    }

    const base64String = imageBuffer.toString("base64");
    return `data:${mimeType};base64,${base64String}`;
  } catch (error) {
    logger.error(`Failed to convert image to base64: ${imagePath}`, error);
    // 返回一个错误占位符或抛出错误
    return `data:image/png;base64,`; // 空的base64，避免程序崩溃
  }
};

// 添加用户消息
export const addUserMessageToMessages = ({
  messages,
  content,
  images,
}: AddUserMessageParams): Message[] => {
  const blocks: Message["blocks"] = [{ type: "text", content }];

  // 如果有图片，添加图片块
  if (images && images.length > 0) {
    const imageUrls = images.map((img) => img.path);
    blocks.push({
      type: "image",
      attributes: {
        imageUrls,
      },
    });
  }

  const userMessage: Message = {
    role: "user",
    blocks,
  };
  return [...messages, userMessage];
};

// 添加助手消息
export const addAssistantMessageToMessages = (
  messages: Message[],
): Message[] => {
  const initialAssistantMessage: Message = {
    role: "assistant",
    blocks: [],
    originalDeltas: [], // 初始化原始delta数组
  };

  return [...messages, initialAssistantMessage];
};

// 添加 Answer Block 到最后一个助手消息
export const addAnswerBlockToMessage = (messages: Message[]): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      newMessages[i].blocks.push({ type: "text", content: "" });
      break;
    }
  }
  return newMessages;
};

// 更新最后一个助手消息的 Answer Block 内容
export const updateAnswerBlockInMessage = ({
  messages,
  content,
}: UpdateAnswerBlockParams): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      const textBlocks = newMessages[i].blocks.filter(
        (block) => block.type === "text",
      );
      if (textBlocks.length > 0) {
        const lastTextBlockIndex = newMessages[i].blocks.lastIndexOf(
          textBlocks[textBlocks.length - 1],
        );
        if (lastTextBlockIndex >= 0) {
          newMessages[i].blocks[lastTextBlockIndex] = {
            type: "text",
            content: content,
          };
        }
      }
      break;
    }
  }
  return newMessages;
};

// 更新最后一个助手消息的 File Operation Block
export const addDiffBlockToMessage = ({
  messages,
  path,
  diffResult,
  original,
  modified,
  warning,
}: AddDiffBlockParams): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      // 直接添加 diff 块，而不是替换现有块
      newMessages[i].blocks.push({
        type: "diff",
        path: path,
        original: original,
        modified: modified,
        diffResult: diffResult,
        warning: warning,
      });
      break;
    }
  }
  return newMessages;
};

// 添加 Tool Block 到最后一个助手消息
export const addToolBlockToMessage = ({
  messages,
  attributes,
}: AddToolBlockParams): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      newMessages[i].blocks.push({
        type: "tool",
        parameters: "",
        result: "",
        attributes: {
          id: attributes.id,
          name: attributes.name,
          isRunning: false, // 尚未开始执行
        },
      });
      break;
    }
  }
  return newMessages;
};

// 更新最后一个助手消息的 Tool Block
export const updateToolBlockInMessage = ({
  messages,
  id,
  parameters,
  result,
  success,
  error,
  isRunning,
  name,
  shortResult,
  images,
}: UpdateToolBlockParams): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      const toolBlockIndex = newMessages[i].blocks.findIndex(
        (block) => block.type === "tool" && block.attributes?.id === id,
      );

      if (toolBlockIndex !== -1) {
        const toolBlock = newMessages[i].blocks[toolBlockIndex];
        if (toolBlock.type === "tool") {
          toolBlock.parameters = parameters;
          if (result !== undefined) toolBlock.result = result;
          if (shortResult !== undefined) toolBlock.shortResult = shortResult;
          if (images !== undefined) toolBlock.images = images; // 添加图片数据更新
          if (toolBlock.attributes) {
            if (success !== undefined) toolBlock.attributes.success = success;
            if (error !== undefined) toolBlock.attributes.error = error;
            if (isRunning !== undefined)
              toolBlock.attributes.isRunning = isRunning;
          }
        }
      } else if (result !== undefined) {
        // 如果找不到现有block，创建新的
        newMessages[i].blocks.push({
          type: "tool",
          parameters: parameters,
          result: result,
          shortResult: shortResult,
          images: images, // 添加图片数据
          attributes: {
            id: id,
            name: name || "unknown",
            success: success,
            error: error,
            isRunning: isRunning ?? false,
          },
        });
      }
      break;
    }
  }
  return newMessages;
};

// 添加 Error Block 到最后一个助手消息
export const addErrorBlockToMessage = ({
  messages,
  error,
}: AddErrorBlockParams): Message[] => {
  const newMessages = [...messages];
  // 找到最后一个助手消息
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      newMessages[i].blocks = [
        ...newMessages[i].blocks,
        {
          type: "error",
          content: error,
        },
      ];
      break;
    }
  }
  return newMessages;
};

// 添加压缩块到指定位置的消息
export const addCompressBlockToMessage = ({
  messages,
  insertIndex,
  compressContent,
}: AddCompressBlockParams): Message[] => {
  const newMessages = [...messages];

  // 创建一个新的助手消息来包含压缩块
  const compressMessage: Message = {
    role: "assistant",
    blocks: [
      {
        type: "compress",
        content: compressContent,
      },
    ],
  };

  // 在指定位置插入压缩消息
  newMessages.splice(insertIndex, 0, compressMessage);
  return newMessages;
};

// 添加 Memory Block 作为新的助手消息
export const addMemoryBlockToMessage = ({
  messages,
  content,
  isSuccess,
  memoryType,
  storagePath,
}: AddMemoryBlockParams): Message[] => {
  const newMessages = [...messages];

  // 创建新的助手消息包含 MemoryBlock
  const memoryMessage: Message = {
    role: "assistant",
    blocks: [
      {
        type: "memory",
        content,
        isSuccess,
        memoryType,
        storagePath,
      },
    ],
  };

  // 添加到消息列表末尾
  newMessages.push(memoryMessage);
  return newMessages;
};

/**
 * 从后往前计算有效的 block 数量
 * 只有 text、image、tool 类型的 block 才会被计入
 * @param messages 消息数组
 * @param targetCount 需要计算的有效 block 数量
 * @returns { messageIndex: number, blockCount: number } 消息索引和实际计算到的 block 数量
 */
export const countValidBlocksFromEnd = (
  messages: Message[],
  targetCount: number,
): { messageIndex: number; blockCount: number } => {
  let validBlockCount = 0;

  // 从后往前遍历消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // 遍历当前消息的所有 blocks
    for (const block of message.blocks) {
      // 只计算有效的 block 类型
      if (
        block.type === "text" ||
        block.type === "image" ||
        block.type === "tool"
      ) {
        validBlockCount++;

        // 如果达到目标数量，返回当前消息的索引
        if (validBlockCount >= targetCount) {
          return { messageIndex: i, blockCount: validBlockCount };
        }
      }
    }
  }

  // 如果没有达到目标数量，返回0索引
  return { messageIndex: 0, blockCount: validBlockCount };
};

/**
 * 获取需要压缩的消息和插入位置
 * @param messages 消息数组
 * @param keepLastCount 保留最后几个有效 block 不压缩
 * @returns { messagesToCompress: Message[], insertIndex: number }
 */
export const getMessagesToCompress = (
  messages: Message[],
  keepLastCount: number = 7,
): { messagesToCompress: Message[]; insertIndex: number } => {
  // 从后往前计算需要保留的消息位置
  const { messageIndex } = countValidBlocksFromEnd(messages, keepLastCount);

  // 找到最后一个包含压缩块的消息索引
  let lastCompressIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const hasCompressBlock = messages[i].blocks.some(
      (block) => block.type === "compress",
    );
    if (hasCompressBlock) {
      lastCompressIndex = i;
      break;
    }
  }

  // 确定压缩的起始位置
  // 如果存在压缩块，从压缩块位置开始（包含压缩块）
  // 如果不存在压缩块，从开始位置开始
  const startIndex = lastCompressIndex >= 0 ? lastCompressIndex : 0;

  // 需要压缩的消息是从起始位置到计算出的位置之前的所有消息
  const messagesToCompress = messages.slice(startIndex, messageIndex);

  // 插入位置就是保留消息前的位置
  const insertIndex = messageIndex;

  return { messagesToCompress, insertIndex };
};

// 添加命令输出块到消息列表
export const addCommandOutputMessage = ({
  messages,
  command,
}: AddCommandOutputParams): Message[] => {
  const outputMessage: Message = {
    role: "assistant",
    blocks: [
      {
        type: "command_output",
        command,
        output: "",
        isRunning: true,
        exitCode: null,
      },
    ],
  };

  return [...messages, outputMessage];
};

// 更新命令输出块的输出内容
export const updateCommandOutputInMessage = ({
  messages,
  command,
  output,
}: UpdateCommandOutputParams): Message[] => {
  const newMessages = [...messages];
  // Find the last assistant message with a command_output block for this command
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i];
    if (msg.role === "assistant") {
      const commandBlock = msg.blocks.find(
        (block) =>
          block.type === "command_output" &&
          block.command === command &&
          block.isRunning,
      );
      if (commandBlock && commandBlock.type === "command_output") {
        commandBlock.output = output.trim();
        break;
      }
    }
  }
  return newMessages;
};

// 完成命令执行，更新退出状态
export const completeCommandInMessage = ({
  messages,
  command,
  exitCode,
}: CompleteCommandParams): Message[] => {
  const newMessages = [...messages];
  // Find the last assistant message with a command_output block for this command
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i];
    if (msg.role === "assistant") {
      const commandBlock = msg.blocks.find(
        (block) =>
          block.type === "command_output" &&
          block.command === command &&
          block.isRunning,
      );
      if (commandBlock && commandBlock.type === "command_output") {
        commandBlock.isRunning = false;
        commandBlock.exitCode = exitCode;
        break;
      }
    }
  }
  return newMessages;
};

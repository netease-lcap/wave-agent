import type { Message, Usage, MessageSource } from "../types/index.js";
import { readFileSync } from "fs";
import { extname } from "path";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";

// Base user message parameters interface
export interface UserMessageParams {
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  customCommandContent?: string;
  source?: MessageSource;
}

// Parameter interfaces for message operations
export interface AddUserMessageParams extends UserMessageParams {
  messages: Message[];
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
  compactParams?: string;
}

// Agent specific interfaces (without messages parameter)
export type AgentToolBlockUpdateParams = Omit<
  UpdateToolBlockParams,
  "messages"
>;

export interface AddDiffBlockParams {
  messages: Message[];
  path: string;
  diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>;
}

export interface AddErrorBlockParams {
  messages: Message[];
  error: string;
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
 * Extract text content from user messages in the messages array
 */
export const extractUserInputHistory = (messages: Message[]): string[] => {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => {
      // Extract all text block content and merge
      const textBlocks = message.blocks.filter(
        (block) => block.type === "text",
      );
      return textBlocks
        .map((block) => block.content)
        .join(" ")
        .trim();
    })
    .filter((text) => text.length > 0); // Filter out empty text
};

/**
 * Convert image file path to base64 format
 * @param imagePath Image file path
 * @returns base64 format image data URL
 */
export const convertImageToBase64 = (imagePath: string): string => {
  try {
    const imageBuffer = readFileSync(imagePath);
    const ext = extname(imagePath).toLowerCase().substring(1);

    // Determine MIME type based on file extension
    let mimeType = "image/png"; // Default
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
  } catch {
    // logger.error(`Failed to convert image to base64: ${imagePath}`, error);
    // Return an error placeholder or throw error
    return `data:image/png;base64,`; // Empty base64, avoid program crash
  }
};

// Add user message
export const addUserMessageToMessages = ({
  messages,
  content,
  images,
  customCommandContent,
  source,
}: AddUserMessageParams): Message[] => {
  const blocks: Message["blocks"] = [];

  // Create text block with optional customCommandContent and source
  const textBlock = {
    type: "text" as const,
    content,
    ...(customCommandContent && { customCommandContent }),
    ...(source && { source }),
  };
  blocks.push(textBlock);

  // If there are images, add image block
  if (images && images.length > 0) {
    const imageUrls = images.map((img) => img.path);
    blocks.push({
      type: "image",
      imageUrls,
    });
  }

  const userMessage: Message = {
    role: "user",
    blocks,
  };
  return [...messages, userMessage];
};

// Add assistant message (support one-time addition of answer and tool calls)
export const addAssistantMessageToMessages = (
  messages: Message[],
  content?: string,
  toolCalls?: ChatCompletionMessageFunctionToolCall[],
  usage?: Usage,
): Message[] => {
  const blocks: Message["blocks"] = [];

  // If there's answer content, add text block
  if (content) {
    blocks.push({ type: "text", content: content });
  }

  // If there are tool calls, add tool blocks
  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach((toolCall) => {
      blocks.push({
        type: "tool",
        parameters: toolCall.function.arguments || "",
        result: "",
        id: toolCall.id || "",
        name: toolCall.function?.name || "",
        isRunning: false,
      });
    });
  }

  const initialAssistantMessage: Message = {
    role: "assistant",
    blocks,
    usage, // Include usage data if provided
  };

  return [...messages, initialAssistantMessage];
};

// Update File Operation Block of the last assistant message
export const addDiffBlockToMessage = ({
  messages,
  path,
  diffResult,
}: AddDiffBlockParams): Message[] => {
  const newMessages = [...messages];
  // Find the last assistant message
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      // Directly add diff block instead of replacing existing blocks
      newMessages[i].blocks.push({
        type: "diff",
        path: path,
        diffResult: diffResult,
      });
      break;
    }
  }
  return newMessages;
};

// Update Tool Block of the last assistant message
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
  compactParams,
}: UpdateToolBlockParams): Message[] => {
  const newMessages = [...messages];
  // Find the last assistant message
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant") {
      const toolBlockIndex = newMessages[i].blocks.findIndex(
        (block) => block.type === "tool" && block.id === id,
      );

      if (toolBlockIndex !== -1) {
        const toolBlock = newMessages[i].blocks[toolBlockIndex];
        if (toolBlock.type === "tool") {
          toolBlock.parameters = parameters;
          if (result !== undefined) toolBlock.result = result;
          if (shortResult !== undefined) toolBlock.shortResult = shortResult;
          toolBlock.images = images; // Add image data update
          if (success !== undefined) toolBlock.success = success;
          if (error !== undefined) toolBlock.error = error;
          if (isRunning !== undefined) toolBlock.isRunning = isRunning;
          if (compactParams !== undefined)
            toolBlock.compactParams = compactParams;
        }
      } else if (result !== undefined) {
        // If existing block not found, create new one
        newMessages[i].blocks.push({
          type: "tool",
          parameters: parameters,
          result: result,
          shortResult: shortResult,
          images: images, // Add image data
          id: id,
          name: name || "unknown",
          success: success,
          error: error,
          isRunning: isRunning ?? false,
          compactParams: compactParams,
        });
      }
      break;
    }
  }
  return newMessages;
};

// Add Error Block to the last assistant message
export const addErrorBlockToMessage = ({
  messages,
  error,
}: AddErrorBlockParams): Message[] => {
  const newMessages = [...messages];

  // Check if the last message is an assistant message
  const lastMessage = newMessages[newMessages.length - 1];
  if (lastMessage && lastMessage.role === "assistant") {
    // Create a new message object with the error block added
    newMessages[newMessages.length - 1] = {
      ...lastMessage,
      blocks: [
        ...lastMessage.blocks,
        {
          type: "error",
          content: error,
        },
      ],
    };
  } else {
    // If the last message is not an assistant message, create a new assistant message
    newMessages.push({
      role: "assistant",
      blocks: [
        {
          type: "error",
          content: error,
        },
      ],
    });
  }

  return newMessages;
};

// Add Memory Block as new assistant message
export const addMemoryBlockToMessage = ({
  messages,
  content,
  isSuccess,
  memoryType,
  storagePath,
}: AddMemoryBlockParams): Message[] => {
  const newMessages = [...messages];

  // Create new assistant message containing MemoryBlock
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

  // Add to end of message list
  newMessages.push(memoryMessage);
  return newMessages;
};

/**
 * Count valid blocks from the end
 * Only text, image, and tool type blocks are counted
 * @param messages Message array
 * @param targetCount Number of valid blocks to count
 * @returns { messageIndex: number, blockCount: number } Message index and actual counted block count
 */
export const countValidBlocksFromEnd = (
  messages: Message[],
  targetCount: number,
): { messageIndex: number; blockCount: number } => {
  let validBlockCount = 0;

  // Iterate messages from end to beginning
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Iterate through all blocks of current message
    for (const block of message.blocks) {
      // Only count valid block types
      if (
        block.type === "text" ||
        block.type === "image" ||
        block.type === "tool"
      ) {
        validBlockCount++;

        // If target count reached, return current message index
        if (validBlockCount >= targetCount) {
          return { messageIndex: i, blockCount: validBlockCount };
        }
      }
    }
  }

  // If target count not reached, return index 0
  return { messageIndex: 0, blockCount: validBlockCount };
};

/**
 * Get messages to be compressed and insertion position
 * @param messages Message array
 * @param keepLastCount Keep the last few valid blocks uncompressed
 * @returns { messagesToCompress: Message[], insertIndex: number }
 */
export const getMessagesToCompress = (
  messages: Message[],
  keepLastCount: number = 7,
): { messagesToCompress: Message[]; insertIndex: number } => {
  // Calculate message position to keep from end to beginning
  const { messageIndex } = countValidBlocksFromEnd(messages, keepLastCount);

  // Find the last message containing compression block
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

  // Determine compression start position
  // If compression block exists, start from compression block position (include compression block)
  // If no compression block, start from beginning
  const startIndex = lastCompressIndex >= 0 ? lastCompressIndex : 0;

  // Messages to compress are all messages from start position to before calculated position
  const messagesToCompress = messages.slice(startIndex, messageIndex);

  // Change insertion position to negative number, indicating position from end
  const insertIndex = messageIndex - messages.length;

  return { messagesToCompress, insertIndex };
};

// Add command output block to message list
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

// Update output content of command output block
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

// Complete command execution, update exit status
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

// Subagent block message operations
export interface AddSubagentBlockParams {
  messages: Message[];
  subagentId: string;
  subagentName: string;
  status: "active" | "completed" | "error" | "aborted";
  subagentMessages?: Message[];
}

export interface UpdateSubagentBlockParams {
  messages: Message[];
  subagentId: string;
  status: "active" | "completed" | "error" | "aborted";
  subagentMessages: Message[];
}

export const addSubagentBlockToMessage = ({
  messages,
  subagentId,
  subagentName,
  status,
  subagentMessages = [],
}: AddSubagentBlockParams): Message[] => {
  const newMessages = [...messages];

  // Find the last assistant message or create one
  let lastAssistantMessage = newMessages[newMessages.length - 1];

  if (!lastAssistantMessage || lastAssistantMessage.role !== "assistant") {
    // Create new assistant message if the last message is not from assistant
    lastAssistantMessage = {
      role: "assistant",
      blocks: [],
    };
    newMessages.push(lastAssistantMessage);
  }

  // Add subagent block
  lastAssistantMessage.blocks.push({
    type: "subagent",
    subagentId,
    subagentName,
    status,
    messages: subagentMessages,
  });

  return newMessages;
};

export const updateSubagentBlockInMessage = (
  messages: Message[],
  subagentId: string,
  updates: Partial<{
    status: "active" | "completed" | "error" | "aborted";
    messages: Message[];
  }>,
): Message[] => {
  const newMessages = [...messages];

  // Find and update the subagent block
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const message = newMessages[i];
    if (message.role === "assistant") {
      for (const block of message.blocks) {
        if (block.type === "subagent" && block.subagentId === subagentId) {
          if (updates.status !== undefined) {
            block.status = updates.status;
          }
          if (updates.messages !== undefined) {
            block.messages = updates.messages;
          }
          return newMessages;
        }
      }
    }
  }

  return newMessages;
};

/**
 * Removes the last user message from the messages array
 * Used for hook error handling when the user prompt needs to be erased
 */
export const removeLastUserMessage = (messages: Message[]): Message[] => {
  const newMessages = [...messages];

  // Find the index of the last user message
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "user") {
      // Remove the user message at index i
      newMessages.splice(i, 1);
      break;
    }
  }

  return newMessages;
};

import { randomUUID } from "crypto";
import type { Message, Usage, ToolBlock } from "../types/index.js";
import { MessageSource } from "../types/index.js";
import { readFileSync } from "fs";
import { extname } from "path";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import { logger } from "./globalLogger.js";

// Base user message parameters interface
export interface UserMessageParams {
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  source?: MessageSource;
  isMeta?: boolean;
}

// Parameter interfaces for message operations
export interface AddUserMessageParams extends UserMessageParams {
  messages: Message[];
  id?: string;
}

export interface AddSlashParams {
  messages: Message[];
  command: string;
  args?: string;
  content?: string;
  id?: string;
}

export interface UpdateSlashParams {
  messages: Message[];
  command: string;
  messageId?: string;
  args?: string;
  content?: string;
  result?: string;
  stage?: "running" | "success" | "error" | "aborted";
  error?: string;
  shortResult?: string;
}

export interface UpdateToolBlockParams {
  messages: Message[];
  id: string;
  messageId?: string; // Optional message ID to target a specific message
  parameters?: string;
  result?: string;
  success?: boolean;
  error?: string;
  /**
   * Tool execution stage:
   * - 'start': Tool call initiated during AI streaming
   * - 'streaming': Tool parameters being received incrementally
   * - 'running': Tool execution in progress
   * - 'end': Tool execution completed with final result
   */
  stage?: "start" | "streaming" | "running" | "end";
  name?: string;
  shortResult?: string;
  startLineNumber?: number;
  images?: Array<{ data: string; mediaType?: string }>;
  compactParams?: string;
  parametersChunk?: string; // Incremental parameter updates for streaming
  isManuallyBackgrounded?: boolean;
}

// Agent specific interfaces (without messages parameter)
export type AgentToolBlockUpdateParams = Omit<
  UpdateToolBlockParams,
  "messages"
>;

export interface AddErrorBlockParams {
  messages: Message[];
  error: string;
}

export interface AddBangParams {
  messages: Message[];
  command: string;
}

export interface UpdateBangParams {
  messages: Message[];
  command: string;
  output: string;
}

export interface CompleteBangParams {
  messages: Message[];
  command: string;
  exitCode: number;
  output?: string;
}

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
  } catch (error) {
    logger.error(`Failed to convert image to base64: ${imagePath}`, error);
    // Return an error placeholder or throw error
    return `data:image/png;base64,`; // Empty base64, avoid program crash
  }
};

export const generateMessageId = (): string => `msg-${randomUUID()}`;

// Add user message
export const addUserMessageToMessages = ({
  messages,
  content,
  images,
  source,
  id,
  isMeta,
}: AddUserMessageParams): Message[] => {
  const blocks: Message["blocks"] = [];

  // Create text block with optional source
  const textBlock = {
    type: "text" as const,
    content,
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
    id: id || generateMessageId(),
    role: "user",
    blocks,
    ...(isMeta !== undefined && { isMeta }),
  };
  return [...messages, userMessage];
};

/**
 * Add a slash command message to the conversation.
 */
export const addSlashMessageToMessages = ({
  messages,
  command,
  args,
  content,
  id,
}: AddSlashParams): Message[] => {
  const slashMessage: Message = {
    id: id || generateMessageId(),
    role: "user",
    blocks: [
      {
        type: "slash",
        command,
        args,
        content,
        stage: "running",
      },
    ],
  };
  return [...messages, slashMessage];
};

/**
 * Update a slash block in a message.
 */
export const updateSlashBlockInMessage = ({
  messages,
  command,
  messageId,
  args,
  content,
  result,
  stage,
  error,
  shortResult,
}: UpdateSlashParams): Message[] => {
  const newMessages = [...messages];

  // If messageId is provided, target that specific message
  if (messageId) {
    const messageIndex = newMessages.findIndex((msg) => msg.id === messageId);
    if (messageIndex !== -1) {
      const slashBlockIndex = newMessages[messageIndex].blocks.findIndex(
        (block) => block.type === "slash" && block.command === command,
      );

      if (slashBlockIndex !== -1) {
        const slashBlock = newMessages[messageIndex].blocks[slashBlockIndex];
        if (slashBlock.type === "slash") {
          if (args !== undefined) slashBlock.args = args;
          if (content !== undefined) slashBlock.content = content;
          if (result !== undefined) slashBlock.result = result;
          if (stage !== undefined) slashBlock.stage = stage;
          if (error !== undefined) slashBlock.error = error;
          if (shortResult !== undefined) slashBlock.shortResult = shortResult;
        }
      }
    }
    return newMessages;
  }

  // Find the last user message with a slash block for this command
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i];
    if (msg.role === "user") {
      const slashBlockIndex = msg.blocks.findIndex(
        (block) => block.type === "slash" && block.command === command,
      );
      if (slashBlockIndex !== -1) {
        const slashBlock = msg.blocks[slashBlockIndex];
        if (slashBlock.type === "slash") {
          if (args !== undefined) slashBlock.args = args;
          if (content !== undefined) slashBlock.content = content;
          if (result !== undefined) slashBlock.result = result;
          if (stage !== undefined) slashBlock.stage = stage;
          if (error !== undefined) slashBlock.error = error;
          if (shortResult !== undefined) slashBlock.shortResult = shortResult;
        }
        break;
      }
    }
  }
  return newMessages;
};

/**
 * Update a user message's content by its ID.
 */
export const updateUserMessageInMessages = (
  messages: Message[],
  id: string,
  params: Partial<UserMessageParams>,
): Message[] => {
  return messages.map((msg) => {
    if (msg.id === id && msg.role === "user") {
      const newBlocks = msg.blocks.map((block) => {
        if (block.type === "text") {
          return {
            ...block,
            ...(params.content !== undefined && { content: params.content }),
            ...(params.source !== undefined && { source: params.source }),
          };
        }
        return block;
      });
      return {
        ...msg,
        blocks: newBlocks,
        ...(params.isMeta !== undefined && { isMeta: params.isMeta }),
      };
    }
    return msg;
  });
};

// Add assistant message (support one-time addition of answer and tool calls)
export const addAssistantMessageToMessages = (
  messages: Message[],
  content?: string,
  toolCalls?: ChatCompletionMessageFunctionToolCall[],
  usage?: Usage,
  additionalFields?: Record<string, unknown>,
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
        stage: "start",
      });
    });
  }

  const initialAssistantMessage: Message = {
    id: generateMessageId(),
    role: "assistant",
    blocks,
    usage, // Include usage data if provided
    ...(additionalFields ? { additionalFields: { ...additionalFields } } : {}),
  };

  return [...messages, initialAssistantMessage];
};

/**
 * Add a tool block to a specific message by ID.
 */
export const addToolBlockToMessageInMessages = (
  messages: Message[],
  messageId: string,
  params: Omit<AgentToolBlockUpdateParams, "id">,
): { messages: Message[]; toolBlockId: string } => {
  const toolBlockId = randomUUID();
  const newMessages = messages.map((msg) => {
    if (msg.id === messageId) {
      return {
        ...msg,
        blocks: [
          ...msg.blocks,
          {
            type: "tool" as const,
            id: toolBlockId,
            name: params.name || "unknown",
            parameters: params.parameters || "",
            result: params.result || "",
            stage: "start",
            ...params,
          } as ToolBlock,
        ],
      };
    }
    return msg;
  });
  return { messages: newMessages, toolBlockId };
};

// Update Tool Block of the last assistant or user message
export const updateToolBlockInMessage = ({
  messages,
  id,
  messageId,
  parameters,
  result,
  success,
  error,
  stage,
  name,
  shortResult,
  startLineNumber,
  images,
  compactParams,
  parametersChunk,
  isManuallyBackgrounded,
}: UpdateToolBlockParams): Message[] => {
  const newMessages = [...messages];

  // If messageId is provided, target that specific message
  if (messageId) {
    const messageIndex = newMessages.findIndex((msg) => msg.id === messageId);
    if (messageIndex !== -1) {
      const toolBlockIndex = newMessages[messageIndex].blocks.findIndex(
        (block) => block.type === "tool" && block.id === id,
      );

      if (toolBlockIndex !== -1) {
        const toolBlock = newMessages[messageIndex].blocks[toolBlockIndex];
        if (toolBlock.type === "tool") {
          if (parameters !== undefined) toolBlock.parameters = parameters;
          if (result !== undefined) toolBlock.result = result;
          if (shortResult !== undefined) toolBlock.shortResult = shortResult;
          if (startLineNumber !== undefined)
            toolBlock.startLineNumber = startLineNumber;
          if (images !== undefined) toolBlock.images = images;
          if (success !== undefined) toolBlock.success = success;
          if (error !== undefined) toolBlock.error = error;
          if (stage !== undefined) toolBlock.stage = stage;
          if (compactParams !== undefined)
            toolBlock.compactParams = compactParams;
          if (parametersChunk !== undefined)
            toolBlock.parametersChunk = parametersChunk;
          if (isManuallyBackgrounded !== undefined)
            toolBlock.isManuallyBackgrounded = isManuallyBackgrounded;
        }
      }
    }
    return newMessages;
  }

  // Find the last assistant or user message
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "assistant" || newMessages[i].role === "user") {
      const toolBlockIndex = newMessages[i].blocks.findIndex(
        (block) => block.type === "tool" && block.id === id,
      );

      if (toolBlockIndex !== -1) {
        const toolBlock = newMessages[i].blocks[toolBlockIndex];
        if (toolBlock.type === "tool") {
          if (parameters !== undefined) toolBlock.parameters = parameters;
          if (result !== undefined) toolBlock.result = result;
          if (shortResult !== undefined) toolBlock.shortResult = shortResult;
          if (startLineNumber !== undefined)
            toolBlock.startLineNumber = startLineNumber;
          if (images !== undefined) toolBlock.images = images; // Add image data update
          if (success !== undefined) toolBlock.success = success;
          if (error !== undefined) toolBlock.error = error;
          if (stage !== undefined) toolBlock.stage = stage;
          if (compactParams !== undefined)
            toolBlock.compactParams = compactParams;
          if (parametersChunk !== undefined)
            toolBlock.parametersChunk = parametersChunk;
          if (isManuallyBackgrounded !== undefined)
            toolBlock.isManuallyBackgrounded = isManuallyBackgrounded;
        }
        break; // Found and updated, stop searching
      } else if (newMessages[i].role === "assistant") {
        // If existing block not found in assistant message, create new one
        // This handles cases where we're streaming tool parameters before execution
        newMessages[i].blocks.push({
          type: "tool",
          parameters: parameters,
          result: result || "",
          shortResult: shortResult,
          startLineNumber: startLineNumber,
          images: images, // Add image data
          id: id,
          name: name || "unknown",
          success: success,
          error: error,
          stage: stage ?? "start",
          compactParams: compactParams,
          parametersChunk: parametersChunk,
          isManuallyBackgrounded: isManuallyBackgrounded,
        });
        break; // Created and added, stop searching
      }
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
      id: generateMessageId(),
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

// Add bang block to message list
export const addBangMessage = ({
  messages,
  command,
}: AddBangParams): Message[] => {
  const outputMessage: Message = {
    id: generateMessageId(),
    role: "user",
    blocks: [
      {
        type: "bang",
        command,
        output: "",
        isRunning: true,
        exitCode: null,
      },
    ],
  };

  return [...messages, outputMessage];
};

// Update output content of bang block
export const updateBangInMessage = ({
  messages,
  command,
  output,
}: UpdateBangParams): Message[] => {
  const newMessages = [...messages];
  // Find the last user message with a bang block for this command
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i];
    if (msg.role === "user") {
      const commandBlock = msg.blocks.find(
        (block) =>
          block.type === "bang" && block.command === command && block.isRunning,
      );
      if (commandBlock && commandBlock.type === "bang") {
        commandBlock.output = output.trim();
        break;
      }
    }
  }
  return newMessages;
};

// Complete bang execution, update exit status
export const completeBangInMessage = ({
  messages,
  command,
  exitCode,
  output,
}: CompleteBangParams): Message[] => {
  const newMessages = [...messages];
  // Find the last user message with a bang block for this command
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i];
    if (msg.role === "user") {
      const commandBlock = msg.blocks.find(
        (block) =>
          block.type === "bang" && block.command === command && block.isRunning,
      );
      if (commandBlock && commandBlock.type === "bang") {
        commandBlock.isRunning = false;
        commandBlock.exitCode = exitCode;
        if (output !== undefined) {
          commandBlock.output = output.trim();
        }
        break;
      }
    }
  }
  return newMessages;
};

/**
 * Helper to count tool blocks in messages
 */
export function countToolBlocks(messages: Message[]): number {
  let toolCount = 0;
  messages.forEach((msg) => {
    msg.blocks.forEach((block) => {
      if (block.type === "tool") {
        toolCount++;
      }
    });
  });
  return toolCount;
}

/**
 * Remove the last user message from the conversation
 * Used for hook error handling when the user prompt needs to be erased
 */
export const removeLastUserMessage = (messages: Message[]): Message[] => {
  const newMessages = [...messages];
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === "user") {
      newMessages.splice(i, 1);
      break;
    }
  }
  return newMessages;
};

/**
 * Efficiently clone a message for UI freezing.
 * Clones the message object and its blocks array, but reuses string references.
 */
export function cloneMessage(message: Message): Message {
  return {
    ...message,
    blocks: message.blocks.map((block) => {
      const clonedBlock = { ...block };
      // Deep clone arrays/objects within blocks if they exist
      if (clonedBlock.type === "tool" && clonedBlock.images) {
        clonedBlock.images = clonedBlock.images.map((img) => ({ ...img }));
      } else if (clonedBlock.type === "image" && clonedBlock.imageUrls) {
        clonedBlock.imageUrls = [...clonedBlock.imageUrls];
      } else if (clonedBlock.type === "file_history" && clonedBlock.snapshots) {
        clonedBlock.snapshots = clonedBlock.snapshots.map((s) => ({ ...s }));
      }
      return clonedBlock;
    }) as Message["blocks"],
    // Clone additionalFields if it exists
    ...(message.additionalFields
      ? { additionalFields: { ...message.additionalFields } }
      : {}),
  };
}

/**
 * Helper to format tool and token summary
 */
export function formatToolTokenSummary(
  toolCount: number,
  tokens: number,
): string {
  if (toolCount === 0) {
    return "";
  }
  let summary = `(${toolCount} tools`;
  if (tokens > 0) {
    summary += ` | ${tokens.toLocaleString()} tokens`;
  }
  summary += ")";
  return summary;
}

/**
 * Extracts displayable text from a Message object, handling various block types.
 * Returns the first available content block.
 */
export function getMessageContent(message: Message): string {
  // Find first available content block
  const textBlock = message.blocks.find((block) => block.type === "text");
  if (textBlock && "content" in textBlock) {
    return textBlock.content;
  }

  const slashBlock = message.blocks.find((block) => block.type === "slash");
  if (slashBlock && "command" in slashBlock) {
    return `/${slashBlock.command}${slashBlock.args ? ` ${slashBlock.args}` : ""}`;
  }

  const bangBlock = message.blocks.find((block) => block.type === "bang");
  if (bangBlock && "command" in bangBlock) {
    return `!${bangBlock.command}`;
  }

  const compressBlock = message.blocks.find(
    (block) => block.type === "compress",
  );
  if (compressBlock && "content" in compressBlock) {
    return compressBlock.content;
  }

  return "";
}

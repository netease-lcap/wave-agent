import type { ChatCompletionMessageParam, ModelId } from "../types/common";
import { VALID_MODEL_IDS, DEFAULT_MODEL_ID } from "../types/common";
import { toolRegistry } from "../plugins/tools";
import { logger } from "@/utils/logger";
import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";

// Initialize OpenAI client with environment variables
const openai = new OpenAI({
  apiKey: process.env.AIGW_TOKEN,
  baseURL: process.env.AIGW_URL,
});

// 验证模型ID是否有效
function isValidModelId(modelId: string): modelId is ModelId {
  return VALID_MODEL_IDS.includes(modelId as ModelId);
}

export interface CallAgentOptions {
  messages: ChatCompletionMessageParam[];
  sessionId?: string;
  abortSignal?: AbortSignal;
}

export interface CallAgentResult {
  content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GenerateCommitMessageOptions {
  diff: string;
  abortSignal?: AbortSignal;
}

export interface ApplyEditOptions {
  targetFile: string;
  instructions: string;
  codeEdit: string;
  abortSignal?: AbortSignal;
}

export async function applyEdit(options: ApplyEditOptions): Promise<string> {
  const { targetFile, instructions, codeEdit, abortSignal } = options;

  // 如果 targetFile 为空字符串，说明是新建文件，直接返回 codeEdit
  if (!targetFile || targetFile.trim() === "") {
    return codeEdit;
  }

  // 使用 OpenAI 来处理文件编辑
  try {
    const response = await openai.chat.completions.create(
      {
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a code editor. Apply the given instructions to edit the code. Return only the edited content without any explanations.`,
          },
          {
            role: "user",
            content: `File: ${targetFile}\n\nInstructions: ${instructions}\n\nCode to edit:\n${codeEdit}`,
          },
        ],
        temperature: 0.1,
      },
      {
        signal: abortSignal,
      },
    );

    return response.choices[0]?.message?.content || codeEdit;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request was aborted");
    }
    logger.error("Failed to apply edit:", error);
    return codeEdit; // 返回原始内容作为后备
  }
}

export async function generateCommitMessage(
  options: GenerateCommitMessageOptions,
): Promise<string> {
  const { diff, abortSignal } = options;

  try {
    const response = await openai.chat.completions.create(
      {
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Generate a single, concise commit message for the following git diff. Return only the commit message without any explanations. Keep it under 50 characters and use conventional commit format.`,
          },
          {
            role: "user",
            content: diff,
          },
        ],
        temperature: 0.3,
        max_tokens: 100,
      },
      {
        signal: abortSignal,
      },
    );

    return response.choices[0]?.message?.content?.trim() || "Update files";
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request was aborted");
    }
    logger.error("Failed to generate commit message:", error);
    return "Update files";
  }
}

export async function callAgent(
  options: CallAgentOptions,
): Promise<CallAgentResult> {
  const { messages, abortSignal } = options;

  // 获取模型配置
  const envModel = process.env.AIGW_MODEL;
  const modelId: ModelId =
    envModel && isValidModelId(envModel)
      ? (envModel as ModelId)
      : DEFAULT_MODEL_ID;

  try {
    // 添加系统提示词
    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "system",
      content: `You are a professional web development expert.

## TODOs
⏳ Pending tasks
✅ Completed tasks

## Tool Usage Guidelines:

- Check that all required parameters for each tool call are provided or can reasonably be inferred from context
- If there are missing values for required parameters, ask the user to supply these values before proceeding
- If the user provides a specific value for a parameter (especially in quotes), use that value EXACTLY
- DO NOT make up values for or ask about optional parameters
- Carefully analyze descriptive terms in the request as they may indicate required parameter values

## TODO Management:

- Update TODO status: ⏳ for pending, ✅ for completed
- **IMPORTANT**: After completing each item, show the updated TODO list
- Keep TODO descriptions brief and clear

Remember: Execute tasks systematically and show updated TODOs after each completion.`,
    };

    // ChatCompletionMessageParam[] 已经是 OpenAI 格式，添加系统提示词到开头
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [systemMessage, ...messages];

    // 获取工具配置
    const tools = toolRegistry.getToolsConfig();

    // 调用 OpenAI API（非流式）
    const response = await openai.chat.completions.create(
      {
        model: modelId,
        messages: openaiMessages,
        tools,
        temperature: 0,
        max_completion_tokens: 8192,
      },
      {
        signal: abortSignal,
      },
    );

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("No response from OpenAI");
    }

    const result: CallAgentResult = {};

    // 返回内容
    if (choice.message.content) {
      result.content = choice.message.content;
    }

    // 返回工具调用
    if (choice.message.tool_calls) {
      result.tool_calls = choice.message.tool_calls;
    }

    // 返回 token 使用信息
    if (response.usage) {
      result.usage = {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      };
    }

    return result;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request was aborted");
    }
    logger.error("Failed to call OpenAI:", error);
    throw error;
  }
}

export interface CompressMessagesOptions {
  messages: ChatCompletionMessageParam[];
  abortSignal?: AbortSignal;
}

export async function compressMessages(
  options: CompressMessagesOptions,
): Promise<string> {
  const { messages, abortSignal } = options;

  try {
    const response = await openai.chat.completions.create(
      {
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a conversation history compression expert. Please compress the following conversation history into a concise summary that retains key information.

Requirements:
1. Preserve important technical discussion points and code examples
2. Preserve key file operations, modifications, and their locations
3. Preserve main user requirements and assistant solutions with outcomes
4. Preserve error messages and debugging steps if any
5. Use third-person summary format
6. Target 300-500 words (adjust based on content complexity)
7. Respond in the same language as the original conversation
8. If the conversation involves multiple topics, organize by sections`,
          },
          {
            role: "user",
            content: `Please compress the following conversation history:`,
          },
          ...messages,
        ],
        temperature: 0.1,
        max_tokens: 800,
      },
      {
        signal: abortSignal,
      },
    );

    return (
      response.choices[0]?.message?.content?.trim() ||
      "Failed to compress conversation history"
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Compression request was aborted");
    }
    logger.error("Failed to compress messages:", error);
    return "Failed to compress conversation history";
  }
}

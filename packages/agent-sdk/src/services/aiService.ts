import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources.js";
import { FAST_MODEL_ID, AGENT_MODEL_ID } from "@/utils/constants.js";

/**
 * 模型配置类型，基于 OpenAI 的参数但排除 messages
 */
type ModelConfig = Omit<ChatCompletionCreateParamsNonStreaming, "messages">;

/**
 * 根据模型名称获取特定的配置参数
 * @param modelName 模型名称
 * @param baseConfig 基础配置
 * @returns 配置好的模型参数
 */
function getModelConfig(
  modelName: string,
  baseConfig: Partial<ModelConfig> = {},
): ModelConfig {
  const config: ModelConfig = {
    model: modelName,
    stream: false,
    ...baseConfig,
  };

  // 针对特定模型的配置规则
  if (modelName.includes("gpt-5-codex")) {
    // gpt-5-codex 模型设置 temperature 为 undefined
    config.temperature = undefined;
  }

  return config;
}

// Initialize OpenAI client with environment variables
const openai = new OpenAI({
  apiKey: process.env.AIGW_TOKEN,
  baseURL: process.env.AIGW_URL,
});

export interface CallAgentOptions {
  messages: ChatCompletionMessageParam[];
  sessionId?: string;
  abortSignal?: AbortSignal;
  memory?: string; // 记忆内容参数，从 WAVE.md 读取的内容
  workdir?: string; // 当前工作目录
  tools?: ChatCompletionFunctionTool[]; // 工具配置
  model?: string; // 自定义模型
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

export async function callAgent(
  options: CallAgentOptions,
): Promise<CallAgentResult> {
  const { messages, abortSignal, memory, workdir, tools, model } = options;

  try {
    // 构建系统提示词内容
    let systemContent = `You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

## Current Working Directory
${workdir || process.cwd()}
`;

    // 如果有记忆内容，添加到系统提示词中
    if (memory && memory.trim()) {
      systemContent += `\n\n## Memory Context\n\nThe following is important context and memory from previous interactions:\n\n${memory}`;
    }

    // 添加系统提示词
    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "system",
      content: systemContent,
    };

    // ChatCompletionMessageParam[] 已经是 OpenAI 格式，添加系统提示词到开头
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [systemMessage, ...messages];

    // 获取模型配置
    const modelConfig = getModelConfig(model || AGENT_MODEL_ID, {
      temperature: 0,
      max_completion_tokens: 32768,
    });

    // 准备 API 调用参数
    const createParams: ChatCompletionCreateParamsNonStreaming = {
      ...modelConfig,
      messages: openaiMessages,
    };

    // 只有当 tools 存在时才添加到参数中
    if (tools && tools.length > 0) {
      createParams.tools = tools;
    }

    // 调用 OpenAI API（非流式）
    const response = await openai.chat.completions.create(createParams, {
      signal: abortSignal,
    });

    const finalMessage = response.choices[0]?.message;
    const totalUsage = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined;

    const result: CallAgentResult = {};

    // 返回内容
    if (finalMessage?.content) {
      result.content = finalMessage.content;
    }

    // 返回工具调用
    if (finalMessage?.tool_calls && finalMessage.tool_calls.length > 0) {
      result.tool_calls = finalMessage.tool_calls;
    }

    // 返回 token 使用信息
    if (totalUsage) {
      result.usage = totalUsage;
    }

    return result;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request was aborted");
    }
    // // logger.error("Failed to call OpenAI:", error);
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

  // 获取模型配置
  const modelConfig = getModelConfig(FAST_MODEL_ID, {
    temperature: 0.1,
    max_tokens: 1500,
  });

  try {
    const response = await openai.chat.completions.create(
      {
        ...modelConfig,
        messages: [
          {
            role: "system",
            content: `You are an expert conversation history compression specialist. Your task is to create comprehensive yet concise summaries that preserve critical development context.

## Primary Request and Intent
Compress conversation history while maintaining all essential technical and procedural information.

## Key Technical Concepts
- Code modifications and file operations
- Tool executions and their results  
- Error handling and debugging processes
- User requirements and assistant solutions
- Technical discussions and decisions

## Compression Strategy
1. **Preserve Critical Information**:
   - All file paths, function names, and code examples
   - Tool execution results and outcomes
   - Error messages and resolution steps
   - User requirements and implementation approaches
   - Technical decisions and their reasoning

2. **Structure Organization**:
   - Group related actions and discussions
   - Maintain chronological flow for complex operations
   - Separate different technical topics clearly
   
3. **Context Preservation**:
   - Keep enough detail for future reference
   - Maintain relationships between requests and solutions
   - Preserve debugging context and error resolution paths

## Output Requirements:
- Use third-person narrative format
- Target 300-800 words (scale based on complexity)
- Maintain the original conversation language
- Structure with clear sections for multi-topic conversations
- Focus on actionable information and outcomes

## Format Template:
For technical conversations, structure as:
- **User Requests**: Key requirements and goals
- **Technical Implementation**: Code changes, file operations, tool usage
- **Problem Resolution**: Errors encountered and solutions applied
- **Outcomes**: Final results and current state`,
          },
          ...messages,
          {
            role: "user",
            content: `Please compress this conversation following the structured approach. Focus on preserving all technical details, file operations, and problem-solving context while creating a concise summary.`,
          },
        ],
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
    // // logger.error("Failed to compress messages:", error);
    return "Failed to compress conversation history";
  }
}

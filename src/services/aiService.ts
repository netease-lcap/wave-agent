import { toolRegistry } from "../tools";
import { logger } from "@/utils/logger";
import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";
import { FunctionToolCall } from "openai/resources/beta/threads/runs.mjs";
import { ChatCompletionMessageParam } from "openai/resources.js";
import { FAST_MODEL_ID, AGENT_MODEL_ID } from "@/utils/constants";

/**
 * 模型配置类型，基于 OpenAI 的参数但排除 messages 和 stream
 */
type ModelConfig = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParams,
  "messages" | "stream"
>;

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
  memory?: string; // 记忆内容参数，从 LCAP.md 读取的内容
  onContentUpdate?: (content: string) => void; // 流式更新内容回调
  onToolCallUpdate?: (toolCall: FunctionToolCall, isComplete: boolean) => void; // 工具调用更新回调
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
  codeEdit: string;
  abortSignal?: AbortSignal;
}

export async function applyEdit(options: ApplyEditOptions): Promise<string> {
  const { targetFile, codeEdit, abortSignal } = options;

  // 如果 targetFile 为空字符串，说明是新建文件，直接返回 codeEdit
  if (!targetFile || targetFile.trim() === "") {
    return codeEdit;
  }

  // 使用 OpenAI 来处理文件编辑
  try {
    // 使用固定的模型，不使用环境变量
    const modelConfig = getModelConfig(FAST_MODEL_ID, {
      temperature: 0.1,
    });

    const response = await openai.chat.completions.create(
      {
        ...modelConfig,
        messages: [
          {
            role: "system",
            content: `You are a precise code editing assistant. Your task is to apply the requested edit to the original file content.

CRITICAL INSTRUCTIONS:
1. The user will provide ORIGINAL FILE CONTENT and CODE EDIT TO APPLY
2. The CODE EDIT uses special comments like "// ... existing code ..." to indicate preserved sections
3. You must carefully merge the edit with the original content
4. Preserve ALL existing code that is marked with "// ... existing code ..." comments
5. Replace ONLY the specific sections indicated by the edit
6. Maintain proper indentation and formatting
7. Return the COMPLETE final file content (not just the changes)

EDIT RULES:
- When you see "// ... existing code ...", preserve that exact section from the original file
- Apply edits in the exact sequence they appear
- Do not add, remove, or modify any code not explicitly indicated in the edit
- Maintain the original file's structure and formatting
- If the edit shows specific lines of code, replace them exactly as shown

Return only the complete, final file content without any explanations or markdown formatting.`,
          },
          {
            role: "user",
            content: `ORIGINAL FILE CONTENT:
${targetFile}

CODE EDIT TO APPLY:
${codeEdit}

Apply the edit and return the complete final file content:`,
          },
        ],
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
    // 使用固定的模型，不使用环境变量
    const modelConfig = getModelConfig(FAST_MODEL_ID, {
      temperature: 0.3,
      max_tokens: 100,
    });

    const response = await openai.chat.completions.create(
      {
        ...modelConfig,
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
  const { messages, abortSignal, memory, onContentUpdate, onToolCallUpdate } =
    options;

  try {
    // 构建系统提示词内容
    let systemContent = `You are a professional web development expert.

## TODOs
⏳ Pending tasks
✅ Completed tasks

## Tool Usage Guidelines:

- Check that all required parameters for each tool call are provided or can reasonably be inferred from context
- If there are missing values for required parameters, ask the user to supply these values before proceeding
- If the user provides a specific value for a parameter (especially in quotes), use that value EXACTLY
- DO NOT make up values for or ask about optional parameters
- Carefully analyze descriptive terms in the request as they may indicate required parameter values
- Make multiple tool calls in a single response whenever possible

## TODO Management:

- Update TODO status: ⏳ for pending, ✅ for completed
- **IMPORTANT**: After completing each item, show the updated TODO list
- Keep TODO descriptions brief and clear

Remember: Execute tasks systematically and show updated TODOs after each completion.`;

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

    // 获取工具配置
    const tools = toolRegistry.getToolsConfig();

    // 获取模型配置
    const modelConfig = getModelConfig(AGENT_MODEL_ID, {
      temperature: 0,
      max_completion_tokens: 32768,
    });

    // 调用 OpenAI API（流式）
    const stream = await openai.chat.completions.create(
      {
        ...modelConfig,
        messages: openaiMessages,
        tools,
        stream: true,
      },
      {
        signal: abortSignal,
      },
    );

    // 构建最终消息
    const finalMessage: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content: "",
      refusal: null,
      tool_calls: [],
    };

    let accumulatedContent = "";
    let totalUsage:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | undefined;

    // 处理流式响应
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      // 处理内容流
      if (choice.delta.content) {
        accumulatedContent += choice.delta.content;
        finalMessage.content += choice.delta.content;

        // 实时回调内容更新
        if (onContentUpdate) {
          onContentUpdate(accumulatedContent);
        }
      }

      // 处理工具调用流
      if (choice.delta.tool_calls) {
        for (const toolCallDelta of choice.delta.tool_calls) {
          // 使用工具调用的 ID 来标识，而不是依赖 index
          let existingToolCall: ChatCompletionMessageToolCall | undefined;

          // 如果有 ID，尝试找到现有的工具调用
          if (toolCallDelta.id) {
            existingToolCall = finalMessage.tool_calls!.find(
              (tc) => tc.id === toolCallDelta.id,
            );
          } else {
            // 如果没有 ID，取最后一个工具调用
            existingToolCall =
              finalMessage.tool_calls!.length > 0
                ? finalMessage.tool_calls![finalMessage.tool_calls!.length - 1]
                : undefined;
          }

          // 如果没有找到现有的工具调用，创建新的
          if (!existingToolCall) {
            existingToolCall = {
              id: toolCallDelta.id || "",
              type: "function",
              function: {
                name: "",
                arguments: "",
              },
            };
            finalMessage.tool_calls!.push(existingToolCall);
          }

          // 更新工具调用信息
          if (toolCallDelta.id) {
            existingToolCall.id = toolCallDelta.id;
          }
          if (toolCallDelta.type) {
            existingToolCall.type = toolCallDelta.type;
          }
          if (toolCallDelta.function?.name) {
            (existingToolCall as FunctionToolCall).function.name =
              toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            (existingToolCall as FunctionToolCall).function.arguments +=
              toolCallDelta.function.arguments;
          }

          // 实时回调工具调用更新
          if (onToolCallUpdate) {
            const functionToolCall = existingToolCall as FunctionToolCall;
            // 判断工具调用是否完整（有id、name，且arguments看起来完整）
            const isComplete = !!(
              functionToolCall.id &&
              functionToolCall.function?.name &&
              functionToolCall.function?.arguments &&
              // 简单检查arguments是否可能完整（以}结尾）
              functionToolCall.function.arguments.trim().endsWith("}")
            );
            onToolCallUpdate(functionToolCall, isComplete);
          }
        }
      }

      // 处理使用统计
      if (chunk.usage) {
        totalUsage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }
    }

    const result: CallAgentResult = {};

    // 返回内容
    if (finalMessage.content) {
      result.content = finalMessage.content;
    }

    // 返回工具调用
    if (finalMessage.tool_calls && finalMessage.tool_calls.length > 0) {
      // 过滤掉空的工具调用
      const validToolCalls = finalMessage.tool_calls.filter((tc) => {
        const functionTc = tc as FunctionToolCall;
        return (
          tc.id && functionTc.function?.name && functionTc.function?.arguments
        );
      });
      result.tool_calls = validToolCalls;
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

  // 获取模型配置
  const modelConfig = getModelConfig(AGENT_MODEL_ID, {
    temperature: 0.1,
    max_tokens: 8192,
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
    logger.error("Failed to compress messages:", error);
    return "Failed to compress conversation history";
  }
}

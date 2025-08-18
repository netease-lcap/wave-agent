import type { ChatCompletionMessageParam, ModelId } from "../types/common";
import { DEFAULT_MODEL_ID } from "../types/common";
import { toolRegistry } from "../plugins/tools";
import { logger } from "@/utils/logger";
import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";

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
            content: `You are an expert code editor that applies precise edits to existing files.

CRITICAL INSTRUCTIONS:
1. You will receive the ORIGINAL file content and a CODE EDIT that uses "// ... existing code ..." markers
2. Apply the edit by replacing the markers with the actual existing code from the original file
3. The "// ... existing code ..." markers indicate where unchanged code should be preserved
4. Return ONLY the final edited file content - no explanations, no markdown blocks
5. Maintain exact indentation, spacing, and formatting from the original file
6. Ensure the output is valid, complete code that can be written directly to the file

PROCESS:
- Parse the code edit structure with "// ... existing code ..." markers
- Replace each marker with the corresponding original code sections
- Apply the actual edits (new/modified lines) between the markers
- Output the complete, final file content`,
          },
          {
            role: "user",
            content: `ORIGINAL FILE CONTENT:
${targetFile}

INSTRUCTIONS: ${instructions}

CODE EDIT TO APPLY:
${codeEdit}

Apply the edit and return the complete final file content:`,
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
  const { messages, abortSignal, memory } = options;

  // 获取模型配置
  const envModel = process.env.AIGW_MODEL;
  const modelId: ModelId = (envModel as ModelId) || DEFAULT_MODEL_ID;

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
        temperature: 0.1,
        max_tokens: 1500,
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

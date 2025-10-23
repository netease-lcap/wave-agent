import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources.js";
import { FAST_MODEL_ID, AGENT_MODEL_ID } from "@/utils/constants.js";

/**
 * Model configuration type, based on OpenAI parameters but excluding messages
 */
type ModelConfig = Omit<ChatCompletionCreateParamsNonStreaming, "messages">;

/**
 * Get specific configuration parameters based on model name
 * @param modelName Model name
 * @param baseConfig Base configuration
 * @returns Configured model parameters
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

  // Configuration rules for specific models
  if (modelName.includes("gpt-5-codex")) {
    // gpt-5-codex model sets temperature to undefined
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
  memory?: string; // Memory content parameter, content read from WAVE.md
  workdir: string; // Current working directory
  tools?: ChatCompletionFunctionTool[]; // Tool configuration
  model?: string; // Custom model
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
    // Build system prompt content
    let systemContent = `You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

## Current Working Directory
${workdir}
`;

    // If there is memory content, add it to the system prompt
    if (memory && memory.trim()) {
      systemContent += `\n\n## Memory Context\n\nThe following is important context and memory from previous interactions:\n\n${memory}`;
    }

    // Add system prompt
    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "system",
      content: systemContent,
    };

    // ChatCompletionMessageParam[] is already in OpenAI format, add system prompt to the beginning
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [systemMessage, ...messages];

    // Get model configuration
    const modelConfig = getModelConfig(model || AGENT_MODEL_ID, {
      temperature: 0,
      max_completion_tokens: 32768,
    });

    // Prepare API call parameters
    const createParams: ChatCompletionCreateParamsNonStreaming = {
      ...modelConfig,
      messages: openaiMessages,
    };

    // Only add tools if they exist
    if (tools && tools.length > 0) {
      createParams.tools = tools;
    }

    // Call OpenAI API (non-streaming)
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

    // Return content
    if (finalMessage?.content) {
      result.content = finalMessage.content;
    }

    // Return tool call
    if (finalMessage?.tool_calls && finalMessage.tool_calls.length > 0) {
      result.tool_calls = finalMessage.tool_calls;
    }

    // Return token usage information
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

  // Get model configuration
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

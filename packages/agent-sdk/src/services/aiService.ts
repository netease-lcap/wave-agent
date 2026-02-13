import { ChatCompletionMessageToolCall } from "openai/resources";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionChunk,
} from "openai/resources.js";
import { OpenAIClient } from "../utils/openaiClient.js";
import { logger } from "../utils/globalLogger.js";
import type { GatewayConfig, ModelConfig } from "../types/index.js";
import {
  transformMessagesForClaudeCache,
  addCacheControlToLastTool,
  isClaudeModel,
  extendUsageWithCacheMetrics,
  type ClaudeUsage,
} from "../utils/cacheControlUtils.js";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_SYSTEM_PROMPT,
  buildSystemPrompt,
  COMPRESS_MESSAGES_SYSTEM_PROMPT,
} from "../constants/prompts.js";

/**
 * Interface for debug data saved during 400 errors
 */
interface DebugData {
  originalMessages: ChatCompletionMessageParam[];
  timestamp: string;
  model: string;
  workdir: string;
  sessionId?: string;
  gatewayConfig: {
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
  };
  processedMessages?: ChatCompletionMessageParam[];
  createParams?:
    | ChatCompletionCreateParamsNonStreaming
    | ChatCompletionCreateParamsStreaming;
  tools?: ChatCompletionFunctionTool[];
}

/**
 * Interface for error data saved during 400 errors
 */
interface ErrorData {
  error: {
    message?: string;
    status?: number;
    type?: string;
    code?: string;
    body?: unknown;
    stack?: string;
  };
  timestamp: string;
}

/**
 * Use parametersChunk as compact param for better performance
 * Instead of parsing JSON, we use the raw chunk for efficient streaming
 */

/**
 * Check if a directory is a git repository
 * @param dirPath Directory path to check
 * @returns "Yes" if it's a git repo, "No" otherwise
 */
function isGitRepository(dirPath: string): string {
  try {
    // Check if .git directory exists in current directory or any parent directory
    let currentPath = path.resolve(dirPath);
    while (currentPath !== path.dirname(currentPath)) {
      const gitPath = path.join(currentPath, ".git");
      if (fs.existsSync(gitPath)) {
        return "Yes";
      }
      currentPath = path.dirname(currentPath);
    }
    return "No";
  } catch {
    return "No";
  }
}

/**
 * OpenAI model configuration type, based on OpenAI parameters but excluding messages
 */
type OpenAIModelConfig = Omit<
  ChatCompletionCreateParamsNonStreaming,
  "messages"
> & {
  vertexai?: {
    thinking_config: {
      thinking_level: string;
    };
  };
};

/**
 * Get specific configuration parameters based on model name
 * @param modelName Model name
 * @param baseConfig Base configuration
 * @returns Configured model parameters
 */
function getModelConfig(
  modelName: string,
  baseConfig: Partial<OpenAIModelConfig> = {},
): OpenAIModelConfig {
  const config: OpenAIModelConfig = {
    model: modelName,
    stream: false,
    ...baseConfig,
  };

  // Configuration rules for specific models
  if (modelName.includes("gpt-5-codex")) {
    // gpt-5-codex model sets temperature to undefined
    config.temperature = undefined;
  }

  if (modelName.startsWith("gemini-3-flash")) {
    config.vertexai = {
      thinking_config: {
        thinking_level: "minimal",
      },
    };
  }

  return config;
}

export interface CallAgentOptions {
  // Resolved configuration
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;

  // Existing parameters (preserved)
  messages: ChatCompletionMessageParam[];
  sessionId?: string;
  abortSignal?: AbortSignal;
  memory?: string; // Memory content parameter, content read from AGENTS.md
  workdir: string; // Current working directory
  tools?: ChatCompletionFunctionTool[]; // Tool configuration
  model?: string; // Custom model
  systemPrompt?: string; // Custom system prompt
  maxTokens?: number; // Maximum output tokens

  // NEW: Streaming callbacks
  onContentUpdate?: (content: string) => void;
  onToolUpdate?: (toolCall: {
    id: string;
    name: string;
    parameters: string;
    parametersChunk?: string;
    stage?: "start" | "streaming" | "running" | "end";
  }) => void;
  onReasoningUpdate?: (content: string) => void;
}

export interface CallAgentResult {
  content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  reasoning_content?: string;
  usage?: ClaudeUsage;
  finish_reason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "function_call"
    | null;
  response_headers?: Record<string, string>;
  additionalFields?: Record<string, unknown>;
}

export async function callAgent(
  options: CallAgentOptions,
): Promise<CallAgentResult> {
  const {
    gatewayConfig,
    modelConfig,
    messages,
    abortSignal,
    memory,
    workdir,
    tools,
    model,
    systemPrompt,
    onContentUpdate,
    onToolUpdate,
    onReasoningUpdate,
  } = options;

  // Declare variables outside try block for error handling access
  let openaiMessages: ChatCompletionMessageParam[] | undefined;
  let createParams:
    | ChatCompletionCreateParamsNonStreaming
    | ChatCompletionCreateParamsStreaming
    | undefined;
  let processedTools: ChatCompletionFunctionTool[] | undefined;

  try {
    // Create OpenAI client with injected configuration
    const openai = new OpenAIClient({
      apiKey: gatewayConfig.apiKey,
      baseURL: gatewayConfig.baseURL,
      defaultHeaders: gatewayConfig.defaultHeaders,
      fetchOptions: gatewayConfig.fetchOptions,
      fetch: gatewayConfig.fetch,
    });

    // Build system prompt content
    let systemContent = buildSystemPrompt(
      systemPrompt || DEFAULT_SYSTEM_PROMPT,
      tools || [],
    );

    // Always add environment information
    systemContent += `

Here is useful information about the environment you are running in:
<env>
Working directory: ${workdir}
Is directory a git repo: ${isGitRepository(workdir)}
Platform: ${os.platform()}
OS Version: ${os.type()} ${os.release()}
Today's date: ${new Date().toISOString().split("T")[0]}
</env>
`;

    // If there is memory content, add it to the system prompt
    if (memory && memory.trim()) {
      systemContent += `\n## Memory Context\n\nThe following is important context and memory from previous interactions:\n\n${memory}`;
    }

    // Add system prompt
    const systemMessage: ChatCompletionMessageParam = {
      role: "system",
      content: systemContent,
    };

    // ChatCompletionMessageParam[] is already in OpenAI format, add system prompt to the beginning
    openaiMessages = [systemMessage, ...messages];

    // Apply cache control for Claude models
    const currentModel = model || modelConfig.agentModel;
    const resolvedMaxTokens = options.maxTokens ?? modelConfig.maxTokens;

    processedTools = tools;

    if (isClaudeModel(currentModel)) {
      openaiMessages = transformMessagesForClaudeCache(
        openaiMessages,
        currentModel,
      );

      // Apply cache control to tools separately
      if (tools && tools.length > 0) {
        processedTools = addCacheControlToLastTool(tools);
      }
    }

    // Get model configuration - use injected modelConfig with optional override
    const openaiModelConfig = getModelConfig(model || modelConfig.agentModel, {
      temperature: 0,
      max_tokens: resolvedMaxTokens,
    });

    // Determine if streaming is needed
    const isStreaming = !!(
      onContentUpdate ||
      onToolUpdate ||
      onReasoningUpdate
    );

    // Prepare API call parameters
    createParams = {
      ...openaiModelConfig,
      messages: openaiMessages,
      stream: isStreaming,
    } as
      | ChatCompletionCreateParamsNonStreaming
      | ChatCompletionCreateParamsStreaming;

    // Only add tools if they exist
    if (processedTools && processedTools.length > 0) {
      createParams.tools = processedTools;
    }

    if (isStreaming) {
      // Handle streaming response
      const { data: stream, response } = await openai.chat.completions
        .create(createParams as ChatCompletionCreateParamsStreaming, {
          signal: abortSignal,
        })
        .withResponse();

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      (response.headers as Headers).forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });

      return await processStreamingResponse(
        stream,
        onContentUpdate,
        onToolUpdate,
        onReasoningUpdate,
        abortSignal,
        responseHeaders,
        currentModel,
      );
    } else {
      // Handle non-streaming response
      const { data: response, response: rawResponse } =
        await openai.chat.completions
          .create(createParams as ChatCompletionCreateParamsNonStreaming, {
            signal: abortSignal,
          })
          .withResponse();

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      (rawResponse.headers as Headers).forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });

      const finalMessage = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason || null;

      let totalUsage = response.usage
        ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined;

      // Extend usage with cache metrics for Claude models
      if (totalUsage && isClaudeModel(currentModel) && response.usage) {
        totalUsage = extendUsageWithCacheMetrics(
          totalUsage,
          response.usage as Partial<ClaudeUsage>,
        );
      }

      const result: CallAgentResult = {};

      if (finalMessage) {
        const {
          content: finalContent,
          tool_calls: finalToolCalls,
          reasoning_content: finalReasoningContent,
          ...otherFields
        } = finalMessage as unknown as {
          content?: string;
          tool_calls?: ChatCompletionMessageToolCall[];
          reasoning_content?: string;
          [key: string]: unknown;
        };

        if (typeof finalContent === "string" && finalContent.length > 0) {
          result.content = finalContent;
        }

        if (
          typeof finalReasoningContent === "string" &&
          finalReasoningContent.length > 0
        ) {
          result.reasoning_content = finalReasoningContent;
        }

        if (Array.isArray(finalToolCalls) && finalToolCalls.length > 0) {
          result.tool_calls = finalToolCalls;
        }

        if (Object.keys(otherFields).length > 0) {
          const additionalFields: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(otherFields)) {
            if (value !== undefined && key !== "role") {
              additionalFields[key] = value;
            }
          }
          if (Object.keys(additionalFields).length > 0) {
            result.additionalFields = additionalFields;
          }
        }
      }

      if (totalUsage) {
        result.usage = totalUsage;
      }

      if (finishReason) {
        result.finish_reason = finishReason;
      }

      if (Object.keys(responseHeaders).length > 0) {
        result.response_headers = responseHeaders;
      }

      return result;
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request was aborted");
    }

    // Check if it's a 400 error and save messages to temp directory
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 400
    ) {
      try {
        // Create temp directory for error debugging
        const tempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "callAgent-400-error-"),
        );
        const messagesFile = path.join(tempDir, "messages.json");
        const errorFile = path.join(tempDir, "error.json");

        // Save complete messages to temp file
        const debugData: DebugData = {
          originalMessages: messages,
          timestamp: new Date().toISOString(),
          model: model || modelConfig.agentModel,
          workdir,
          sessionId: options.sessionId,
          gatewayConfig: {
            baseURL: gatewayConfig.baseURL,
            // Don't include apiKey for security
            defaultHeaders: gatewayConfig.defaultHeaders,
          },
        };

        // Add processed messages if they exist
        if (typeof openaiMessages !== "undefined") {
          debugData.processedMessages = openaiMessages;
        }

        // Add create params if they exist
        if (typeof createParams !== "undefined") {
          debugData.createParams = createParams;
        }

        // Add tools if they exist
        if (processedTools) {
          debugData.tools = processedTools;
        }

        fs.writeFileSync(messagesFile, JSON.stringify(debugData, null, 2));

        // Save error details
        const errorData: ErrorData = {
          error: {
            message:
              error && typeof error === "object" && "message" in error
                ? String(error.message)
                : undefined,
            status:
              error && typeof error === "object" && "status" in error
                ? Number(error.status)
                : undefined,
            type:
              error && typeof error === "object" && "type" in error
                ? String(error.type)
                : undefined,
            code:
              error && typeof error === "object" && "code" in error
                ? String(error.code)
                : undefined,
            body:
              error && typeof error === "object" && "body" in error
                ? error.body
                : undefined,
            stack:
              error && typeof error === "object" && "stack" in error
                ? String(error.stack)
                : undefined,
          },
          timestamp: new Date().toISOString(),
        };

        fs.writeFileSync(errorFile, JSON.stringify(errorData, null, 2));

        logger.error(
          "callAgent 400 error occurred. Debug files saved to:",
          tempDir,
        );
        logger.error("Messages file:", messagesFile);
        logger.error("Error file:", errorFile);
        logger.error("Error details:", error);
      } catch (saveError) {
        logger.error("Failed to save 400 error debug files:", saveError);
      }
    }

    logger.error("Failed to call OpenAI:", error);
    throw error;
  }
}

/**
 * Process streaming response from OpenAI API
 * @param stream Async iterator of chat completion chunks
 * @param onContentUpdate Callback for content updates
 * @param onToolUpdate Callback for tool updates
 * @param abortSignal Optional abort signal
 * @param responseHeaders Response headers from the initial request
 * @param modelName Model name for cache control processing
 * @returns Final result with accumulated content and tool calls
 */
async function processStreamingResponse(
  stream: AsyncIterable<ChatCompletionChunk>,
  onContentUpdate?: (content: string) => void,
  onToolUpdate?: (toolCall: {
    id: string;
    name: string;
    parameters: string;
    parametersChunk?: string;
    stage?: "start" | "streaming" | "running" | "end";
  }) => void,
  onReasoningUpdate?: (content: string) => void,
  abortSignal?: AbortSignal,
  responseHeaders?: Record<string, string>,
  modelName?: string,
): Promise<CallAgentResult> {
  let accumulatedContent = "";
  let accumulatedReasoningContent = "";
  const toolCalls: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[] = [];
  const additionalDeltaFields: Record<string, unknown> = {};
  let usage: CallAgentResult["usage"] = undefined;
  let finishReason: CallAgentResult["finish_reason"] = null;

  try {
    for await (const chunk of stream) {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error("Request was aborted");
      }

      // Check for usage information in any chunk
      if (chunk.usage) {
        let chunkUsage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };

        // Extend usage with cache metrics for Claude models
        if (modelName && isClaudeModel(modelName)) {
          chunkUsage = extendUsageWithCacheMetrics(
            chunkUsage,
            chunk.usage as Partial<ClaudeUsage>,
          );
        }

        usage = chunkUsage;
      }

      // Check for finish_reason in the choice
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice?.delta;
      if (!delta) {
        continue;
      }

      const {
        content,
        tool_calls: toolCallUpdates,
        reasoning_content,
        ...deltaMetadata
      } = delta as unknown as {
        content?: string;
        tool_calls?: ChatCompletionChunk.Choice.Delta.ToolCall[];
        reasoning_content?: string;
        [key: string]: unknown;
      };

      if (Object.keys(deltaMetadata).length > 0) {
        Object.assign(additionalDeltaFields, deltaMetadata);
      }

      if (typeof content === "string" && content.length > 0) {
        // Note: OpenAI API already handles UTF-8 character boundaries correctly in streaming,
        // ensuring that delta.content always contains complete UTF-8 strings
        accumulatedContent += content;
        if (onContentUpdate) {
          onContentUpdate(accumulatedContent);
        }
      }

      if (
        typeof reasoning_content === "string" &&
        reasoning_content.length > 0
      ) {
        accumulatedReasoningContent += reasoning_content;
        if (onReasoningUpdate) {
          onReasoningUpdate(accumulatedReasoningContent);
        }
      }

      if (Array.isArray(toolCallUpdates)) {
        for (const rawToolCall of toolCallUpdates) {
          const toolCallDelta =
            rawToolCall as ChatCompletionChunk.Choice.Delta.ToolCall;

          if (!toolCallDelta.function) {
            continue;
          }

          const functionDelta = toolCallDelta.function;

          let existingCall;
          let isNew = false;

          if (toolCallDelta.id) {
            existingCall = toolCalls.find((t) => t.id === toolCallDelta.id);
            if (!existingCall) {
              existingCall = {
                id: toolCallDelta.id,
                type: "function" as const,
                function: {
                  name: functionDelta.name || "",
                  arguments: "",
                },
              };
              toolCalls.push(existingCall);
              isNew = true;
            }
          } else {
            existingCall = toolCalls[toolCalls.length - 1];
          }

          if (!existingCall) {
            continue;
          }

          if (functionDelta.name) {
            existingCall.function.name = functionDelta.name;
          }

          // Emit start stage when a new tool call is created and we have the tool name
          if (onToolUpdate && isNew && existingCall.function.name) {
            onToolUpdate({
              id: existingCall.id,
              name: existingCall.function.name,
              parameters: "", // Empty parameters for start stage
              parametersChunk: "", // Empty chunk for start stage
              stage: "start", // New tool call triggers start stage
            });
            isNew = false; // Prevent duplicate start emissions
          }

          if (functionDelta.arguments) {
            existingCall.function.arguments += functionDelta.arguments;
          }

          // Emit streaming updates for all chunks with actual content (including first chunk)
          if (
            onToolUpdate &&
            existingCall.function.name &&
            functionDelta.arguments &&
            functionDelta.arguments.length > 0 // Only emit streaming for chunks with actual content
          ) {
            onToolUpdate({
              id: existingCall.id,
              name: existingCall.function.name,
              parameters: existingCall.function.arguments,
              parametersChunk: functionDelta.arguments,
              stage: "streaming",
            });
          }
        }
      }
    }
  } catch (error) {
    if ((error as Error).message === "Request was aborted") {
      throw error;
    }
    throw error;
  }

  // Prepare final result
  const result: CallAgentResult = {};

  if (accumulatedContent) {
    result.content = accumulatedContent.trim();
  }

  if (accumulatedReasoningContent) {
    result.reasoning_content = accumulatedReasoningContent.trim();
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  if (usage) {
    result.usage = usage;
  }

  if (finishReason) {
    result.finish_reason = finishReason;
  }

  if (responseHeaders && Object.keys(responseHeaders).length > 0) {
    result.response_headers = responseHeaders;
  }

  if (Object.keys(additionalDeltaFields).length > 0) {
    result.additionalFields = {};
    for (const [key, value] of Object.entries(additionalDeltaFields)) {
      if (value !== undefined && key !== "role") {
        result.additionalFields[key] = value;
      }
    }
    if (Object.keys(result.additionalFields).length === 0) {
      delete result.additionalFields;
    }
  }

  return result;
}

export interface CompressMessagesOptions {
  // Resolved configuration
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;

  // Existing parameters
  messages: ChatCompletionMessageParam[];
  abortSignal?: AbortSignal;
  model?: string;
}

export interface CompressMessagesResult {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function compressMessages(
  options: CompressMessagesOptions,
): Promise<CompressMessagesResult> {
  const { gatewayConfig, modelConfig, messages, abortSignal } = options;

  // Create OpenAI client with injected configuration
  const openai = new OpenAIClient({
    apiKey: gatewayConfig.apiKey,
    baseURL: gatewayConfig.baseURL,
    defaultHeaders: gatewayConfig.defaultHeaders,
    fetchOptions: gatewayConfig.fetchOptions,
    fetch: gatewayConfig.fetch,
  });

  // Get model configuration - use injected agent model
  const openaiModelConfig = getModelConfig(
    options.model || modelConfig.agentModel,
    {
      temperature: 0.1,
      max_tokens: 2048,
    },
  );

  try {
    const response = await openai.chat.completions.create(
      {
        ...openaiModelConfig,
        messages: [
          {
            role: "system",
            content: COMPRESS_MESSAGES_SYSTEM_PROMPT,
          },
          ...messages,
          {
            role: "user",
            content: `Please create a detailed summary of the conversation so far.`,
          },
        ],
      },
      {
        signal: abortSignal,
      },
    );

    const content =
      response.choices[0]?.message?.content?.trim() ||
      "Failed to compress conversation history";
    const usage = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      usage,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Compression request was aborted");
    }
    logger.error("Failed to compress messages:", error);
    return {
      content: "Failed to compress conversation history",
      usage: undefined,
    };
  }
}

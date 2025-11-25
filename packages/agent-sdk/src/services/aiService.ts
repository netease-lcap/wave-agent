import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionChunk,
} from "openai/resources.js";
import type { GatewayConfig, ModelConfig } from "../types/index.js";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

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
>;

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

  // NEW: Streaming callbacks
  onContentUpdate?: (content: string) => void;
  onToolUpdate?: (toolCall: {
    id: string;
    name: string;
    parameters: string;
    parametersChunk?: string;
    stage?: "start" | "streaming" | "running" | "end";
  }) => void;
}

export interface CallAgentResult {
  content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "function_call"
    | null;
  response_headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
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
  } = options;

  try {
    // Create OpenAI client with injected configuration
    const openai = new OpenAI({
      apiKey: gatewayConfig.apiKey,
      baseURL: gatewayConfig.baseURL,
    });

    // Build system prompt content
    let systemContent =
      systemPrompt ||
      `You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.
      
# Tool usage policy
- When doing file search, prefer to use the Task tool in order to reduce context usage.
- You should proactively use the Task tool with specialized agents when the task at hand matches the agent's description.
- You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. When making multiple bash tool calls, you MUST send a single message with multiple tools calls to run the calls in parallel. For example, if you need to run "git status" and "git diff", send a single message with two tool calls to run the calls in parallel.

      `;

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
    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "system",
      content: systemContent,
    };

    // ChatCompletionMessageParam[] is already in OpenAI format, add system prompt to the beginning
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [systemMessage, ...messages];

    // Get model configuration - use injected modelConfig with optional override
    const openaiModelConfig = getModelConfig(model || modelConfig.agentModel, {
      temperature: 0,
    });

    // Determine if streaming is needed
    const isStreaming = !!(onContentUpdate || onToolUpdate);

    // Prepare API call parameters
    const createParams = {
      ...openaiModelConfig,
      messages: openaiMessages,
      stream: isStreaming,
    } as
      | ChatCompletionCreateParamsNonStreaming
      | ChatCompletionCreateParamsStreaming;

    // Only add tools if they exist
    if (tools && tools.length > 0) {
      createParams.tools = tools;
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
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return await processStreamingResponse(
        stream,
        onContentUpdate,
        onToolUpdate,
        abortSignal,
        responseHeaders,
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
      rawResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const finalMessage = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason || null;
      const totalUsage = response.usage
        ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined;

      const result: CallAgentResult = {};

      if (finalMessage) {
        const {
          content: finalContent,
          tool_calls: finalToolCalls,
          ...otherFields
        } = finalMessage;

        if (typeof finalContent === "string" && finalContent.length > 0) {
          result.content = finalContent;
        }

        if (Array.isArray(finalToolCalls) && finalToolCalls.length > 0) {
          result.tool_calls = finalToolCalls;
        }

        if (Object.keys(otherFields).length > 0) {
          const metadata: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(otherFields)) {
            if (value !== undefined) {
              metadata[key] = value;
            }
          }
          if (Object.keys(metadata).length > 0) {
            result.metadata = metadata;
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
    // // logger.error("Failed to call OpenAI:", error);
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
  abortSignal?: AbortSignal,
  responseHeaders?: Record<string, string>,
): Promise<CallAgentResult> {
  let accumulatedContent = "";
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
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
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
        ...deltaMetadata
      } = delta as unknown as {
        content?: string;
        tool_calls?: ChatCompletionChunk.Choice.Delta.ToolCall[];
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

          if (functionDelta.arguments) {
            existingCall.function.arguments += functionDelta.arguments;

            // Emit start stage with empty parameters when first chunk arrives
            if (onToolUpdate && isNew) {
              onToolUpdate({
                id: existingCall.id,
                name: existingCall.function.name || "",
                parameters: "", // Empty parameters for start stage
                parametersChunk: "", // Empty chunk for start stage
                stage: "start", // First chunk triggers start stage
              });
            }
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
    result.content = accumulatedContent;
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
    result.metadata = {};
    for (const [key, value] of Object.entries(additionalDeltaFields)) {
      if (value !== undefined) {
        result.metadata[key] = value;
      }
    }
    if (Object.keys(result.metadata).length === 0) {
      delete result.metadata;
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
  const openai = new OpenAI({
    apiKey: gatewayConfig.apiKey,
    baseURL: gatewayConfig.baseURL,
  });

  // Get model configuration - use injected fast model
  const openaiModelConfig = getModelConfig(modelConfig.fastModel, {
    temperature: 0.1,
    max_tokens: 1500,
  });

  try {
    const response = await openai.chat.completions.create(
      {
        ...openaiModelConfig,
        messages: [
          {
            role: "system",
            content: `You are an expert conversation history compression specialist. Your task is to create comprehensive yet concise summaries that preserve critical development context.

Follow this structure for compression:

## Primary Request and Intent
What is the user's core goal and main objectives?

## Key Technical Concepts  
Frameworks, algorithms, libraries, and technical concepts involved in the conversation.

## Files and Code Sections
All mentioned or modified code and file paths.

## Errors and Fixes
Record error messages encountered and final solutions applied.

## Problem Solving
Complete thought process and decision-making path for problem resolution.

## All User Messages
Preserve key user instructions and feedback.

## Pending Tasks
Unfinished work items, forming a to-do list.

## Current Work
Clearly record the current progress when the conversation was interrupted.

## Output Requirements:
- Use third-person narrative format
- Target 300-800 words (scale based on complexity)
- Maintain the original conversation language
- Structure with clear sections for multi-topic conversations
- Focus on actionable information and outcomes`,
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
    // // logger.error("Failed to compress messages:", error);
    return {
      content: "Failed to compress conversation history",
      usage: undefined,
    };
  }
}

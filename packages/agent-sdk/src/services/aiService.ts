import OpenAI from "openai";
import { ChatCompletionMessageToolCall } from "openai/resources";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionChunk,
} from "openai/resources.js";
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
  usage?: ClaudeUsage;
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
      defaultHeaders: gatewayConfig.defaultHeaders,
      fetchOptions: gatewayConfig.fetchOptions,
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
    let openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages,
    ];

    // Apply cache control for Claude models
    const currentModel = model || modelConfig.agentModel;

    let processedTools = tools;

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
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return await processStreamingResponse(
        stream,
        onContentUpdate,
        onToolUpdate,
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
      rawResponse.headers.forEach((value, key) => {
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
            if (value !== undefined && key !== "role") {
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
  abortSignal?: AbortSignal,
  responseHeaders?: Record<string, string>,
  modelName?: string,
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
      if (value !== undefined && key !== "role") {
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
    defaultHeaders: gatewayConfig.defaultHeaders,
    fetchOptions: gatewayConfig.fetchOptions,
  });

  // Get model configuration - use injected fast model
  const openaiModelConfig = getModelConfig(modelConfig.fastModel, {
    temperature: 0.1,
    max_tokens: 2048,
  });

  try {
    const response = await openai.chat.completions.create(
      {
        ...openaiModelConfig,
        messages: [
          {
            role: "system",
            content: `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
6. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response. 

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>`,
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

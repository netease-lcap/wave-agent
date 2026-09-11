/**
 * Shared fast-model content processing.
 *
 * WebFetch runs every fetched page through a small, fast model, and the
 * reader-view artifact read summarizes someone else's page the same way.
 * Both go through this single implementation (prompt → answer).
 */

import type { ToolContext, ToolResult } from "../tools/types.js";

/** Human-readable byte size (e.g. "512B", "2.0KB", "1.5MB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Run the fast model over `content` with `prompt` and return its answer as the
 * tool result. The main model only ever sees this answer.
 */
export async function processContentWithAI(
  url: string,
  prompt: string,
  content: string,
  statusCode: number,
  statusText: string,
  context: ToolContext,
  contentSize?: number,
): Promise<ToolResult> {
  if (!context.aiManager || !context.aiService) {
    return {
      success: false,
      content: content,
      error: "AI Manager or AI Service not available for processing content",
    };
  }

  const modelConfig = context.aiManager.getModelConfig();
  const fastModel = modelConfig.fastModel;

  const aiResponse = await context.aiService.processWebContent({
    gatewayConfig: context.aiManager.getGatewayConfig(),
    modelConfig: modelConfig,
    content: content,
    prompt: prompt,
    model: fastModel,
    abortSignal: context.abortSignal,
  });

  const sizeStr =
    contentSize !== undefined ? formatSize(contentSize) : "unknown size";
  const statusStr = `${statusCode} ${statusText}`.trim();

  return {
    success: true,
    content: aiResponse.content || "",
    shortResult: `Received ${sizeStr} (${statusStr}) from ${url}`,
  };
}

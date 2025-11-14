import type { Usage } from "wave-agent-sdk";

/**
 * Token summary by model
 */
export interface TokenSummary {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  operations: {
    agent_calls: number;
    compressions: number;
  };
}

/**
 * Calculate token usage summary by model from usage array
 * @param usages Array of usage data from agent operations
 * @returns Array of token summaries grouped by model
 */
export function calculateTokenSummary(
  usages: Usage[],
): Record<string, TokenSummary> {
  const summaryMap = new Map<string, TokenSummary>();

  for (const usage of usages) {
    const model = usage.model || "unknown";

    if (!summaryMap.has(model)) {
      summaryMap.set(model, {
        model,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        operations: {
          agent_calls: 0,
          compressions: 0,
        },
      });
    }

    const summary = summaryMap.get(model)!;
    summary.prompt_tokens += usage.prompt_tokens;
    summary.completion_tokens += usage.completion_tokens;
    summary.total_tokens += usage.total_tokens;

    // Track operation types
    if (usage.operation_type === "agent") {
      summary.operations.agent_calls += 1;
    } else if (usage.operation_type === "compress") {
      summary.operations.compressions += 1;
    }
  }

  // Convert Map to Record and sort by total tokens
  const result: Record<string, TokenSummary> = {};
  const sortedEntries = Array.from(summaryMap.entries()).sort(
    (a, b) => b[1].total_tokens - a[1].total_tokens,
  );

  for (const [model, summary] of sortedEntries) {
    result[model] = summary;
  }

  return result;
}

/**
 * Display usage summary in a formatted way
 * @param usages Array of usage data from agent operations
 * @param sessionFilePath Optional session file path to display
 */
export function displayUsageSummary(
  usages: Usage[],
  sessionFilePath?: string,
): void {
  if (usages.length === 0) {
    return; // No usage data to display
  }

  const summaries = calculateTokenSummary(usages);

  console.log("\nToken Usage Summary:");
  console.log("==================");

  if (sessionFilePath) {
    console.log(`Session: ${sessionFilePath}`);
  }

  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let totalAgentCalls = 0;
  let totalCompressions = 0;

  for (const [, summary] of Object.entries(summaries)) {
    console.log(`Model: ${summary.model}`);
    console.log(`  Prompt tokens: ${summary.prompt_tokens.toLocaleString()}`);
    console.log(
      `  Completion tokens: ${summary.completion_tokens.toLocaleString()}`,
    );
    console.log(`  Total tokens: ${summary.total_tokens.toLocaleString()}`);
    console.log(
      `  Operations: ${summary.operations.agent_calls} agent calls, ${summary.operations.compressions} compressions`,
    );
    console.log();

    totalPrompt += summary.prompt_tokens;
    totalCompletion += summary.completion_tokens;
    totalTokens += summary.total_tokens;
    totalAgentCalls += summary.operations.agent_calls;
    totalCompressions += summary.operations.compressions;
  }

  if (Object.keys(summaries).length > 1) {
    console.log("Overall Total:");
    console.log(`  Prompt tokens: ${totalPrompt.toLocaleString()}`);
    console.log(`  Completion tokens: ${totalCompletion.toLocaleString()}`);
    console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(
      `  Operations: ${totalAgentCalls} agent calls, ${totalCompressions} compressions`,
    );
  }
}

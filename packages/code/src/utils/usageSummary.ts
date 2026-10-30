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
    compactions: number;
  };
  // Normalized cache tokens
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Totals across every usage record — what the structured `usage` field reports.
 *
 * Claude Code's `input_tokens` excludes cached tokens; ours (`prompt_tokens`,
 * OpenAI shape) already contains them, so the two are not interchangeable and
 * this deliberately keeps our own field names.
 */
export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Sum of all usage records, cache fields included only when they appear. */
export function sumUsage(usages: Usage[]): UsageTotals {
  const totals: UsageTotals = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  for (const usage of usages) {
    totals.prompt_tokens += usage.prompt_tokens;
    totals.completion_tokens += usage.completion_tokens;
    totals.total_tokens += usage.total_tokens;
    if (usage.cache_read_input_tokens) {
      totals.cache_read_input_tokens =
        (totals.cache_read_input_tokens || 0) + usage.cache_read_input_tokens;
    }
    if (usage.cache_creation_input_tokens) {
      totals.cache_creation_input_tokens =
        (totals.cache_creation_input_tokens || 0) +
        usage.cache_creation_input_tokens;
    }
  }
  return totals;
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
          compactions: 0,
        },
      });
    }

    const summary = summaryMap.get(model)!;
    summary.prompt_tokens += usage.prompt_tokens;
    summary.completion_tokens += usage.completion_tokens;
    summary.total_tokens += usage.total_tokens;

    // Handle cache tokens if present and non-zero
    if (usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
      summary.cache_read_input_tokens =
        (summary.cache_read_input_tokens || 0) + usage.cache_read_input_tokens;
    }
    if (
      usage.cache_creation_input_tokens &&
      usage.cache_creation_input_tokens > 0
    ) {
      summary.cache_creation_input_tokens =
        (summary.cache_creation_input_tokens || 0) +
        usage.cache_creation_input_tokens;
    }

    // Track operation types
    if (usage.operation_type === "agent") {
      summary.operations.agent_calls += 1;
    } else if (usage.operation_type === "compact") {
      summary.operations.compactions += 1;
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
 * Where the summary lines go. Called with no argument for a blank line.
 */
export type UsageLineWriter = (line?: string) => void;

/**
 * Display usage summary in a formatted way
 * @param usages Array of usage data from agent operations
 * @param sessionFilePath Optional session file path to display
 * @param writer Where the lines go — stdout by default; structured print modes
 *   hand it stderr so their stdout stays pure JSON
 */
export function displayUsageSummary(
  usages: Usage[],
  sessionFilePath?: string,
  writer?: UsageLineWriter,
): void {
  if (usages.length === 0) {
    return; // No usage data to display
  }

  const write: UsageLineWriter =
    writer ??
    ((line) => {
      if (line === undefined) console.log();
      else console.log(line);
    });

  const summaries = calculateTokenSummary(usages);

  write("\nToken Usage Summary:");
  write("==================");

  if (sessionFilePath) {
    write(`Session: ${sessionFilePath}`);
  }

  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let totalAgentCalls = 0;
  let totalCompactions = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let hasCacheData = false;

  for (const [, summary] of Object.entries(summaries)) {
    write(`Model: ${summary.model}`);
    write(`  Prompt tokens: ${summary.prompt_tokens.toLocaleString()}`);
    write(`  Completion tokens: ${summary.completion_tokens.toLocaleString()}`);
    write(`  Total tokens: ${summary.total_tokens.toLocaleString()}`);

    // Display cache information if available
    if (
      summary.cache_read_input_tokens ||
      summary.cache_creation_input_tokens
    ) {
      hasCacheData = true;
      write("  Cache Usage:");

      if (
        summary.cache_read_input_tokens &&
        summary.cache_read_input_tokens > 0
      ) {
        write(
          `    Read from cache: ${summary.cache_read_input_tokens.toLocaleString()} tokens`,
        );
        totalCacheRead += summary.cache_read_input_tokens;
      }

      if (
        summary.cache_creation_input_tokens &&
        summary.cache_creation_input_tokens > 0
      ) {
        write(
          `    Created cache: ${summary.cache_creation_input_tokens.toLocaleString()} tokens`,
        );
        totalCacheCreation += summary.cache_creation_input_tokens;
      }
    }

    write(
      `  Operations: ${summary.operations.agent_calls} agent calls, ${summary.operations.compactions} compactions`,
    );
    write();

    totalPrompt += summary.prompt_tokens;
    totalCompletion += summary.completion_tokens;
    totalTokens += summary.total_tokens;
    totalAgentCalls += summary.operations.agent_calls;
    totalCompactions += summary.operations.compactions;
  }

  if (Object.keys(summaries).length > 1) {
    write("Overall Total:");
    write(`  Prompt tokens: ${totalPrompt.toLocaleString()}`);
    write(`  Completion tokens: ${totalCompletion.toLocaleString()}`);
    write(`  Total tokens: ${totalTokens.toLocaleString()}`);

    if (hasCacheData) {
      write("  Cache Usage:");
      if (totalCacheRead > 0) {
        write(`    Read from cache: ${totalCacheRead.toLocaleString()} tokens`);
      }
      if (totalCacheCreation > 0) {
        write(
          `    Created cache: ${totalCacheCreation.toLocaleString()} tokens`,
        );
      }
    }

    write(
      `  Operations: ${totalAgentCalls} agent calls, ${totalCompactions} compactions`,
    );
  }
}

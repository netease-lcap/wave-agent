import type { Message } from "../types/index.js";

export interface ApiRound {
  messages: Message[];
  estimatedTokens: number;
}

/**
 * Groups messages into "API rounds" — each round corresponds to one API
 * call-response cycle. This is critical because in agentic sessions with a
 * single user prompt, Wave creates a new Message per API round (each recursive
 * sendAIMessage call creates a new assistant message).
 *
 * Boundaries:
 *  - A new `role: "user"` message starts a new round.
 *  - A new `role: "assistant"` message with a different `id` starts a new round.
 *  - A message with a `compress` block is pushed as its own round and starts a
 *    new round after it.
 */
export function groupMessagesByApiRound(messages: Message[]): ApiRound[] {
  const rounds: ApiRound[] = [];
  let currentRound: Message[] = [];
  let lastAssistantId: string | undefined;

  for (const msg of messages) {
    let startNewRound = false;

    if (msg.role === "user") {
      startNewRound = true;
    } else if (msg.role === "assistant") {
      // Compress block is always its own round
      const hasCompress = msg.blocks.some((b) => b.type === "compress");
      if (hasCompress) {
        startNewRound = true;
      } else if (msg.id !== lastAssistantId) {
        // New assistant id starts a new round.
        // Exception: if the current round is [user] (first assistant after a
        // user prompt in a normal conversation), keep them together as one
        // round. But if we already have assistant(s) in this round (agentic
        // tool loop), the new id starts a new round.
        const roundHasOtherAssistant = currentRound.some(
          (m) => m.role === "assistant" && m.id !== msg.id,
        );
        if (roundHasOtherAssistant) {
          startNewRound = true;
        }
      }
      lastAssistantId = msg.id;
    }

    if (startNewRound && currentRound.length > 0) {
      rounds.push({
        messages: currentRound,
        estimatedTokens: estimateTokens(currentRound),
      });
      currentRound = [];
    }

    currentRound.push(msg);

    // After pushing a compress message as its own round, flush immediately
    if (
      msg.role === "assistant" &&
      msg.blocks.some((b) => b.type === "compress")
    ) {
      rounds.push({
        messages: currentRound,
        estimatedTokens: estimateTokens(currentRound),
      });
      currentRound = [];
    }
  }

  if (currentRound.length > 0) {
    rounds.push({
      messages: currentRound,
      estimatedTokens: estimateTokens(currentRound),
    });
  }

  return rounds;
}

/**
 * Returns the last `roundCount` complete API rounds as a flat message array.
 * Never splits a tool_use/tool_result pair. If fewer rounds exist, returns all.
 */
export function getLastApiRounds(
  messages: Message[],
  roundCount: number,
): Message[] {
  const rounds = groupMessagesByApiRound(messages);
  const lastRounds = rounds.slice(-roundCount);
  return lastRounds.flatMap((r) => r.messages);
}

/**
 * Roughly estimate token count from character count (~4 chars per token).
 */
function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const block of msg.blocks) {
      if ("content" in block && typeof block.content === "string") {
        chars += block.content.length;
      }
      if (
        block.type === "tool" &&
        block.parameters &&
        typeof block.parameters === "string"
      ) {
        chars += block.parameters.length;
      }
      if (block.type === "tool" && block.result) {
        chars += block.result.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

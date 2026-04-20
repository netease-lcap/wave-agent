import type { Message, ToolBlock } from "../types/messaging.js";

export interface MicrocompactOptions {
  timeThresholdMS: number;
  recentResultsToKeep: number;
}

const CLEARED_RESULT = "[Old tool result content cleared]";

export function microcompactMessages(
  messages: Message[],
  options: MicrocompactOptions,
): Message[] {
  const { timeThresholdMS, recentResultsToKeep } = options;

  // 1. Find the latest tool block timestamp across all assistant messages
  let lastAssistantTime = 0;
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const block of msg.blocks) {
        if (block.type === "tool" && block.stage === "end" && block.timestamp) {
          if (block.timestamp > lastAssistantTime) {
            lastAssistantTime = block.timestamp;
          }
        }
      }
    }
  }

  // 2. If no prior assistant messages with completed tools, return unchanged
  if (lastAssistantTime === 0) {
    return messages;
  }

  // 3. If within threshold, return unchanged
  if (Date.now() - lastAssistantTime < timeThresholdMS) {
    return messages;
  }

  // 4. Collect all completed tool results with timestamps, sorted newest-first
  type ToolRef = { msgIndex: number; blockIndex: number; timestamp: number };

  const toolRefs: ToolRef[] = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "assistant") {
      for (let bi = 0; bi < msg.blocks.length; bi++) {
        const block = msg.blocks[bi];
        if (block.type === "tool" && block.stage === "end" && block.timestamp) {
          toolRefs.push({
            msgIndex: mi,
            blockIndex: bi,
            timestamp: block.timestamp,
          });
        }
      }
    }
  }

  toolRefs.sort((a, b) => b.timestamp - a.timestamp);

  // 5. Mark the top N as "keep"
  const keepSet = new Set<string>();
  for (let i = 0; i < Math.min(recentResultsToKeep, toolRefs.length); i++) {
    const ref = toolRefs[i];
    keepSet.add(`${ref.msgIndex}:${ref.blockIndex}`);
  }

  // 6. Deep-copy messages and clear result + shortResult on non-kept blocks
  const result: Message[] = messages.map((msg) => ({
    ...msg,
    blocks: msg.blocks.map((block) => {
      if (block.type === "tool" && block.stage === "end" && block.timestamp) {
        return { ...block } as ToolBlock;
      }
      return block;
    }),
  }));

  // Clear non-kept tool blocks
  for (const ref of toolRefs) {
    const key = `${ref.msgIndex}:${ref.blockIndex}`;
    if (!keepSet.has(key)) {
      result[ref.msgIndex] = {
        ...result[ref.msgIndex],
        blocks: result[ref.msgIndex].blocks.map((b, idx) => {
          if (idx === ref.blockIndex && b.type === "tool") {
            return {
              ...b,
              result: CLEARED_RESULT,
              shortResult: undefined,
            } as ToolBlock;
          }
          return b;
        }),
      };
    }
  }

  return result;
}

/**
 * Example demonstrating MessageList expanded mode message limiting
 *
 * This example shows how MessageList handles large numbers of messages
 * in expanded mode by limiting to 20 messages to prevent long rendering times.
 */

import React from "react";
import { Box } from "ink";
import { MessageList } from "../src/components/MessageList.js";
import type { Message } from "wave-agent-sdk";

// Create sample messages
const createMessage = (
  role: "user" | "assistant",
  content: string,
  id: number,
): Message => ({
  role,
  blocks: [
    {
      type: "text",
      content: `${content} - Message ${id}`,
    },
  ],
});

// Create 30 messages to demonstrate limiting
const manyMessages = Array.from({ length: 30 }, (_, i) =>
  createMessage(
    i % 2 === 0 ? "user" : "assistant",
    `Sample message ${i + 1}`,
    i + 1,
  ),
);

const ExampleApp = () => {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Box flexDirection="column">
          {/* Collapsed mode - shows all messages */}
          <Box marginBottom={1}>
            <Box backgroundColor="blue" paddingX={1}>
              <text>Collapsed Mode (shows all 30 messages):</text>
            </Box>
          </Box>
          <MessageList
            messages={manyMessages}
            isExpanded={false}
            latestTotalTokens={15000}
          />
        </Box>
      </Box>

      <Box>
        <Box flexDirection="column">
          {/* Expanded mode - limits to 20 messages */}
          <Box marginBottom={1}>
            <Box backgroundColor="green" paddingX={1}>
              <text>Expanded Mode (limits to latest 20 messages):</text>
            </Box>
          </Box>
          <MessageList
            messages={manyMessages}
            isExpanded={true}
            latestTotalTokens={15000}
          />
        </Box>
      </Box>
    </Box>
  );
};

// Note: This is an example file for demonstration purposes.
// In a real application, you would import and use MessageList
// within your chat interface component.

console.log("MessageList Expanded Mode Limiting Example");
console.log("==========================================");
console.log(
  "This example demonstrates how MessageList handles large message counts:",
);
console.log("- Collapsed mode: Shows all messages");
console.log(
  "- Expanded mode: Limits to latest 20 messages with omission indicator",
);
console.log("");
console.log("Key features:");
console.log("- Prevents long rendering times with many messages");
console.log("- Shows '... N earlier messages omitted' indicator");
console.log("- Always displays the latest 20 messages");
console.log("- Maintains full message count display");

export { ExampleApp, manyMessages, createMessage };

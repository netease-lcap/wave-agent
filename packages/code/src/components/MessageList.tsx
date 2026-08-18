import React, { useLayoutEffect, useRef } from "react";
import os from "os";
import { Box, Text, Static, useWindowSize } from "ink";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { MessageBlockItem } from "./MessageBlockItem.js";

const MAX_MESSAGES_COLLAPSED = 30;
const MAX_MESSAGES_EXPANDED = 10;

export interface MessageListProps {
  messages: Message[];
  isExpanded?: boolean;
  version?: string;
  workdir?: string;
}

export const MessageList = React.memo(
  ({ messages, isExpanded = false, version, workdir }: MessageListProps) => {
    const maxMessages = isExpanded
      ? MAX_MESSAGES_EXPANDED
      : MAX_MESSAGES_COLLAPSED;
    // Bound the <Static> history to the terminal width. The static node is
    // absolutely positioned, so without an explicit width Yoga measures it
    // against its content: any row whose natural width exceeds the terminal
    // (e.g. long tool compactParams) widens the node past the viewport, and
    // the node's height stays at the pre-resize measurement while children
    // re-layout at the wider width — leaving a block of blank rows between
    // the last message and the input box on session restore.
    const { columns } = useWindowSize();

    const welcomeMessage = (
      <Box flexDirection="column" paddingTop={1}>
        <Text color="gray">WAVE{version ? ` v${version}` : ""}</Text>
        {workdir && (
          <Text color="gray" wrap="truncate-middle">
            {workdir.replace(os.homedir(), "~")}
          </Text>
        )}
      </Box>
    );

    // Filter out meta messages
    const visibleMessages = messages.filter((m) => !m.isMeta);

    const isRunning = (b: MessageBlock) =>
      (b.type === "tool" &&
        (b.stage === "running" ||
          b.stage === "streaming" ||
          b.stage === "start")) ||
      (b.type === "bang" && b.stage === "running") ||
      (b.type === "reasoning" && b.stage === "streaming") ||
      (b.type === "text" && b.stage === "streaming");

    // Flatten messages into blocks with metadata
    // Include streaming text blocks (rendered as truncated gray text)
    const allBlocks = visibleMessages.flatMap((message, messageIndex) => {
      return message.blocks.map((block, blockIndex) => ({
        block,
        message,
        messageIndex,
        // Unique key for each block to help Static component
        key: `${message.id}-${blockIndex}`,
      }));
    });

    // Find message indices that have any running/streaming block
    const runningMessageIndices = new Set<number>();
    for (const item of allBlocks) {
      if (isRunning(item.block)) {
        runningMessageIndices.add(item.messageIndex);
      }
    }

    // Determine which blocks are static vs dynamic
    // Blocks not in the last message are always static.
    // For the last message: if any block is running/streaming, blocks in that message are dynamic,
    // except text/reasoning blocks that have already completed (stage === "end")
    const lastMessageIndex = visibleMessages.length - 1;
    const blocksWithStatus = allBlocks.map((item) => {
      const isInLastMessage = item.messageIndex === lastMessageIndex;
      const isBlockCompleted =
        (item.block.type === "text" || item.block.type === "reasoning") &&
        item.block.stage === "end";
      const isDynamic =
        !isExpanded &&
        isInLastMessage &&
        !isBlockCompleted &&
        runningMessageIndices.has(item.messageIndex);
      return { ...item, isDynamic };
    });

    const staticBlocks = blocksWithStatus.filter((b) => !b.isDynamic);
    const dynamicBlocks = blocksWithStatus.filter((b) => b.isDynamic);

    const staticItems = [
      {
        isWelcome: true,
        key: "welcome",
        block: undefined,
        message: undefined,
        messageIndex: -1,
      },
      ...staticBlocks.map((b) => ({ ...b, isWelcome: false })),
    ];

    // Track the content that was written into the append-only <Static> zone for
    // each block. Ink's <Static> never updates an already-rendered item, so when
    // a text/reasoning block reopens (stage "end" -> "streaming") the frozen
    // prefix stays on screen while the dynamic zone would re-render the FULL
    // accumulated content — duplicating the first words. Rendering only the
    // delta (content beyond the frozen prefix) in the dynamic zone avoids the
    // overlap.
    const frozenContentRef = useRef(new Map<string, string>());
    // Mirrors <Static>'s internal index (the previous static items.length) so we
    // know which static items are actually appended to the terminal output in
    // this render pass. Only those items get their content frozen.
    const staticIndexRef = useRef(0);

    useLayoutEffect(() => {
      staticIndexRef.current = staticItems.length;
    }, [staticItems.length]);

    // Record the content of static items being appended this pass, and prune
    // keys for blocks that no longer exist (e.g. rewound or cleared messages).
    // Only text/reasoning blocks carry content and can reopen (end -> streaming).
    const currentKeys = new Set<string>();
    staticItems.forEach((item, position) => {
      if (item.isWelcome) return;
      currentKeys.add(item.key);
      if (
        position >= staticIndexRef.current &&
        (item.block!.type === "text" || item.block!.type === "reasoning")
      ) {
        frozenContentRef.current.set(item.key, item.block!.content);
      }
    });
    for (const item of dynamicBlocks) {
      currentKeys.add(item.key);
    }
    for (const key of frozenContentRef.current.keys()) {
      if (!currentKeys.has(key)) {
        frozenContentRef.current.delete(key);
      }
    }

    // Reopened blocks (in the dynamic zone but previously written to static)
    // must render only the content beyond the frozen prefix, otherwise the
    // already-displayed prefix appears twice on screen.
    const dynamicBlocksWithDelta = dynamicBlocks.map((item) => {
      const frozen = frozenContentRef.current.get(item.key);
      if (
        frozen !== undefined &&
        (item.block.type === "text" || item.block.type === "reasoning") &&
        item.block.content.length > frozen.length
      ) {
        return {
          ...item,
          block: {
            ...item.block,
            content: item.block.content.slice(frozen.length),
          },
        };
      }
      return item;
    });

    return (
      <Box flexDirection="column" paddingBottom={1}>
        {/* Static items (Welcome message + Static blocks) */}
        {staticItems.length > 0 && (
          <Static items={staticItems} style={{ width: columns }}>
            {(item) => {
              if (item.isWelcome) {
                return (
                  <React.Fragment key={item.key}>
                    {welcomeMessage}
                  </React.Fragment>
                );
              }
              if (
                visibleMessages.length > maxMessages &&
                item.messageIndex < visibleMessages.length - maxMessages
              ) {
                return null;
              }
              return (
                <MessageBlockItem
                  key={item.key}
                  block={item.block!}
                  message={item.message!}
                  isExpanded={isExpanded}
                  paddingTop={1}
                />
              );
            }}
          </Static>
        )}

        {/* Dynamic blocks */}
        {dynamicBlocksWithDelta.length > 0 && (
          <Box flexDirection="column">
            {dynamicBlocksWithDelta.map((item) => (
              <MessageBlockItem
                key={item.key}
                block={item.block}
                message={item.message}
                isExpanded={isExpanded}
                paddingTop={1}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  },
);

// Add display name for debugging
MessageList.displayName = "MessageList";

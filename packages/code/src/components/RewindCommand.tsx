import React, { useState, useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { RewindCheckpoint } from "wave-agent-sdk";
import { rewindSelectorReducer } from "../reducers/rewindSelectorReducer.js";

/** 稳定的空表：加载期也要能渲染，但不能每帧造一个新数组（effect 依赖它）。 */
const NO_CHECKPOINTS: RewindCheckpoint[] = [];

export interface RewindCommandProps {
  /**
   * 取检查点表。SDK 扫转录当场投影，内存里不留整条线程——这一屏要的只是
   * 「哪几条能回滚到」和它们在完整线程里的位置。
   */
  getCheckpoints: () => Promise<RewindCheckpoint[]>;
  /** 参数是在完整线程里的绝对位置，直接喂 `truncateHistory(index)`。 */
  onSelect: (index: number) => void;
  onCancel: () => void;
}

export const RewindCommand: React.FC<RewindCommandProps> = ({
  getCheckpoints,
  onSelect,
  onCancel,
}) => {
  const [checkpoints, setCheckpoints] = useState<RewindCheckpoint[] | null>(
    null,
  );
  const isLoading = checkpoints === null;

  useEffect(() => {
    let cancelled = false;
    getCheckpoints().then((loaded) => {
      if (!cancelled) setCheckpoints(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [getCheckpoints]);

  const items = checkpoints ?? NO_CHECKPOINTS;

  const MAX_VISIBLE_ITEMS = 3;

  const [state, dispatch] = useReducer(rewindSelectorReducer, {
    selectedIndex: items.length - 1,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  // Update selectedIndex when checkpoints arrive
  useEffect(() => {
    dispatch({ type: "RESET_INDEX", index: items.length - 1 });
  }, [items.length]);

  // Handle decisions from reducer
  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select") {
      if (items.length > 0 && selectedIndex >= 0) {
        onSelect(items[selectedIndex].index);
      }
    } else if (pendingDecision === "cancel") {
      onCancel();
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [pendingDecision, selectedIndex, items, onSelect, onCancel]);

  useInput((input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: items.length - 1,
    });
  });

  if (isLoading) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="cyan"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="cyan">Loading rewind checkpoints...</Text>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="yellow"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="yellow">No user messages found to rewind to.</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, items.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCheckpoints = items.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      gap={1}
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
    >
      <Box>
        <Text color="cyan" bold>
          Rewind: Select a message to revert to
        </Text>
      </Box>

      <Box flexDirection="column">
        {visibleCheckpoints.map((checkpoint, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          const content = checkpoint.content
            .replace(/\n/g, "\\n")
            .substring(0, 60);

          return (
            <Box key={checkpoint.id}>
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}[{checkpoint.index}]{" "}
                {content || "(No text content)"}
                {actualIndex === items.length - 1 ? " (Latest)" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor>↑↓ navigate • Enter to rewind • Esc to cancel</Text>
      </Box>
      <Box>
        <Text color="red" dimColor>
          Warning: This will delete all subsequent messages and revert file and
          task list changes.
        </Text>
      </Box>
    </Box>
  );
};

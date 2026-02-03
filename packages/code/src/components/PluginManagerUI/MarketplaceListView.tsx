import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { KnownMarketplace } from "wave-agent-sdk";

export interface MarketplaceListViewProps {
  marketplaces: KnownMarketplace[];
  onAdd: (source: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  onUpdate: (name: string) => Promise<void>;
  loading?: boolean;
}

export const MarketplaceListView: React.FC<MarketplaceListViewProps> = ({
  marketplaces,
  onAdd,
  onRemove,
  onUpdate,
  loading,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [newSource, setNewSource] = useState("");

  useInput((input, key) => {
    if (isAdding) {
      if (key.escape) {
        setIsAdding(false);
        setNewSource("");
        return;
      }
      if (key.return) {
        if (newSource.trim()) {
          onAdd(newSource.trim());
          setIsAdding(false);
          setNewSource("");
        }
        return;
      }
      if (key.backspace || key.delete) {
        setNewSource(newSource.slice(0, -1));
        return;
      }
      if (input) {
        setNewSource(newSource + input);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(Math.min(marketplaces.length - 1, selectedIndex + 1));
    }
    if (input === "a") {
      setIsAdding(true);
    }
    if (input === "r" && marketplaces.length > 0) {
      const m = marketplaces[selectedIndex];
      if (!m.isBuiltin) {
        onRemove(m.name);
      }
    }
    if (input === "u" && marketplaces.length > 0) {
      onUpdate(marketplaces[selectedIndex].name);
    }
  });

  if (loading && !isAdding) {
    return (
      <Box paddingY={1}>
        <Text color="yellow">Loading marketplaces...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {marketplaces.map((m, index) => (
        <Box key={m.name} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={index === selectedIndex ? "cyan" : undefined}>
              {index === selectedIndex ? "▶ " : "  "}
            </Text>
            <Text bold={index === selectedIndex}>{m.name}</Text>
            {m.isBuiltin && <Text color="gray"> (builtin)</Text>}
          </Box>
          <Box marginLeft={4}>
            <Text dimColor>
              Source:{" "}
              {m.source.source === "github"
                ? `GitHub (${m.source.repo})`
                : m.source.source === "directory"
                  ? `Local (${m.source.path})`
                  : `Git (${(m.source as { url: string }).url})`}
            </Text>
          </Box>
          {index === selectedIndex && !isAdding && (
            <Box marginLeft={4} marginTop={1}>
              <Text color="gray">Actions: </Text>
              <Text color="cyan">[u] Update </Text>
              {!m.isBuiltin && <Text color="red">[r] Remove </Text>}
            </Box>
          )}
        </Box>
      ))}

      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        {isAdding ? (
          <Box>
            <Text bold>Add Marketplace: </Text>
            <Text color="cyan">{newSource}</Text>
            <Text color="yellow">█</Text>
          </Box>
        ) : (
          <Text dimColor>
            Press [a] to add a new marketplace (GitHub repo or local path)
          </Text>
        )}
      </Box>
      {isAdding && (
        <Box marginLeft={1}>
          <Text dimColor>Enter to confirm • Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
};

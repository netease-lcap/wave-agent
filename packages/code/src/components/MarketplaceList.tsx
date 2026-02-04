import React from "react";
import { Box, Text } from "ink";
import { KnownMarketplace } from "wave-agent-sdk";

interface MarketplaceListProps {
  marketplaces: KnownMarketplace[];
  selectedIndex: number;
}

export const MarketplaceList: React.FC<MarketplaceListProps> = ({
  marketplaces,
  selectedIndex,
}) => {
  if (marketplaces.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No marketplaces registered.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {marketplaces.map((marketplace, index) => {
        const isSelected = index === selectedIndex;
        const sourceStr =
          marketplace.source.source === "directory"
            ? marketplace.source.path
            : marketplace.source.source === "github"
              ? marketplace.source.repo
              : marketplace.source.url;

        return (
          <Box key={marketplace.name} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "> " : "  "}
                <Text bold>{marketplace.name}</Text>
                {marketplace.isBuiltin && (
                  <Text color="yellow"> [Built-in]</Text>
                )}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <Text dimColor>Source: {sourceStr}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

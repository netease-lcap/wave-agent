import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { transformToolBlockToChanges } from "wave-agent-sdk";
import { diffLines, diffWords } from "diff";
import type { ToolBlock } from "wave-agent-sdk";

interface DiffDisplayProps {
  toolBlock: ToolBlock;
}

export const DiffDisplay: React.FC<DiffDisplayProps> = ({ toolBlock }) => {
  // Diff detection and transformation
  const changes = useMemo(() => {
    try {
      return transformToolBlockToChanges(toolBlock);
    } catch (error) {
      console.warn("Error transforming tool block to changes:", error);
      return [];
    }
  }, [toolBlock]);

  const showDiff =
    changes.length > 0 &&
    ["running", "end"].includes(toolBlock.stage) &&
    toolBlock.name &&
    ["Write", "Edit", "MultiEdit"].includes(toolBlock.name);

  // Render word-level diff for line-by-line comparison
  const renderWordLevelDiff = (
    oldLine: string,
    newLine: string,
    keyPrefix: string,
  ) => {
    try {
      const changes = diffWords(oldLine, newLine);

      const removedParts: React.ReactNode[] = [];
      const addedParts: React.ReactNode[] = [];

      changes.forEach((part, index) => {
        if (part.removed) {
          removedParts.push(
            <Text
              key={`removed-${keyPrefix}-${index}`}
              color="black"
              backgroundColor="red"
            >
              {part.value}
            </Text>,
          );
        } else if (part.added) {
          addedParts.push(
            <Text
              key={`added-${keyPrefix}-${index}`}
              color="black"
              backgroundColor="green"
            >
              {part.value}
            </Text>,
          );
        } else {
          // Unchanged parts
          removedParts.push(
            <Text key={`removed-unchanged-${keyPrefix}-${index}`} color="red">
              {part.value}
            </Text>,
          );
          addedParts.push(
            <Text key={`added-unchanged-${keyPrefix}-${index}`} color="green">
              {part.value}
            </Text>,
          );
        }
      });

      return { removedParts, addedParts };
    } catch (error) {
      console.warn("Error rendering word-level diff:", error);
      // Fallback to simple line display
      return {
        removedParts: [
          <Text key={`fallback-removed-${keyPrefix}`} color="red">
            {oldLine}
          </Text>,
        ],
        addedParts: [
          <Text key={`fallback-added-${keyPrefix}`} color="green">
            {newLine}
          </Text>,
        ],
      };
    }
  };

  // Render expanded diff display using diffLines with word-level support
  const renderExpandedDiff = () => {
    try {
      if (changes.length === 0) return null;

      return (
        <Box flexDirection="column">
          {changes.map((change, changeIndex) => {
            try {
              const lineDiffs = diffLines(
                change.oldContent || "",
                change.newContent || "",
              );

              // For simple single-line changes, use word-level diff
              const isSingleLineChange =
                !change.oldContent.includes("\n") &&
                !change.newContent.includes("\n") &&
                change.oldContent.trim() !== "" &&
                change.newContent.trim() !== "";

              if (isSingleLineChange) {
                const { removedParts, addedParts } = renderWordLevelDiff(
                  change.oldContent,
                  change.newContent,
                  `change-${changeIndex}`,
                );

                return (
                  <Box key={changeIndex} flexDirection="column">
                    <Box flexDirection="row">
                      <Text color="red">-</Text>
                      {removedParts}
                    </Box>
                    <Box flexDirection="row">
                      <Text color="green">+</Text>
                      {addedParts}
                    </Box>
                  </Box>
                );
              }

              // For multi-line changes, use line-level diff
              return (
                <Box key={changeIndex} flexDirection="column">
                  {lineDiffs.map((part, partIndex) => {
                    if (part.added) {
                      return part.value
                        .split("\n")
                        .filter((line) => line !== "")
                        .map((line, lineIndex) => (
                          <Text
                            key={`add-${changeIndex}-${partIndex}-${lineIndex}`}
                            color="green"
                          >
                            +{line}
                          </Text>
                        ));
                    } else if (part.removed) {
                      return part.value
                        .split("\n")
                        .filter((line) => line !== "")
                        .map((line, lineIndex) => (
                          <Text
                            key={`remove-${changeIndex}-${partIndex}-${lineIndex}`}
                            color="red"
                          >
                            -{line}
                          </Text>
                        ));
                    } else {
                      // Context lines - show unchanged content
                      return part.value
                        .split("\n")
                        .filter((line) => line !== "")
                        .map((line, lineIndex) => (
                          <Text
                            key={`context-${changeIndex}-${partIndex}-${lineIndex}`}
                            color="white"
                          >
                            {" "}
                            {line}
                          </Text>
                        ));
                    }
                  })}
                </Box>
              );
            } catch (error) {
              console.warn(
                `Error rendering diff for change ${changeIndex}:`,
                error,
              );
              // Fallback to simple display
              return (
                <Box key={changeIndex} flexDirection="column">
                  <Text color="red">-{change.oldContent || ""}</Text>
                  <Text color="green">+{change.newContent || ""}</Text>
                </Box>
              );
            }
          })}
        </Box>
      );
    } catch (error) {
      console.warn("Error rendering expanded diff:", error);
      return (
        <Box>
          <Text color="gray">Error rendering diff display</Text>
        </Box>
      );
    }
  };

  // Don't render anything if no diff should be shown
  if (!showDiff) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {showDiff && (
        <Box
          paddingLeft={2}
          borderLeft
          borderColor="cyan"
          flexDirection="column"
        >
          <Text color="cyan" bold>
            Diff:
          </Text>
          {renderExpandedDiff()}
        </Box>
      )}
    </Box>
  );
};

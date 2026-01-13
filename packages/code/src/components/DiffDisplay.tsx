import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { transformToolBlockToChanges } from "../utils/toolParameterTransforms.js";
import { diffLines, diffWords } from "diff";
import type { ToolBlock } from "wave-agent-sdk";

interface DiffDisplayProps {
  toolBlock: ToolBlock;
}

export const DiffDisplay: React.FC<DiffDisplayProps> = ({ toolBlock }) => {
  const { stdout } = useStdout();
  const maxHeight = useMemo(() => {
    return Math.max(5, (stdout?.rows || 24) - 10);
  }, [stdout?.rows]);

  const showDiff =
    ["running", "end"].includes(toolBlock.stage) &&
    toolBlock.name &&
    ["Write", "Edit", "MultiEdit"].includes(toolBlock.name);

  // Diff detection and transformation using typed parameters
  const changes = useMemo(() => {
    if (!showDiff || !toolBlock.name || !toolBlock.parameters) return [];
    try {
      // Use local transformation with JSON parsing and type guards
      return transformToolBlockToChanges(toolBlock.name, toolBlock.parameters);
    } catch (error) {
      console.warn("Error transforming tool block to changes:", error);
      return [];
    }
  }, [toolBlock.name, toolBlock.parameters, showDiff]);

  // Render word-level diff between two lines of text
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

  // Render expanded diff display using word-level diff for all changes
  const renderExpandedDiff = () => {
    try {
      if (changes.length === 0) return null;

      const allElements: React.ReactNode[] = [];

      changes.forEach((change, changeIndex) => {
        try {
          // Get line-level diff to understand the structure
          const lineDiffs = diffLines(
            change.oldContent || "",
            change.newContent || "",
          );

          const diffElements: React.ReactNode[] = [];

          // Process line diffs and apply word-level diff to changed lines
          lineDiffs.forEach((part, partIndex) => {
            if (part.added) {
              const lines = part.value
                .split("\n")
                .filter((line) => line !== "");
              lines.forEach((line, lineIndex) => {
                diffElements.push(
                  <Box
                    key={`add-${changeIndex}-${partIndex}-${lineIndex}`}
                    flexDirection="row"
                  >
                    <Text color="green">+</Text>
                    <Text color="green">{line}</Text>
                  </Box>,
                );
              });
            } else if (part.removed) {
              const lines = part.value
                .split("\n")
                .filter((line) => line !== "");
              lines.forEach((line, lineIndex) => {
                diffElements.push(
                  <Box
                    key={`remove-${changeIndex}-${partIndex}-${lineIndex}`}
                    flexDirection="row"
                  >
                    <Text color="red">-</Text>
                    <Text color="red">{line}</Text>
                  </Box>,
                );
              });
            } else {
              // Context lines - show unchanged content
              const lines = part.value
                .split("\n")
                .filter((line) => line !== "");
              lines.forEach((line, lineIndex) => {
                diffElements.push(
                  <Box
                    key={`context-${changeIndex}-${partIndex}-${lineIndex}`}
                    flexDirection="row"
                  >
                    <Text color="white"> </Text>
                    <Text color="white">{line}</Text>
                  </Box>,
                );
              });
            }
          });

          // Now look for pairs of removed/added lines that can be word-diffed
          let i = 0;

          while (i < diffElements.length) {
            const current = diffElements[i];
            const next =
              i + 1 < diffElements.length ? diffElements[i + 1] : null;

            // Check if we have a removed line followed by an added line
            const currentKey = React.isValidElement(current) ? current.key : "";
            const nextKey = React.isValidElement(next) ? next.key : "";

            const isCurrentRemoved =
              typeof currentKey === "string" && currentKey.includes("remove-");
            const isNextAdded =
              typeof nextKey === "string" && nextKey.includes("add-");

            if (
              isCurrentRemoved &&
              isNextAdded &&
              React.isValidElement(current) &&
              React.isValidElement(next)
            ) {
              // Extract the text content from the removed and added lines
              const removedText = extractTextFromElement(current);
              const addedText = extractTextFromElement(next);

              if (removedText && addedText) {
                // Apply word-level diff
                const { removedParts, addedParts } = renderWordLevelDiff(
                  removedText,
                  addedText,
                  `word-${changeIndex}-${i}`,
                );

                allElements.push(
                  <Box
                    key={`word-diff-removed-${changeIndex}-${i}`}
                    flexDirection="row"
                  >
                    <Text color="red">-</Text>
                    {removedParts}
                  </Box>,
                );
                allElements.push(
                  <Box
                    key={`word-diff-added-${changeIndex}-${i}`}
                    flexDirection="row"
                  >
                    <Text color="green">+</Text>
                    {addedParts}
                  </Box>,
                );

                i += 2; // Skip the next element since we processed it
              } else {
                // Fallback to original elements
                allElements.push(current);
                i += 1;
              }
            } else {
              allElements.push(current);
              i += 1;
            }
          }
        } catch (error) {
          console.warn(
            `Error rendering diff for change ${changeIndex}:`,
            error,
          );
          // Fallback to simple display
          allElements.push(
            <Box key={`fallback-${changeIndex}`} flexDirection="column">
              <Text color="red">-{change.oldContent || ""}</Text>
              <Text color="green">+{change.newContent || ""}</Text>
            </Box>,
          );
        }
      });

      const isTruncated = allElements.length > maxHeight;
      const displayElements = isTruncated
        ? allElements.slice(0, maxHeight - 1)
        : allElements;

      return (
        <Box flexDirection="column">
          {displayElements}
          {isTruncated && (
            <Text color="yellow" dimColor>
              ... (truncated {allElements.length - (maxHeight - 1)} more lines)
            </Text>
          )}
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

  // Helper function to extract text content from a React element
  const extractTextFromElement = (element: React.ReactNode): string | null => {
    if (!React.isValidElement(element)) return null;

    // Navigate through Box -> Text structure
    const children = (
      element.props as unknown as { children?: React.ReactNode[] }
    ).children;
    if (Array.isArray(children) && children.length >= 2) {
      const textElement = children[1]; // Second child should be the Text with content
      if (
        React.isValidElement(textElement) &&
        (textElement.props as unknown as { children?: string }).children
      ) {
        return (textElement.props as unknown as { children: string }).children;
      }
    }
    return null;
  };

  // Don't render anything if no diff should be shown
  if (!showDiff) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2} borderLeft borderColor="cyan" flexDirection="column">
        <Text color="cyan" bold>
          Diff:
        </Text>
        {renderExpandedDiff()}
      </Box>
    </Box>
  );
};

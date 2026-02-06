import React, { useMemo } from "react";
import { Box, Text } from "ink";
import {
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
} from "wave-agent-sdk";
import { transformToolBlockToChanges } from "../utils/toolParameterTransforms.js";
import { diffLines, diffWords } from "diff";

interface DiffDisplayProps {
  toolName?: string;
  parameters?: string;
}

export const DiffDisplay: React.FC<DiffDisplayProps> = ({
  toolName,
  parameters,
}) => {
  const showDiff =
    toolName &&
    [WRITE_TOOL_NAME, EDIT_TOOL_NAME, MULTI_EDIT_TOOL_NAME].includes(toolName);

  // Diff detection and transformation using typed parameters
  const changes = useMemo(() => {
    if (!showDiff || !toolName || !parameters) return [];
    try {
      // Use local transformation with JSON parsing and type guards
      return transformToolBlockToChanges(toolName, parameters);
    } catch (error) {
      console.warn("Error transforming tool block to changes:", error);
      return [];
    }
  }, [toolName, parameters, showDiff]);

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

  // Render expanded diff display
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

          // Process line diffs
          const diffElements: React.ReactNode[] = [];
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

          // If it's a single line change (one removed, one added), use word-level diff
          if (
            diffElements.length === 2 &&
            React.isValidElement(diffElements[0]) &&
            React.isValidElement(diffElements[1]) &&
            typeof diffElements[0].key === "string" &&
            diffElements[0].key.includes("remove-") &&
            typeof diffElements[1].key === "string" &&
            diffElements[1].key.includes("add-")
          ) {
            const removedText = extractTextFromElement(diffElements[0]);
            const addedText = extractTextFromElement(diffElements[1]);

            if (removedText && addedText) {
              const { removedParts, addedParts } = renderWordLevelDiff(
                removedText,
                addedText,
                `word-${changeIndex}`,
              );

              allElements.push(
                <Box
                  key={`word-diff-removed-${changeIndex}`}
                  flexDirection="row"
                >
                  <Text color="red">-</Text>
                  {removedParts}
                </Box>,
              );
              allElements.push(
                <Box key={`word-diff-added-${changeIndex}`} flexDirection="row">
                  <Text color="green">+</Text>
                  {addedParts}
                </Box>,
              );
            } else {
              allElements.push(...diffElements);
            }
          } else {
            allElements.push(...diffElements);
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

      return <Box flexDirection="column">{allElements}</Box>;
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
      <Box paddingLeft={2} borderLeft borderColor="cyan" flexDirection="column">
        <Text color="cyan" bold>
          Diff:
        </Text>
        {renderExpandedDiff()}
      </Box>
    </Box>
  );
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

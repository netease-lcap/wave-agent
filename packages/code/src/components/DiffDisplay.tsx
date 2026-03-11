import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from "wave-agent-sdk";
import { transformToolBlockToChanges } from "../utils/toolParameterTransforms.js";
import { diffLines, diffWords } from "diff";

interface DiffDisplayProps {
  toolName?: string;
  parameters?: string;
  startLineNumber?: number;
}

export const DiffDisplay: React.FC<DiffDisplayProps> = ({
  toolName,
  parameters,
  startLineNumber,
}) => {
  const showDiff =
    toolName && [WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(toolName);

  // Diff detection and transformation using typed parameters
  const changes = useMemo(() => {
    if (!showDiff || !toolName || !parameters) return [];
    try {
      // Use local transformation with JSON parsing and type guards
      return transformToolBlockToChanges(toolName, parameters, startLineNumber);
    } catch (error) {
      console.warn("Error transforming tool block to changes:", error);
      return [];
    }
  }, [toolName, parameters, showDiff, startLineNumber]);

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

      const maxLineNum = changes.reduce((max, change) => {
        const oldLines = (change.oldContent || "").split("\n").length;
        const newLines = (change.newContent || "").split("\n").length;
        const start = change.startLineNumber || 1;
        // For Edit tool, the diff might show context lines before/after the change.
        // The startLineNumber is the line where old_string starts.
        // diffLines will include context lines if they are part of the change object.
        // However, our transformEditParameters currently only puts old_string/new_string.
        // If we ever support context lines in the Change object, we need to be careful.
        return Math.max(max, start + oldLines, start + newLines);
      }, 0);
      const maxDigits = Math.max(2, maxLineNum.toString().length);

      const renderLine = (
        oldLineNum: number | null,
        newLineNum: number | null,
        prefix: string,
        content: React.ReactNode,
        color: string,
        key: string,
      ) => {
        const formatNum = (num: number | null) =>
          num === null
            ? " ".repeat(maxDigits)
            : num.toString().padStart(maxDigits);

        return (
          <Box key={key} flexDirection="row">
            <Text color="gray">{formatNum(oldLineNum)} </Text>
            <Text color="gray">{formatNum(newLineNum)} </Text>
            <Text color="gray">| </Text>
            <Text color={color}>{prefix}</Text>
            <Text color={color}>{content}</Text>
          </Box>
        );
      };

      const allElements: React.ReactNode[] = [];

      changes.forEach((change, changeIndex) => {
        try {
          // Get line-level diff to understand the structure
          const lineDiffs = diffLines(
            change.oldContent || "",
            change.newContent || "",
          );

          let oldLineNum = change.startLineNumber || 1;
          let newLineNum = change.startLineNumber || 1;

          // Process line diffs
          const diffElements: React.ReactNode[] = [];
          for (let i = 0; i < lineDiffs.length; i++) {
            const part = lineDiffs[i];
            const lines = part.value.split("\n");
            // diffLines might return a trailing empty string if the content ends with a newline
            if (lines[lines.length - 1] === "") {
              lines.pop();
            }

            if (part.removed) {
              // Look ahead for an added block
              if (i + 1 < lineDiffs.length && lineDiffs[i + 1].added) {
                const nextPart = lineDiffs[i + 1];
                const addedLines = nextPart.value.split("\n");
                if (addedLines[addedLines.length - 1] === "") {
                  addedLines.pop();
                }

                if (lines.length === addedLines.length) {
                  // Word-level diffing
                  lines.forEach((line, lineIndex) => {
                    const { removedParts, addedParts } = renderWordLevelDiff(
                      line,
                      addedLines[lineIndex],
                      `word-${changeIndex}-${i}-${lineIndex}`,
                    );
                    diffElements.push(
                      renderLine(
                        oldLineNum++,
                        null,
                        "-",
                        removedParts,
                        "red",
                        `remove-${changeIndex}-${i}-${lineIndex}`,
                      ),
                    );
                    diffElements.push(
                      renderLine(
                        null,
                        newLineNum++,
                        "+",
                        addedParts,
                        "green",
                        `add-${changeIndex}-${i}-${lineIndex}`,
                      ),
                    );
                  });
                  i++; // Skip the added block
                  continue;
                }
              }

              // Fallback to standard removed rendering
              lines.forEach((line, lineIndex) => {
                diffElements.push(
                  renderLine(
                    oldLineNum++,
                    null,
                    "-",
                    line,
                    "red",
                    `remove-${changeIndex}-${i}-${lineIndex}`,
                  ),
                );
              });
            } else if (part.added) {
              lines.forEach((line, lineIndex) => {
                diffElements.push(
                  renderLine(
                    null,
                    newLineNum++,
                    "+",
                    line,
                    "green",
                    `add-${changeIndex}-${i}-${lineIndex}`,
                  ),
                );
              });
            } else {
              // Context lines - show unchanged content
              const isFirstBlock = i === 0;
              const isLastBlock = i === lineDiffs.length - 1;

              let linesToDisplay = lines;
              let showEllipsisTop = false;
              let showEllipsisBottom = false;

              if (isFirstBlock && !isLastBlock) {
                // First block: keep last 3
                if (lines.length > 3) {
                  const skipCount = lines.length - 3;
                  oldLineNum += skipCount;
                  newLineNum += skipCount;
                  linesToDisplay = lines.slice(-3);
                  showEllipsisTop = true;
                }
              } else if (isLastBlock && !isFirstBlock) {
                // Last block: keep first 3
                if (lines.length > 3) {
                  linesToDisplay = lines.slice(0, 3);
                  showEllipsisBottom = true;
                }
              } else if (!isFirstBlock && !isLastBlock) {
                // Middle block: keep first 3 and last 3
                if (lines.length > 6) {
                  linesToDisplay = [...lines.slice(0, 3), ...lines.slice(-3)];
                  showEllipsisTop = false; // We'll put ellipsis in the middle
                }
              }

              if (showEllipsisTop) {
                diffElements.push(
                  <Box key={`ellipsis-top-${changeIndex}-${i}`}>
                    <Text color="gray">{" ".repeat(maxDigits * 2 + 2)}...</Text>
                  </Box>,
                );
              }

              linesToDisplay.forEach((line, lineIndex) => {
                // If it's a middle block and we are at the split point
                if (
                  !isFirstBlock &&
                  !isLastBlock &&
                  lines.length > 6 &&
                  lineIndex === 3
                ) {
                  const skipCount = lines.length - 6;
                  oldLineNum += skipCount;
                  newLineNum += skipCount;
                  diffElements.push(
                    <Box key={`ellipsis-mid-${changeIndex}-${i}`}>
                      <Text color="gray">
                        {" ".repeat(maxDigits * 2 + 2)}...
                      </Text>
                    </Box>,
                  );
                }

                diffElements.push(
                  renderLine(
                    oldLineNum++,
                    newLineNum++,
                    " ",
                    line,
                    "white",
                    `context-${changeIndex}-${i}-${lineIndex}`,
                  ),
                );
              });

              if (showEllipsisBottom) {
                const skipCount = lines.length - linesToDisplay.length;
                // We don't increment oldLineNum/newLineNum here because they are already incremented in the loop
                // But we need to account for the lines we skipped at the end of this block
                oldLineNum += skipCount;
                newLineNum += skipCount;
                diffElements.push(
                  <Box key={`ellipsis-bottom-${changeIndex}-${i}`}>
                    <Text color="gray">{" ".repeat(maxDigits * 2 + 2)}...</Text>
                  </Box>,
                );
              }
            }
          }
          allElements.push(...diffElements);
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
        {renderExpandedDiff()}
      </Box>
    </Box>
  );
};

import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { diffWords } from "diff";
import { parse, setOptions } from "marked";
import TerminalRenderer from "marked-terminal";
import type { DiffBlock } from "wave-agent-sdk";

interface DiffViewerProps {
  block: DiffBlock;
  isExpanded?: boolean;
}

// Check if diff is all additions (new file or only new code)
const isAllAdditions = (
  diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
): boolean => {
  return diffResult.every((part) => !part.removed);
};

// Extract all added content from diff
const extractAddedContent = (
  diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
): string => {
  return diffResult
    .filter((part) => part.added)
    .map((part) => part.value)
    .join("")
    .trim();
};

const countAddedLines = (
  diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
): number => {
  return diffResult.reduce((total, part) => {
    if (!part.added) return total;
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return total + lines.length;
  }, 0);
};

// Markdown component for syntax highlighting (reused from MessageList)
const CodeHighlight = ({
  children,
  language,
}: {
  children: string;
  language?: string;
}) => {
  const markdownContent = language
    ? `\`\`\`${language}\n${children}\n\`\`\``
    : `\`\`\`\n${children}\n\`\`\``;

  setOptions({
    renderer: new TerminalRenderer(
      {}, // Default options
      {}, // Empty highlightOptions, let cli-highlight auto-handle
    ) as unknown as Parameters<typeof setOptions>[0]["renderer"],
  });

  const result = parse(markdownContent);
  const output = typeof result === "string" ? result.trim() : "";
  return <Text>{output}</Text>;
};

// Render word-level diff
const renderWordLevelDiff = (removedLine: string, addedLine: string) => {
  const changes = diffWords(removedLine, addedLine);

  const removedParts: React.ReactNode[] = [];
  const addedParts: React.ReactNode[] = [];

  changes.forEach((part, index) => {
    if (part.removed) {
      removedParts.push(
        <Text key={`removed-${index}`} color="black" backgroundColor="red">
          {part.value}
        </Text>,
      );
    } else if (part.added) {
      addedParts.push(
        <Text key={`added-${index}`} color="black" backgroundColor="green">
          {part.value}
        </Text>,
      );
    } else {
      // Unchanged parts, need to display on both sides
      removedParts.push(
        <Text key={`removed-unchanged-${index}`} color="red">
          {part.value}
        </Text>,
      );
      addedParts.push(
        <Text key={`added-unchanged-${index}`} color="green">
          {part.value}
        </Text>,
      );
    }
  });

  return { removedParts, addedParts };
};

export const DiffViewer: React.FC<DiffViewerProps> = ({
  block,
  isExpanded = false,
}) => {
  const { diffResult } = block;

  // Check if this is all additions and try syntax highlighting
  const shouldUseSyntaxHighlighting = useMemo(() => {
    if (!diffResult) return false;
    if (!isAllAdditions(diffResult)) return false;
    return countAddedLines(diffResult) > 3;
  }, [diffResult]);

  const addedContent = useMemo(() => {
    if (!shouldUseSyntaxHighlighting || !diffResult) return "";
    return extractAddedContent(diffResult);
  }, [shouldUseSyntaxHighlighting, diffResult]);

  const diffLines = useMemo(() => {
    if (!diffResult) return [];

    const lines: Array<{
      content: string;
      type: "added" | "removed" | "unchanged" | "separator";
      lineNumber?: number;
      rawContent?: string; // Store original content for word-level comparison
      wordDiff?: {
        removedParts: React.ReactNode[];
        addedParts: React.ReactNode[];
      };
    }> = [];

    let originalLineNum = 1;
    let modifiedLineNum = 1;
    const maxContext = 3; // Show at most 3 lines of context

    // Buffer for storing context
    let contextBuffer: Array<{
      content: string;
      type: "unchanged";
      lineNumber: number;
    }> = [];

    let hasAnyChanges = false;
    let afterChangeContext = 0;

    // Temporarily store adjacent deleted and added lines for word-level comparison
    let pendingRemovedLines: Array<{
      content: string;
      rawContent: string;
      lineNumber: number;
    }> = [];

    const flushPendingLines = () => {
      pendingRemovedLines.forEach((line) => {
        lines.push({
          content: line.content,
          type: "removed",
          lineNumber: line.lineNumber,
          rawContent: line.rawContent,
        });
      });
      pendingRemovedLines = [];
    };

    diffResult.forEach(
      (part: { value: string; added?: boolean; removed?: boolean }) => {
        const partLines = part.value.split("\n");
        // Remove the last empty line (produced by split)
        if (partLines[partLines.length - 1] === "") {
          partLines.pop();
        }

        if (part.removed) {
          // If this is the first change encountered, add preceding context
          if (!hasAnyChanges) {
            // Take the last few lines from the buffer as preceding context
            const preContext = contextBuffer.slice(-maxContext);
            if (contextBuffer.length > maxContext) {
              lines.push({
                content: "...",
                type: "separator",
              });
            }
            lines.push(...preContext);
          } else if (afterChangeContext > maxContext) {
            // If there's too much context after the previous change, add a separator
            lines.push({
              content: "...",
              type: "separator",
            });
          }

          // Temporarily store deleted lines, waiting for possible added lines for word-level comparison
          partLines.forEach((line: string) => {
            pendingRemovedLines.push({
              content: `- ${line}`,
              rawContent: line,
              lineNumber: originalLineNum++,
            });
          });

          hasAnyChanges = true;
          afterChangeContext = 0;
          contextBuffer = []; // Clear buffer
        } else if (part.added) {
          // If this is the first change encountered, add preceding context
          if (!hasAnyChanges) {
            const preContext = contextBuffer.slice(-maxContext);
            if (contextBuffer.length > maxContext) {
              lines.push({
                content: "...",
                type: "separator",
              });
            }
            lines.push(...preContext);
          } else if (afterChangeContext > maxContext) {
            lines.push({
              content: "...",
              type: "separator",
            });
          }

          // Process added lines, try to do word-level comparison with pending deleted lines
          partLines.forEach((line: string, index: number) => {
            if (index < pendingRemovedLines.length) {
              // Has corresponding deleted line, perform word-level comparison
              const removedLine = pendingRemovedLines[index];
              const wordDiff = renderWordLevelDiff(
                removedLine.rawContent,
                line,
              );

              // Add deleted line (with word-level highlighting)
              lines.push({
                content: `- ${removedLine.rawContent}`,
                type: "removed",
                lineNumber: removedLine.lineNumber,
                rawContent: removedLine.rawContent,
                wordDiff: {
                  removedParts: wordDiff.removedParts,
                  addedParts: [],
                },
              });

              // Add added line (with word-level highlighting)
              lines.push({
                content: `+ ${line}`,
                type: "added",
                lineNumber: modifiedLineNum++,
                rawContent: line,
                wordDiff: { removedParts: [], addedParts: wordDiff.addedParts },
              });
            } else {
              // No corresponding deleted line, directly add the added line
              lines.push({
                content: `+ ${line}`,
                type: "added",
                lineNumber: modifiedLineNum++,
                rawContent: line,
              });
            }
          });

          // If there are more deleted lines than added lines, add remaining deleted lines
          for (let i = partLines.length; i < pendingRemovedLines.length; i++) {
            const removedLine = pendingRemovedLines[i];
            lines.push({
              content: removedLine.content,
              type: "removed",
              lineNumber: removedLine.lineNumber,
              rawContent: removedLine.rawContent,
            });
          }

          pendingRemovedLines = []; // Clear pending deleted lines
          hasAnyChanges = true;
          afterChangeContext = 0;
          contextBuffer = [];
        } else {
          // Before processing unchanged lines, first clear pending deleted lines
          flushPendingLines();

          // Process unchanged lines
          partLines.forEach((line: string) => {
            const contextLine = {
              content: `  ${line}`,
              type: "unchanged" as const,
              lineNumber: originalLineNum,
            };

            if (hasAnyChanges) {
              // If there are already changes, these are post-change context
              if (afterChangeContext < maxContext) {
                lines.push(contextLine);
                afterChangeContext++;
              }
            } else {
              // If no changes yet, add to buffer
              contextBuffer.push(contextLine);
            }

            originalLineNum++;
            modifiedLineNum++;
          });
        }
      },
    );

    // Handle remaining deleted lines at the end
    flushPendingLines();

    // Only limit displayed lines in collapsed state
    if (!isExpanded) {
      const MAX_DISPLAY_LINES = 50;
      if (lines.length > MAX_DISPLAY_LINES) {
        const truncatedLines = lines.slice(0, MAX_DISPLAY_LINES);
        truncatedLines.push({
          content: `... (${lines.length - MAX_DISPLAY_LINES} more lines truncated, press Ctrl+O to expand)`,
          type: "separator",
        });
        return truncatedLines;
      }
    }

    return lines;
  }, [diffResult, isExpanded]);

  if (!diffResult || diffResult.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No changes detected</Text>
      </Box>
    );
  }

  // If it's all additions and we have content, show syntax-highlighted version
  if (shouldUseSyntaxHighlighting && addedContent.trim()) {
    return (
      <Box flexDirection="column">
        <CodeHighlight language="">{addedContent}</CodeHighlight>
      </Box>
    );
  }

  // Fall back to traditional diff view
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box flexDirection="column">
          {diffLines.map((line, index) => {
            // If has word-level diff, render special effects
            if (line.wordDiff) {
              const prefix = line.type === "removed" ? "- " : "+ ";
              const parts =
                line.type === "removed"
                  ? line.wordDiff.removedParts
                  : line.wordDiff.addedParts;

              return (
                <Box key={index} flexDirection="row">
                  <Text color={line.type === "removed" ? "red" : "green"}>
                    {prefix}
                  </Text>
                  <Box flexDirection="row" flexWrap="wrap">
                    {parts}
                  </Box>
                </Box>
              );
            }

            // Normal rendering
            return (
              <Text
                key={index}
                color={
                  line.type === "added"
                    ? "green"
                    : line.type === "removed"
                      ? "red"
                      : line.type === "separator"
                        ? "gray"
                        : "white"
                }
                dimColor={line.type === "separator"}
              >
                {line.content}
              </Text>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

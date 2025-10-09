import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { diffWords } from "diff";
import type { DiffBlock } from "wave-agent-sdk";

interface DiffViewerProps {
  block: DiffBlock;
  isExpanded?: boolean;
}

// 渲染单词级 diff
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
      // 未改变的部分，两边都要显示
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

  const diffLines = useMemo(() => {
    if (!diffResult) return [];

    const lines: Array<{
      content: string;
      type: "added" | "removed" | "unchanged" | "separator";
      lineNumber?: number;
      rawContent?: string; // 存储原始内容用于单词级对比
      wordDiff?: {
        removedParts: React.ReactNode[];
        addedParts: React.ReactNode[];
      };
    }> = [];

    let originalLineNum = 1;
    let modifiedLineNum = 1;
    const maxContext = 3; // 最多显示3行上下文

    // 用于存储上下文的缓冲区
    let contextBuffer: Array<{
      content: string;
      type: "unchanged";
      lineNumber: number;
    }> = [];

    let hasAnyChanges = false;
    let afterChangeContext = 0;

    // 临时存储相邻的删除和新增行，用于单词级对比
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
        // 移除最后一个空行（split产生的）
        if (partLines[partLines.length - 1] === "") {
          partLines.pop();
        }

        if (part.removed) {
          // 如果这是第一次遇到变更，添加前面的上下文
          if (!hasAnyChanges) {
            // 取缓冲区中最后几行作为前置上下文
            const preContext = contextBuffer.slice(-maxContext);
            if (contextBuffer.length > maxContext) {
              lines.push({
                content: "...",
                type: "separator",
              });
            }
            lines.push(...preContext);
          } else if (afterChangeContext > maxContext) {
            // 如果上一个变更后的上下文太多，添加分隔符
            lines.push({
              content: "...",
              type: "separator",
            });
          }

          // 暂存删除行，等待可能的新增行来做单词级对比
          partLines.forEach((line: string) => {
            pendingRemovedLines.push({
              content: `- ${line}`,
              rawContent: line,
              lineNumber: originalLineNum++,
            });
          });

          hasAnyChanges = true;
          afterChangeContext = 0;
          contextBuffer = []; // 清空缓冲区
        } else if (part.added) {
          // 如果这是第一次遇到变更，添加前面的上下文
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

          // 处理新增行，尝试与待处理的删除行做单词级对比
          partLines.forEach((line: string, index: number) => {
            if (index < pendingRemovedLines.length) {
              // 有对应的删除行，进行单词级对比
              const removedLine = pendingRemovedLines[index];
              const wordDiff = renderWordLevelDiff(
                removedLine.rawContent,
                line,
              );

              // 添加删除行（带单词级高亮）
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

              // 添加新增行（带单词级高亮）
              lines.push({
                content: `+ ${line}`,
                type: "added",
                lineNumber: modifiedLineNum++,
                rawContent: line,
                wordDiff: { removedParts: [], addedParts: wordDiff.addedParts },
              });
            } else {
              // 没有对应的删除行，直接添加新增行
              lines.push({
                content: `+ ${line}`,
                type: "added",
                lineNumber: modifiedLineNum++,
                rawContent: line,
              });
            }
          });

          // 如果删除行比新增行多，添加剩余的删除行
          for (let i = partLines.length; i < pendingRemovedLines.length; i++) {
            const removedLine = pendingRemovedLines[i];
            lines.push({
              content: removedLine.content,
              type: "removed",
              lineNumber: removedLine.lineNumber,
              rawContent: removedLine.rawContent,
            });
          }

          pendingRemovedLines = []; // 清空待处理的删除行
          hasAnyChanges = true;
          afterChangeContext = 0;
          contextBuffer = [];
        } else {
          // 处理未变更的行前，先清空待处理的删除行
          flushPendingLines();

          // 处理未变更的行
          partLines.forEach((line: string) => {
            const contextLine = {
              content: `  ${line}`,
              type: "unchanged" as const,
              lineNumber: originalLineNum,
            };

            if (hasAnyChanges) {
              // 如果已经有变更，这些是后置上下文
              if (afterChangeContext < maxContext) {
                lines.push(contextLine);
                afterChangeContext++;
              }
            } else {
              // 如果还没有变更，加入缓冲区
              contextBuffer.push(contextLine);
            }

            originalLineNum++;
            modifiedLineNum++;
          });
        }
      },
    );

    // 处理结尾可能剩余的删除行
    flushPendingLines();

    // 只在折叠状态下限制显示行数
    if (!isExpanded) {
      const MAX_DISPLAY_LINES = 50;
      if (lines.length > MAX_DISPLAY_LINES) {
        const truncatedLines = lines.slice(0, MAX_DISPLAY_LINES);
        truncatedLines.push({
          content: `... (${lines.length - MAX_DISPLAY_LINES} more lines truncated, press Ctrl+R to expand)`,
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

  return (
    <Box flexDirection="column">
      {block.warning && (
        <Box marginBottom={1}>
          <Text color="red" bold>
            ⚠️ {block.warning}
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Box flexDirection="column">
          {diffLines.map((line, index) => {
            // 如果有单词级 diff，渲染特殊效果
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

            // 普通渲染
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

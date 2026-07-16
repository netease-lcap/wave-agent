import React, { useMemo } from 'react';
import { diffLines, diffWords, type Change } from 'diff';
import { transformToolBlockToChanges, transformParametersToChanges } from '../utils/diffTransform';
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from 'wave-agent-sdk/dist/constants/tools.js';
import type { ToolBlock } from 'wave-agent-sdk/dist/types/messaging.js';
import '../styles/DiffViewer.css';

interface DiffViewerProps {
  toolBlock?: ToolBlock;
  toolName?: string;
  parameters?: unknown;
}

/**
 * DiffViewer component that extracts and displays diffs from tool blocks
 * Uses transformToolBlockToChanges from wave-agent-sdk to get file changes
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({ toolBlock, toolName, parameters }) => {

  // Diff detection and transformation
  const changes = useMemo(() => {
    try {
      if (toolBlock) {
        // Skip parsing during streaming - parameters are still being received and incomplete
        if (toolBlock.stage === 'streaming') {
          return [];
        }
        return transformToolBlockToChanges(toolBlock);
      } else if (toolName && parameters) {
        return transformParametersToChanges(toolName, parameters);
      }
      return [];
    } catch (error) {
      console.warn("Error transforming tool block to changes:", error);
      return [];
    }
  }, [toolBlock, toolName, parameters]);

  const showDiff =
    changes.length > 0 &&
    (toolBlock ? ["end"].includes(toolBlock.stage) : true) &&
    (toolBlock?.name || toolName) &&
    [WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(toolBlock?.name || toolName || "");

  // Render word-level diff for line-by-line comparison
  const renderWordLevelDiff = (
    oldLine: string,
    newLine: string,
    keyPrefix: string,
  ) => {
    const wordChanges = diffWords(oldLine, newLine);

    const removedParts: React.ReactNode[] = [];
    const addedParts: React.ReactNode[] = [];

    wordChanges.forEach((part, index) => {
      if (part.removed) {
        removedParts.push(
          <span
            key={`removed-${keyPrefix}-${index}`}
            className="diff-word-removed"
          >
            {part.value}
          </span>
        );
      } else if (part.added) {
        addedParts.push(
          <span
            key={`added-${keyPrefix}-${index}`}
            className="diff-word-added"
          >
            {part.value}
          </span>
        );
      } else {
        // Unchanged parts
        removedParts.push(
          <span key={`removed-unchanged-${keyPrefix}-${index}`} className="diff-word-unchanged">
            {part.value}
          </span>
        );
        addedParts.push(
          <span key={`added-unchanged-${keyPrefix}-${index}`} className="diff-word-unchanged">
            {part.value}
          </span>
        );
      }
    });

    return { removedParts, addedParts };
  };

  // Render expanded diff display using word-level diff for all scenarios
  const renderExpandedDiff = () => {
    if (changes.length === 0) return null;

    return (
      <div className="diff-changes">
        {changes.map((change, changeIndex) => {
          const lineDiffsResult = diffLines(
            change.oldContent || "",
            change.newContent || "",
          );

          // Extract removed and added lines for word-level comparison
          const diffLinesElements: React.ReactNode[] = [];
          let pendingRemoved: string[] = [];
          let pendingAdded: string[] = [];
          let groupIndex = 0;

          const splitLines = (text: string) => {
            if (!text) return [];
            const lines = text.split("\n");
            // If the last line is empty, it's usually because the text ended with a newline
            if (lines.length > 0 && lines[lines.length - 1] === "") {
              return lines.slice(0, -1);
            }
            return lines;
          };

          const flushPending = () => {
            const maxLines = Math.max(pendingRemoved.length, pendingAdded.length);
            for (let i = 0; i < maxLines; i++) {
              const oldLine = pendingRemoved[i] || "";
              const newLine = pendingAdded[i] || "";

              if (i < pendingRemoved.length && i < pendingAdded.length) {
                // Both lines exist - do word-level diff
                const { removedParts, addedParts } = renderWordLevelDiff(
                  oldLine,
                  newLine,
                  `paired-${changeIndex}-${groupIndex}-${i}`
                );

                diffLinesElements.push(
                  <div
                    key={`removed-${changeIndex}-${groupIndex}-${i}`}
                    className="diff-line diff-line-removed"
                  >
                    <span className="diff-prefix">-</span>
                    <span className="diff-content">{removedParts}</span>
                  </div>
                );

                diffLinesElements.push(
                  <div
                    key={`added-${changeIndex}-${groupIndex}-${i}`}
                    className="diff-line diff-line-added"
                  >
                    <span className="diff-prefix">+</span>
                    <span className="diff-content">{addedParts}</span>
                  </div>
                );
              } else if (i < pendingRemoved.length) {
                // Only removed line
                const { removedParts } = renderWordLevelDiff(
                  oldLine,
                  "",
                  `removed-only-${changeIndex}-${groupIndex}-${i}`
                );

                diffLinesElements.push(
                  <div
                    key={`removed-only-${changeIndex}-${groupIndex}-${i}`}
                    className="diff-line diff-line-removed"
                  >
                    <span className="diff-prefix">-</span>
                    <span className="diff-content">{removedParts}</span>
                  </div>
                );
              } else if (i < pendingAdded.length) {
                // Only added line
                const { addedParts } = renderWordLevelDiff(
                  "",
                  newLine,
                  `added-only-${changeIndex}-${groupIndex}-${i}`
                );

                diffLinesElements.push(
                  <div
                    key={`added-only-${changeIndex}-${groupIndex}-${i}`}
                    className="diff-line diff-line-added"
                  >
                    <span className="diff-prefix">+</span>
                    <span className="diff-content">{addedParts}</span>
                  </div>
                );
              }
            }
            pendingRemoved = [];
            pendingAdded = [];
            groupIndex++;
          };

          lineDiffsResult.forEach((part: Change, partIndex: number) => {
            if (part.removed) {
              pendingRemoved.push(...splitLines(part.value));
            } else if (part.added) {
              pendingAdded.push(...splitLines(part.value));
            } else {
              flushPending();
              const lines = splitLines(part.value);
              const contextLimit = 3;
              
              let displayLines = lines;
              let showEllipsisBefore = false;
              let showEllipsisAfter = false;

              if (partIndex === 0) {
                // Start of diff: show last N lines
                if (lines.length > contextLimit) {
                  displayLines = lines.slice(-contextLimit);
                  showEllipsisBefore = true;
                }
              } else if (partIndex === lineDiffsResult.length - 1) {
                // End of diff: show first N lines
                if (lines.length > contextLimit) {
                  displayLines = lines.slice(0, contextLimit);
                  showEllipsisAfter = true;
                }
              } else {
                // Middle of diff: show first N and last N lines
                if (lines.length > contextLimit * 2) {
                  displayLines = [...lines.slice(0, contextLimit), "...", ...lines.slice(-contextLimit)];
                }
              }

              if (showEllipsisBefore) {
                diffLinesElements.push(
                  <div key={`ellipsis-before-${changeIndex}-${groupIndex}`} className="diff-line-ellipsis">
                    ...
                  </div>
                );
              }

              displayLines.forEach((line, lineIndex) => {
                if (line === "...") {
                  diffLinesElements.push(
                    <div key={`ellipsis-middle-${changeIndex}-${groupIndex}-${lineIndex}`} className="diff-line-ellipsis">
                      ...
                    </div>
                  );
                  return;
                }
                const { addedParts } = renderWordLevelDiff(
                  line, 
                  line, 
                  `context-${changeIndex}-${groupIndex}-${lineIndex}`
                );
                diffLinesElements.push(
                  <div
                    key={`context-${changeIndex}-${groupIndex}-${lineIndex}`}
                    className="diff-line diff-line-context"
                  >
                    <span className="diff-prefix"> </span>
                    <span className="diff-content">{addedParts}</span>
                  </div>
                );
              });

              if (showEllipsisAfter) {
                diffLinesElements.push(
                  <div key={`ellipsis-after-${changeIndex}-${groupIndex}`} className="diff-line-ellipsis">
                    ...
                  </div>
                );
              }
              groupIndex++;
            }
          });
          flushPending();

          return (
            <div key={changeIndex} className="diff-change">
              {diffLinesElements}
            </div>
          );
        })}
      </div>
    );
  };

  // Don't render anything if no diff should be shown
  if (!showDiff) {
    return null;
  }

  return (
    <div className="diff-viewer-container">
      <div className="diff-viewer-content" tabIndex={0}>
        {renderExpandedDiff()}
        {changes.length === 0 && (
          <div className="diff-empty">No changes</div>
        )}
      </div>
    </div>
  );
};
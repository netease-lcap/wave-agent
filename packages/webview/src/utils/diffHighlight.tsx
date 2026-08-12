import React from "react";
import { diffWords } from "diff";

/**
 * Word-level split of one removed/added line pair: only the changed words get
 * the deeper word-level highlight, unchanged words keep the line-level
 * background. Shared by the message-list diff block and the desktop diff pane.
 */
export function renderWordLevelDiff(
  oldLine: string,
  newLine: string,
  keyPrefix: string,
): { removedParts: React.ReactNode[]; addedParts: React.ReactNode[] } {
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
        </span>,
      );
    } else if (part.added) {
      addedParts.push(
        <span key={`added-${keyPrefix}-${index}`} className="diff-word-added">
          {part.value}
        </span>,
      );
    } else {
      // Unchanged parts
      removedParts.push(
        <span
          key={`removed-unchanged-${keyPrefix}-${index}`}
          className="diff-word-unchanged"
        >
          {part.value}
        </span>,
      );
      addedParts.push(
        <span
          key={`added-unchanged-${keyPrefix}-${index}`}
          className="diff-word-unchanged"
        >
          {part.value}
        </span>,
      );
    }
  });

  return { removedParts, addedParts };
}

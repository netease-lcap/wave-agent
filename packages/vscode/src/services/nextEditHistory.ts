import * as vscode from "vscode";
import type { NextEditHistoryEntry } from "wave-agent-sdk/host";

/**
 * Per-file trajectory of what the user typed, in the shape the next-edit
 * request wants (`docs/specs/ui/next-edit-suggestion.md`, 故事 3).
 *
 * The hard part is not collecting — VS Code hands us every change — but
 * *rejecting* what is not user intent: a branch switch, an external formatter
 * or a reload rewrites the buffer through the same event, and feeding those to
 * the model produces confident suggestions for someone else's edit.
 *
 * Removed text is not part of the change event, so a shadow copy of each
 * document is kept and primed before the first edit; without it a trajectory
 * could only say "some characters were deleted", which is useless as intent.
 */
export interface NextEditHistoryOptions {
  /** How many of the most recent edits are kept per file. */
  maxEntries: number;
  /** Edits older than this are dropped — intent decays fast. */
  ttlMs: number;
  /** Per-side cap on a stored edit, so one huge paste cannot dominate the prompt. */
  maxEntryChars: number;
}

export const NEXT_EDIT_HISTORY_OPTIONS: NextEditHistoryOptions = {
  maxEntries: 5,
  ttlMs: 5 * 60 * 1000,
  maxEntryChars: 1000,
};

interface StoredEdit extends NextEditHistoryEntry {
  at: number;
}

/** Whether this change replaced the whole buffer, i.e. it was not typed. */
function isWholeDocumentReplace(
  document: vscode.TextDocument,
  change: vscode.TextDocumentContentChangeEvent,
): boolean {
  if (change.rangeOffset !== 0) return false;
  // `document` already holds the post-change text, so the pre-change length has
  // to be reconstructed before comparing.
  const before =
    document.getText().length - change.text.length + change.rangeLength;
  return before > 0 && change.rangeLength === before;
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export class NextEditHistory {
  private readonly byFile = new Map<string, StoredEdit[]>();
  /** Post-change text of the last time we looked at a document. */
  private readonly shadows = new Map<string, string>();

  constructor(
    private readonly options: NextEditHistoryOptions = NEXT_EDIT_HISTORY_OPTIONS,
  ) {}

  /** Takes the baseline copy used to read removed text out of the next change. */
  prime(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file") return;
    this.shadows.set(document.uri.toString(), document.getText());
  }

  /**
   * Records one document change. Multi-range edits (multi-cursor typing) are
   * folded into a single entry: the trajectory is a story about intent, not a
   * per-cursor log.
   */
  record(
    document: vscode.TextDocument,
    event: vscode.TextDocumentChangeEvent,
  ): void {
    if (document.uri.scheme !== "file") return;
    const changes = event.contentChanges;
    if (changes.length === 0) return;

    const key = document.uri.toString();
    if (changes.some((change) => isWholeDocumentReplace(document, change))) {
      // The file was replaced wholesale (checkout, external formatter, revert):
      // the trajectory no longer describes what *this* user was doing.
      this.byFile.delete(key);
      this.prime(document);
      return;
    }

    const shadow = this.shadows.get(key);
    const removed = changes.map((change) =>
      shadow
        ? shadow.slice(
            change.rangeOffset,
            change.rangeOffset + change.rangeLength,
          )
        : "",
    );
    const inserted = changes.map((change) => change.text);

    // Always re-prime, even when the edit is not kept: the next edit's offsets
    // are relative to this text.
    this.prime(document);

    const noRemoval = removed.every((part) => part === "");
    const noInsertion = inserted.every((part) => part === "");
    if (noRemoval && noInsertion) return;
    // Without a shadow the removal is unrecoverable; a trajectory that only
    // knows the insertion half would misrepresent the edit, so skip this one.
    if (
      shadow === undefined &&
      changes.some((change) => change.rangeLength > 0)
    ) {
      return;
    }

    const entries = this.byFile.get(key) ?? [];
    entries.push({
      oldText: clip(removed.join("\n"), this.options.maxEntryChars),
      newText: clip(inserted.join("\n"), this.options.maxEntryChars),
      at: Date.now(),
    });
    // Keep the tail: the newest edits are the ones that predict the next one.
    this.byFile.set(key, entries.slice(-this.options.maxEntries));
  }

  /** Edits within the TTL, oldest first. Empty means "nothing to predict from". */
  recent(document: vscode.TextDocument): NextEditHistoryEntry[] {
    const key = document.uri.toString();
    const entries = this.byFile.get(key);
    if (!entries) return [];
    const cutoff = Date.now() - this.options.ttlMs;
    const fresh = entries.filter((entry) => entry.at >= cutoff);
    if (fresh.length !== entries.length) {
      if (fresh.length === 0) this.byFile.delete(key);
      else this.byFile.set(key, fresh);
    }
    return fresh.map(({ oldText, newText }) => ({ oldText, newText }));
  }

  forget(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.byFile.delete(key);
    this.shadows.delete(key);
  }

  /** When the newest recorded edit happened, or `undefined` when there is none. */
  lastEditAt(document: vscode.TextDocument): number | undefined {
    const entries = this.byFile.get(document.uri.toString());
    return entries?.[entries.length - 1]?.at;
  }
}

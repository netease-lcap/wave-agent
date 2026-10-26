/**
 * Cross-file context for inline (ghost-text) completion.
 *
 * The split is deliberate and one-directional: the host (the only side with a
 * language service) decides *which* symbols are worth asking about and reads
 * their definition bodies; the CLI decides how much of that survives into the
 * prompt and where it lands. So what crosses the wire is raw material — a path
 * plus a body — never a formatted block.
 */

export interface CompletionSnippet {
  /** Absolute path of the file the body was read from. */
  path: string;
  /** The definition body, already trimmed by the host. */
  text: string;
}

/**
 * One past edit of the current file, as a before/after pair.
 *
 * The host is the only side that sees the editor's text changes, so the edit
 * trajectory arrives as raw pairs rather than as a formatted diff block: the
 * CLI decides how much of it survives into the prompt, and in which order.
 * Only edits the user typed are here — a branch switch or an external
 * formatter must not read as intent (spec ui/next-edit-suggestion.md, 轨迹采集).
 */
export interface NextEditHistoryEntry {
  /** Replaced text, before the edit. Empty when the edit was a pure insert. */
  oldText: string;
  /** Replacement text. Empty when the edit was a pure delete. */
  newText: string;
}

/** The window of the current file the model is allowed to rewrite. */
export interface NextEditRegion {
  /** First line of the window, 1-based and inclusive. */
  startLine: number;
  /** Last line of the window, 1-based and inclusive. */
  endLine: number;
  /** Current text of the window, lines joined by `\n`. */
  text: string;
}

/**
 * A wider slice of the file around the region, carrying **absolute** line
 * numbers so the model can name lines the way the host does. The region is a
 * sub-range of the excerpt; context outside it is read-only for the model.
 */
export interface NextEditExcerpt {
  /** 1-based line number of the excerpt's first line. */
  startLine: number;
  /** The excerpt's lines joined by `\n`. */
  text: string;
}

/** A suggestion the host should render as a diff and apply on accept. */
export interface NextEditSuggestion {
  /** First line to replace, 1-based inclusive — always inside the request's region. */
  startLine: number;
  /** Last line to replace, 1-based inclusive. Empty `text` with a non-empty range deletes lines. */
  endLine: number;
  /** Replacement text for those lines. Never `undefined` — absence is `null` at the response. */
  text: string;
}

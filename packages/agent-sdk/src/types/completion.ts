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

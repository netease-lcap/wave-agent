/**
 * Bracketed paste (DECSET 2004) detector.
 *
 * When bracketed paste is enabled, terminals wrap pasted text in
 * `\x1b[200~` (start) and `\x1b[201~` (end) markers, which lets the input
 * pipeline distinguish "text was pasted" from "user typed keys" — most
 * importantly, a pasted trailing `\r` must NOT be treated as an Enter key.
 *
 * ink delivers each stdin chunk through useInput after stripping ONE leading
 * ESC from the parsed sequence (see use-input.js), so markers may arrive in
 * either the raw form (`\x1b[200~`) or the stripped form (`[200~`), and may
 * be split across chunks. The detector normalizes both forms and buffers
 * partial markers until they complete (deferral is safe: a deferred partial
 * is flushed unchanged if the next chunk does not complete a marker).
 */
export type PasteProcessResult =
  | { kind: "input"; input: string }
  | { kind: "paste"; text: string; leadingInput?: string }
  | { kind: "consume" };

export interface BracketedPasteDetector {
  /**
   * Feed one input chunk (as delivered by ink's useInput callback).
   * - `input`: regular keystrokes, pass through to normal handling.
   * - `paste`: completed bracketed paste; insert `text` without submitting.
   *   `leadingInput` (rare) is content that preceded the start marker in the
   *   same chunk and should be handled as regular input first.
   * - `consume`: content of an in-flight paste (or an empty paste); do
   *   nothing with this chunk.
   */
  process(chunk: string): PasteProcessResult;
  reset(): void;
}

const ESC = "\u001b";
const START_STRIPPED = "[200~";
const START_RAW = `${ESC}[200~`;
const END_STRIPPED = "[201~";
const END_RAW = `${ESC}[201~`;

const START_FORMS = [START_RAW, START_STRIPPED];
const END_FORMS = [END_RAW, END_STRIPPED];

/**
 * Suffixes that may be the beginning of a marker split across chunks.
 * Longest-first so the longest matching suffix is deferred (e.g. `[200`
 * rather than `[20` for `...x[200`). Deferral is flush-equivalent: if the
 * next chunk does not complete a marker, the deferred suffix is delivered
 * as regular input unchanged.
 */
const PARTIAL_SUFFIXES = [
  `${ESC}[201`,
  `${ESC}[200`,
  `${ESC}[20`,
  `${ESC}[2`,
  "[201",
  "[200",
  "[20",
  "[2",
].sort((a, b) => b.length - a.length);

export function createBracketedPasteDetector(): BracketedPasteDetector {
  let inPaste = false;
  let buffer = ""; // paste content collected since the start marker
  let pending = ""; // deferred partial marker suffix from a previous chunk

  const findFirst = (
    text: string,
    forms: string[],
  ): { index: number; length: number } | null => {
    let best: { index: number; length: number } | null = null;
    for (const form of forms) {
      const index = text.indexOf(form);
      if (index !== -1 && (best === null || index < best.index)) {
        best = { index, length: form.length };
      }
    }
    return best;
  };

  const endsWithPartial = (text: string): string | null => {
    for (const prefix of PARTIAL_SUFFIXES) {
      if (text.endsWith(prefix)) {
        return prefix;
      }
    }
    return null;
  };

  const process = (chunk: string): PasteProcessResult => {
    let remaining = pending + chunk;
    pending = "";
    let leadingInput = "";
    let pasteText: string | null = null;

    while (remaining.length > 0) {
      if (!inPaste) {
        const start = findFirst(remaining, START_FORMS);
        if (start) {
          leadingInput += remaining.slice(0, start.index);
          remaining = remaining.slice(start.index + start.length);
          inPaste = true;
          continue;
        }
        // Orphan end marker (start was missed, e.g. consumed by another
        // input handler): treat the preceding text as paste so a trailing
        // `\r` cannot trigger the coalesced-Enter submit heuristic.
        const end = findFirst(remaining, END_FORMS);
        if (end) {
          pasteText =
            (pasteText ?? "") + leadingInput + remaining.slice(0, end.index);
          leadingInput = "";
          remaining = remaining.slice(end.index + end.length);
          continue;
        }
        const partial = endsWithPartial(remaining);
        if (partial) {
          pending = remaining.slice(remaining.length - partial.length);
          remaining = remaining.slice(0, remaining.length - partial.length);
        }
        if (remaining.length > 0) {
          leadingInput += remaining;
          remaining = "";
        }
        break;
      }

      const end = findFirst(remaining, END_FORMS);
      if (end) {
        pasteText = (pasteText ?? "") + buffer + remaining.slice(0, end.index);
        buffer = "";
        inPaste = false;
        remaining = remaining.slice(end.index + end.length);
        continue;
      }
      const partial = endsWithPartial(remaining);
      if (partial) {
        pending = remaining.slice(remaining.length - partial.length);
        remaining = remaining.slice(0, remaining.length - partial.length);
      }
      buffer += remaining;
      remaining = "";
      break;
    }

    if (inPaste) {
      // Paste still in flight: hold the content, deliver nothing yet.
      return { kind: "consume" };
    }
    if (pasteText !== null) {
      const result: { kind: "paste"; text: string; leadingInput?: string } = {
        kind: "paste",
        text: pasteText,
      };
      if (leadingInput !== "") {
        result.leadingInput = leadingInput;
      }
      return result;
    }
    return { kind: "input", input: leadingInput };
  };

  const reset = (): void => {
    inPaste = false;
    buffer = "";
    pending = "";
  };

  return { process, reset };
}

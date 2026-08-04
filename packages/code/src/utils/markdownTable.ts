import type { Token, Tokens } from "marked";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { stripAnsiColors } from "wave-agent-sdk";

/**
 * Accounts for parent indentation (e.g. message prefix) and terminal
 * resize races. Without enough margin the table overflows its layout box
 * and Ink's clip truncates differently on alternating frames.
 */
const SAFETY_MARGIN = 4;

/** Minimum column width to prevent degenerate layouts */
const MIN_COLUMN_WIDTH = 3;

/**
 * Maximum number of lines per row before switching to vertical format.
 * When wrapping would make rows taller than this, vertical (key-value)
 * format provides better readability.
 */
const MAX_ROW_LINES = 4;

/** ANSI escape codes for text formatting */
const ANSI_BOLD_START = "\x1b[1m";
const ANSI_BOLD_END = "\x1b[22m";

export type CellAlign = "left" | "center" | "right" | null;

/**
 * Wrap text to fit within a given width, returning array of lines.
 * ANSI-aware: preserves styling across line breaks.
 *
 * @param hard - If true, break words that exceed width (needed when columns
 *               are narrower than the longest word). Default false.
 */
export function wrapText(
  text: string,
  width: number,
  options?: { hard?: boolean },
): string[] {
  if (width <= 0) return [text];
  // Strip trailing whitespace/newlines before wrapping, otherwise extra
  // blank lines would appear in table cells.
  const trimmedText = text.trimEnd();
  const wrapped = wrapAnsi(trimmedText, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true,
  });
  // Filter out empty lines that result from trailing newlines or
  // multiple consecutive newlines in the source content.
  const lines = wrapped.split("\n").filter((line) => line.length > 0);
  // Ensure we always return at least one line (empty string for empty cells)
  return lines.length > 0 ? lines : [""];
}

/**
 * Pad `content` to `targetWidth` according to alignment. `displayWidth` is the
 * visible width of `content` (caller computes this, e.g. via stringWidth on
 * ANSI-stripped text, so ANSI codes in `content` don't affect padding).
 */
export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: CellAlign | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth);
  if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    return " ".repeat(leftPad) + content + " ".repeat(padding - leftPad);
  }
  if (align === "right") {
    return " ".repeat(padding) + content;
  }
  return content + " ".repeat(padding);
}

/**
 * Render a markdown table to a box-drawing ANSI string for the terminal.
 * Handles terminal width by:
 * 1. Calculating minimum column widths based on longest word
 * 2. Distributing available space proportionally
 * 3. Wrapping text within cells (no truncation)
 * 4. Falling back to a vertical key-value format when rows would be too
 *    tall or the table still overflows the terminal width
 *
 * @param token - marked table token
 * @param columns - terminal width
 * @param formatInline - formats inline tokens to an ANSI string (the caller
 *                       binds its marked parser so this module stays
 *                       parser-agnostic and directly testable)
 */
export function renderMarkdownTable(
  token: Tokens.Table,
  columns: number,
  formatInline: (tokens: Token[]) => string,
): string {
  // Format cell content to ANSI string
  function formatCell(tokens: Token[] | undefined): string {
    return tokens && tokens.length > 0 ? formatInline(tokens) : "";
  }

  // Get plain text (stripped of ANSI codes)
  function getPlainText(tokens: Token[] | undefined): string {
    return stripAnsiColors(formatCell(tokens));
  }

  // Get the longest word width in a cell (minimum width to avoid breaking words)
  function getMinWidth(tokens: Token[] | undefined): number {
    const text = getPlainText(tokens);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(...words.map((w) => stringWidth(w)), MIN_COLUMN_WIDTH);
  }

  // Get ideal width (full content without wrapping)
  function getIdealWidth(tokens: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens)), MIN_COLUMN_WIDTH);
  }

  // Step 1: Get minimum (longest word) and ideal (full content) widths
  const minWidths = token.header.map((header, colIndex) => {
    let maxMinWidth = getMinWidth(header.tokens);
    for (const row of token.rows) {
      maxMinWidth = Math.max(maxMinWidth, getMinWidth(row[colIndex]?.tokens));
    }
    return maxMinWidth;
  });
  const idealWidths = token.header.map((header, colIndex) => {
    let maxIdeal = getIdealWidth(header.tokens);
    for (const row of token.rows) {
      maxIdeal = Math.max(maxIdeal, getIdealWidth(row[colIndex]?.tokens));
    }
    return maxIdeal;
  });

  // Step 2: Calculate available space
  // Border overhead: │ content │ content │ = 1 + (width + 3) per column
  const numCols = token.header.length;
  const borderOverhead = 1 + numCols * 3; // │ + (2 padding + 1 border) per col
  // Account for SAFETY_MARGIN to avoid triggering the fallback safety check
  const availableWidth = Math.max(
    columns - borderOverhead - SAFETY_MARGIN,
    numCols * MIN_COLUMN_WIDTH,
  );

  // Step 3: Calculate column widths that fit available space
  const totalMin = minWidths.reduce((sum, w) => sum + w, 0);
  const totalIdeal = idealWidths.reduce((sum, w) => sum + w, 0);

  // Track whether columns are narrower than longest words (needs hard wrap)
  let needsHardWrap = false;
  let columnWidths: number[];
  if (totalIdeal <= availableWidth) {
    // Everything fits - use ideal widths
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    // Need to shrink - give each column its min, distribute remaining space
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i]!);
    const totalOverflow = overflows.reduce((sum, o) => sum + o, 0);
    columnWidths = minWidths.map((min, i) => {
      if (totalOverflow === 0) return min;
      const extra = Math.floor((overflows[i]! / totalOverflow) * extraSpace);
      return min + extra;
    });
  } else {
    // Table wider than terminal at minimum widths
    // Shrink columns proportionally to fit allowing word breaks
    needsHardWrap = true;
    const scaleFactor = availableWidth / totalMin;
    columnWidths = minWidths.map((w) =>
      Math.max(Math.floor(w * scaleFactor), MIN_COLUMN_WIDTH),
    );
  }

  // Step 4: Calculate max row lines to determine if vertical format is needed
  function calculateMaxRowLines(): number {
    let maxLines = 1;
    // Check header
    for (let i = 0; i < token.header.length; i++) {
      const content = formatCell(token.header[i]!.tokens);
      const wrapped = wrapText(content, columnWidths[i]!, {
        hard: needsHardWrap,
      });
      maxLines = Math.max(maxLines, wrapped.length);
    }
    // Check rows
    for (const row of token.rows) {
      for (let i = 0; i < row.length; i++) {
        const content = formatCell(row[i]?.tokens);
        const wrapped = wrapText(content, columnWidths[i]!, {
          hard: needsHardWrap,
        });
        maxLines = Math.max(maxLines, wrapped.length);
      }
    }
    return maxLines;
  }

  // Use vertical format if wrapping would make rows too tall
  const maxRowLines = calculateMaxRowLines();
  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  // Render a single row with potential multi-line cells
  // Returns an array of strings, one per line of the row
  function renderRowLines(
    cells: Array<{ tokens?: Token[] }>,
    isHeader: boolean,
  ): string[] {
    // Get wrapped lines for each cell (preserving ANSI formatting)
    const cellLines = cells.map((cell, colIndex) => {
      const formattedText = formatCell(cell.tokens);
      const width = columnWidths[colIndex]!;
      return wrapText(formattedText, width, { hard: needsHardWrap });
    });

    // Find max number of lines in this row
    const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1);

    // Calculate vertical offset for each cell (to center vertically)
    const verticalOffsets = cellLines.map((lines) =>
      Math.floor((maxLines - lines.length) / 2),
    );

    // Build each line of the row as a single string
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      let line = "│";
      for (let colIndex = 0; colIndex < cells.length; colIndex++) {
        const lines = cellLines[colIndex]!;
        const offset = verticalOffsets[colIndex]!;
        const contentLineIdx = lineIdx - offset;
        const lineText =
          contentLineIdx >= 0 && contentLineIdx < lines.length
            ? lines[contentLineIdx]!
            : "";
        const width = columnWidths[colIndex]!;
        // Headers always centered; data uses table alignment
        const align = isHeader
          ? "center"
          : ((token.align?.[colIndex] as CellAlign | undefined) ?? "left");
        line +=
          " " +
          padAligned(lineText, stringWidth(lineText), width, align) +
          " │";
      }
      result.push(line);
    }
    return result;
  }

  // Render horizontal border as a single string
  function renderBorderLine(type: "top" | "middle" | "bottom"): string {
    const [left, mid, cross, right] = {
      top: ["┌", "─", "┬", "┐"],
      middle: ["├", "─", "┼", "┤"],
      bottom: ["└", "─", "┴", "┘"],
    }[type] as [string, string, string, string];
    let line = left;
    columnWidths.forEach((width, colIndex) => {
      line += mid.repeat(width + 2);
      line += colIndex < columnWidths.length - 1 ? cross : right;
    });
    return line;
  }

  // Render vertical format (key-value pairs) for extra-narrow terminals
  function renderVerticalFormat(): string {
    const lines: string[] = [];
    const headers = token.header.map((h) => getPlainText(h.tokens));
    const separatorWidth = Math.min(columns - 1, 40);
    const separator = "─".repeat(separatorWidth);
    // Small indent for wrapped lines (just 2 spaces)
    const wrapIndent = "  ";
    token.rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) {
        lines.push(separator);
      }
      row.forEach((cell, colIndex) => {
        const label = headers[colIndex] || `Column ${colIndex + 1}`;
        // Clean value: trim, remove extra internal whitespace/newlines
        const rawValue = formatCell(cell.tokens).trimEnd();
        const value = rawValue.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

        // Wrap value to fit terminal, accounting for label on first line
        const firstLineWidth = columns - stringWidth(label) - 3;
        const subsequentLineWidth = columns - wrapIndent.length - 1;

        // Two-pass wrap: first line is narrower (label takes space),
        // continuation lines get the full width minus indent.
        const firstPassLines = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPassLines[0] || "";
        let wrappedValue: string[];
        if (
          firstPassLines.length <= 1 ||
          subsequentLineWidth <= firstLineWidth
        ) {
          wrappedValue = firstPassLines;
        } else {
          // Re-join remaining text and re-wrap to the wider continuation width
          const remainingText = firstPassLines
            .slice(1)
            .map((l) => l.trim())
            .join(" ");
          const rewrapped = wrapText(remainingText, subsequentLineWidth);
          wrappedValue = [firstLine, ...rewrapped];
        }

        // First line: bold label + value
        lines.push(
          `${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ""}`,
        );

        // Subsequent lines with small indent (skip empty lines)
        for (let i = 1; i < wrappedValue.length; i++) {
          const line = wrappedValue[i]!;
          if (!line.trim()) continue;
          lines.push(`${wrapIndent}${line}`);
        }
      });
    });
    return lines.join("\n");
  }

  // Choose format based on available width
  if (useVerticalFormat) {
    return renderVerticalFormat();
  }

  // Build the complete horizontal table as an array of strings
  const tableLines: string[] = [];
  tableLines.push(renderBorderLine("top"));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine("middle"));
  token.rows.forEach((row, rowIndex) => {
    tableLines.push(...renderRowLines(row, false));
    if (rowIndex < token.rows.length - 1) {
      tableLines.push(renderBorderLine("middle"));
    }
  });
  tableLines.push(renderBorderLine("bottom"));

  // Safety check: verify no line exceeds terminal width.
  // This catches edge cases during terminal resize where calculations
  // were based on a different width than the current render target.
  const maxLineWidth = Math.max(
    ...tableLines.map((line) => stringWidth(stripAnsiColors(line))),
  );

  // If we're within SAFETY_MARGIN characters of the edge, use vertical format
  // to account for terminal resize race conditions.
  if (maxLineWidth > columns - SAFETY_MARGIN) {
    return renderVerticalFormat();
  }

  return tableLines.join("\n");
}

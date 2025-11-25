import React, { useMemo } from "react";
import { Text } from "ink";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

export interface MarkdownProps {
  children: string;
}

// Markdown component using marked-terminal with proper unescape option
export const Markdown = React.memo(({ children }: MarkdownProps) => {
  const result = useMemo(() => {
    // Configure marked with TerminalRenderer using default options
    marked.setOptions({
      renderer: new TerminalRenderer({
        // Use official unescape option to handle HTML entities
        unescape: true,
      }),
    });

    const output = marked(children);
    return typeof output === "string" ? output.trim() : "";
  }, [children]);

  return <Text>{result}</Text>;
});

// Add display name for debugging
Markdown.displayName = "Markdown";

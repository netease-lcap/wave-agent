import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked, type Token } from "marked";
import { Highlight } from "./Highlight.js";

type InkColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey";

interface MarkdownTextProps {
  content: string;
  maxWidth?: number;
}

// Render code block with ink-highlight
const renderCodeBlock = (code: string, language?: string): React.ReactNode => {
  return (
    <Box flexDirection="column" width="100%">
      {language && (
        <Box>
          <Text color="gray" dimColor>
            ```{language}
          </Text>
        </Box>
      )}
      <Box>
        <Highlight code={code} language={language || "text"} />
      </Box>
      {language && (
        <Box>
          <Text color="gray" dimColor>
            ```
          </Text>
        </Box>
      )}
    </Box>
  );
};

// Render inline tokens from marked parser
const renderInlineTokens = (tokens: Token[]): React.ReactNode[] => {
  const elements: React.ReactNode[] = [];

  tokens.forEach((token, index) => {
    switch (token.type) {
      case "text":
        elements.push(<Text key={index}>{token.text}</Text>);
        break;

      case "strong":
        elements.push(
          <Text key={index} bold>
            **{token.tokens ? renderInlineTokens(token.tokens) : token.text}**
          </Text>,
        );
        break;

      case "em":
        elements.push(
          <Text key={index} italic>
            *{token.tokens ? renderInlineTokens(token.tokens) : token.text}*
          </Text>,
        );
        break;

      case "codespan":
        elements.push(
          <Text key={index} color="cyan">
            `{token.text}`
          </Text>,
        );
        break;

      case "link":
        elements.push(
          <Text key={index} color="blue" underline>
            {token.tokens ? renderInlineTokens(token.tokens) : token.text}
          </Text>,
        );
        break;

      case "image":
        elements.push(
          <Text key={index} color="magenta">
            🖼️ {token.tokens ? renderInlineTokens(token.tokens) : token.text}
          </Text>,
        );
        break;

      default:
        // Fallback for unknown token types
        elements.push(
          <Text key={index}>
            {"text" in token ? token.text : "raw" in token ? token.raw : ""}
          </Text>,
        );
        break;
    }
  });

  return elements;
};

// Simple markdown renderer for Ink
const renderMarkdown = (content: string): React.ReactNode[] => {
  const elements: React.ReactNode[] = [];

  try {
    const tokens = marked.lexer(content);

    tokens.forEach((token, index) => {
      switch (token.type) {
        case "heading": {
          const headingColors: Record<number, InkColor> = {
            1: "magenta",
            2: "blue",
            3: "green",
            4: "yellow",
            5: "yellow",
            6: "yellow",
          };

          const headingPrefix = "#".repeat(token.depth) + " ";

          elements.push(
            <Box key={index} marginY={token.depth <= 2 ? 1 : 0}>
              <Text
                color={headingColors[token.depth]}
                bold
                underline={token.depth === 1}
              >
                {headingPrefix}
                {token.tokens ? renderInlineTokens(token.tokens) : token.text}
              </Text>
            </Box>,
          );
          break;
        }

        case "paragraph":
          elements.push(
            <Box key={index} marginY={1}>
              {token.tokens ? (
                renderInlineTokens(token.tokens)
              ) : (
                <Text>{token.text}</Text>
              )}
            </Box>,
          );
          break;

        case "code":
          elements.push(
            <Box key={index}>
              {renderCodeBlock(token.text, token.lang || undefined)}
            </Box>,
          );
          break;

        case "blockquote":
          elements.push(
            <Box key={index} borderLeft borderColor="gray">
              <Text color="gray" italic>
                {token.text}
              </Text>
            </Box>,
          );
          break;

        case "list": {
          elements.push(
            <Box key={index} flexDirection="column">
              {token.items.map((item: Token, itemIndex: number) => {
                // For list items, we need to access the text tokens from the item
                const itemTokens =
                  "tokens" in item && item.tokens
                    ? (
                        item.tokens.find(
                          (t: Token) => t.type === "text" && "tokens" in t,
                        ) as Token & { tokens?: Token[] }
                      )?.tokens
                    : null;
                return (
                  <Box key={itemIndex}>
                    <Text color="cyan">
                      {token.ordered ? `${itemIndex + 1}. ` : "• "}
                    </Text>
                    {itemTokens ? (
                      renderInlineTokens(itemTokens)
                    ) : (
                      <Text>{"text" in item ? item.text : ""}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>,
          );
          break;
        }

        case "hr":
          elements.push(
            <Box key={index} marginY={1}>
              <Text color="gray">─────────────────────────</Text>
            </Box>,
          );
          break;

        default:
          // Handle other token types as plain text
          if ("text" in token) {
            elements.push(
              <Box key={index}>
                <Text>{token.text}</Text>
              </Box>,
            );
          }
          break;
      }
    });
  } catch {
    // Fallback to plain text if markdown parsing fails
    elements.push(
      <Box key="fallback">
        <Text>{content}</Text>
      </Box>,
    );
  }

  return elements;
};

export const MarkdownText: React.FC<MarkdownTextProps> = ({
  content,
  maxWidth,
}) => {
  const renderedElements = useMemo(() => {
    if (!content.trim()) {
      return [];
    }

    return renderMarkdown(content);
  }, [content]);

  return (
    <Box flexDirection="column" width={maxWidth}>
      {renderedElements}
    </Box>
  );
};

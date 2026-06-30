/**
 * Contracts for Markdown Rendering System
 */

import { Token } from "marked";

/**
 * Props for the main Markdown component
 */
export interface MarkdownProps {
  /**
   * The markdown string to render
   */
  children: string;
}

/**
 * Props for the BlockRenderer component
 */
export interface BlockRendererProps {
  /**
   * List of block-level tokens to render
   */
  tokens: Token[];
}

/**
 * Props for the InlineRenderer component
 */
export interface InlineRendererProps {
  /**
   * List of inline tokens to render
   */
  tokens: Token[];
}

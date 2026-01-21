# Data Model: Markdown Rendering System

**Branch**: `020-markdown-rendering-system` | **Date**: 2024-12-01  
**Purpose**: Define the data structures and component relationships for the Markdown rendering system.

## Core Entities

### Markdown Token (from `marked`)
**Purpose**: Represents a parsed element of the Markdown document.  
**Source**: `marked.lexer(markdownString)`

```typescript
type Token = 
  | Tokens.Heading
  | Tokens.Paragraph
  | Tokens.List
  | Tokens.ListItem
  | Tokens.Code
  | Tokens.Table
  | Tokens.Blockquote
  | Tokens.Hr
  | Tokens.Text
  | Tokens.Strong
  | Tokens.Em
  | Tokens.Codespan
  | Tokens.Link
  | Tokens.Br
  | Tokens.Del;
```

### Table Configuration
**Purpose**: Internal state used by `TableRenderer` to manage column layout.

```typescript
interface TableLayout {
  columnWidths: number[];
  totalWidth: number;
  terminalWidth: number;
}
```

## Component Relationships

### Rendering Flow

1. **Markdown(children: string)**
   - Calls `marked.lexer(children)` to get `Token[]`.
   - Passes tokens to `BlockRenderer`.

2. **BlockRenderer(tokens: Token[])**
   - Iterates through tokens.
   - For `heading`, `paragraph`, `blockquote`: Renders a `Box` and calls `InlineRenderer` for the content.
   - For `list`: Iterates through `items` and recursively calls `BlockRenderer` or `InlineRenderer`.
   - For `code`: Renders a `Box` with formatted text.
   - For `table`: Calls `TableRenderer`.

3. **InlineRenderer(tokens: Token[])**
   - Iterates through inline tokens.
   - Maps tokens to Ink `Text` components with specific props (e.g., `bold`, `italic`, `color="yellow"` for codespan).

4. **TableRenderer(token: Tokens.Table)**
   - Calculates `columnWidths` based on content and terminal width.
   - Renders a `Box` with `borderStyle="single"`.
   - Renders header and rows using `Box` and `Text` with calculated widths.

## State Transitions

1. **Input Change**: `children` prop changes -> `useMemo` triggers re-lexing -> New `tokens` generated.
2. **Terminal Resize**: `useStdout` detects change in `stdout.columns` -> `TableRenderer` re-calculates `columnWidths` -> Table re-renders.

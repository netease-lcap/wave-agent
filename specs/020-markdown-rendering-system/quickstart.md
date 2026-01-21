# Quickstart: Markdown Rendering System

**Branch**: `020-markdown-rendering-system` | **Date**: 2024-12-01  
**Purpose**: Guide for using the Markdown component in Wave Agent CLI.

## Overview

The `Markdown` component provides a simple way to render rich text in the terminal. It handles the complexity of parsing markdown and mapping it to Ink components.

## Basic Usage

```tsx
import { Markdown } from './components/Markdown';

const MyComponent = () => {
  const content = `
# Hello Wave
This is a **bold** statement.
- Item 1
- Item 2
  `;

  return <Markdown>{content}</Markdown>;
};
```

## Advanced Features

### Tables

The component automatically handles tables and ensures they fit within the terminal width.

```tsx
const tableContent = `
| Feature | Status | Description |
|---------|--------|-------------|
| Markdown| Done   | Robust rendering |
| Tables  | Done   | Responsive scaling |
`;

return <Markdown>{tableContent}</Markdown>;
```

### Code Blocks

Code blocks are rendered with clear delimiters and padding.

```tsx
const codeContent = "```typescript\nconst x = 1;\n```";

return <Markdown>{codeContent}</Markdown>;
```

## Implementation Details

### Customizing Styles

Styles are currently hardcoded in `Markdown.tsx` to match the Wave Agent theme:
- Headings: Bold Cyan
- Inline Code: Yellow
- Links: Blue Underline
- Table Borders: Gray
- Blockquotes: Gray left border

### Responsive Tables

The `TableRenderer` uses `useStdout` from Ink to get the current terminal width and scales columns if necessary.

```tsx
const { stdout } = useStdout();
const terminalWidth = (stdout?.columns || 80) - 2;
// ... width calculation logic ...
```

## Testing

You can test the component by providing various markdown strings and verifying the output in the terminal.

```tsx
import { render } from 'ink-testing-library';
import { Markdown } from './Markdown';

const { lastFrame } = render(<Markdown># Test</Markdown>);
console.log(lastFrame()); // Should contain "# Test" with bold/cyan markers
```

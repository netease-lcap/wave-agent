# Research: File System Tools Implementation

## Tool Selection
**Decision**: Provide specialized tools for FS operations instead of relying on `Bash`.
**Rationale**: Specialized tools allow for better validation, permission control, and structured output (e.g., line numbers, image data) that is easier for LLMs to process.

## Smart Editing
**Decision**: Implement indentation-insensitive matching for `Edit`.
**Rationale**: LLMs often struggle with exact whitespace matching. By ignoring leading indentation differences, we make the tools more resilient to minor formatting variations.

## Search Performance
**Decision**: Use `ripgrep` for the `Grep` tool.
**Rationale**: `ripgrep` is significantly faster than native Node.js implementations for large codebases and is a standard tool in the VS Code ecosystem.

## Large File Handling
**Decision**: Implement `offset` and `limit` in the `Read` tool, and truncate long lines.
**Rationale**: LLMs have context window limits. Reading entire large files or extremely long lines can exhaust tokens or cause performance issues.

## Search Feedback
**Decision**: Suggest specifying the `path` field when `Grep` returns no matches.
**Rationale**: The default search path is the current working directory and respects `.gitignore`. If no matches are found, it's often because the target files are in ignored directories (like `node_modules`) or outside the current directory. Providing this suggestion helps the agent understand how to expand its search.

## Image Support
**Decision**: Leverage existing `convertImageToBase64` utility in `messageOperations.ts`.
**Rationale**: The codebase already contains a robust function that handles multiple image formats (JPEG, PNG, GIF, WebP, BMP), provides proper MIME type detection, and includes error handling.
**Decision**: Extend `ToolResult` interface with `images` array.
**Rationale**: The `ToolResult` interface already includes an `images` array field for base64 encoded image data and media type.
**Decision**: 20MB File Size Limit for images.
**Rationale**: Balances functionality with performance, preventing memory exhaustion from extremely large image files while accommodating high-resolution screenshots.

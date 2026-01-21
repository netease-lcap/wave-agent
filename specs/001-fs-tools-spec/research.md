# Research: File System Tools Implementation

## Tool Selection
**Decision**: Provide specialized tools for FS operations instead of relying on `Bash`.
**Rationale**: Specialized tools allow for better validation, permission control, and structured output (e.g., line numbers, image data) that is easier for LLMs to process.

## Smart Editing
**Decision**: Implement indentation-insensitive matching for `Edit` and `MultiEdit`.
**Rationale**: LLMs often struggle with exact whitespace matching. By ignoring leading indentation differences, we make the tools more resilient to minor formatting variations.

## Search Performance
**Decision**: Use `ripgrep` for the `Grep` tool.
**Rationale**: `ripgrep` is significantly faster than native Node.js implementations for large codebases and is a standard tool in the VS Code ecosystem.

## Large File Handling
**Decision**: Implement `offset` and `limit` in the `Read` tool, and truncate long lines.
**Rationale**: LLMs have context window limits. Reading entire large files or extremely long lines can exhaust tokens or cause performance issues.

## Multimodal Support
**Decision**: Integrate image reading into the `Read` tool.
**Rationale**: Allows the agent to "see" screenshots or other relevant images in the project directory when using a multimodal model.

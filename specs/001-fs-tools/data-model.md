# Data Model: File System Tools

**Feature**: File System Tools
**Source**: Extracted from current implementation in `packages/agent-sdk/src/tools/`

## Core Entities

### ToolResult
**Purpose**: Standardized result format for all tool executions.
**Fields**:
- `success: boolean`: Whether the operation succeeded.
- `content: string`: Detailed output for the LLM.
- `shortResult?: string`: Brief summary for UI display.
- `error?: string`: Error message if success is false.
- `images?: Array<{ data: string; mediaType: string }>`: Image data for multimodal processing.

### ReadArguments
**Purpose**: Arguments for the `Read` tool.
**Fields**:
- `file_path: string`: Absolute path to the file.
- `offset?: number`: Line number to start reading from (text files only).
- `limit?: number`: Number of lines to read (text files only).

### ImageFile
**Purpose**: Represents an image file processed by the `Read` tool.
**Fields**:
- `path: string`: Absolute path to the image file.
- `extension: string`: File extension (png, jpeg, jpg, gif, webp).
- `size: number`: File size in bytes (must be ≤ 20MB).
- `mimeType: string`: MIME type (image/png, image/jpeg, image/gif, image/webp).

### WriteArguments
**Purpose**: Arguments for the `Write` tool.
**Fields**:
- `file_path: string`: Absolute path to the file.
- `content: string`: Content to write.

### EditArguments
**Purpose**: Arguments for the `Edit` tool.
**Fields**:
- `file_path: string`: Absolute path to the file.
- `old_string: string`: Text to replace.
- `new_string: string`: Replacement text.
- `replace_all?: boolean`: Whether to replace all occurrences.

### GlobArguments
**Purpose**: Arguments for the `Glob` tool.
**Fields**:
- `pattern: string`: Glob pattern.
- `path?: string`: Directory to search in.

### GrepArguments
**Purpose**: Arguments for the `Grep` tool.
**Fields**:
- `pattern: string`: Regex pattern.
- `path?: string`: Directory to search in.
- `glob?: string`: Glob filter for files.
- `output_mode?: "content" | "files_with_matches" | "count"`: Output format.
- `multiline?: boolean`: Enable multiline matching.

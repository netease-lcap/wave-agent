# Spec: File System Tools

This specification covers the set of tools provided by the agent for interacting with the local file system. These tools are designed to be safer and more efficient than using raw bash commands for common file operations.

## Tools Overview

### 1. Read Tool (`Read`)
Reads the content of a file from the local filesystem.
- **Features**:
  - Supports absolute paths.
  - Handles large files with `offset` and `limit` parameters.
  - Truncates overly long lines (max 2000 characters).
  - Supports reading images (PNG, JPG, GIF, WebP) and returns them as base64 data for multimodal LLMs.
  - Supports reading Jupyter notebooks (.ipynb).
  - Formats text output with line numbers (cat -n format).
  - Prevents reading binary document formats (PDF, DOCX, etc.).

### 2. Write Tool (`Write`)
Writes content to a file on the local filesystem.
- **Features**:
  - Overwrites existing files.
  - Automatically creates parent directories if they don't exist.
  - Includes a safety check: if the file exists, the agent should have read it first.
  - Avoids unnecessary writes if the content is identical.

### 3. Edit Tool (`Edit`)
Performs exact string replacements in a single file.
- **Features**:
  - Indentation-insensitive matching (smartly matches leading whitespace).
  - `replace_all` option to replace all occurrences.
  - Fails if `old_string` is not unique (unless `replace_all` is true).
  - Requires the file to have been read before editing.

### 4. Multi-Edit Tool (`MultiEdit`)
Performs multiple find-and-replace operations on a single file in one atomic operation.
- **Features**:
  - Built on top of the `Edit` tool.
  - Applies edits sequentially; each edit operates on the result of the previous one.
  - Atomic: either all edits succeed or none are applied.
  - Supports creating new files if the first edit has an empty `old_string`.

### 5. Delete Tool (`Delete`)
Deletes a file at the specified path.
- **Features**:
  - Fails gracefully if the file doesn't exist.
  - Requires relative path from workspace root (though implementation resolves it).

### 6. LS Tool (`LS`)
Lists files and directories in a given path.
- **Features**:
  - Requires absolute paths.
  - Supports ignore patterns (glob).
  - Distinguishes between files, directories, and symlinks.
  - Shows file sizes and identifies binary files.

### 7. Glob Tool (`Glob`)
Fast file pattern matching tool.
- **Features**:
  - Supports standard glob patterns (e.g., `**/*.ts`).
  - Returns matching file paths sorted by modification time (most recent first).
  - Respects common ignore patterns.

### 8. Grep Tool (`Grep`)
Powerful search tool based on ripgrep (`rg`).
- **Features**:
  - Supports full regex syntax.
  - Multiple output modes: `content`, `files_with_matches`, `count`.
  - Supports context lines (`-A`, `-B`, `-C`).
  - Supports multiline matching.
  - Respects common ignore patterns.

## Security and Permissions
All file system tools integrate with the `PermissionManager` to ensure that operations are authorized based on the current permission mode (e.g., `default`, `secure-file-access`).

# File System Tools Quickstart

## Overview
The File System tools provide a high-level API for agents to interact with the local filesystem.

## Usage Examples

### Reading a File
```typescript
// Use the Read tool
const result = await readTool.execute({
  file_path: "/path/to/file.ts",
  limit: 100
}, context);
```

### Writing a File
```typescript
// Use the Write tool
const result = await writeTool.execute({
  file_path: "/path/to/newfile.ts",
  content: "console.log('hello');"
}, context);
```

### Editing
```typescript
// Use the Edit tool for exact string replacement
const result = await editTool.execute({
  file_path: "/path/to/file.ts",
  old_string: "function old() {}",
  new_string: "function updated() {}"
}, context);
```

### Searching with Grep
```typescript
// Use the Grep tool for powerful regex search
const result = await grepTool.execute({
  pattern: "TODO:",
  path: "src",
  output_mode: "content"
}, context);
```

## Key Implementation Details
- **Ripgrep Integration**: The `Grep` tool spawns the `rg` binary from `@vscode/ripgrep` for high-performance searching. If no matches are found, it suggests specifying the `path` field to search in ignored or other directories.
- **Image Support**: `Read` tool detects image extensions (png, jpeg, jpg, gif, webp) and returns base64 data in the `images` array. It enforces a 20MB file size limit.
- **Jupyter Notebook Support**: `Read` tool handles `.ipynb` files.

### Image Processing Implementation
The `Read` tool uses `convertImageToBase64` from `packages/agent-sdk/src/utils/messageOperations.ts` to process image files. It populates the `ToolResult.images` array with base64 encoded data and the correct MIME type.

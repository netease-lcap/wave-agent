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

### Smart Editing
```typescript
// Use the Edit tool for indentation-insensitive replacement
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
- **Indentation Matching**: The `Edit` and `MultiEdit` tools use `findIndentationInsensitiveMatch` to handle variations in leading whitespace.
- **Ripgrep Integration**: The `Grep` tool spawns the `rg` binary from `@vscode/ripgrep` for high-performance searching.
- **Image Support**: `Read` tool detects image extensions and returns base64 data.

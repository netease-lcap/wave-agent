# File System Tools API Contract

**Version**: 1.0.0
**Feature**: File System Tools

## TypeScript Interface Definitions

### Tool Plugin Interface
```typescript
interface ToolPlugin {
  name: string;
  config: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  };
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  formatCompactParams?: (params: Record<string, unknown>, context: ToolContext) => string;
}
```

### Tool Result
```typescript
interface ToolResult {
  success: boolean;
  content: string;
  shortResult?: string;
  error?: string;
  images?: Array<{
    data: string;
    mediaType: string;
  }>;
  filePath?: string;
  metadata?: Record<string, unknown>;
}
```

### Tool Context
```typescript
interface ToolContext {
  workdir: string;
  permissionManager?: PermissionManager;
  permissionMode?: string;
  canUseToolCallback?: (toolName: string, args: any) => Promise<boolean>;
  // ... other context fields
}
```

## Tool-Specific Arguments

### Read Tool
```typescript
interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}
```

### Write Tool
```typescript
interface WriteArgs {
  file_path: string;
  content: string;
}
```

### Edit Tool
```typescript
interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}
```

**Edit Tool Behavioral Contracts**:
- **Read-before-edit**: The tool MUST reject edits to files that have not been read in the current conversation (tracked via `MessageManager.hasFileInContext()`). Returns error: `"You must read the file with the Read tool before editing it."`
- **CRLF normalization**: Both file content and `old_string` are normalized (`\r\n` → `\n`) before matching. Output uses normalized (LF) line endings.
- **Error detail**: When `old_string` is not found, the error includes the attempted string (truncated to 200 chars): `"String to replace not found in file.\nString: <attempted text>"`
- **Uniqueness check**: When `old_string` appears multiple times and `replace_all` is false, the tool MUST fail with the count of occurrences.

### LS Tool
```typescript
interface LSArgs {
  path: string;
  ignore?: string[];
}
```

### Glob Tool
```typescript
interface GlobArgs {
  pattern: string;
  path?: string;
  limit?: number;
}
```

### Grep Tool
```typescript
interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-B"?: number;
  "-A"?: number;
  "-C"?: number;
  "-n"?: boolean;
  "-i"?: boolean;
  type?: string;
  head_limit?: number;
  multiline?: boolean;
  offset?: number;
  context?: number;
}
```

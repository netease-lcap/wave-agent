# Data Model: LSP Integration Support

## Configuration Types

### LspServerConfig
Configuration for a single LSP server.
```typescript
interface LspServerConfig {
  command: string;
  args?: string[];
  extensionToLanguage: Record<string, string>;
  transport?: "stdio" | "socket";
  env?: Record<string, string>;
  initializationOptions?: unknown;
  settings?: unknown;
  workspaceFolder?: string;
  startupTimeout?: number;
  shutdownTimeout?: number;
  restartOnCrash?: boolean;
  maxRestarts?: number;
}
```

### LspConfig
The root configuration object, usually loaded from `.lsp.json`.
```typescript
interface LspConfig {
  [language: string]: LspServerConfig;
}
```

## Internal State

### LspProcess
Represents a running LSP server process and its associated state.
```typescript
interface LspProcess {
  process: ChildProcess;
  config: LspServerConfig;
  language: string;
  initialized: boolean;
  requestId: number;
  pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }>;
  openedFiles: Set<string>;
}
```

## Tool Interface

### LspToolArguments
Arguments passed to the `lspTool`.
```typescript
interface LspToolArguments {
  operation: "goToDefinition" | "findReferences" | "hover" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls";
  filePath: string;
  line: number;
  character: number;
}
```

## LSP Protocol Types (Subset)

### Position
```typescript
interface Position {
  line: number; // 0-based
  character: number; // 0-based
}
```

### Range
```typescript
interface Range {
  start: Position;
  end: Position;
}
```

### Location
```typescript
interface Location {
  uri: string;
  range: Range;
}
```

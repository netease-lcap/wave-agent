# Contract: LSP API

## LspManager Interface

```typescript
class LspManager {
  /**
   * Initializes the manager with the workspace directory.
   */
  async initialize(workdir: string): Promise<void>;

  /**
   * Registers a new LSP server configuration.
   */
  registerServer(language: string, config: LspServerConfig): void;

  /**
   * Executes an LSP operation.
   */
  execute(args: {
    operation: string;
    filePath: string;
    line: number;
    character: number;
  }): Promise<{ success: boolean; content: string }>;

  /**
   * Cleans up all running LSP processes.
   */
  async cleanup(): Promise<void>;
}
```

## Tool Definition

```typescript
const lspTool: ToolPlugin = {
  name: "lsp",
  description: "Interact with Language Server Protocol (LSP) servers to get code intelligence features.",
  parameters: {
    type: "object",
    properties: {
          operation: {
            type: "string",
            enum: [
              "goToDefinition",
              "findReferences",
              "hover",
              "documentSymbol",
              "workspaceSymbol",
              "goToImplementation",
              "prepareCallHierarchy",
              "incomingCalls",
              "outgoingCalls"
            ]
          },
      filePath: { type: "string" },
      line: { type: "number" },
      character: { type: "number" }
    },
    required: ["operation", "filePath", "line", "character"]
  },
  execute: async (args, context) => { ... }
};
```

## Configuration Schema (.lsp.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "properties": {
      "command": { "type": "string" },
      "args": { "type": "array", "items": { "type": "string" } },
      "env": { "type": "object", "additionalProperties": { "type": "string" } },
      "extensionToLanguage": { "type": "object", "additionalProperties": { "type": "string" } },
      "initializationOptions": { "type": "object" }
    },
    "required": ["command", "extensionToLanguage"]
  }
}
```

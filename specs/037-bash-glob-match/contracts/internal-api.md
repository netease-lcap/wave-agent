# Internal API Contracts: Permission Management

## PermissionManager (agent-sdk)

### `getSmartPrefix(command: string): string`
Extracts a smart prefix from a bash command.

**Parameters:**
- `command`: The full bash command string.

**Returns:**
- The extracted prefix (e.g., `npm install`).

### `expandBashRule(command: string, workdir: string): string[]`
*Updated* to support prefix rules.

**Returns:**
- Array of rules, potentially including `Bash(pattern*)`.

## Confirmation Component (code)

### `ConfirmationProps`
*Updated* to include suggested prefix.

```typescript
interface ConfirmationProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string; // New optional prop
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
  onAbort: () => void;
}
```

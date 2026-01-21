# Bash History Selector Data Model

## InputManager State

The `InputManager` maintains the following state for the Bash History Selector:

```typescript
private showBashHistorySelector: boolean; // Visibility of the selector
private exclamationPosition: number;     // Position of '!' (usually 0)
private bashHistorySearchQuery: string;   // Current search string after '!'
```

## Bash History Entry

The `BashHistoryEntry` interface (from `wave-agent-sdk`) represents a single command in the history:

```typescript
export interface BashHistoryEntry {
  command: string;
  timestamp: number;
  workdir: string;
  exitCode?: number;
}
```

## Callbacks

The `InputManager` uses the `onBashHistorySelectorStateChange` callback to notify the UI:

```typescript
onBashHistorySelectorStateChange?: (
  show: boolean,
  query: string,
  position: number,
) => void;
```

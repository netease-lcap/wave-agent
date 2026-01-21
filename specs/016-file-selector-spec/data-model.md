# File Selector Data Model

## InputManager State

The `InputManager` maintains the following state for the File Selector:

```typescript
private showFileSelector: boolean; // Visibility of the selector
private atPosition: number;        // Cursor position where '@' was typed
private fileSearchQuery: string;   // Current search string after '@'
private filteredFiles: FileItem[]; // List of files matching the query
```

## File Item

The `FileItem` interface (from `wave-agent-sdk`) represents a single entry in the file list:

```typescript
export interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
}
```

## Callbacks

The `InputManager` uses the `onFileSelectorStateChange` callback to notify the UI:

```typescript
onFileSelectorStateChange?: (
  show: boolean,
  files: FileItem[],
  query: string,
  position: number,
) => void;
```

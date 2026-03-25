# Data Model: Help Command

## Entities

### SlashCommand
Represents a command that can be invoked via the `/` prefix.

```typescript
interface SlashCommand {
  id: string;          // Unique identifier (e.g., "help")
  name: string;        // Display name
  description: string; // Brief explanation of what the command does
  handler: (args: string) => void | Promise<void>; // Function to execute
}
```

### HelpItem
A simple mapping for general key bindings.

```typescript
interface HelpItem {
  key: string;         // The key or key combination (e.g., "Ctrl+R")
  description: string; // What the key does
}
```

### HelpView State
Internal state for the `HelpView` component.

```typescript
interface HelpViewState {
  activeTab: "general" | "commands" | "custom-commands";
  selectedIndex: number; // Index of the selected command in the current tab
}
```

## Relationships
- `HelpView` consumes a list of `SlashCommand` objects (both built-in and custom).
- `HelpView` renders a static list of `HelpItem` objects for the "General" tab.

# Contracts: Help View

## HelpView Component

The `HelpView` component is the primary interface for displaying help information.

### Props

```typescript
interface HelpViewProps {
  /**
   * Callback invoked when the user requests to close the help view (e.g., by pressing Esc).
   */
  onCancel: () => void;

  /**
   * Optional list of custom commands to display in the "Custom Commands" tab.
   * If empty or not provided, the "Custom Commands" tab will not be shown.
   */
  commands?: SlashCommand[];
}
```

### Behavior
- **Mounting**: When mounted, it should default to the "General" tab.
- **Input Handling**:
    - `Tab`: Cycle through available tabs ("General" -> "Commands" [-> "Custom Commands"] -> "General").
    - `UpArrow` / `DownArrow`: Navigate the command list when in "Commands" or "Custom Commands" tabs.
    - `Esc`: Call `onCancel`.
- **Rendering**:
    - Display tab headers at the top.
    - Display the content of the active tab in the middle.
    - Display a footer with navigation hints (e.g., "Tab switch • ↑↓ navigate • Esc close").

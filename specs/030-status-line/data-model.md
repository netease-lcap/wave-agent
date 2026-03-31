# Data Model: Status Line Component Refactoring

## Entities

### StatusLineProps
The interface defining the properties passed to the `StatusLine` component.

| Property | Type | Description |
|----------|------|-------------|
| `permissionMode` | `string` | The current permission mode (e.g., "plan", "normal"). |
| `isShellCommand` | `boolean` | Whether the current input is a shell command (starts with `!`). |

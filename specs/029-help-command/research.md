# Research: Help Command

## Decision: Ink-based Interactive UI
- **Rationale**: The `code` package uses React Ink for its terminal interface. Implementing the help view as an Ink component allows for a rich, interactive experience (tabs, scrolling, colors) within the terminal, consistent with the rest of the application.
- **Alternatives considered**: 
    - Static text output: Rejected because it's less user-friendly for long lists of commands and doesn't allow for easy navigation between categories.

## Decision: Tabbed Interface
- **Rationale**: Separating key bindings, built-in commands, and custom commands into tabs prevents information overload and makes it easier for users to find specific types of help.
- **Alternatives considered**: 
    - Single long list: Rejected as it would require significant scrolling and would be harder to scan.

## Decision: Selection-based Command Descriptions
- **Rationale**: Showing descriptions only for the selected command saves vertical space, allowing more commands to be visible at once while still providing detailed information when needed.
- **Alternatives considered**: 
    - Show all descriptions: Rejected as it would make the list very long and harder to navigate.

## Decision: Integration with InputManager
- **Rationale**: The `/help` command needs to intercept the normal chat flow and display a modal-like view. Integrating it into the `InputManager` (or the main application loop) ensures it can correctly capture input and manage its own state.

## Integration Points
- `AVAILABLE_COMMANDS`: The source of truth for built-in commands.
- `HelpView`: The React component in `packages/code/src/components/HelpView.tsx`.
- `SlashCommand` type: Defined in `wave-agent-sdk`.

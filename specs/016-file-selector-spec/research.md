# Research: File Selector

**Decision**: Implement an interactive File Selector triggered by `@` in the terminal input.

**Rationale**: 
- Manually typing file paths is error-prone and slow.
- Real-time filtering provides immediate feedback and helps users find files quickly.
- Keyboard-based navigation maintains the CLI-first workflow.

**Alternatives Considered**:
- **Tab Completion**: Standard shell tab completion is useful but doesn't provide the same visual list and filtering capabilities as a dedicated selector.
- **Command-line Arguments**: Requiring users to pass files as arguments is less flexible than allowing them to insert paths anywhere in their message.

## Findings

### Trigger Logic
- The `@` character is a natural trigger for "mentioning" or "referencing" files.
- Detection should happen in `InputManager` to allow for real-time UI updates.

### Search Utility
- Use `searchFiles` from `wave-agent-sdk`.
- Implement debouncing (300ms) to prevent excessive I/O during rapid typing.
- Support both absolute and relative paths, as well as `~` expansion.

### UI Implementation
- Use `ink` to render a floating list near the cursor or at the bottom of the input.
- **Visual Style**:
  - Use icons (📁/📄) to distinguish between directories and files.
  - Highlight the selected item with a distinct color (e.g., cyan).
  - Show a "sliding window" of 10 items for large directories.
  - Indicate if there are more items above or below the current view.

### Integration Points
- **InputManager**: Manage the `@` trigger, query state, and selection logic.
- **FileSelector Component**: Handle the rendering and keyboard events for navigation.
- **wave-agent-sdk**: Provide the underlying filesystem search capabilities.

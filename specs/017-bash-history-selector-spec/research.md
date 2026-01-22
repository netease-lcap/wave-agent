# Research: Bash History Selector

**Decision**: Implement an interactive Bash History Selector triggered by `!` at the start of the input.

**Rationale**: 
- Users frequently repeat or slightly modify previous commands.
- Searching history is faster than re-typing or using `Ctrl+r` in a standard shell.
- Integrating history into the agent's input field allows for seamless command re-execution.

**Alternatives Considered**:
- **Standard `Ctrl+r`**: While powerful, it's less discoverable and doesn't provide a visual list of multiple matches.
- **Agent-only History**: Storing history only within the agent session would miss out on the user's existing shell history.

## Findings

### Trigger Logic
- The `!` character is the traditional shell trigger for history expansion.
- Restricting it to the first character of the input prevents accidental triggers during normal typing.

### Search Utility
- Use `searchBashHistory` from `wave-agent-sdk`.
- Search should be performed on the command string and optionally filtered by the current directory.

### UI Implementation
- Use `ink` to render a list of history entries.
- **Visual Style**:
  - Show the command string clearly.
  - Display metadata like timestamp and execution directory for the selected item.
  - Use a blue border to distinguish the history selector.
  - Support `Enter` for execution and `Tab` for insertion/editing.
  - Support `Ctrl+d` for deleting entries.

### Integration Points
- **InputManager**: Manage the `!` trigger and history selection state.
- **BashHistorySelector Component**: Handle rendering and keyboard navigation.
- **wave-agent-sdk**: Provide access to and searching of the `.bash_history` file.

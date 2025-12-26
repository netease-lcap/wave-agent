# Research: AcceptEdits Permission Mode

## RT-001: Shift+Tab Detection in Ink
- **Decision**: Use `key.shift` and `key.tab` in Ink's `useInput` hook.
- **Rationale**: Ink's `Key` object typically includes boolean flags for modifier keys. If `key.tab` is true and `key.shift` is true, it indicates `Shift+Tab`.
- **Alternatives considered**: Using raw escape sequences, but Ink's abstraction is preferred if available.

## RT-002: CLI UI Status Display
- **Decision**: Add a status indicator in the `InputBox` component, possibly next to the cursor or as a separate line above the input field.
- **Rationale**: The `InputBox` is where the user interacts with the agent and where mode cycling will be triggered. Showing the mode here provides immediate feedback.
- **Alternatives considered**: Adding a global status bar at the top or bottom of the screen.

## RT-003: defaultMode Initialization Trace
- **Decision**: Leverage existing `LiveConfigManager` and `PermissionManager` integration.
- **Rationale**: `Agent.initialize` already handles loading `settings.json` and updating `PermissionManager` with `defaultMode`. We just need to ensure `acceptEdits` is a valid value in the types and validation logic.
- **Trace**:
  1. `Agent.create` -> `Agent.initialize`
  2. `Agent.initialize` -> `liveConfigManager.initialize()`
  3. `Agent.initialize` -> `permissionManager.updateConfiguredDefaultMode(currentConfig.defaultMode)`
  4. `PermissionManager.resolveEffectivePermissionMode` uses `configuredDefaultMode`.

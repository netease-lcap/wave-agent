# Quickstart: /model Command

## Overview
The `/model` command allows you to switch between configured AI models during a session. This is useful when you want to use a different model for a specific task.

## How to use

1. **Invoke the command**: Type `/model` in the chat and press Enter.
2. **View available models**: A list of configured models appears at the bottom of the interface.
3. **Navigate**: Use the **Up/Down Arrow** keys to move the cursor through the list.
4. **Select**: Press **Enter** to confirm your selection.
5. **Cancel**: Press **Escape** to close the selector without changing the model.

## Example

```text
User: /model
[UI shows:]
▶ claude-opus-4 (current)
  claude-sonnet-4
  claude-haiku-3
[User navigates and selects "claude-sonnet-4"]
Agent: Model switched to claude-sonnet-4.
```

In this example, the active model is changed from `claude-opus-4` to `claude-sonnet-4` for the current session.

## Important Notes
- **Session Only**: The model change only affects the current session. Restarting the agent will revert to the default model.
- **Current Model**: The currently active model is marked with `(current)` in green.
- **Configuration**: Available models come from your `settings.json` files (user and project level), environment variables, and defaults.

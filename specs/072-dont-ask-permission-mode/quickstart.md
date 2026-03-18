# Quickstart: dontAsk Permission Mode

The `dontAsk` permission mode allows you to configure the agent to automatically deny any restricted tool calls that have not been pre-approved in your `permissions.allow` rules. This prevents the agent from interrupting you with permission prompts for untrusted tools, while still allowing pre-approved tools to run seamlessly.

## Enabling dontAsk Mode

To enable `dontAsk` mode, you can set the `defaultMode` in your `settings.json` or `settings.local.json` file:

```json
{
  "defaultMode": "dontAsk"
}
```

## How it Works

- **Auto-Allow**: Tools that match a rule in your `permissions.allow` or `temporaryRules` will be executed automatically without prompting you.
- **Auto-Deny**: Any restricted tool call that does NOT match a pre-approved rule will be immediately denied. The agent will receive a "Permission denied" error and will be informed that automatic prompts are disabled in this mode.
- **Unrestricted Tools**: Tools that do not require permission (e.g., `Read`, `Grep`) will continue to work as usual.
- **Deny Rules**: If a tool is explicitly denied in your `permissions.deny` rules, it will still be denied, even if it's also in the `allow` list.

## UI Interaction

The `dontAsk` mode is NOT included in the "Shift+Tab" cycle of permission modes in the CLI. This prevents accidental activation of the mode while you are interacting with the agent. It must be explicitly enabled via configuration.

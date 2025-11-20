# Quickstart: Separate Agent Sessions

This guide explains how to verify the separate session files for agents and subagents.

## Prerequisites

- A running Wave Agent environment.
- `agent-sdk` built with the new changes.

## Verification Steps

1. **Start the Agent**
   Run the agent in a terminal.

2. **Trigger a Subagent**
   Ask the agent to perform a task that requires a subagent.
   Example: "Use the subagent to research the history of AI."

3. **Wait for Completion**
   Wait until the task is finished and the agent saves the session (usually on exit or periodically).

4. **Check Session Files**
   Navigate to the sessions directory (default: `~/.wave/sessions`).
   
   ```bash
   ls -l ~/.wave/sessions
   ```

5. **Verify Filenames**
   You should see two types of files:
   
   - Main Agent Session: `session_xxxxxxxx.json`
   - Subagent Session: `subagent_session_xxxxxxxx.json`

## Code Usage

If you are using the SDK programmatically:

```typescript
// Main Agent (default)
const agent = new Agent(options);
// Session saved as session_{id}.json

// Subagent (internal)
// The SubagentManager automatically handles this:
// Session saved as subagent_session_{id}.json
```

To manually specify a prefix (e.g. for testing):

```typescript
const messageManager = new MessageManager({
  // ... other options
  sessionPrefix: "custom_prefix"
});
// Session saved as custom_prefix_{id}.json
```

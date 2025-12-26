# Quickstart: AcceptEdits Permission Mode

## CLI Usage

### Cycling Modes
During an active session, press `Shift+Tab` to cycle through permission modes:
1. **Default**: Asks for permission for all sensitive operations.
2. **Accept Edits**: Automatically allows file edits, writes, and deletes. Still asks for Bash commands.
3. **Bypass Permissions**: Automatically allows everything.

### Visual Indicator
The current mode will be displayed in the input area.

## Configuration

Add `defaultMode` to your `settings.json`:

```json
{
  "defaultMode": "acceptEdits"
}
```

## SDK Usage

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  permissionMode: 'acceptEdits'
});

// Change mode dynamically
agent.setPermissionMode('bypassPermissions');

// Get current mode
const mode = agent.getPermissionMode();
```

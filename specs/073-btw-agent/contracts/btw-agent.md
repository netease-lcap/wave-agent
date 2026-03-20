# API Contracts: btwAgent

## Slash Command: `/btw`

The `/btw` command is a client-side command that triggers the `btwAgent` session.

### Command Definition
- **Command**: `/btw`
- **Arguments**: `<query>` (string)
- **Description**: Ask a quick question about the codebase or current context without adding to the task queue. The `btwAgent` runs concurrently with the main agent.

### Interception Logic (`useChat.tsx`)
```typescript
// Intercept BEFORE the isLoading || isCommandRunning check
if (message.startsWith('/btw ')) {
  const query = message.slice(5).trim();
  if (query) {
    // 1. Set isBtwModeActive to true
    // 2. Create btwAgentInstance via SubagentManager
    // 3. Initialize btwAgentInstance.messageManager with main agent's messages
    // 4. Wrap query in <system-reminder>
    // 5. Execute btwAgentInstance.aiManager.sendAIMessage()
    // 6. Bypass queuedMessages
  }
}
```

## Subagent Configuration (`SubagentConfiguration`)

The `btwAgent` will be configured with the following parameters:

| Parameter | Value |
|-----------|-------|
| `systemPrompt` | `mainAgent.aiManager.getSystemPrompt()` |
| `tools` | `mainAgent.toolManager.list().map(t => t.name)` |
| `model` | `mainAgent.getModelConfig().model` |

## UI State Interface (`ChatContextType`)

The `ChatContextType` will be extended with the following fields:

```typescript
interface ChatContextType {
  // ... existing fields
  isBtwModeActive: boolean;
  btwAgentInstance: SubagentInstance | null;
  btwAgentMessages: Message[];
  btwAgentIsLoading: boolean;
}
```

## System Reminder Template

The user's query will be wrapped in the following XML block:

```xml
<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${USER_QUERY}
```

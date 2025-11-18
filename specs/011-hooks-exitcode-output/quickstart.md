# Quickstart: Hook Exit Code Output Support

## Overview

This feature enhances Wave Agent's hooks system to support exit code-based communication patterns. Hooks can now communicate status and provide feedback through exit codes, stdout, and stderr, with different behaviors based on the hook event type.

## Exit Code Communication

### Simple Communication Pattern

```bash
#!/bin/bash
# Hook script example

# Success - stdout handling varies by hook type
echo "Hook executed successfully"
exit 0

# Blocking error - stderr shown to appropriate recipient  
echo "Critical error occurred" >&2
exit 2

# Non-blocking error - stderr shown to user, execution continues
echo "Warning: minor issue detected" >&2  
exit 1
```

### Hook Event Behaviors

| Hook Event | Exit 0 | Exit 2 | Other Exits |
|------------|--------|--------|-------------|
| **UserPromptSubmit** | stdout → agent context | stderr → user error, block prompt | stderr → user error |
| **PreToolUse** | continue execution | stderr → agent, block tool | stderr → user |  
| **PostToolUse** | continue execution | stderr → agent (tool ran) | stderr → user |
| **Stop** | allow stop | stderr → agent, block stop | stderr → user |

## Implementation Integration

### 1. Hook Manager Enhancement

The existing `HookManager` is enhanced to process exit codes:

```typescript
// Enhanced hook execution with exit code processing
const results = await hookManager.executeHooks(event, context);

// Process results for message creation
for (const result of results) {
  if (result.exitCode === 2) {
    // Handle blocking error based on event type
    await handleBlockingError(event, result.stderr);
  } else if (result.exitCode === 0 && event === 'UserPromptSubmit') {
    // Inject stdout into agent context
    await injectHookContext(result.stdout);
  }
}
```

### 2. Message Manager Integration

Hook results are integrated into the conversation flow using existing methods:

```typescript
// UserPromptSubmit success - inject context
if (result.exitCode === 0 && event === 'UserPromptSubmit') {
  messageManager.addUserMessage(result.stdout);
}

// PreToolUse blocking error - update tool block with error
if (result.exitCode === 2 && event === 'PreToolUse') {
  messageManager.updateToolBlock({
    toolId: context.toolId,
    result: result.stderr,
    success: false,
    error: "Hook blocked tool execution"
  });
}

// PostToolUse error feedback - append stderr to original result
if (result.exitCode === 2 && event === 'PostToolUse') {
  messageManager.updateToolBlock({
    toolId: context.toolId,
    result: `${originalResult}\n\nHook feedback: ${result.stderr}`,
    success: false
  });
}

// UserPromptSubmit blocking error - show user error only
if (result.exitCode === 2 && event === 'UserPromptSubmit') {
  messageManager.addErrorBlock(result.stderr);
}

// Stop blocking error - provide agent feedback  
if (result.exitCode === 2 && event === 'Stop') {
  messageManager.addUserMessage(`Stop blocked: ${result.stderr}`);
}

// Non-blocking errors - show user error
if (result.exitCode !== 0 && result.exitCode !== 2) {
  messageManager.addErrorBlock(result.stderr);
}
```

### 3. Testing Integration

Hook behaviors are validated through message inspection:

```typescript
// Test UserPromptSubmit success behavior
const agent = await Agent.create({ workdir });
agent.sendMessage("test prompt");

// Verify context injection occurred
expect(agent.messages).toHaveLength(2);
expect(agent.messages[1].role).toBe('user');  
expect(agent.messages[1].blocks[0].content).toContain('hook output');
```

## Hook Development Examples

### UserPromptSubmit Hook

```bash
#!/bin/bash
# .wave/settings.json: UserPromptSubmit event

USER_PROMPT="$1"

# Validate prompt
if [[ -z "$USER_PROMPT" ]]; then
  echo "Error: Empty prompt not allowed" >&2
  exit 2  # Block prompt processing
fi

# Add context for AI
echo "User intent analyzed: $USER_PROMPT"
echo "Confidence: high"
exit 0  # Success - stdout injected into context
```

### PreToolUse Hook

```bash
#!/bin/bash  
# .wave/settings.json: PreToolUse event with tool matcher

TOOL_NAME="$1"
TOOL_INPUT="$2"

# Check if dangerous operation
if [[ "$TOOL_INPUT" == *"rm -rf"* ]]; then
  echo "Blocked dangerous operation: $TOOL_INPUT" >&2
  exit 2  # Block tool execution
fi

# Log tool usage
echo "Tool $TOOL_NAME validated successfully"
exit 0  # Continue with tool execution
```

### PostToolUse Hook

```bash
#!/bin/bash
# .wave/settings.json: PostToolUse event

TOOL_NAME="$1" 
TOOL_RESULT="$2"

# Analyze tool result
if [[ "$TOOL_RESULT" == *"Error"* ]]; then
  echo "Tool execution completed with errors. Manual review recommended." >&2
  exit 2  # Alert agent to errors (tool already ran)
fi

echo "Tool execution logged successfully"
exit 0  # Normal completion
```

### Stop Hook  

```bash
#!/bin/bash
# .wave/settings.json: Stop event

# Check if work is complete
if [[ ! -f ".wave/session-complete" ]]; then
  echo "Session incomplete. Please save work before stopping." >&2
  exit 2  # Block stop operation
fi

echo "Session completed successfully"  
exit 0  # Allow stop
```

## Configuration

### Hook Configuration Example

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{"type": "command", "command": "./validate-prompt.sh"}]
    }],
    "PreToolUse": [{
      "matcher": "bash*",
      "hooks": [{"type": "command", "command": "./check-bash-safety.sh"}]
    }],
    "PostToolUse": [{
      "hooks": [{"type": "command", "command": "./log-tool-usage.sh"}]  
    }],
    "Stop": [{
      "hooks": [{"type": "command", "command": "./check-completion.sh"}]
    }]
  }
}
```

## Implementation Integration

### Hook Result Processing in AIManager

The `packages/agent-sdk/src/managers/aiManager.ts` processes PreToolUse, PostToolUse, and Stop hook results:

```typescript
// Enhanced PreToolUse hook execution with result processing
private async executePreToolUseHooks(
  toolName: string,
  toolArgs: Record<string, unknown>,
  currentToolId: string
): Promise<void> {
  if (!this.hookManager) return;

  const context: ExtendedHookExecutionContext = {
    event: "PreToolUse",
    toolName,
    projectDir: this.workdir,
    timestamp: new Date(),
    // ... other context fields
  };

  const results = await this.hookManager.executeHooks("PreToolUse", context);
  
  // Process hook results based on exit codes
  for (const result of results) {
    if (result.exitCode === 2) {
      // PreToolUse blocking: show error to agent via current tool block
      this.messageManager.updateToolBlock({
        toolId: currentToolId,
        result: result.stderr,
        success: false,
        error: "Hook blocked tool execution"
      });
      // Tool execution continues - agent sees the feedback
    } else if (result.exitCode !== 0) {
      // Non-blocking error: show to user
      this.messageManager.addErrorBlock(result.stderr || "Hook execution failed");
    }
    // Exit code 0: success, no message operations needed
  }
}

// Enhanced PostToolUse hook execution with result processing  
private async executePostToolUseHooks(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: ToolResult
): Promise<void> {
  if (!this.hookManager) return;

  const context: ExtendedHookExecutionContext = {
    event: "PostToolUse",
    toolName,
    projectDir: this.workdir,
    timestamp: new Date(),
    toolResponse: toolResult.content,
    // ... other context fields
  };

  const results = await this.hookManager.executeHooks("PostToolUse", context);
  
  // Process hook results based on exit codes
  for (const result of results) {
    if (result.exitCode === 2) {
      // PostToolUse blocking: update the current tool block with feedback
      // Note: toolResult.toolId should contain the actual tool execution ID
      this.messageManager.updateToolBlock({
        toolId: toolResult.toolId,
        result: `${toolResult.content}\n\nHook feedback: ${result.stderr}`,
        success: false
      });
    } else if (result.exitCode !== 0) {
      // Non-blocking error: show to user
      this.messageManager.addErrorBlock(result.stderr || "Hook execution failed");
    }
    // Exit code 0: success, no message operations needed
  }
}

// Enhanced Stop hook execution with result processing
private async executeStopHooks(): Promise<void> {
  if (!this.hookManager) return;

  const context: ExtendedHookExecutionContext = {
    event: "Stop",
    projectDir: this.workdir,
    timestamp: new Date(),
    // ... other context fields
  };

  const results = await this.hookManager.executeHooks("Stop", context);
  
  // Process hook results based on exit codes
  for (const result of results) {
    if (result.exitCode === 2) {
      // Stop blocking: show error to agent and continue conversation
      this.messageManager.addUserMessage(result.stderr);
      // Continue conversation - agent should respond to the feedback
      await this.sendAIMessage();
    } else if (result.exitCode !== 0) {
      // Non-blocking error: show to user  
      this.messageManager.addErrorBlock(result.stderr || "Hook execution failed");
    }
    // Exit code 0: success, no message operations needed
  }
}
```

### Hook Result Processing in Agent

The `packages/agent-sdk/src/agent.ts` processes UserPromptSubmit hook results:

```typescript
// Enhanced UserPromptSubmit hook execution with result processing
if (this.hookManager) {
  try {
    const results = await this.hookManager.executeHooks("UserPromptSubmit", {
      event: "UserPromptSubmit",
      projectDir: this.workdir,
      timestamp: new Date(),
      userPrompt: content,
      // ... other context fields
    });
    
    // Process hook results based on exit codes
    for (const result of results) {
      if (result.exitCode === 2) {
        // UserPromptSubmit blocking: show error, erase prompt, and stop processing
        this.messageManager.addErrorBlock(result.stderr || "Invalid prompt");
        this.messageManager.removeLastUserMessage();
        return; // Block further processing - do not continue to AI
      } else if (result.exitCode === 0 && result.stdout) {
        // Success with context: inject stdout as user message
        this.messageManager.addUserMessage(result.stdout);
      } else if (result.exitCode !== 0) {
        // Non-blocking error: show to user
        this.messageManager.addErrorBlock(result.stderr || "Hook execution failed");
      }
    }
  } catch (error) {
    this.logger?.warn("UserPromptSubmit hooks execution failed:", error);
    // Continue processing even if hooks fail
  }
}
```

## Testing Your Hooks

### Agent-SDK Tests (Mocked)

All tests in `packages/agent-sdk/tests/agent/` use mocking to avoid real operations:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import * as hookService from "@/services/hook.js";
import { saveSession } from "@/services/session.js";

// Mock the session service
vi.mock("@/services/session", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

// Mock AI Service to prevent real network calls
vi.mock("@/services/aiService");

// Mock hook service to control hook execution
vi.mock("@/services/hook");

describe('Hook Exit Code Behavior', () => {
  let agent: Agent;

  beforeEach(async () => {  
    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
      },
    });
    
    vi.clearAllMocks();
  });

  it('should inject context for UserPromptSubmit success', async () => {
    // Mock hook execution returning exit code 0 with stdout
    const mockExecuteHooks = vi.mocked(hookService.executeHooks);
    mockExecuteHooks.mockResolvedValue([{
      success: true,
      exitCode: 0,
      stdout: 'context data',
      stderr: '',
      duration: 100,
      timedOut: false
    }]);

    // Mock AI service to return simple response
    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "Response with injected context",
    });

    await agent.sendMessage('test prompt');
    
    // Verify context injection through agent.messages validation
    expect(agent.messages).toHaveLength(2);
    expect(agent.messages[1].blocks[0].content).toContain('context data');
  });

  it('should block tool execution on PreToolUse exit 2', async () => {
    // Mock hook execution returning exit code 2 with stderr
    const mockExecuteHooks = vi.mocked(hookService.executeHooks);  
    mockExecuteHooks.mockResolvedValue([{
      success: false,
      exitCode: 2,
      stdout: '',
      stderr: 'Tool blocked by hook',
      duration: 100,
      timedOut: false
    }]);
    
    // Mock AI service to return tool call
    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      tool_calls: [{
        id: "call_123",
        type: "function" as const,
        index: 0,
        function: {
          name: "run_terminal_cmd",
          arguments: JSON.stringify({ command: 'dangerous-command' }),
        },
      }],
    });

    await agent.sendMessage('test prompt');
    
    // Verify tool was blocked through message validation
    const toolBlocks = agent.messages.filter(msg => 
      msg.blocks?.some(block => block.type === 'tool')
    );
    expect(toolBlocks[0].blocks[0].result).toContain('Tool blocked by hook');
    expect(toolBlocks[0].blocks[0].success).toBe(false);
  });
});
```

All hook behavior validation is done through comprehensive mocked tests that verify the correct message operations are performed based on exit codes and hook event types.

## Best Practices

### Hook Script Guidelines

1. **Exit Code Usage**:
   - Exit 0: Successful completion
   - Exit 2: Critical issues requiring blocking
   - Exit 1 (or other): Non-critical issues, show warning

2. **Output Handling**:
   - Use stdout for context data (UserPromptSubmit only)
   - Use stderr for all error messages
   - Keep output concise and actionable

3. **Performance**:
   - Keep hook execution under 10 seconds
   - Use timeout-safe operations
   - Avoid blocking I/O when possible

### Error Message Guidelines

1. **User-facing errors**: Clear, actionable messages
2. **Agent-facing errors**: Technical details with context  
3. **Blocking errors**: Explain why operation was blocked
4. **Non-blocking errors**: Provide guidance for resolution

This quickstart enables you to implement rich hook communication patterns while maintaining backward compatibility with existing hook configurations.
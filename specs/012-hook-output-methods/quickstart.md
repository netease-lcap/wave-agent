# Quickstart: Hook Output Methods

**Target Audience**: Developers implementing hooks with output control capabilities  
**Time to Complete**: 15-20 minutes  
**Prerequisites**: Basic understanding of Wave hooks, TypeScript, and JSON

## Overview

Hook Output Methods enable hooks to communicate sophisticated control instructions to Wave through both simple exit codes and advanced JSON output. This allows hooks to block operations, modify tool inputs, display warnings, and request user confirmation.

## Implementation Approach

### Phase 0: Agent & Chat Context Integration (Promise-Based Approach)

**IMPORTANT**: Instead of pausing/resuming recursion, we use **Promise-based permission handling** where `sendMessage` continues running and simply waits for Promise resolution.

1. **Update Agent Class with Promise-Based Permissions**
   ```typescript
   // Add to packages/agent-sdk/src/agent.ts
   
   export class Agent {
     // ... existing properties ...
     
     private pendingPermissions: PermissionRequest[] = [];
     
     // Get current pending permissions for UI display
     public getPendingPermissions(): PermissionRequest[] {
       return [...this.pendingPermissions];
     }
     
     // Check if waiting for any permissions
     public isAwaitingPermission(): boolean {
       return this.pendingPermissions.length > 0;
     }
     
     // Internal: Create permission request with Promise
     private createPermissionRequest(
       toolName: string, 
       reason: string, 
       toolInput?: Record<string, any>
     ): Promise<boolean> {
       return new Promise<boolean>((resolve, reject) => {
         const request: PermissionRequest = {
           id: generateId(),
           toolName,
           reason,
           toolInput,
           resolve: (allowed: boolean) => {
             // Remove from pending list
             this.pendingPermissions = this.pendingPermissions.filter(p => p.id !== request.id);
             resolve(allowed);
           },
           reject: (error: string) => {
             this.pendingPermissions = this.pendingPermissions.filter(p => p.id !== request.id);
             reject(new Error(error));
           }
         };
         
         // Add to pending list
         this.pendingPermissions.push(request);
         
         // Notify UI via callback
         this.callbacks?.onPermissionRequired?.(request);
       });
     }
   }
   
   // Update AgentCallbacks interface
   export interface AgentCallbacks {
     // ... existing callbacks ...
     
     // Called when permission is needed - UI can resolve the Promise
     onPermissionRequired?: (request: PermissionRequest) => void;
   }
   ```

2. **Update Chat Context for Promise-Based Resolution**
   ```typescript
   // Modify packages/code/src/contexts/useChat.tsx
   
   export interface ChatContextType {
     // ... existing properties ...
     
     // Permission management (Promise-based)
     pendingPermissions: PermissionRequest[];
     resolvePermission: (permissionId: string, allowed: boolean) => void;
     isAwaitingPermission: boolean;
   }
   
   export function ChatProvider({ children }: { children: React.ReactNode }) {
     // ... existing state ...
     
     const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
     
     // Create agent callbacks that handle permission requests
     const agentCallbacks: AgentCallbacks = {
       // ... existing callbacks ...
       
       onPermissionRequired: useCallback((request: PermissionRequest) => {
         setPendingPermissions(prev => [...prev, request]);
       }, []),
     };
     
     // Method to resolve permission Promise from UI
     const resolvePermission = useCallback((permissionId: string, allowed: boolean) => {
       const request = pendingPermissions.find(p => p.id === permissionId);
       if (request) {
         // This resolves the Promise that sendMessage is waiting on
         request.resolve(allowed);
         
         // Update UI state
         setPendingPermissions(prev => prev.filter(p => p.id !== permissionId));
       }
     }, [pendingPermissions]);
     
     const isAwaitingPermission = pendingPermissions.length > 0;
     
     return (
       <ChatContext.Provider value={{
         // ... existing values ...
         pendingPermissions,
         resolvePermission, // UI calls this to resolve the Promise
         isAwaitingPermission,
       }}>
         {children}
       </ChatContext.Provider>
     );
   }
   ```

### Phase 1: Core Infrastructure (Hours 1-4)

1. **Extend Message Block Types**
   ```typescript
   // Add to packages/agent-sdk/src/types/messaging.ts
   export interface WarnBlock {
     type: "warn";
     content: string;
   }

   export interface HookBlock {
     type: "hook";
     hookEvent: HookEventName;
     content: string;
     metadata?: Record<string, any>;
   }
   ```

2. **Create Hook Output Parser**
   ```typescript
   // Create packages/agent-sdk/src/utils/hookOutputParser.ts
   export function parseHookOutput(result: HookOutputResult): ParsedHookOutput {
     // 1. Try parsing stdout as JSON first
     // 2. Fall back to exit code interpretation if JSON invalid
     // 3. Validate hook-specific fields based on event type
     // 4. Return structured result with message blocks
   }
   ```

3. **Extend Message Manager**
   ```typescript
   // Add to packages/agent-sdk/src/managers/messageManager.ts
   public addWarnMessage(content: string): void {
     // Create WarnBlock and add to messages
   }

   public addHookMessage(hookEvent: HookEventName, content: string, metadata?: Record<string, any>): void {
     // Create HookBlock and add to messages
   }
   ```

### Phase 2: Hook Integration & Flow Control (Hours 5-8)

4. **Extend Hook Executor with Promise-Based Flow**
   ```typescript
   // Modify packages/agent-sdk/src/services/hookExecutor.ts
   export async function executePreToolUseWithPromise(
     toolName: string,
     toolInput: Record<string, any>,
     permissionCallback: (request: PermissionRequest) => void
   ): Promise<PreToolUseResult> {
     // 1. Execute PreToolUse hooks
     // 2. Parse hook output (JSON or exit code)
     // 3. If permissionDecision is "ask":
     //    - Create Promise that UI can resolve
     //    - Call permissionCallback to notify Agent
     //    - Return Promise that sendMessage will await
     // 4. If "allow"/"deny": return result immediately
     
     const result = await executeHook(/* ... */);
     
     if (result.parsed.permissionDecision === 'ask') {
       const permissionPromise = new Promise<boolean>((resolve, reject) => {
         const request: PermissionRequest = {
           id: generateId(),
           toolName,
           reason: result.parsed.reason || 'Permission required',
           toolInput,
           resolve,
           reject
         };
         
         // Notify Agent (which notifies UI)
         permissionCallback(request);
       });
       
       return {
         shouldProceed: false, // Don't proceed until Promise resolves
         permissionPromise
       };
     }
     
     return {
       shouldProceed: result.parsed.permissionDecision === 'allow',
       blockReason: result.parsed.reason
     };
   }
   ```

5. **Modify AIManager sendAIMessage (Promise-Based)**
   ```typescript
   // Modify packages/agent-sdk/src/managers/aiManager.ts
   
   // No complex state management - just Promise awaiting
   private async executePreToolUseHooks(
     toolName: string,
     toolInput?: Record<string, unknown>,
   ): Promise<PreToolUseResult> {
     if (!this.hookManager) return { shouldProceed: true };

     const result = await executePreToolUseWithPromise(
       toolName, 
       toolInput, 
       (request) => {
         // Add to Agent's pending list and notify UI
         this.agent.addPendingPermission(request);
       }
     );

     // If permission needed, await the Promise
     if (result.permissionPromise) {
       try {
         const allowed = await result.permissionPromise;
         return {
           shouldProceed: allowed,
           updatedInput: allowed ? result.updatedInput : undefined,
           blockReason: allowed ? undefined : 'User denied permission'
         };
       } catch (error) {
         return {
           shouldProceed: false,
           blockReason: `Permission error: ${error.message}`
         };
       }
     }

     return result;
   }

   // Tool execution flow - much simpler now
   const toolExecutionPromises = toolCalls.map(async (functionToolCall) => {
     // ... existing setup code ...

     try {
       // Execute PreToolUse hooks - this will await permission if needed
       const preToolResult = await this.executePreToolUseHooks(toolName, toolArgs);
       
       // Simple check - no complex state management
       if (!preToolResult.shouldProceed) {
         this.messageManager.updateToolBlock({
           toolId,
           args: JSON.stringify(toolArgs, null, 2),
           result: preToolResult.blockReason || "Tool execution blocked",
           success: false,
           isRunning: false,
           name: toolName,
           compactParams,
         });
         return;
       }

       // Use updated input if hook modified it
       const finalToolArgs = preToolResult.updatedInput || toolArgs;

       // ... continue with normal tool execution ...
     }
   });
   ```

### Phase 3: UI Components (Hours 9-12)

6. **Create Warning Block Component**
   ```typescript
   // Create packages/code/src/components/WarnBlock.tsx
   export function WarnBlock({ block, onDismiss }: WarnBlockProps) {
     return (
       <div className="warn-block">
         <Icon name="warning" />
         <span>{block.content}</span>
         {onDismiss && <Button onClick={onDismiss}>Dismiss</Button>}
       </div>
     );
   }
   ```

7. **Create Hook Block Component**
   ```typescript
   // Create packages/code/src/components/HookBlock.tsx
   export function HookBlock({ block, onExpand }: HookBlockProps) {
     return (
       <div className="hook-block">
         <div className="hook-header">
           <span>Hook: {block.hookEvent}</span>
           {onExpand && <Button onClick={onExpand}>Details</Button>}
         </div>
         <div className="hook-content">{block.content}</div>
       </div>
     );
   }
   ```

8. **Create Confirmation Dialog (Promise-Based)**
   ```typescript
   // Create packages/code/src/components/ConfirmDialog.tsx
   import React, { useState } from 'react';
   import { Box, Text, useInput } from 'ink';
   import { useChat } from '../contexts/useChat.js';
   
   export function ConfirmDialog({ request }: { request: PermissionRequest }) {
     const { resolvePermission } = useChat();
     const [selectedOption, setSelectedOption] = useState<'allow' | 'deny'>('deny');
     
     useInput((input, key) => {
       if (key.upArrow || key.downArrow) {
         setSelectedOption(prev => prev === 'allow' ? 'deny' : 'allow');
       }
       if (key.return) {
         // This resolves the Promise that sendMessage is awaiting
         resolvePermission(request.id, selectedOption === 'allow');
       }
     });

     return (
       <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
         <Text color="yellow" bold>🔒 Permission Required</Text>
         <Text>{request.reason}</Text>
         <Text dimColor>Tool: {request.toolName}</Text>
         
         <Box marginTop={1} flexDirection="column">
           <Text color={selectedOption === 'allow' ? 'green' : 'gray'}>
             {selectedOption === 'allow' ? '▶ ' : '  '}✓ Allow (continue execution)
           </Text>
           <Text color={selectedOption === 'deny' ? 'red' : 'gray'}>
             {selectedOption === 'deny' ? '▶ ' : '  '}✗ Deny (stop execution)
           </Text>
         </Box>
         
         <Text dimColor marginTop={1}>Use ↑/↓ to select, Enter to confirm</Text>
       </Box>
     );
   }
   ```

9. **Update Main Chat Component (Simplified)**
   ```typescript
   // Modify packages/code/src/components/Chat.tsx
   import { ConfirmDialog } from './ConfirmDialog.js';
   
   export function Chat() {
     const { 
       messages, 
       pendingPermissions, 
       isAwaitingPermission,
       sendMessage 
     } = useChat();
     
     return (
       <Box flexDirection="column">
         {/* Existing message display */}
         <MessageList messages={messages} />
         
         {/* Show permission dialogs - much simpler now */}
         {pendingPermissions.map(request => (
           <ConfirmDialog key={request.id} request={request} />
         ))}
         
         {/* Input behavior is unchanged - sendMessage handles the waiting */}
         <UserInput 
           placeholder={
             isAwaitingPermission 
               ? "Waiting for permission decision..." 
               : "Type a message..."
           }
           onSubmit={sendMessage} // sendMessage will wait for permission Promises
         />
       </Box>
     );
   }
   ```

## Quick Examples

### 1. Simple Hook with Warning
```bash
#!/bin/bash
# .wave/hooks/pre-tool-use/warn-write.sh

if [[ "$TOOL_NAME" == "write" ]]; then
  echo '{"permissionDecision": "allow", "warnings": ["Writing to file system"]}'
  exit 0
fi

exit 0
```

### 2. Hook Requesting User Permission  
```bash
#!/bin/bash
# .wave/hooks/pre-tool-use/confirm-sensitive.sh

if [[ "$TOOL_NAME" == "bash" ]] && echo "$TOOL_INPUT" | grep -q "rm\|delete"; then
  echo '{
    "permissionDecision": "ask",
    "reason": "This command appears to delete files. Are you sure you want to proceed?",
    "toolInputModifications": {
      "command": "echo \"Confirmed: \" && '"$TOOL_INPUT"'"
    }
  }'
  exit 0
fi

exit 0
```

### 3. Hook Blocking Tool Usage
```bash  
#!/bin/bash
# .wave/hooks/pre-tool-use/block-network.sh

if [[ "$TOOL_NAME" == "bash" ]] && echo "$TOOL_INPUT" | grep -qE "(curl|wget|ssh)"; then
  echo '{"permissionDecision": "deny", "reason": "Network operations are not allowed in this environment"}'
  exit 1
fi

exit 0
```

### 4. PostToolUse Hook with Success Info
```bash
#!/bin/bash  
# .wave/hooks/post-tool-use/file-count.sh

if [[ "$TOOL_NAME" == "write" ]] && [[ "$TOOL_SUCCESS" == "true" ]]; then
  file_count=$(find . -type f | wc -l)
  echo '{
    "info": ["File written successfully. Total files in directory: '$file_count'"],
    "permissionDecision": "allow"
  }'
fi

exit 0
```

### Phase 4: Context & State Management (Hours 13-16)

9. **Create Hook Context**
   ```typescript
   // Create packages/code/src/contexts/hookContext.tsx
   export const HookContext = createContext<HookContextValue | null>(null);

   export function HookProvider({ children }: { children: ReactNode }) {
     const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
     const [hookHistory, setHookHistory] = useState<HookExecutionRecord[]>([]);

     // Implement permission queue management
     // Handle timeout for permission requests
     // Provide hook execution history
   }
   ```

10. **Create Hook Output Hook with Flow Control**
    ```typescript
    // Create packages/code/src/hooks/useHookOutput.ts
    export function useHookOutput() {
      const context = useContext(HookContext);
      
      // Handle permission resolution with AI manager flow control
      const resolvePendingPermission = useCallback(async (
        id: string, 
        decision: PermissionDecision
      ) => {
        const permission = context.pendingPermissions.find(p => p.id === id);
        if (!permission) return;

        // Remove from pending list
        context.resolvePendingPermission(id, decision);

        // Resume or abort AI manager recursion
        if (context.aiManagerFlowControl) {
          await context.aiManagerFlowControl.resumeRecursion(id, decision.shouldContinueRecursion);
        }

        // Call original resolution callback
        permission.onResolve(decision);
      }, [context]);

      return {
        addPendingPermission: context.addPendingPermission,
        resolvePendingPermission,
        pendingPermissions: context.pendingPermissions,
        hookHistory: context.hookHistory,
        isAwaitingPermission: context.isAwaitingPermission
      };
    }
    ```

11. **Update convertMessagesForAPI**
    ```typescript
    // Extend packages/agent-sdk/src/utils/convertMessagesForAPI.ts
    // Add warn block conversion (similar to custom_command)
    if (block.type === "warn" && block.content) {
      contentParts.push({
        type: "text",
        text: `[WARNING] ${block.content}`,
      });
    }

    // Add hook block conversion
    if (block.type === "hook" && block.content) {
      contentParts.push({
        type: "text", 
        text: block.content,
      });
    }
    ```

## Critical Flow Control Pattern

### Promise-Based Permission Flow (Much Cleaner!)

The key insight is to use **Promise-based permissions** instead of pause/resume mechanisms. This makes the flow much simpler and more maintainable:

```typescript
// 1. Hook requests permission (in pre-tool-use hook)
echo '{"permissionDecision": "ask", "reason": "Sensitive operation"}' 

// 2. HookExecutor creates Promise and notifies Agent
const permissionPromise = new Promise<boolean>((resolve, reject) => {
  const request = { id, toolName, reason, resolve, reject };
  permissionCallback(request); // Notifies Agent
});

// 3. Agent → Chat Context callback  
agent.callbacks.onPermissionRequired(request);

// 4. Chat Context → UI renders ConfirmDialog
<ConfirmDialog request={request} />

// 5. User makes decision → resolves the Promise
chatContext.resolvePermission(requestId, allowed); // Calls request.resolve(allowed)

// 6. AIManager.executePreToolUseHooks() continues
const allowed = await result.permissionPromise; // This Promise resolves!

// 7. Tool execution continues or stops based on user decision
if (allowed) {
  // Continue with tool execution
} else {
  // Stop this tool execution (but sendMessage continues with other tools)
}
```

### Benefits of Promise-Based Approach

1. **No Complex State Management**: No need to save/restore recursion context
2. **sendMessage Never Stops**: The main `sendMessage` flow continues running
3. **Natural Async Flow**: Uses standard Promise patterns that developers understand
4. **Easier Testing**: Can easily mock Promise resolution in tests
5. **Better Error Handling**: Promise rejection handles timeout/cancellation naturally
6. **Cleaner Code**: Much less complex than pause/resume mechanisms

### Simplified sendAIMessage Flow

The most important aspect of this implementation is **properly pausing and resuming the sendAIMessage recursion** when hooks request user permission ("ask" decision).

```typescript
// Normal Flow:
sendAIMessage() → Tool calls detected → Execute tools in parallel → 
  PreToolUse hooks → Tool execution → PostToolUse hooks → 
  If tool calls exist: sendAIMessage(recursionDepth + 1) → ...

// With "ask" Permission Flow:
sendAIMessage() → Tool calls detected → Execute tools in parallel →
  PreToolUse hook returns "ask" → **PAUSE RECURSION** → 
  Show permission dialog to user → User decides → 
  **RESUME RECURSION** (if allowed) OR **ABORT RECURSION** (if denied)
```

### Key Implementation Points

1. **Agent Public API**: The Agent class MUST expose `resumeAfterPermission()` as a public method that can be called from the UI layer.

2. **Chat Context Integration**: The `useChat` context MUST provide `resolvePermission()` that calls through to the Agent, creating a clean interface for UI components.

3. **Callback Chain**: The permission flow requires a complete callback chain:
   - `AIManager` → `Agent.callbacks.onPermissionRequired`
   - `Agent.callbacks` → `ChatContext` state updates
   - `ChatContext.resolvePermission` → `Agent.resumeAfterPermission`
   - `Agent.resumeAfterPermission` → `AIManager.resumeRecursionAfterPermission`

4. **State Synchronization**: UI state (`pendingPermissions`, `isAwaitingPermission`) must stay in sync with AIManager state through the callback chain.

5. **Error Handling**: Each layer should handle failures gracefully and prevent stuck states where recursion is paused indefinitely.

### Testing the Promise-Based Permission Flow

```typescript
// Test that demonstrates the much simpler Promise-based flow
describe('Promise-Based Permission Flow', () => {
  it('should wait for Promise resolution on hook permission request', async () => {
    const agent = await Agent.create({ callbacks: mockCallbacks });
    
    // 1. Start AI operation that triggers hook
    const messagePromise = agent.sendMessage('delete some files');
    
    // 2. Verify permission request is created (via callback)
    await waitFor(() => {
      expect(mockCallbacks.onPermissionRequired).toHaveBeenCalled();
    });
    
    // 3. Verify sendMessage is still running (not stopped)
    expect(messagePromise).toBeInstanceOf(Promise);
    
    // 4. User grants permission by resolving the Promise
    const request = mockCallbacks.onPermissionRequired.mock.calls[0][0];
    request.resolve(true); // This resolves the awaited Promise in executePreToolUseHooks
    
    // 5. Verify sendMessage completes successfully
    await messagePromise;
    expect(agent.isAwaitingPermission()).toBe(false);
  });
  
  it('should handle permission denial gracefully', async () => {
    const agent = await Agent.create({ callbacks: mockCallbacks });
    
    const messagePromise = agent.sendMessage('delete some files');
    
    await waitFor(() => {
      expect(mockCallbacks.onPermissionRequired).toHaveBeenCalled();
    });
    
    // User denies permission
    const request = mockCallbacks.onPermissionRequired.mock.calls[0][0];
    request.resolve(false);
    
    // sendMessage should complete, but tool should be blocked
    await messagePromise;
    
    const messages = agent.getMessages();
    const toolBlock = messages.find(m => m.blocks?.some(b => b.type === 'tool'));
    expect(toolBlock?.blocks?.some(b => 
      b.type === 'tool' && b.result?.includes('blocked')
    )).toBe(true);
  });
});
```

### Code Flow Diagram

```
AIManager.sendAIMessage(depth=0)
├── Tool calls detected: [Write, Read]  
├── Execute tools in parallel:
│   ├── Write tool:
│   │   ├── executePreToolUseHooks()
│   │   ├── Hook returns: {"permissionDecision": "ask", "reason": "Writing to sensitive file"}
│   │   ├── pauseRecursionForPermission() → STOPS here, saves context
│   │   └── Show ConfirmDialog to user
│   └── Read tool: (also paused, waiting for Write permission)
│
└── User interaction:
    ├── User clicks "Allow" → resumeRecursionAfterPermission()
    │   └── Continue Write tool execution → Complete both tools → sendAIMessage(depth=1)
    └── User clicks "Deny" → abortRecursionDueToPermission()
        └── Mark tools as blocked → Set isLoading=false → Stop recursion
```

### 1. Simple Exit Code Hook

```bash
#!/bin/bash
# Hook that uses exit codes only

if [ "$HOOK_EVENT_NAME" = "PreToolUse" ] && [ "$TOOL_NAME" = "Write" ]; then
  # Check if writing to sensitive file
  if [[ "$TOOL_INPUT" == *"config"* ]]; then
    echo "Writing to config file detected" >&2
    exit 2  # Block the operation
  fi
fi

exit 0  # Allow operation
```

### 2. JSON Output Hook with Permission Request

```bash
#!/bin/bash
# Hook that returns JSON for advanced control

if [ "$HOOK_EVENT_NAME" = "PreToolUse" ]; then
  # Parse tool input and make decision
  cat <<EOF
{
  "continue": true,
  "systemMessage": "Security check completed",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse", 
    "permissionDecision": "ask",
    "permissionDecisionReason": "This tool will modify system files. Proceed?",
    "updatedInput": {
      "backup": true
    }
  }
}
EOF
fi
```

### 3. PostToolUse Hook with Automatic Feedback

```bash
#!/bin/bash
# Hook that provides automated feedback to Wave

if [ "$HOOK_EVENT_NAME" = "PostToolUse" ] && [ "$TOOL_NAME" = "Edit" ]; then
  # Check tool response for errors
  if echo "$TOOL_RESPONSE" | grep -q "error"; then
    cat <<EOF
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "block",
    "reason": "File edit failed. Please check file permissions and try again.",
    "additionalContext": "The edit operation encountered an error. The file may be read-only or the path may not exist."
  }
}
EOF
  fi
fi

exit 0
```

## Testing Your Implementation

### Unit Tests

```typescript
// Test hook output parsing
describe('Hook Output Parser', () => {
  it('should parse JSON output correctly', () => {
    const result = {
      exitCode: 0,
      stdout: '{"continue": false, "stopReason": "Test"}',
      stderr: '',
      hookEvent: 'PreToolUse' as const,
      executionTime: 100
    };

    const parsed = parseHookOutput(result);
    expect(parsed.source).toBe('json');
    expect(parsed.continue).toBe(false);
    expect(parsed.stopReason).toBe('Test');
  });

  it('should fall back to exit code interpretation', () => {
    const result = {
      exitCode: 2,
      stdout: 'invalid json',
      stderr: 'Operation blocked',
      hookEvent: 'PreToolUse' as const,
      executionTime: 50
    };

    const parsed = parseHookOutput(result);
    expect(parsed.source).toBe('exitcode');
    expect(parsed.continue).toBe(false);
  });
});
```

### Integration Tests

```typescript
// Test real hook execution with temporary directories
describe('Hook Output Integration', () => {
  it('should process hook with JSON output', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-test-'));
    
    // Create test hook script
    const hookScript = `#!/bin/bash
echo '{"continue": true, "systemMessage": "Test message"}'
exit 0`;

    await fs.writeFile(path.join(tempDir, 'test-hook.sh'), hookScript);
    await fs.chmod(path.join(tempDir, 'test-hook.sh'), 0o755);

    // Execute hook and verify output processing
    const result = await executeHookWithOutput(
      { command: './test-hook.sh', event: 'PreToolUse', matcher: '*', timeout: 5000 },
      { session_id: 'test', transcript_path: '', cwd: tempDir, hook_event_name: 'PreToolUse' }
    );

    expect(result.parsed.continue).toBe(true);
    expect(result.messageBlocks).toHaveLength(1);
    expect(result.messageBlocks[0].type).toBe('warn');
  });
});
```

## Common Patterns

### Exit Code Mapping
- `0`: Success, continue processing
- `2`: Block operation, process stderr according to hook type
- `1, 3-255`: Show error to user, continue processing

### JSON Override Priority
1. If valid JSON in stdout → use JSON fields
2. If invalid JSON → fall back to exit code interpretation
3. JSON `continue: false` overrides any other settings

### Message Routing Rules
- `systemMessage` → Always shown to user via WarnBlock
- `permissionDecisionReason` → Shown to user for "allow"/"ask", to Wave for "deny"
- `reason` (PostToolUse/UserPromptSubmit block) → Shown to user only
- `reason` (Stop block) → Shown to Wave
- `additionalContext` → Always passed to Wave via HookBlock

## Performance Considerations

- Hook output parsing should complete in <100ms
- JSON validation should complete in <50ms  
- Permission request timeout: 30 seconds default
- Hook execution timeout: 10 seconds default
- UI components should render without blocking main thread

## Troubleshooting

### Common Issues

1. **Hook returns JSON but falls back to exit code**
   - Check JSON syntax with `jq` or online validator
   - Ensure required fields are present for hook type

2. **Permission dialog not showing**
   - Verify HookProvider wraps your components
   - Check that permissionDecision is set to "ask"
   - Ensure onConfirm callback is properly defined

3. **Message blocks not rendering**
   - Verify block types are added to MessageBlock union
   - Check component registration in message renderer
   - Ensure blocks are properly created in MessageManager

### Debug Commands

```bash
# Test hook JSON output
echo '{"continue": false}' | jq .

# Validate hook-specific output
echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse"}}' | jq '.hookSpecificOutput.hookEventName'

# Test hook execution manually
cd /path/to/project && ./hooks/test-hook.sh
```

**Memory**: After implementing this feature, make sure to update the main tasks.md file by marking completed tasks with [X]. The critical implementation focus should be on the AI Manager flow control to properly pause and resume sendAIMessage recursion when hooks request user permission.
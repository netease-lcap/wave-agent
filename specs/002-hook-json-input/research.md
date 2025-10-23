# Research: Hook JSON Input Support

**Phase 0** | **Date**: 2024-12-19 | **Feature**: Hook JSON Input Support

## Key Findings

### Current Hook System Architecture

**Hook Execution Flow**:
1. Hook events triggered from `aiManager.ts` (PreToolUse, PostToolUse, Stop) and `agent.ts` (UserPromptSubmit)
2. `HookManager.executeHooks()` matches hooks and calls `HookExecutor.executeCommand()`
3. `HookExecutor` spawns shell processes with environment variables only (`WAVE_PROJECT_DIR`)
4. No data currently passed via stdin - hooks must gather context independently

**Current Context Passing**:
- Only `HookExecutionContext` with limited fields: `event`, `toolName`, `projectDir`, `timestamp`
- Environment variables: Only `WAVE_PROJECT_DIR` (previously included `WAVE_HOOK_EVENT`, `WAVE_TOOL_NAME`, `WAVE_TIMESTAMP` but were removed)

### Session System Integration

**Session File Structure**:
- Location: `~/.wave/sessions/session_[shortId].json`
- Path generation: `getSessionFilePath()` in `session.ts` line 49-52
- Contains: `SessionData` with `id`, `metadata` (workdir, timestamps, tokens), `state.messages`

**Current Session Access**:
- Session ID available in various managers but not passed to hooks
- Transcript path can be derived from session ID using existing `getSessionFilePath()` function

### Integration Points Analysis

**Hook Trigger Locations**:

1. **PreToolUse**: `aiManager.ts:482` - Has access to `toolName`, tool arguments, session context
2. **PostToolUse**: `aiManager.ts:520` - Has access to tool result, original input, session context  
3. **UserPromptSubmit**: `agent.ts:285` - Has access to user prompt content, session context
4. **Stop**: `aiManager.ts:447` - Minimal context, session ending

**Available Context Data**:
- Session ID: Available in agent/manager instances
- Tool input/output: Available in `aiManager` during tool execution
- User prompts: Available in `agent.ts` during prompt processing
- Current working directory: Already passed as `context.projectDir`

## Technical Approach

### Phase 1: Extend Context Types

**New Type Definitions** (in `hooks/types.ts`):
```typescript
// Extended context with JSON input data
interface HookJsonInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: HookEvent;
  // Event-specific fields
  tool_name?: string;        // PreToolUse/PostToolUse
  tool_input?: unknown;      // PreToolUse/PostToolUse  
  tool_response?: unknown;   // PostToolUse only
  prompt?: string;           // UserPromptSubmit only
}

// Extended execution context
interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string;
  toolInput?: unknown;
  toolResponse?: unknown; 
  userPrompt?: string;
}
```

### Phase 2: Modify Executor for JSON Input

**HookExecutor Changes** (in `hooks/executor.ts`):
1. Add `writeJsonToStdin()` method to pipe JSON data to child process
2. Modify `executeCommand()` to construct JSON payload and write to stdin
3. Handle stdin gracefully for hooks that don't read it (non-blocking)
4. Add timeout handling for stdin operations

**Key Implementation Points**:
- Use `childProcess.stdin.write()` with proper error handling
- JSON construction from extended context
- Backward compatibility - hooks not reading stdin continue to work
- Cross-platform stdin handling (Windows/Unix)

### Phase 3: Context Data Flow

**Data Collection Points**:

1. **Session ID & Transcript Path**: 
   - Available in agent instances, need to pass through hook manager
   - Use existing `getSessionFilePath()` logic

2. **Tool Data** (PreToolUse/PostToolUse):
   - Tool input available in `aiManager` before tool execution
   - Tool response available after tool execution
   - Need to capture and pass through hook context

3. **User Prompt** (UserPromptSubmit):
   - Available in `agent.ts` during `handleUserPrompt()`
   - Need to pass prompt content through hook context

### Risk Assessment

**Low Risk**:
- Existing hook system well-architected with clear interfaces
- JSON construction straightforward with existing context
- Session path logic already implemented

**Medium Risk**:
- Cross-platform stdin handling differences
- Backward compatibility testing required

**Mitigation Strategies**:
- Cross-platform testing
- Gradual rollout with feature flags for testing

## Implementation Priority

1. **Phase 1**: Type definitions and interface extensions
2. **Phase 2**: HookExecutor JSON stdin implementation  
3. **Phase 3**: Context data collection and passing
4. **Phase 4**: Concise integration testing with jq

## Success Criteria Validation

- ✅ JSON data accessible within 100ms (achievable with current architecture)
- ✅ All hook events include required fields (context available at trigger points)
- ✅ Session data loading via transcript_path (existing session service)
- ✅ Consistent JSON structure (controlled by type definitions)
- ✅ Performance overhead <50ms (minimal JSON serialization cost)

## Next Steps

Proceed to Phase 1 (Data Model design) with focus on:
1. JSON input schema definition
2. Extended context type design
3. Backward compatibility strategy
4. Error handling for stdin operations
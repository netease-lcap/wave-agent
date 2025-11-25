# Research: Remove Custom Session Dir Feature

**Date**: 2025-11-25  
**Feature**: Remove Custom Session Dir Feature  
**Phase**: 0 - Research & Analysis

## Research Questions Addressed

1. Complete usage audit of sessionDir in the codebase
2. Parameter flow analysis through the system  
3. Testing strategy for TDD-based feature removal
4. TypeScript-safe removal order and strategy

## Key Findings

### 1. SessionDir Usage Audit

**Primary Implementation Files:**
- `packages/agent-sdk/src/agent.ts` - AgentOptions interface and Agent constructor
- `packages/agent-sdk/src/managers/messageManager.ts` - MessageManagerOptions and path computation  
- `packages/agent-sdk/src/services/session.ts` - All session service functions
- `packages/agent-sdk/src/utils/pathEncoder.ts` - Directory creation logic

**Complete Parameter Flow:**
```typescript
AgentOptions.sessionDir (optional)
  → Agent constructor extracts sessionDir
    → MessageManager constructor receives sessionDir  
      → MessageManager passes to session service functions
        → Session services use resolveSessionDir(sessionDir)
          → Final path: sessionDir || SESSION_DIR constant
```

**Function Signatures Requiring Changes:**
- `MessageManager.constructor(options: MessageManagerOptions)` - remove sessionDir from options
- `appendMessages(sessionId, messages, workdir, sessionDir?, isSubagent?)` - remove sessionDir parameter
- `loadSessionFromJsonl(sessionId, workdir, sessionDir?, isSubagent?)` - remove sessionDir parameter  
- `getSessionFilePath(sessionId, workdir, sessionDir?, isSubagent?)` - remove sessionDir parameter
- `ensureSessionDir(sessionDir?)` - remove parameter or eliminate function
- `resolveSessionDir(sessionDir?)` - simplify to return constant or eliminate

### 2. Dependencies and Impact Analysis

**Breaking Changes:**
- AgentOptions interface - TypeScript compilation will fail for users passing sessionDir
- All session service function signatures change - internal breaking change
- MessageManager constructor signature changes - internal breaking change

**Safe Removal Order:**
1. Start with leaf functions (session services) - remove sessionDir parameters
2. Update MessageManager to not pass sessionDir to session services  
3. Remove sessionDir from MessageManagerOptions interface
4. Remove sessionDir from AgentOptions and Agent constructor
5. Update all test files to remove sessionDir usage

**No External API Impact**: sessionDir was optional, so users not using it won't be affected functionally, only those explicitly passing sessionDir will get TypeScript errors.

### 3. Testing Strategy (TDD for Feature Removal)

**TDD Approach for Removal:**
- **Red Phase**: Write tests that expect sessionDir to be rejected/unavailable
- **Green Phase**: Remove sessionDir functionality to make tests pass  
- **Refactor Phase**: Clean up code and ensure default behavior is solid

**Test File Updates Required:**
- `packages/agent-sdk/tests/agent/` - Remove sessionDir from Agent creation tests
- `packages/agent-sdk/tests/managers/messageManager*` - Update MessageManager tests
- `packages/agent-sdk/tests/services/session.test.ts` - Remove sessionDir parameter tests
- `packages/agent-sdk/tests/utils/pathEncoder.test.ts` - Simplify to default path only

**Mock Updates Needed:**
```typescript
// Before: vi.mocked(appendMessages).mockImplementation((id, msgs, workdir, sessionDir?, sub?) => ...)
// After:  vi.mocked(appendMessages).mockImplementation((id, msgs, workdir, sub?) => ...)
```

**Tests to Delete vs Modify:**
- Delete: Tests specifically verifying custom sessionDir behavior
- Modify: Tests that use sessionDir parameters but test other functionality  
- Keep: All tests verifying default session directory behavior

### 4. Implementation Decisions

**Decision 1: Remove resolveSessionDir function entirely**  
**Rationale**: Function becomes trivial (just returns SESSION_DIR constant), better to inline the constant usage  
**Alternative Considered**: Keep function returning constant - rejected due to unnecessary indirection

**Decision 2: Remove sessionDir parameters all at once per file**  
**Rationale**: Gradual removal within a file creates compilation errors and inconsistent state  
**Alternative Considered**: Parameter-by-parameter removal - rejected due to TypeScript compilation issues  

**Decision 3: Update tests following strict TDD cycle**  
**Rationale**: Even when removing functionality, TDD principles ensure we don't break existing behavior  
**Alternative Considered**: Just delete sessionDir tests - rejected because we need to verify defaults still work

## Technical Approach

### File Modification Sequence:
1. **session.ts** - Remove sessionDir parameters, inline SESSION_DIR constant usage
2. **messageManager.ts** - Remove sessionDir handling, update session service calls  
3. **agent.ts** - Remove sessionDir from interfaces and constructor
4. **Test files** - Update mocks and assertions for new signatures

### TypeScript Safety Measures:
- Modify one file completely before moving to next (avoid partial compilation errors)
- Use TypeScript compiler to validate each step  
- Ensure all function calls match updated signatures before proceeding

### Default Behavior Preservation:
- All session operations continue using `~/.wave/projects` as before
- No functional changes for users not using custom sessionDir
- Session cleanup, loading, and saving behavior unchanged

## Risk Mitigation

**Risk**: Breaking users currently using sessionDir  
**Mitigation**: This is an intentional breaking change; TypeScript will provide clear compile-time errors

**Risk**: Accidentally changing default session directory behavior  
**Mitigation**: Extensive testing to verify default path usage remains identical

**Risk**: Creating inconsistent state during removal process  
**Mitigation**: Complete each file fully before moving to next, use TypeScript compiler feedback

## Next Steps

Research complete. Ready to proceed to Phase 1: Design & Contracts with:
1. Clear understanding of all sessionDir usage locations
2. TypeScript-safe removal strategy defined  
3. TDD approach established for maintaining test coverage
4. Risk mitigation strategies in place
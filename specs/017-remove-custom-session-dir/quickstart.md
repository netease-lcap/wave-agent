# Quickstart: Remove Custom Session Dir Feature

**Date**: 2025-11-25  
**Feature**: Remove Custom Session Dir Feature  
**Phase**: 1 - Design & Contracts

## Overview

This guide provides a quick implementation path for removing the custom session directory feature from the Wave Agent SDK. The removal simplifies the API by eliminating sessionDir configuration options throughout the codebase.

## Implementation Summary

**Goal**: Remove all sessionDir parameters and force usage of default session directory (`~/.wave/projects`)  
**Approach**: Breaking change - eliminate sessionDir configuration entirely  
**Impact**: Users currently using custom sessionDir will need to adapt to default directory

## Quick Implementation Steps

### 1. Update Session Services First (Leaf Dependencies)

**File**: `packages/agent-sdk/src/services/session.ts`

```bash
# Remove sessionDir parameters from all function signatures
# Replace resolveSessionDir(sessionDir) calls with SESSION_DIR constant
# Update function implementations to use SESSION_DIR directly
```

**Key Changes**:
- Remove `sessionDir?: string` parameters from all functions
- Eliminate `resolveSessionDir()` function entirely  
- Replace all `resolveSessionDir(sessionDir)` calls with `SESSION_DIR`

### 2. Update MessageManager (Consumer of Session Services)

**File**: `packages/agent-sdk/src/managers/messageManager.ts`

```bash
# Remove sessionDir from MessageManagerOptions interface
# Remove sessionDir property from MessageManager class
# Update session service function calls to remove sessionDir parameter
# Simplify path computation to use SESSION_DIR directly
```

**Key Changes**:
- Remove `sessionDir?: string` from `MessageManagerOptions`
- Remove `private sessionDir?: string` class property
- Update `computeTranscriptPath()` to use `SESSION_DIR` constant
- Remove sessionDir parameter from session service calls

### 3. Update Agent Interface (Root Consumer)

**File**: `packages/agent-sdk/src/agent.ts`

```bash
# Remove sessionDir from AgentOptions interface
# Remove sessionDir extraction from constructor
# Remove sessionDir parameter when creating MessageManager
```

**Key Changes**:
- Remove `sessionDir?: string` from `AgentOptions` interface
- Remove sessionDir extraction in constructor: `const { sessionDir } = options`
- Remove sessionDir parameter when instantiating MessageManager

### 4. Update All Test Files

**Files**: `packages/agent-sdk/tests/**/*.test.ts`

```bash
# Remove sessionDir from Agent.create() calls in tests
# Update session service mocks to remove sessionDir parameters  
# Remove sessionDir-specific test cases
# Verify default directory behavior in remaining tests
```

**Key Changes**:
- Remove sessionDir arguments from `Agent.create()` calls
- Update `vi.mocked()` function signatures for session services
- Delete tests specifically for custom sessionDir behavior
- Add/maintain tests verifying default directory usage

## File Modification Order

1. **`packages/agent-sdk/src/services/session.ts`** - Remove sessionDir from all functions
2. **`packages/agent-sdk/src/managers/messageManager.ts`** - Remove sessionDir handling
3. **`packages/agent-sdk/src/agent.ts`** - Remove sessionDir from AgentOptions  
4. **`packages/agent-sdk/tests/services/session.test.ts`** - Update session service tests
5. **`packages/agent-sdk/tests/managers/messageManager*.test.ts`** - Update MessageManager tests
6. **`packages/agent-sdk/tests/agent/agent*.test.ts`** - Update Agent tests
7. **Any other test files using sessionDir** - Remove sessionDir usage

## TypeScript Safety Checklist

- [ ] Run `pnpm run type-check` after each file modification
- [ ] Ensure all function calls match updated signatures  
- [ ] Verify no sessionDir parameters remain in any interface
- [ ] Confirm SESSION_DIR constant is used directly throughout
- [ ] Validate that default session behavior is preserved

## Testing Verification

```bash
# After each step, verify compilation
pnpm run type-check

# Run tests to ensure functionality preserved  
pnpm test

# Build SDK package
pnpm build

# Test in dependent packages
cd packages/code && pnpm test
```

## Breaking Change Validation

**Expected TypeScript Errors for Users**:
```typescript
// This will cause compilation error after change
const agent = await Agent.create({
  sessionDir: "/custom/path"  // Property 'sessionDir' does not exist on type 'AgentOptions'
});
```

**Expected Working Code**:
```typescript  
// This will continue working (uses default ~/.wave/projects)
const agent = await Agent.create({
  apiKey: "your-key"
  // No sessionDir needed - uses default automatically
});
```

## Rollback Plan

If issues arise, rollback by:
1. Revert commits in reverse order of implementation
2. Restore sessionDir parameters to all modified interfaces
3. Restore resolveSessionDir() function
4. Restore sessionDir handling in MessageManager
5. Run full test suite to verify restoration

## Success Criteria

- [ ] All TypeScript compilation passes without sessionDir usage
- [ ] All tests pass with updated signatures
- [ ] Default session directory behavior preserved
- [ ] No sessionDir parameters remain in public or internal APIs  
- [ ] Users get clear TypeScript errors when trying to use removed sessionDir parameter

## Estimated Time

- **Session services update**: 30 minutes
- **MessageManager update**: 20 minutes  
- **Agent interface update**: 15 minutes
- **Test file updates**: 45 minutes
- **Testing and validation**: 30 minutes

**Total estimated time**: 2.5 hours for complete removal
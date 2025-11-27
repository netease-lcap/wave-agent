# Quick Start: Nested Command Discovery Implementation

**Feature**: Nested Markdown Discovery for Slash Commands  
**Date**: 2025-11-27

## Overview

This implementation adds support for organizing slash commands in nested directories within `.wave/commands/`. Commands in subdirectories use colon syntax (e.g., `/openspec:apply`) while maintaining backward compatibility with flat commands.

## Development Setup

### 1. Environment Preparation
```bash
# Ensure you're on the feature branch
git checkout 018-nested-md-discovery

# Install dependencies
pnpm install

# Build agent-sdk (required for testing changes)
cd packages/agent-sdk && pnpm build
```

### 2. Key Files to Modify

**Primary Implementation**:
- `packages/agent-sdk/src/utils/customCommands.ts` - Core discovery logic
- `packages/agent-sdk/src/types/commands.ts` - Type definitions

**Secondary Updates**:
- `packages/agent-sdk/src/managers/slashCommandManager.ts` - Command parsing integration

**Test Files**:
- `packages/agent-sdk/tests/utils/customCommands.test.ts` - Discovery logic tests
- `packages/agent-sdk/tests/managers/slashCommandManager.test.ts` - Integration tests

## Implementation Steps

### Phase 1: Core Discovery Logic (TDD)

1. **Write failing tests** for nested command discovery:
```typescript
// Test structure for nested discovery
describe('nested command discovery', () => {
  it('should discover commands in subdirectories with colon syntax', () => {
    // Test: .wave/commands/openspec/apply.md → openspec:apply
  });
  
  it('should limit discovery to 1 level of nesting', () => {
    // Test: ignore .wave/commands/a/b/c/deep.md  
  });
  
  it('should maintain backward compatibility with flat commands', () => {
    // Test: .wave/commands/help.md → help
  });
});
```

2. **Implement enhanced `scanCommandsDirectory()` function**:
   - Add recursive scanning with depth control
   - Convert file paths to command IDs with colon syntax
   - Maintain existing error handling patterns

3. **Update type definitions**:
   - Extend `CustomSlashCommand` interface with nested fields
   - Add command ID parsing utilities

### Phase 2: Integration (TDD)

1. **Write failing tests** for command manager integration:
```typescript  
describe('slash command manager nested integration', () => {
  it('should parse nested command syntax correctly', () => {
    // Test: /openspec:apply → { namespace: 'openspec', command: 'apply' }
  });
  
  it('should execute nested commands', () => {
    // Test: command execution works with colon syntax
  });
});
```

2. **Update command parsing** in `slashCommandManager.ts`:
   - Enhance input parsing to handle colon syntax
   - Ensure compatibility with existing flat command syntax

### Phase 3: Validation & Polish

1. **Add comprehensive error handling**:
   - Deep nesting detection and warnings
   - File system error recovery

2. **Performance validation**:
   - Add performance benchmarks if needed

## Testing Strategy

### Unit Tests
```bash
# Test command discovery logic
cd packages/agent-sdk
pnpm test utils/customCommands.test.ts

# Test slash command manager integration  
pnpm test managers/slashCommandManager.test.ts
```

### Integration Tests  
```bash
# Test full command pipeline
cd packages/code
pnpm test

# Manual testing with real commands
mkdir -p .wave/commands/test
echo "# Test Command" > .wave/commands/test/hello.md
pnpm wave
# Type: /test:hello
```

### Example Test Commands

Create test directory structure:
```bash
mkdir -p .wave/commands/openspec
echo "Apply the OpenAPI specification" > .wave/commands/openspec/apply.md
echo "Propose changes to the spec" > .wave/commands/openspec/proposal.md
echo "Archive old specifications" > .wave/commands/openspec/archive.md
```

Expected command discovery:
- `/openspec:apply` - Apply command
- `/openspec:proposal` - Proposal command  
- `/openspec:archive` - Archive command

## Development Workflow

### TDD Cycle
1. **Red**: Write failing test for specific nested behavior
2. **Green**: Implement minimal code to pass the test
3. **Refactor**: Improve code while keeping tests passing
4. **Repeat**: Move to next behavior

### Quality Gates
```bash
# Run after each implementation phase
pnpm run type-check    # Must pass without errors
pnpm run lint         # Must pass all rules
pnpm test             # All tests must pass
```

### Build Process
```bash
# After modifying agent-sdk
cd packages/agent-sdk && pnpm build

# Test in code package
cd packages/code && pnpm test

# Manual verification
pnpm wave
```

## Key Implementation Notes

### Command ID Generation
- Path: `.wave/commands/openspec/apply.md`
- Relative: `openspec/apply.md`  
- Command ID: `openspec:apply`
- Display: `/openspec:apply`

### Conflict Resolution
- Flat command `/apply` and nested `/openspec:apply` can coexist naturally
- Existing project/user command precedence is maintained (project commands override user commands)

### Backward Compatibility  
- Existing flat commands continue working unchanged
- `CommandSelector.tsx` requires no modifications
- Command execution pipeline remains the same

## Success Criteria

✅ **Discovery**: System finds commands in nested directories  
✅ **Syntax**: Colon syntax works for nested commands (`/openspec:apply`)  
✅ **Compatibility**: Existing flat commands still work  
✅ **Limits**: Commands deeper than 1 level are ignored  
✅ **Performance**: Command discovery adds <50ms to startup  
✅ **Tests**: All new functionality has comprehensive test coverage  
✅ **Types**: TypeScript compilation passes without errors

## Troubleshooting

### Common Issues

**Commands not discovered**:
- Check file permissions on `.wave/commands/` directory
- Verify markdown files have `.md` extension  
- Ensure directory depth doesn't exceed 1 level

**Syntax errors**:  
- Run `pnpm run type-check` for TypeScript errors
- Check ESLint output with `pnpm run lint`

**Test failures**:
- Ensure `pnpm build` was run after agent-sdk changes
- Check test isolation - no shared state between tests
- Verify mock setup in test files

**Performance issues**:
- Profile command discovery time with console timing  
- Check for unnecessary file system operations
- Verify caching is working if implemented
# Quickstart: Configuration Management Refactoring

**Target Audience**: Wave Agent SDK developers implementing the configuration refactoring  
**Time Estimate**: 2-3 days for complete refactoring implementation  
**Prerequisites**: Familiarity with Wave Agent SDK architecture and TypeScript

## Overview

This refactoring separates configuration management concerns from hook execution, centralizes settings.json loading logic, and eliminates redundant environment variable passing. The result is cleaner separation of concerns and simplified configuration loading.

## Implementation Steps

### Phase 1: Create New Services (Day 1)

#### 1. Create ConfigurationService

```bash
# Create the new configuration service
touch packages/agent-sdk/src/services/configurationService.ts
```

**Key Implementation Points**:
- Extract all `loadWaveConfig*` functions from `hook.ts`
- Implement simplified loading without complex fallbacks  
- Provide clear success/failure feedback to users
- Maintain backward compatibility with existing interfaces

#### 2. Create EnvironmentService

```bash
# Create the new environment service  
touch packages/agent-sdk/src/services/environmentService.ts
```

**Key Implementation Points**:
- Extract `validateEnvironmentConfig` and `mergeEnvironmentConfig` from `hook.ts`
- Handle application of environment variables to `process.env` (always override)
- Track conflicts between user and project environment variables
- Always apply Wave configuration values to `process.env`

#### 3. Refactor HookExecutionService

**Key Changes to `hook.ts`**:
- Remove all configuration loading functions
- Remove `additionalEnvVars` parameter from `executeCommand`
- Keep only command execution logic
- Maintain command safety validation

### Phase 2: Update Service Integration (Day 2)

#### 1. Update LiveConfigManager

**Integration Changes**:
```typescript
// Before: 
this.updateEnvironmentFromSettings(); // calls loadMergedWaveConfig internally

// After:
const config = await this.configurationService.loadMergedConfiguration(this.workdir);
if (config.success && config.configuration?.env) {
  this.environmentService.applyEnvironmentVariables(config.configuration.env);
}
```

#### 2. Update ConfigurationWatcher

**Integration Changes**:
- Replace direct calls to `loadMergedWaveConfigWithFallback` 
- Use new `ConfigurationService.loadMergedConfiguration`
- Delegate validation to `ConfigurationService.validateConfiguration`

#### 3. Update HookManager

**Key Changes**:
- Remove `loadConfigurationFromSettings()` method
- Receive pre-loaded configuration from `LiveConfigManager`
- Remove environment variable management
- Remove calls to configuration loading functions

### Phase 3: Update Tests and Validation (Day 3)

#### 1. Create New Service Tests

```bash
# Create test files for new services
touch packages/agent-sdk/tests/services/configurationService.test.ts
touch packages/agent-sdk/tests/services/environmentService.test.ts
```

**Testing Focus**:
- Configuration loading with success/failure scenarios
- Environment variable validation and merging
- Error handling and user feedback
- Integration between services

#### 2. Update Existing Tests

**Files to Update**:
- `packages/agent-sdk/tests/services/hook.test.ts` - Remove config tests, focus on execution
- `packages/agent-sdk/tests/managers/hookManager.test.ts` - Update for new integration
- `packages/agent-sdk/tests/managers/liveConfigManager.test.ts` - Update service integration

#### 3. Integration Testing

**Key Test Scenarios**:
- End-to-end configuration loading and application
- Live reload behavior with new services
- Hook execution without additional environment variables
- Error propagation and user feedback

## Quick Migration Checklist

### ✅ Before Starting
- [ ] Run existing tests to establish baseline: `pnpm test`
- [ ] Verify type checking passes: `pnpm run type-check`
- [ ] Review current configuration loading flow in `hook.ts`

### ✅ During Implementation
- [ ] Create `ConfigurationService` with extracted functions
- [ ] Create `EnvironmentService` with environment logic
- [ ] Update `hook.ts` to focus only on execution
- [ ] Update `LiveConfigManager` to use new services
- [ ] Update `ConfigurationWatcher` integration
- [ ] Update `HookManager` to receive pre-loaded config
- [ ] Remove `additionalEnvVars` parameter from hook execution

### ✅ After Implementation
- [ ] All existing tests pass: `pnpm test`
- [ ] Type checking passes: `pnpm run type-check`
- [ ] Linting passes: `pnpm run lint`
- [ ] Manual testing of configuration loading and hook execution
- [ ] Verify environment variables accessible in hooks via `process.env`

## Common Pitfalls and Solutions

### Issue: Breaking Changes in Hook Execution
**Problem**: Removing `additionalEnvVars` parameter breaks existing code
**Solution**: Ensure all environment variables are properly set in `process.env` before removal

### Issue: Configuration Loading Errors
**Problem**: New simplified loading doesn't handle edge cases
**Solution**: Provide clear error messages and ensure robust validation

### Issue: Environment Variable Conflicts  
**Problem**: Environment variables not available to hooks
**Solution**: Verify `EnvironmentService` always applies Wave configuration variables to `process.env`, overriding any existing values

### Issue: Test Failures
**Problem**: Tests fail due to configuration service changes
**Solution**: Update test mocking to use new service interfaces

## Validation Commands

```bash
# Type checking
pnpm run type-check

# Linting  
pnpm run lint

# Run tests
pnpm test

# Build agent-sdk
pnpm build

# Test configuration loading
cd packages/agent-sdk && pnpm tsx examples/config-test.ts
```

## Success Metrics

- ✅ Hook execution works without `additionalEnvVars` parameter
- ✅ Environment variables accessible in hooks via `process.env`
- ✅ Configuration loading provides clear success/failure feedback
- ✅ All tests pass with new service architecture
- ✅ No circular dependencies between services
- ✅ Configuration concerns separated from hook execution logic

## Next Steps

After completing this refactoring:
1. Monitor configuration loading performance
2. Gather user feedback on new error messages
3. Consider further simplification of configuration file structure
4. Document new service architecture for future developers
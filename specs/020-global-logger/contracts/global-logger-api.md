# Global Logger API Contract

**Version**: 1.0.0  
**Date**: 2025-12-01  
**Module**: `utils/globalLogger.ts`

## Overview

This contract defines the public API for the global logger system in the Agent SDK. The API provides zero-overhead logging access for utility functions and services without requiring parameter passing.

## Registry Management API

### `setGlobalLogger(logger: Logger | null): void`

**Purpose**: Configure the global logger instance used by utility functions and services.

**Parameters**:
- `logger: Logger | null` - Logger instance implementing the Logger interface, or null to disable logging

**Behavior**:
- Sets the global logger instance for SDK-wide access
- Replaces any previously configured logger
- Null values disable logging (no-op behavior)
- Called automatically by Agent constructor when logger provided

**Usage**:
```typescript
import { setGlobalLogger } from './utils/globalLogger.js';

// Configure logger
setGlobalLogger(myLogger);

// Disable logging  
setGlobalLogger(null);
```

**Thread Safety**: Safe in Node.js single-threaded environment
**Performance**: O(1) assignment operation

---

### `getGlobalLogger(): Logger | null`

**Purpose**: Retrieve the current global logger instance.

**Returns**: `Logger | null` - Current logger instance or null if unconfigured

**Behavior**:
- Returns current global logger state
- Null indicates no logger configured
- Direct access to logger instance (use with caution)

**Usage**:
```typescript
import { getGlobalLogger } from './utils/globalLogger.js';

const currentLogger = getGlobalLogger();
if (currentLogger) {
  currentLogger.info('Direct logger access');
}
```

**Performance**: O(1) variable access
**Use Cases**: Testing, conditional logging, advanced integrations

---

### `clearGlobalLogger(): void`

**Purpose**: Reset global logger to unconfigured state.

**Behavior**:
- Equivalent to `setGlobalLogger(null)`
- Provided for explicit intent and testing convenience
- All subsequent logging calls become no-ops

**Usage**:
```typescript
import { clearGlobalLogger } from './utils/globalLogger.js';

// Reset logger state
clearGlobalLogger();
```

**Performance**: O(1) assignment operation
**Primary Use**: Testing cleanup, explicit reset

---

### `isLoggerConfigured(): boolean`

**Purpose**: Check if global logger is currently configured.

**Returns**: `boolean` - true if logger configured, false otherwise

**Behavior**:
- Returns true when global logger is non-null
- Returns false when global logger is null
- Useful for conditional logic based on logging availability

**Usage**:
```typescript
import { isLoggerConfigured } from './utils/globalLogger.js';

if (isLoggerConfigured()) {
  // Perform expensive logging operation
  const debugInfo = generateDebugInfo();
  logger.debug(debugInfo);
}
```

**Performance**: O(1) null check
**Use Cases**: Performance optimization, conditional debug operations

## Zero-Overhead Logging API

### `logger.debug(...args: unknown[]): void`

**Purpose**: Log debug-level message through global logger.

**Parameters**:
- `...args: unknown[]` - Variable arguments passed to underlying logger

**Behavior**:
- No-op when global logger is null (zero overhead)
- Forwards to `globalLogger.debug()` when configured
- Maintains same signature as Logger interface

**Usage**:
```typescript
import { logger } from './utils/globalLogger.js';

// Zero overhead when no logger configured
logger.debug('Debug message', { context: 'value' });
```

**Performance**: 
- **Unconfigured**: Single null check + early return (near-zero cost)
- **Configured**: Null check + function delegation

---

### `logger.info(...args: unknown[]): void`

**Purpose**: Log info-level message through global logger.

**Parameters**:
- `...args: unknown[]` - Variable arguments passed to underlying logger

**Behavior**: Identical to `logger.debug()` but uses info level

**Usage**:
```typescript
import { logger } from './utils/globalLogger.js';

logger.info('Operation completed', { duration: '150ms' });
```

---

### `logger.warn(...args: unknown[]): void`

**Purpose**: Log warning-level message through global logger.

**Parameters**:
- `...args: unknown[]` - Variable arguments passed to underlying logger

**Behavior**: Identical to `logger.debug()` but uses warn level

**Usage**:
```typescript
import { logger } from './utils/globalLogger.js';

logger.warn('Deprecated function used', { function: 'oldMethod' });
```

---

### `logger.error(...args: unknown[]): void`

**Purpose**: Log error-level message through global logger.

**Parameters**:
- `...args: unknown[]` - Variable arguments passed to underlying logger

**Behavior**: Identical to `logger.debug()` but uses error level

**Usage**:
```typescript
import { logger } from './utils/globalLogger.js';

logger.error('Operation failed', error, { context: 'additional info' });
```

## Type Definitions

### Logger Interface (existing)
```typescript
interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}
```

### Global Logger Module Exports
```typescript
// Registry management
export function setGlobalLogger(logger: Logger | null): void;
export function getGlobalLogger(): Logger | null;
export function clearGlobalLogger(): void;
export function isLoggerConfigured(): boolean;

// Zero-overhead logging
export const logger: {
  readonly debug: (...args: unknown[]) => void;
  readonly info: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
};
```

## Error Handling

### Registry Errors
- **No runtime errors**: All registry functions handle null values gracefully
- **Type errors**: Caught at compile time via TypeScript interface checking

### Logging Errors
- **Unconfigured state**: No errors, functions are no-ops
- **Configured state**: Errors depend on underlying Logger implementation
- **Error propagation**: Logger implementation errors bubble up unchanged

## Performance Guarantees

### Zero-Overhead Claims
- **Unconfigured logger**: Single null check + early return per call
- **No object creation**: Direct function calls, no intermediate objects
- **No argument processing**: Early return skips argument evaluation impact
- **Memory usage**: Single module variable, no per-call allocation

### Benchmarking Validation
```typescript
// Performance test structure
console.time('1M unconfigured calls');
for (let i = 0; i < 1000000; i++) {
  logger.debug('test message', i);
}
console.timeEnd('1M unconfigured calls'); // Should be <10ms
```

## Usage Patterns

### Utility Function Integration
```typescript
// Before: console-based logging
export function myUtilityFunction(data: string): Result {
  console.error('Processing failed:', data); // Inconsistent
  return result;
}

// After: global logger integration  
import { logger } from '../utils/globalLogger.js';

export function myUtilityFunction(data: string): Result {
  logger.error('Processing failed:', data); // Consistent + configurable
  return result;
}
```

### Service Integration
```typescript
// Before: commented logger calls
export async function saveMemory(content: string): Promise<void> {
  // logger.debug('Saving memory:', content); // Can't access logger
  await fs.writeFile(path, content);
}

// After: active logging
import { logger } from '../utils/globalLogger.js';

export async function saveMemory(content: string): Promise<void> {
  logger.debug('Saving memory:', content); // Works with global logger
  await fs.writeFile(path, content);
  logger.debug('Memory saved successfully');
}
```

### Agent Integration
```typescript
// Agent constructor integration
constructor(options: AgentOptions) {
  const { logger } = options;
  
  // Set global logger for utility functions
  if (logger) {
    setGlobalLogger(logger);
  }
  
  // Existing logger usage continues unchanged
  this.logger = logger;
}
```

## Testing Contracts

### Mock Setup
```typescript
import { setGlobalLogger, clearGlobalLogger } from '../src/utils/globalLogger.js';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(), 
  error: vi.fn(),
};

beforeEach(() => {
  setGlobalLogger(mockLogger);
});

afterEach(() => {
  clearGlobalLogger();
  vi.clearAllMocks();
});
```

### Verification Patterns  
```typescript
// Verify log calls
expect(mockLogger.debug).toHaveBeenCalledWith('Expected message', context);

// Verify no-op behavior
clearGlobalLogger();
logger.debug('This should be ignored');
expect(mockLogger.debug).not.toHaveBeenCalled();
```

## Backward Compatibility

### Existing Code Impact
- **Zero breaking changes**: All existing APIs continue to work
- **Additive enhancement**: New functionality only
- **Optional adoption**: Utility functions can gradually adopt global logger

### Migration Strategy
- **Phase 1**: Deploy global logger (no behavior change)
- **Phase 2**: Enable logging in utilities (improvement)
- **Phase 3**: Replace console.* calls (consistency improvement)
# Quick Start: Global Logger for Agent SDK

**Target Audience**: SDK users and contributors  
**Time to Complete**: 5 minutes  
**Prerequisites**: Basic TypeScript knowledge, existing Agent SDK usage

## Overview

The global logger system allows utility functions and services in the Agent SDK to emit log messages without requiring logger parameters to be passed through function calls. This improves debugging capabilities while maintaining zero overhead when no logger is configured.

## Basic Usage

### 1. Configure Logger (SDK Users)

If you're using the Agent SDK, the global logger is automatically configured when you provide a logger to the Agent:

```typescript
import { Agent } from 'wave-agent-sdk';

// Create agent with logger - global logger is automatically configured
const agent = await Agent.create({
  apiKey: 'your-api-key',
  baseURL: 'your-base-url',
  logger: {
    debug: console.log,
    info: console.info, 
    warn: console.warn,
    error: console.error,
  }
});

// Now all utility functions and services will use your logger
```

### 2. Use Global Logger (SDK Contributors)

If you're contributing to the SDK or writing utility functions, you can access the global logger:

```typescript
import { logger } from './utils/globalLogger.js';

export function myUtilityFunction(data: string): Result {
  logger.debug('Processing data:', data);
  
  try {
    const result = processData(data);
    logger.info('Processing successful:', { inputSize: data.length });
    return result;
  } catch (error) {
    logger.error('Processing failed:', error, { input: data });
    throw error;
  }
}
```

## Common Scenarios

### Scenario 1: Adding Logging to Existing Utility

**Before**: Function uses console or has no logging
```typescript
export function parseConfig(content: string): Config {
  console.error('Parsing failed'); // Inconsistent logging
  return config;
}
```

**After**: Function uses global logger
```typescript
import { logger } from '../utils/globalLogger.js';

export function parseConfig(content: string): Config {
  logger.debug('Parsing config:', { size: content.length });
  
  try {
    const config = JSON.parse(content);
    logger.info('Config parsed successfully');
    return config;
  } catch (error) {
    logger.error('Config parsing failed:', error);
    throw error;
  }
}
```

### Scenario 2: Service with Contextual Logging

```typescript
import { logger } from '../utils/globalLogger.js';

export async function saveMemory(message: string, workdir: string): Promise<void> {
  logger.debug('Saving memory entry:', { workdir, messageLength: message.length });
  
  const memoryFilePath = path.join(workdir, 'AGENTS.md');
  
  try {
    await fs.writeFile(memoryFilePath, message);
    logger.info('Memory saved successfully:', { path: memoryFilePath });
  } catch (error) {
    logger.error('Failed to save memory:', error, { path: memoryFilePath });
    throw error;
  }
}
```

### Scenario 3: Conditional Debug Logging

For expensive debug operations, check if logging is enabled:

```typescript
import { logger, isLoggerConfigured } from '../utils/globalLogger.js';

export function processLargeDataset(data: LargeData[]): Result {
  logger.info('Starting large dataset processing:', { count: data.length });
  
  const results = data.map((item, index) => {
    const result = processItem(item);
    
    // Only generate expensive debug info if logger is configured
    if (isLoggerConfigured()) {
      const debugInfo = generateExpensiveDebugInfo(item, result);
      logger.debug('Processed item:', debugInfo);
    }
    
    return result;
  });
  
  logger.info('Dataset processing complete:', { resultsCount: results.length });
  return results;
}
```

## Testing with Global Logger

### Setting Up Tests

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setGlobalLogger, clearGlobalLogger } from '../src/utils/globalLogger.js';
import { myFunction } from '../src/utils/myFunction.js';

describe('myFunction', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    // Configure mock logger for each test
    setGlobalLogger(mockLogger);
  });

  afterEach(() => {
    // Clean up global state
    clearGlobalLogger();
    vi.clearAllMocks();
  });

  it('should log debug information', () => {
    myFunction('test data');
    
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Processing data:', 'test data'
    );
  });

  it('should handle no logger gracefully', () => {
    // Clear logger to test no-op behavior
    clearGlobalLogger();
    
    // Should not throw error
    expect(() => myFunction('test')).not.toThrow();
  });
});
```

### Verifying Log Calls

```typescript
it('should log error with context', () => {
  expect(() => myFunction('invalid')).toThrow();
  
  expect(mockLogger.error).toHaveBeenCalledWith(
    'Processing failed:',
    expect.any(Error),
    { input: 'invalid' }
  );
});
```

## Performance Considerations

### Zero-Overhead Design

When no logger is configured, global logger calls have minimal performance impact:

```typescript
// This call costs only a null check when no logger configured
logger.debug('Expensive operation:', expensiveComputation());

// For very performance-sensitive code, you can optimize further:
if (isLoggerConfigured()) {
  logger.debug('Expensive operation:', expensiveComputation());
}
```

### Best Practices

1. **Use appropriate log levels**:
   - `debug`: Detailed debugging information
   - `info`: General operational information  
   - `warn`: Warning conditions
   - `error`: Error conditions

2. **Include context**: Provide relevant data for debugging
   ```typescript
   logger.error('Operation failed:', error, { 
     userId: user.id, 
     operation: 'save', 
     timestamp: Date.now() 
   });
   ```

3. **Avoid expensive operations in log calls** unless you check if logging is enabled:
   ```typescript
   // Good: cheap operation
   logger.debug('User action:', action.type);
   
   // Better: expensive operation with guard
   if (isLoggerConfigured()) {
     logger.debug('Full state:', JSON.stringify(largeObject));
   }
   ```

## Advanced Usage

### Custom Logger Configuration

You can use any logger that implements the Logger interface:

```typescript
import winston from 'winston';
import { Agent } from 'wave-agent-sdk';

// Winston logger
const winstonLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'agent.log' })
  ]
});

const agent = await Agent.create({
  apiKey: 'your-api-key',
  logger: winstonLogger // Global logger automatically configured
});
```

### Manual Global Logger Management

For advanced use cases, you can manually manage the global logger:

```typescript
import { setGlobalLogger, getGlobalLogger } from 'wave-agent-sdk/utils/globalLogger';

// Set custom logger outside of Agent
setGlobalLogger(myCustomLogger);

// Get current logger for inspection
const currentLogger = getGlobalLogger();

// Temporarily disable logging
const previousLogger = getGlobalLogger();
setGlobalLogger(null);
// ... operations without logging
setGlobalLogger(previousLogger);
```

## Troubleshooting

### Problem: Logs not appearing

**Solution**: Ensure logger is configured in Agent options:
```typescript
const agent = await Agent.create({
  // ... other options
  logger: myLogger // Make sure this is provided
});
```

### Problem: Tests failing due to shared logger state

**Solution**: Always clean up in test teardown:
```typescript
afterEach(() => {
  clearGlobalLogger();
});
```

### Problem: Performance impact from logging

**Solution**: Use conditional logging for expensive operations:
```typescript
if (isLoggerConfigured()) {
  logger.debug('Expensive debug info:', generateExpensiveInfo());
}
```

## Migration Guide

### Updating Existing Utility Functions

1. **Import global logger**:
   ```typescript
   import { logger } from '../utils/globalLogger.js';
   ```

2. **Replace console calls**:
   ```typescript
   // Before
   console.error('Error occurred:', error);
   
   // After  
   logger.error('Error occurred:', error);
   ```

3. **Add contextual information**:
   ```typescript
   // Before
   logger.error('Processing failed');
   
   // After
   logger.error('Processing failed:', error, { 
     input: data, 
     step: 'validation' 
   });
   ```

### Maintaining Backward Compatibility

The global logger is purely additive - no existing code needs to change:

- ✅ Existing Agent initialization continues to work
- ✅ Existing logger injection patterns are preserved  
- ✅ No breaking changes to any APIs
- ✅ Gradual adoption is supported

## Next Steps

- Review the [API Contract](./contracts/global-logger-api.md) for detailed API documentation
- Check the [Data Model](./data-model.md) for implementation details
- Contribute utility function logging improvements using these patterns
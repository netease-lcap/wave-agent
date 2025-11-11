# Quickstart: SessionDir Constructor Argument

**Feature**: SessionDir Constructor Argument  
**Purpose**: Quick reference for developers using custom session directories

## Basic Usage

### Default Behavior (No Changes Required)

```typescript
import { Agent } from 'wave-agent-sdk';

// Existing code continues to work unchanged
const agent = await Agent.create({
  apiKey: 'your-api-key',
  baseURL: 'your-base-url'
});

// Sessions automatically stored in ~/.wave/sessions/
await agent.sendMessage('Hello!');
```

### Custom Session Directory

```typescript
import { Agent } from 'wave-agent-sdk';
import { join } from 'path';

// Specify custom session directory
const agent = await Agent.create({
  apiKey: 'your-api-key',
  baseURL: 'your-base-url',
  sessionDir: '/path/to/custom/sessions'
});

// Sessions now stored in /path/to/custom/sessions/
await agent.sendMessage('Hello!');
```

### Application-Specific Sessions

```typescript
import { Agent } from 'wave-agent-sdk';
import { join } from 'path';

// Isolate sessions per application
const appSessionDir = join(process.cwd(), 'app-sessions');
const agent = await Agent.create({
  apiKey: 'your-api-key',
  baseURL: 'your-base-url',
  sessionDir: appSessionDir
});

// Sessions stored in ./app-sessions/
await agent.sendMessage('Application-specific message');
```

## Common Patterns

### Multi-Tenant Session Isolation

```typescript
import { Agent } from 'wave-agent-sdk';
import { join } from 'path';

async function createTenantAgent(tenantId: string, config: AgentConfig) {
  const tenantSessionDir = join('/var/sessions', tenantId);
  
  return await Agent.create({
    ...config,
    sessionDir: tenantSessionDir
  });
}

// Each tenant gets isolated sessions
const agent1 = await createTenantAgent('tenant-a', { apiKey: 'key', baseURL: 'url' });
const agent2 = await createTenantAgent('tenant-b', { apiKey: 'key', baseURL: 'url' });
```

### Development vs Production Sessions

```typescript
import { Agent } from 'wave-agent-sdk';
import { join } from 'path';

const isDevelopment = process.env.NODE_ENV === 'development';

const agent = await Agent.create({
  apiKey: process.env.API_KEY,
  baseURL: process.env.BASE_URL,
  sessionDir: isDevelopment 
    ? join(process.cwd(), 'dev-sessions')
    : '/prod/sessions'
});
```

### Temporary Sessions for Testing

```typescript
import { Agent } from 'wave-agent-sdk';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Create temporary session directory for testing
const tempSessionDir = await mkdtemp(join(tmpdir(), 'test-sessions-'));

const agent = await Agent.create({
  apiKey: 'test-key',
  baseURL: 'test-url',
  sessionDir: tempSessionDir
});

// Use agent for testing
await agent.sendMessage('Test message');

// Cleanup after test (tempSessionDir can be safely deleted)
```

## Migration Guide

### Upgrading Existing Applications

No code changes required! Existing applications will continue using the default session directory (`~/.wave/sessions/`).

**Before** (v0.x.x):
```typescript
const agent = await Agent.create({
  apiKey: 'key',
  baseURL: 'url'
});
```

**After** (v0.x.x+):
```typescript
// Same code works identically
const agent = await Agent.create({
  apiKey: 'key', 
  baseURL: 'url'
});

// Optional: Add custom sessionDir if needed
const agent = await Agent.create({
  apiKey: 'key',
  baseURL: 'url',
  sessionDir: '/custom/path' // New optional parameter
});
```

### Accessing Existing Sessions

Existing sessions in `~/.wave/sessions/` remain accessible when not specifying `sessionDir`:

```typescript
// This agent can access all existing sessions
const agent = await Agent.create({
  apiKey: 'key',
  baseURL: 'url'
  // No sessionDir specified - uses default ~/.wave/sessions/
});

// Load existing session by ID
await agent.initialize({ 
  restoreSessionId: 'existing-session-id'
});
```

## Error Handling

### Common Error Scenarios

```typescript
import { Agent } from 'wave-agent-sdk';

try {
  const agent = await Agent.create({
    apiKey: 'key',
    baseURL: 'url',
    sessionDir: '/invalid/readonly/path'
  });
  
  await agent.sendMessage('Hello!');
} catch (error) {
  if (error.message.includes('sessionDir')) {
    console.error('Session directory error:', error.message);
    // Handle session directory issues
  }
}
```

### Directory Permission Issues

```typescript
import { Agent } from 'wave-agent-sdk';
import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';

async function createAgentWithValidatedDir(sessionDir: string) {
  try {
    // Check if directory exists and is writable
    await access(sessionDir, constants.F_OK | constants.W_OK);
  } catch {
    // Create directory if it doesn't exist
    await mkdir(sessionDir, { recursive: true });
  }
  
  return await Agent.create({
    apiKey: 'key',
    baseURL: 'url',
    sessionDir
  });
}
```

## Configuration Examples

### Environment-Based Configuration

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  apiKey: process.env.WAVE_API_KEY,
  baseURL: process.env.WAVE_BASE_URL,
  sessionDir: process.env.WAVE_SESSION_DIR || undefined // Use default if not set
});
```

### Configuration Object Pattern

```typescript
import { Agent, type AgentOptions } from 'wave-agent-sdk';

interface AppConfig {
  wave: {
    apiKey: string;
    baseURL: string;
    sessionDir?: string;
  };
}

async function createAgentFromConfig(config: AppConfig): Promise<Agent> {
  const agentOptions: AgentOptions = {
    apiKey: config.wave.apiKey,
    baseURL: config.wave.baseURL,
    sessionDir: config.wave.sessionDir
  };
  
  return await Agent.create(agentOptions);
}
```

## Best Practices

1. **Use Absolute Paths**: Specify absolute paths for sessionDir to avoid confusion
2. **Environment Variables**: Use environment variables for deployment-specific session directories
3. **Directory Validation**: Ensure sessionDir has proper permissions before creating Agent
4. **Cleanup**: For temporary sessions, clean up custom directories after use
5. **Backward Compatibility**: Don't specify sessionDir unless you need custom behavior
6. **Multi-Tenancy**: Use separate sessionDir for each tenant/user to ensure isolation
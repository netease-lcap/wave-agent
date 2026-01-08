# Quickstart: Live Configuration Reload

**Branch**: `019-live-config-reload` | **Date**: 2024-12-01  
**Purpose**: Quick integration guide for implementing live configuration reload in Wave Agent SDK

## Overview

This guide shows how to integrate live configuration reload functionality into the Wave Agent SDK. The implementation extends existing services to support:

1. **Environment variables** in settings.json files
2. **Live reload** of configuration changes without restart
3. **In-memory storage** of AGENTS.md content with automatic updates

## Prerequisites & Installation

- Wave Agent SDK project setup
- Node.js 18+ with TypeScript
- Existing `.wave/settings.json` configuration files

```bash
# Add Chokidar dependency to agent-sdk
cd packages/agent-sdk
pnpm add chokidar
pnpm add -D @types/chokidar
```

## Core Implementation

### File Watcher Service with Chokidar

```typescript
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import type { Logger } from '../types/index.js';

class ConfigurationWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher;
  private logger?: Logger;

  constructor(logger?: Logger) {
    super();
    this.logger = logger;
    // Chokidar handles debouncing, cross-platform support, and error recovery automatically
    this.watcher = chokidar.watch([], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300, // Built-in debouncing
        pollInterval: 100
      }
    });

    this.watcher.on('change', (filePath) => {
      this.logger?.info(`Live Config: Configuration file changed: ${filePath}`);
      this.emit('configChanged', filePath);
    });

    this.watcher.on('error', (error) => {
      this.logger?.error(`Live Config: File watcher error: ${error.message}`);
    });
  }

  watchConfig(filePath: string): void {
    this.watcher.add(filePath);
  }

  close(): void {
    this.watcher.close();
  }
}
```

### Live Configuration Service

```typescript
import type { Logger } from '../types/index.js';

class LiveConfigurationService {
  private logger?: Logger;
  private memoryStoreService: any;
  private fileWatcherService: any;

  constructor(logger?: Logger) {
    this.logger = logger;
    // Initialize services...
  }

  // Runtime monitoring
  private logPerformanceMetrics(): void {
    const stats = this.memoryStoreService.getStats();
    this.logger?.info(`Live Config: Memory store - Size: ${stats.contentSize / 1024}KB, Updates: ${stats.updateCount}`);

    const watcherStatuses = this.fileWatcherService.getAllWatcherStatuses();
    const activeWatchers = watcherStatuses.filter(w => w.isActive).length;
    this.logger?.info(`Live Config: File watchers - Active: ${activeWatchers}/${watcherStatuses.length}`);
  }

  // Runtime error handling
  private async reloadConfiguration(): Promise<void> {
    try {
      const config = await this.loadConfiguration();
      await this.applyConfiguration(config);
    } catch (error) {
      if (error instanceof ConfigurationError && error.recoverable) {
        this.logger?.warn(`Live Config: Configuration error, using fallback: ${error.message}`);
        const fallbackConfig = this.getFallbackConfiguration();
        await this.applyConfiguration(fallbackConfig);
      } else {
        this.logger?.error(`Live Config: Non-recoverable configuration error: ${error.message}`);
        throw error;
      }
    }
  }

  // File watcher error handling
  private setupFileWatcherErrorHandling(): void {
    this.fileWatcherService.onWatcherFailure((path: string, error: Error) => {
      this.logger?.warn(`Live Config: File watcher failed for ${path}: ${error.message}`);
      this.setupPollingFallback(path);
    });
  }

  private setupPollingFallback(path: string): void {
    this.logger?.info(`Live Config: Setting up polling fallback for ${path}`);
    setInterval(() => {
      this.checkConfigurationChanges(path);
    }, 5000);
  }

  public performHealthCheck(): void {
    this.logPerformanceMetrics();
  }
}
```

## Configuration Examples

### Environment Variables in settings.json

**User-level** (`~/.wave/settings.json`):
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "echo 'User prompt submitted'"}]}
    ]
  },
  "env": {
    "AIGW_MODEL": "gpt-4o-mini",
    "LOG_LEVEL": "debug",
    "USER_PREFERENCE": "theme_dark"
  }
}
```

**Project-level** (`./.wave/settings.json`):
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "echo 'Bash completed'"}]
      }
    ]
  },
  "env": {
    "AIGW_MODEL": "claude-sonnet-4-20250514",  // Overrides user setting
    "WAVE_API_KEY": "project-api-key",
    "WAVE_MAX_INPUT_TOKENS": "64000"
  }
}
```

**Result**: Project variables override user variables with the same key.

### Basic Usage

```typescript
import { Agent } from '@wave-agent/agent-sdk';

async function example() {
  // Create agent with live configuration support
  const agent = await Agent.create({
    workdir: process.cwd(),
    // Configuration is automatically loaded and watched
  });

  // Environment variables from settings.json configure the SDK itself
  // (model selection, token limits, API keys, etc.)
  // They do NOT affect external processes like bash commands
}
```

## Integration with Existing Code

**Current hook loading** (`packages/agent-sdk/src/services/hook.ts`):
```typescript
export function loadHooksConfigFromFile(filePath: string): PartialHookConfiguration | null {
  const config = JSON.parse(content) as HookConfiguration;
  return config.hooks;
}
```

**Extended with env support**:
```typescript
export function loadWaveConfigFromFile(filePath: string): WaveConfiguration | null {
  const config = JSON.parse(content) as WaveConfiguration;
  return {
    hooks: config.hooks,
    env: config.env  // New: environment variables
  };
}
```

**Memory Service Extension**:
```typescript
export const readMemoryFile = async (workdir: string): Promise<string> => {
  const memoryFilePath = path.join(workdir, "AGENTS.md");
  
  // Check memory store first
  const stored = memoryStore.get(memoryFilePath);
  if (stored && stored.isLoaded) {
    return stored.content; // Memory read (~1ms)
  }
  
  // Read from file and store in memory
  const content = await fs.readFile(memoryFilePath, "utf-8");
  memoryStore.set(memoryFilePath, { content, isLoaded: true });
  return content;
};
```

## Testing Examples

### Live Configuration Reload Test
```typescript
async function testLiveReload() {
  // Initial configuration
  let config = {
    "env": {
      "AIGW_MODEL": "gpt-4o-mini"
    }
  };
  
  await writeFile('.wave/settings.json', JSON.stringify(config, null, 2));
  const agent = await Agent.create({ workdir: process.cwd() });
  
  // Update configuration while agent is running
  config.env.AIGW_MODEL = "claude-sonnet-4-20250514";
  await writeFile('.wave/settings.json', JSON.stringify(config, null, 2));
  
  // Wait for file watcher (300ms debounce)
  await new Promise(resolve => setTimeout(resolve, 400));
  
  // Agent should now use the updated model for next operations
  return true;
}
```

### Memory Storage Test
```typescript
async function testMemoryStorage() {
  // Initial memory content
  await writeFile('AGENTS.md', '# Initial Memory\n- Use TypeScript');
  const agent = await Agent.create({ workdir: process.cwd() });
  
  // Update memory content while agent is running
  await writeFile('AGENTS.md', '# Updated Memory\n- Use TypeScript\n- Write tests first');
  
  // Wait for file watcher
  await new Promise(resolve => setTimeout(resolve, 400));
  
  // Next agent call gets updated memory content from memory store
}
```

### Environment Variable Merging Test
```typescript
describe('Environment Variable Merging', () => {
  it('should merge user and project env with project precedence', async () => {
    await writeFile('/tmp/user-settings.json', JSON.stringify({
      env: { API_URL: 'user-api', LOG_LEVEL: 'info' }
    }));
    
    await writeFile('/tmp/project-settings.json', JSON.stringify({
      env: { API_URL: 'project-api', DB_URL: 'project-db' }
    }));

    const merged = await loadMergedEnvironmentConfig('/tmp');
    
    expect(merged).toEqual({
      API_URL: 'project-api',  // Project overrides user
      LOG_LEVEL: 'info',       // User only
      DB_URL: 'project-db'     // Project only
    });
  });
});
```

## Performance Expectations

### Before Implementation
- Configuration changes require process restart
- AGENTS.md read on every agent call (~50ms per read)
- High I/O overhead

### After Implementation
- Configuration changes apply within 300ms
- AGENTS.md kept in memory (~1ms access time)
- 100% elimination of file I/O after initial load
- Memory usage increase: <2MB typical

## Next Steps

1. **Implement core services** following the data model and contracts
2. **Add comprehensive tests** for all edge cases and error conditions
3. **Monitor performance** in development and production environments
4. **Extend configuration schema** as needed for additional features

This quickstart provides the foundation for implementing robust live configuration reload that enhances developer productivity while maintaining system stability.
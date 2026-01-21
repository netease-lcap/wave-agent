# Data Model: Live Configuration Reload

**Branch**: `019-live-config-reload` | **Date**: 2024-12-01  
**Purpose**: Define data entities and relationships for live configuration reload system

## Core Entities

### Wave Configuration
**Purpose**: Complete configuration structure supporting environment variables and hooks  
**Location**: User and project `.wave/settings.json` files  
**Relationships**: Contains hook configuration and environment variables

```typescript
interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>; // Environment variables key-value pairs
}
```

**Validation Rules**:
- env field must be object with string keys and string values
- env field is optional (backward compatibility)
- JSON structure must be valid and parseable
- Individual environment variable names must follow standard naming conventions

**State Transitions**:
1. Unloaded → Loading → Valid → Cached
2. Cached → Reloading (on file change) → Valid/Invalid → Cached
3. Invalid → Previous Valid (fallback on error)

### Environment Variables
**Purpose**: Key-value pairs for runtime environment configuration  
**Source**: env field in settings.json files  
**Relationships**: Merged from user and project configurations with precedence rules

**Structure**:
```typescript
interface EnvironmentContext {
  user: Record<string, string>;      // From ~/.wave/settings.json
  project: Record<string, string>;   // From ./.wave/settings.json  
  merged: Record<string, string>;    // Final merged result with project precedence
}
```

**Validation Rules**:
- Keys must be valid environment variable names (alphanumeric + underscore)
- Values must be non-empty strings
- No circular references or complex objects
- Total size limit of 1MB for all environment variables

**Precedence Rules**:
1. Project-level variables override user-level variables with same name
2. Existing process environment variables are not overridden
3. Empty string values are treated as unset

### File Watcher
**Purpose**: Monitor configuration files for changes and trigger reload events using Chokidar  
**Scope**: Single Chokidar instance watching multiple files efficiently  
**Relationships**: Triggers updates to Wave Configuration

```typescript
interface FileWatcherEntry {
  path: string;              // Absolute path to watched file
  watcher: chokidar.FSWatcher | null; // Chokidar watcher instance
  isActive: boolean;         // Watcher status
  lastEvent: number;         // Last event timestamp
  errorCount: number;        // Consecutive error count for backoff
  callbacks: Set<() => void>; // Event callbacks
}

interface FileWatcherManager {
  watchers: Map<string, FileWatcherEntry>;
  globalWatcher: chokidar.FSWatcher; // Single Chokidar instance for all files
  options: {
    stabilityThreshold: number; // Chokidar awaitWriteFinish (300ms)
    pollInterval: number;       // Chokidar polling interval (100ms)
    maxRetries: number;         // Default 3
    fallbackPolling: boolean;   // Enable polling fallback
  };
}
```

**Validation Rules**:
- File paths must be absolute and accessible
- Maximum 100 concurrent file watchers
- Stability threshold between 100ms and 2000ms (Chokidar awaitWriteFinish)
- Error backoff with exponential delay (1s, 2s, 4s, 8s max)

**State Transitions**:
1. Created → Starting → Active → Watching
2. Watching → Event Detected → Stability Check → Event Processing → Watching
3. Active → Error → Retrying → Active/Failed
4. Failed → Fallback Polling → Active

**Benefits of Chokidar**:
- Cross-platform consistency (Windows, macOS, Linux)
- Built-in stability detection via `awaitWriteFinish` option
- Automatic error recovery and reconnection
- Handles file system edge cases (temporary files, atomic writes)
- Single watcher instance can monitor multiple files efficiently

## Relationships

### Configuration Hierarchy
```
User Settings (~/.wave/settings.json)
  ↓ (merged with project precedence)
Project Settings (./.wave/settings.json)
  ↓ (produces)
Effective Configuration
  ↓ (contains)
Environment Variables + Hook Configuration
```

### File Watching Flow
```
File System Change
  ↓ (detected by)
Chokidar Watcher
  ↓ (triggers after stability check)
Configuration Reload
  ↓ (updates)
Wave Configuration Store
  ↓ (notifies)
Agent Processes
```

## Data Storage

### File System
- `~/.wave/settings.json`: User-level configuration with optional env field
- `./.wave/settings.json`: Project-level configuration with optional env field  

### Memory Storage
- Wave configuration store: Configuration objects in memory for fast access
- File watcher registry: Active watcher instances and their state
- Environment variable store: Merged environment variables ready for injection

### No Persistent Storage
- No database required - all data is file-based or memory-cached
- No session persistence needed - watchers restart on process restart
- Configuration changes are immediately reflected in files

## Integration Points

### Existing Systems
- **Hook Manager**: Extends existing hook configuration loading with env field support in WaveConfiguration
- **Agent Execution**: Inherits environment variables from merged configuration

### New Components
- **FileWatcherService**: New service for coordinating file watching across the system
- **ConfigurationReloader**: New service coordinating live reload events

## Performance Characteristics

### Memory Usage
- Base overhead: ~100KB for watcher infrastructure
- Per-file overhead: ~1KB for each watched file
- Total expected usage: <1MB for typical development setup

### Response Times
- File change detection: <50ms average
- Configuration reload: <10ms for settings.json

### Scalability Limits
- Maximum watched files: 100 (well below OS limits)
- Maximum env variables: 1000 per configuration file
- Supported file sizes: Up to 5MB for individual files

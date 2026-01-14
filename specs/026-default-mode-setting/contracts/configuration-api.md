# Configuration API Contract

## WaveConfiguration Interface

```typescript
interface WaveConfiguration {
  hooks?: Hook[];
  env?: Record<string, string>;
  permissions?: {
    defaultMode?: "default" | "bypassPermissions" | "acceptEdits";
    allow?: string[];
  };
}
```

### Validation Contract

```typescript
interface ConfigValidationResult {
  isValid: boolean;
  config: WaveConfiguration;
  warnings: string[];
  errors: string[];
}

// Validation rules for defaultMode
function validateDefaultMode(value: unknown): ValidationResult {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  
  if (value === "default" || value === "bypassPermissions" || value === "acceptEdits") {
    return { valid: true, value };
  }
  
  return { 
    valid: false, 
    error: `Invalid defaultMode: "${value}". Must be "default", "bypassPermissions" or "acceptEdits"`,
    fallback: undefined
  };
}
```

## PermissionManager Contract

```typescript
interface PermissionManagerOptions {
  mode?: "default" | "bypassPermissions";
  canUseTool?: (toolName: string) => boolean;
  configuredDefaultMode?: "default" | "bypassPermissions";
}

class PermissionManager {
  constructor(options: PermissionManagerOptions) {
    // Resolve effective permission mode
    this.effectiveMode = options.mode ?? options.configuredDefaultMode ?? "default";
  }
  
  canUseTool(toolName: string): boolean {
    // Apply permission logic using effectiveMode
  }
}
```

## Configuration Resolution Contract

```typescript
interface ConfigurationResolver {
  resolveConfiguration(): Promise<WaveConfiguration>;
}

// Resolution hierarchy (highest to lowest precedence)
const CONFIG_HIERARCHY = [
  "settings.local.json",      // Project-local (highest)
  "settings.json",           // Project-level  
  "~/.wave/settings.json"    // User-level (lowest)
];
```

## Error Handling Contract

```typescript
interface ConfigurationError {
  type: "validation" | "file-not-found" | "parse-error";
  file: string;
  message: string;
  severity: "error" | "warning";
}

// Error handling behavior
const ERROR_HANDLING = {
  "validation": "warn-and-fallback",
  "file-not-found": "continue-hierarchy", 
  "parse-error": "skip-file-continue"
};
```

## CLI Integration Contract

```typescript
interface CLIOptions {
  dangerouslySkipPermissions?: boolean;
  // Other existing flags...
}

// CLI override precedence
function resolvePermissionMode(
  cliOptions: CLIOptions, 
  config: WaveConfiguration
): "default" | "bypassPermissions" {
  if (cliOptions.dangerouslySkipPermissions) {
    return "bypassPermissions";
  }
  
  return config.permissions?.defaultMode ?? "default";
}
```
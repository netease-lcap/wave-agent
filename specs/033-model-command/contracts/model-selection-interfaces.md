# Contracts: Model Selection Interface

This document defines the core interfaces and types for the model selection system.

## Data Types

### `AgentCallbacks` (`packages/agent-sdk/src/types/agent.ts`)
```typescript
export interface AgentCallbacks {
  // ... existing callbacks
  /** Triggered when the active model is changed */
  onModelChange?: (model: string) => void;
  /** Triggered when the list of configured models changes (e.g., after config reload) */
  onConfiguredModelsChange?: (models: string[]) => void;
}
```

### `ModelConfig` (`packages/agent-sdk/src/types/index.ts`)
```typescript
export interface ModelConfig {
  model: string;
  fastModel: string;
  maxTokens?: number;
  permissionMode?: PermissionMode;
  // ... other optional model settings (temperature, top_p, etc.)
}
```

## Internal Service Methods

### `ConfigurationService` (`packages/agent-sdk/src/services/configurationService.ts`)

| Method | Description |
|--------|-------------|
| `setModel(model: string): void` | Sets the active model ID in the current session. |
| `getConfiguredModels(): string[]` | Returns a unique list of model IDs from `settings.json`, environment variables, and defaults. |

## SDK Interface

### `Agent` (`packages/agent-sdk/src/agent.ts`)

| Method | Description |
|--------|-------------|
| `setModel(model: string): void` | Public API to switch models. Updates internal configuration and triggers `onModelChange` callback. |
| `getConfiguredModels(): string[]` | Public API to get the list of models for the UI. |

## CLI State Management

### `InputState` (`packages/code/src/managers/inputReducer.ts`)
```typescript
export interface InputState {
  // ... existing fields
  showModelSelector: boolean;
}
```

### `InputAction` (`packages/code/src/managers/inputReducer.ts`)
```typescript
export type InputAction = 
  | { type: "SET_SHOW_MODEL_SELECTOR"; payload: boolean }
  // ... other actions
```

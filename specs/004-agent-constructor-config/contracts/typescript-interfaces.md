# TypeScript Interface Contracts

## Agent Constructor Contract

```typescript
export interface AgentOptions {
  // Optional configuration with environment fallbacks
  apiKey?: string;
  baseURL?: string;
  agentModel?: string;
  fastModel?: string;
  tokenLimit?: number;
  
  // Existing options (preserved)
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  messages?: Message[];
  workdir?: string;
  systemPrompt?: string;
}

export interface GatewayConfig {
  apiKey: string;
  baseURL: string;
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
}
```

## Service Configuration Contracts

```typescript
export interface ManagerOptions {
  // Resolved configuration
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;
  tokenLimit: number;
  
  // Existing parameters (preserved)
  messageManager: MessageManager;
  toolManager: ToolManager;
  logger?: Logger;
  backgroundBashManager?: BackgroundBashManager;
  hookManager?: HookManager;
  callbacks?: ManagerCallbacks;
  workdir: string;
  systemPrompt?: string;
}

export interface CallAgentOptions {
  // Resolved configuration
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;
  
  // Existing parameters (preserved)
  messages: ChatCompletionMessageParam[];
  sessionId?: string;
  abortSignal?: AbortSignal;
  memory?: string;
  workdir: string;
  tools?: ChatCompletionFunctionTool[];
  model?: string;
  systemPrompt?: string;
}
```

## Configuration Resolution Contract

```typescript
export interface ConfigurationResolver {
  /**
   * Resolves gateway configuration from constructor args and environment
   * @param apiKey - API key from constructor (optional)
   * @param baseURL - Base URL from constructor (optional)
   * @returns Resolved gateway configuration
   * @throws Error if required configuration is missing after fallbacks
   */
  resolveGatewayConfig(apiKey?: string, baseURL?: string): GatewayConfig;
  
  /**
   * Resolves model configuration with fallbacks
   * @param agentModel - Agent model from constructor (optional)
   * @param fastModel - Fast model from constructor (optional)
   * @returns Resolved model configuration with defaults
   */
  resolveModelConfig(agentModel?: string, fastModel?: string): ModelConfig;
  
  /**
   * Resolves token limit with fallbacks
   * @param constructorLimit - Token limit from constructor (optional)
   * @returns Resolved token limit
   */
  resolveTokenLimit(constructorLimit?: number): number;
}
```

## Validation Contract

```typescript
export interface ConfigurationValidator {
  /**
   * Validates gateway configuration
   * @param config - Configuration to validate
   * @throws Error with descriptive message if invalid
   */
  validateGatewayConfig(config: GatewayConfig): void;
  
  /**
   * Validates token limit value
   * @param tokenLimit - Token limit to validate
   * @throws Error if invalid
   */
  validateTokenLimit(tokenLimit: number): void;
}
```

## Error Contract

```typescript
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly provided?: unknown
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// Standard error messages
export const CONFIG_ERRORS = {
  MISSING_API_KEY: 'Gateway configuration requires apiKey. Provide via constructor or AIGW_TOKEN environment variable.',
  MISSING_BASE_URL: 'Gateway configuration requires baseURL. Provide via constructor or AIGW_URL environment variable.',
  INVALID_TOKEN_LIMIT: 'Token limit must be a positive integer.',
  EMPTY_API_KEY: 'API key cannot be empty string.',
  EMPTY_BASE_URL: 'Base URL cannot be empty string.',
} as const;
```
# Data Model: Configurable Max Output Tokens

## Entities

### AgentOptions (Extension)
- **maxTokens** (optional): `number`
  - The maximum number of tokens to generate in the reply.
  - Default: 4096 (if not specified in options or environment).

### CallAgentOptions (Extension)
- **maxTokens** (optional): `number`
  - Override for the maximum number of tokens for a specific call.

### Environment Variables
- **WAVE_MAX_OUTPUT_TOKENS**: `number`
  - Global default for max output tokens.

## Validation Rules
- `maxTokens` must be a positive integer.
- If a non-numeric value is provided in the environment variable, it should be ignored (fallback to default).

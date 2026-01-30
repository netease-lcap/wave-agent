# Research: Set Language in Settings

## Decision: Implementation Strategy for Language Support

### 1. Configuration Storage
- **Decision**: Add a `language` field to the `WaveConfiguration` interface in `packages/agent-sdk/src/types/configuration.ts`.
- **Rationale**: This is the central place for all Wave Agent settings. Adding it here ensures it's properly typed and can be loaded from `settings.json` or `settings.local.json` across user and project scopes.
- **Alternatives considered**: Using environment variables (e.g., `WAVE_LANGUAGE`). While possible, a dedicated field in the configuration object is more explicit and follows the pattern of other settings like `permissions` and `enabledPlugins`.

### 2. Prompt Injection Point
- **Decision**: Modify `AIManager.sendAIMessage` in `packages/agent-sdk/src/managers/aiManager.ts` to inject the language instruction into the `effectiveSystemPrompt`.
- **Rationale**: `AIManager` is responsible for constructing the final system prompt before calling the AI service. It already handles custom system prompts and plan mode reminders. Injecting the language instruction here ensures it's applied consistently.
- **Alternatives considered**: 
    - Modifying `buildSystemPrompt` in `prompts.ts`. This would require passing the language to `buildSystemPrompt`, which is currently a pure function focused on tool-based policies.
    - Modifying `callAgent` in `aiService.ts`. This is too low-level; `AIManager` is a better place for high-level prompt orchestration.

### 3. Language Resolution
- **Decision**: Add a `resolveLanguage()` method to `ConfigurationService` in `packages/agent-sdk/src/services/configurationService.ts`.
- **Rationale**: `ConfigurationService` already handles resolution of other settings (gateway, model, tokens) with fallbacks (constructor > settings.json). Adding `resolveLanguage` follows this established pattern.
- **Default**: There is no default language. If no language is configured, no language instruction will be added to the system prompt.

### 4. Prompt Format
- **Decision**: Use the exact format requested by the user:
  ```
  # Language
  Always respond in ${A}. Use ${A} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.
  ```
- **Rationale**: This format is clear and covers all aspects of the agent's communication.

## Technical Context

- **Settings Management**: `ConfigurationService` loads and merges `settings.json` from multiple locations.
- **System Prompt**: Built in `AIManager` using `buildSystemPrompt` and additional context.
- **Types**: `WaveConfiguration` in `packages/agent-sdk/src/types/configuration.ts`.

## Unknowns Resolved
- **Where is settings.json managed?** `ConfigurationService.ts`.
- **How is the system prompt constructed?** In `AIManager.ts` using `buildSystemPrompt` and manual appends.
- **How to access settings in AIManager?** `AIManager` already has access to `ConfigurationService` via getter functions passed from `Agent`. I will add a `getLanguage` getter.
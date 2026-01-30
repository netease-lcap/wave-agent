# Feature Specification: Set Language in Settings

**Feature Branch**: `055-set-language-setting`  
**Created**: 2026-01-30  
**Status**: Draft  
**Input**: User description: "support setting language in settings.json, add this to system prompt: `# Language
Always respond in ${A}. Use ${A} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.`"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Preferred Language (Priority: P1)

As a user, I want to specify my preferred language in the settings file or via agent options so that the agent communicates with me in that language.

**Why this priority**: This is the core functionality requested. It enables non-English speakers or users with specific language preferences to interact with the agent more effectively.

**Independent Test**: Can be tested by setting a language (e.g., "Chinese") in `settings.json` or passing it to `Agent.create()` and verifying that the agent's responses and explanations are in that language.

**Acceptance Scenarios**:

1. **Given** a `settings.json` file with a `language` field set to "Chinese", **When** I ask the agent a question, **Then** the agent responds in Chinese.
2. **Given** the agent is created with `language: "French"` in options, **When** the agent explains a code change, **Then** the explanation is in French.

---

### User Story 2 - Default Language Behavior (Priority: P2)

As a user, I want the agent to default to English if no language is specified in my settings, ensuring the system remains functional without manual configuration.

**Why this priority**: Ensures backward compatibility and a sensible default for new users.

**Independent Test**: Can be tested by removing the `language` field from `settings.json` and verifying the agent still responds in English.

**Acceptance Scenarios**:

1. **Given** a `settings.json` file without a `language` field, **When** I interact with the agent, **Then** it responds in English (default).

---

### User Story 3 - Preservation of Technical Terms (Priority: P2)

As a user, I want technical terms and code identifiers to remain in their original form even when the agent is responding in my preferred language, so that the technical context remains clear.

**Why this priority**: Essential for technical accuracy and clarity in software engineering tasks.

**Independent Test**: Can be tested by setting the language to "Spanish" and asking for a code explanation, then verifying that variable names and function calls are not translated.

**Acceptance Scenarios**:

1. **Given** the language is set to "Spanish", **When** the agent explains a function `calculateTotal()`, **Then** the explanation is in Spanish but the string `calculateTotal()` remains unchanged.

### Edge Cases

- **Invalid Language Value**: What happens when the `language` field contains an empty string or a nonsensical value? (Assumption: System defaults to English or ignores the setting).
- **Missing Settings File**: How does the system handle cases where `settings.json` does not exist? (Assumption: System uses default English).
- **Mixed Language Input**: How does the agent handle a user asking a question in English when the setting is set to another language? (Assumption: Agent follows the setting and responds in the configured language).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support setting the `language` via `AgentOptions` or `settings.json`.
- **FR-002**: System MUST inject a language instruction into the system prompt if a language is configured.
- **FR-003**: The injected instruction MUST follow the format: `# Language\nAlways respond in ${A}. Use ${A} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.` where `${A}` is the configured language.
- **FR-004**: System MUST NOT inject any language instruction if the `language` setting is missing or invalid.
- **FR-005**: System MUST ensure that the language instruction is applied to all agent communications, including explanations and comments.

### Key Entities *(include if feature involves data)*

- **Settings**: Represents the user's configuration, now including a `language` attribute.
- **System Prompt**: The base instructions provided to the AI agent, which will now dynamically include language preferences.

## Assumptions

- The `settings.json` file is the central place for user-specific configurations.
- The agent has the capability to understand and follow the language instruction provided in the system prompt.
- "Original form" for technical terms usually means English or the language used in the codebase.

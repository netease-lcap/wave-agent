<!--
Sync Impact Report:
- Version change: 1.10.0 → 1.11.0
- Modified principles: Added XII. User-Centric Quickstart
- Added sections: None
- Removed sections: None
- Templates requiring updates: ✅ plan-template.md
- Follow-up TODOs: None
-->

# Wave Agent Constitution

## Core Principles

### I. Package-First Architecture
Every feature MUST be organized into packages with clear boundaries. Packages MUST be independently buildable and testable. The `agent-sdk` provides core functionality; `code` provides CLI interface. No circular dependencies between packages allowed.

**Rationale**: Monorepo structure requires clear separation of concerns to maintain scalability and enable independent development.

### II. TypeScript Excellence
All code MUST be written in TypeScript with strict type checking enabled. No `any` types allowed without explicit justification. Type definitions MUST be comprehensive and accurate.

**Rationale**: Type safety prevents runtime errors and improves developer experience in an AI-assisted development environment.

### III. Test Alignment
Test file organization MUST follow logical patterns for discoverability. Both unit tests and integration tests are REQUIRED for all new functionality. Unit tests MUST focus on individual components and pure functions. Integration tests MUST verify the interaction between multiple components or packages. Simple modules use direct mapping (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Complex modules may use feature-based organization (e.g., `src/agent.ts` → `tests/agent/agent.feature.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. All tests MUST be in `packages/*/tests` directories. For features that are hard to mock or require real-world validation, MUST provide functional examples in `packages/*/examples/` directory. Focus on essential functionality testing rather than comprehensive coverage to enable faster development iterations.

**Rationale**: Flexible test organization enables both predictable discovery and manageable test suites. Essential testing provides confidence while maintaining development velocity. Mandatory unit and integration tests ensure both component-level correctness and system-level stability. Real-world examples ensure functionality works in non-mocked environments.

### IV. Build Dependencies
After modifying `agent-sdk`, MUST run `pnpm build` before testing changes in dependent packages. Use `pnpm` exclusively for package management, never `npm`.

**Rationale**: Build-time dependencies require explicit build steps to propagate changes correctly across the monorepo.

### V. Documentation Minimalism
Do NOT create Markdown documentation files unless explicitly requested by users. Focus on code clarity and inline documentation rather than separate documentation files.

**Rationale**: Over-documentation creates maintenance burden; well-written code with good naming is often self-documenting.

### VI. Quality Gates
After any modifications, MUST run `pnpm run type-check` and `pnpm run lint` to validate code quality. All type checking MUST pass without errors or warnings. All linting rules MUST be satisfied before committing changes.

**Rationale**: Automated quality checks prevent defects from entering the codebase and ensure consistent code standards across all contributors.

### VII. Source Code Structure
Package source code MUST follow established patterns for maintainability and discoverability. For `agent-sdk`: managers for state-related logic, services for network or IO-related logic, utils for pure functions, types.ts for cross-file type definitions. For `code` package: components for UI, contexts for global state and logic, hooks for reusable state and logic, utils for utility functions. Directory structure MUST reflect functional organization, not technical organization.

**Rationale**: Consistent source code organization enables developers to quickly locate and understand code purpose, reducing cognitive load and improving maintainability.

### VIII. Test-Driven Development
For critical functionality, SHOULD follow TDD workflow: Red (write failing test), Green (minimal implementation), Refactor (improve code while maintaining tests). Both unit and integration tests are REQUIRED for all functionality to ensure reliability and prevent regressions. Test names MUST clearly describe behavior using "should" statements. Each test MUST focus on a single responsibility. Test isolation MUST be maintained - no test should depend on another test's state. Mock external dependencies in tests to ensure fast execution and reliable outcomes.

**Rationale**: Essential testing provides confidence in critical functionality while allowing faster iteration. Mandatory testing of key behaviors offers the best balance of quality and speed.

### IX. Type System Evolution
When adding functionality, MUST modify existing types or interfaces rather than creating new ones whenever possible. New types or interfaces may only be created when extending existing ones would violate single responsibility principle or create semantic inconsistencies. Type extensions MUST use composition, union types, or generic constraints to build upon existing type definitions.

**Rationale**: Type proliferation creates maintenance burden and cognitive overhead. Evolving existing types keeps the codebase lean, maintains semantic consistency, and reduces the number of concepts developers must understand.

### X. Data Model Minimalism
Data models MUST be kept concise and focused on essential attributes only. Avoid excessive entity decomposition or over-specification of attributes. Include only fields that are actively used in implementation. Entity relationships MUST be simple and direct. Prefer flat structures over deep hierarchies when possible.

**Rationale**: Concise data models reduce cognitive overhead, simplify implementation, and prevent over-engineering. Simple models are easier to understand, test, and maintain.

### XI. Planning with General-Purpose Agent
The general-purpose agent MUST be used for all planning phases. Every phrase and decision during the planning process MUST be validated or generated by the general-purpose agent to ensure comprehensive codebase understanding and technical accuracy.

**Rationale**: The general-purpose agent's ability to perform multi-step research and analyze complex system architectures ensures that implementation plans are grounded in the actual state of the codebase and follow established patterns.

### XII. User-Centric Quickstart
The `quickstart.md` file MUST be designed for end-users (CLI users or SDK users), not for developers of the project itself. It MUST focus on installation, configuration, and basic usage examples that allow a new user to get started quickly. Technical implementation details or developer-specific setup (like building from source) SHOULD be kept in `README.md` or dedicated developer documentation.

**Rationale**: A clear distinction between user-facing quickstart and developer-facing setup improves the onboarding experience for both groups and ensures that users are not overwhelmed by irrelevant technical details.

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.11.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2026-02-10


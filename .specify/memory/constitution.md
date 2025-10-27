<!--
Sync Impact Report:
- Version change: 1.0.0 → 1.2.0
- Added principles: VI. Quality Gates (new principle requiring type-check and lint)
- Modified principles: III. Test Alignment (refined to allow feature-based organization for complex modules)
- Modified sections: Quality Standards (expanded to include pre-commit requirements)
- Templates requiring updates: ✅ plan-template.md, spec-template.md, tasks-template.md all align with existing standards
- Follow-up TODOs: None - all placeholders filled
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
Test file organization MUST follow logical patterns for discoverability. Simple modules use direct mapping (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Complex modules may use feature-based organization (e.g., `src/agent.ts` → `tests/agent/agent.feature.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. All tests (unit and integration) MUST be in `packages/*/tests` directories. Integration tests use temporary directories and real file operations; unit tests use mocking for external dependencies.

**Rationale**: Flexible test organization enables both predictable discovery and manageable test suites for complex modules.

### IV. Build Dependencies
After modifying `agent-sdk`, MUST run `pnpm build` before testing changes in dependent packages. Use `pnpm` exclusively for package management, never `npm`.

**Rationale**: Build-time dependencies require explicit build steps to propagate changes correctly across the monorepo.

### V. Documentation Minimalism
Do NOT create Markdown documentation files unless explicitly requested by users. Focus on code clarity and inline documentation rather than separate documentation files.

**Rationale**: Over-documentation creates maintenance burden; well-written code with good naming is often self-documenting.

### VI. Quality Gates
After any modifications, MUST run `pnpm run type-check` and `pnpm run lint` to validate code quality. All type checking MUST pass without errors or warnings. All linting rules MUST be satisfied before committing changes.

**Rationale**: Automated quality checks prevent defects from entering the codebase and ensure consistent code standards across all contributors.

## Quality Standards

All code MUST pass TypeScript compilation without errors or warnings. All tests MUST pass before merging. Code MUST follow the established linting and formatting rules enforced by ESLint and Prettier. Quality gates (type-check and lint) MUST be run and pass after every modification.

**Testing Requirements**: 
- Tests directory: All tests (unit and integration) with proper isolation
- Integration tests: Use temporary directories, real file operations, cleanup after each test
- Unit tests: Use mocking for external dependencies, fast execution
- All new features require corresponding tests

## Development Workflow

**Package Management**: Use `pnpm` for all dependency management operations. Never use `npm` directly.

**Build Process**: 
1. Modify code in any package
2. Run `pnpm build` if changes affect `agent-sdk`
3. Test in dependent packages
4. Run `pnpm run type-check` and `pnpm run lint`
5. Commit with clear, descriptive messages

**Testing Strategy**:
- Unit tests for individual functions and components (with mocking)
- Integration tests for cross-package interactions (with temporary directories)
- All tests must be in tests directories with proper cleanup
- Use appropriate isolation based on test type

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.2.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-01-27
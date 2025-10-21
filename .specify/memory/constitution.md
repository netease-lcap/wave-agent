<!--
Sync Impact Report:
- Version change: Initial → 1.0.0
- Added principles: Package-First Architecture, TypeScript Excellence, Test Alignment, Build Dependencies, Monorepo Standards
- Added sections: Quality Standards, Development Workflow
- Templates requiring updates: ✅ plan-template.md, spec-template.md, tasks-template.md all aligned
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
Test file paths MUST mirror source file structure exactly (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. Integration tests in `packages/*/examples` for real scenarios; unit tests in `packages/*/tests` for mockable scenarios.

**Rationale**: Consistent test organization enables predictable development workflows and clear test discovery.

### IV. Build Dependencies
After modifying `agent-sdk`, MUST run `pnpm build` before testing changes in dependent packages. Use `pnpm` exclusively for package management, never `npm`.

**Rationale**: Build-time dependencies require explicit build steps to propagate changes correctly across the monorepo.

### V. Documentation Minimalism
Do NOT create Markdown documentation files unless explicitly requested by users. Focus on code clarity and inline documentation rather than separate documentation files.

**Rationale**: Over-documentation creates maintenance burden; well-written code with good naming is often self-documenting.

## Quality Standards

All code MUST pass TypeScript compilation without errors or warnings. All tests MUST pass before merging. Code MUST follow the established linting and formatting rules enforced by ESLint and Prettier.

**Testing Requirements**: 
- Examples directory: Real integration tests using `npx tsx` locally
- Tests directory: Unit tests that can run in CI/CD with mocking
- All new features require corresponding tests

## Development Workflow

**Package Management**: Use `pnpm` for all dependency management operations. Never use `npm` directly.

**Build Process**: 
1. Modify code in any package
2. Run `pnpm build` if changes affect `agent-sdk`
3. Test in dependent packages
4. Commit with clear, descriptive messages

**Testing Strategy**:
- Unit tests for individual functions and components
- Integration tests for cross-package interactions
- Use appropriate test directory based on mocking requirements

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.0.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-01-27
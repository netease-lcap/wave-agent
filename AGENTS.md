# Memory

This is the AI assistant's memory file, recording important information and context.

- Use pnpm instead of npm
- Don't create Markdown documents unless explicitly mentioned by user
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - cd to `packages/\*` and run locally with pnpm tsx
  - never access private properties directly with `(agent as any)`
  - MUST use flash model for performance: `process.env.AIGW_MODEL = "gemini-2.5-flash";`
  - Add flash model config at top of file after imports for 2-4x faster execution
  - Examples without flash models may hang or timeout during AI calls
- `packages/*/tests` directories contain test files that are easy to mock, can run locally and on CI/CD
  - Use vitest-expert to write tests
  - Testing framework is vitest
  - Use HookTester to test hooks
  - Use waitHelpers to wait UI change
- `packages/code/src/components` contains Ink components
- After modifying agent-sdk, need to build before using in code
- For type and eslint errors:
  - Don't write any types
  - MUST use typescript-expert to fix type and eslint errors to reduce context usage.
  - Do not modify tsconfig unless user ask you to do that
- Do not perform git commit operation unless explicitly mentioned by user
- While implementing tasks in tasks.md:
  - MUST mark the task off as [X] in the tasks file after you complete a task
  - MUST task subagents to implement in parallel when possible

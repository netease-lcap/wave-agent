# Memory

This is the AI assistant's memory file, recording important information and context.

- Use pnpm instead of npm
- Don't create Markdown documents unless explicitly mentioned by user
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - cd to `packages/\*` and run locally with pnpm tsx
  - never access private properties directly with `(agent as any)`
- `packages/*/tests` directories contain test files that are easy to mock, can run locally and on CI/CD
  - Task vitest-expert to write tests
  - Testing framework is vitest
  - Use HookTester to test hooks
  - Use waitHelpers to wait UI change
  - Use `as unknown as` `Awaited<>` `ReturnType<>` `typeof` to simplify type check, for example: 
    - `vi.mocked(fs.readdir).mockResolvedValueOnce(initialFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>);`
    - `vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as unknown as Awaited<ReturnType<typeof fs.stat>>);`
  - When using `mockImplementation`, function arguments don't require explicit type annotations as TypeScript can infer them from context
  - MUST not write `mkdtemp` in test, use mocking instead
  - Mock stdout and stderr to suppress output during testing and restore mocks after tests
- `packages/code/src/components` contains Ink components
- After modifying agent-sdk, need to build before using in code
- For type and eslint errors:
  - MUST task typescript-expert to fix type and eslint errors in order to reduce context usage of main agent
  - Don't write any types
  - Do not modify tsconfig unless user ask you to do that
- While writing tests about `Agent`, always use `await Agent.create` instead of `new Agent`
- Do not perform git commit operation unless explicitly mentioned by user
- While implementing tasks in `specs/*/tasks.md`:
  - MUST mark the task off as [X] by modifying the tasks.md after you complete a task
  - Task multi subagents at once to implement in parallel when possible
- Before make any spec or plan, research the codebase to ensure you have a comprehensive understanding of user requirements
- Focus on core functionality that's actually being used - remove unused options, methods, and interfaces to keep code lean and maintainable
- Always ensure code changes pass all tests, type checks, and linting before considering implementation complete by running `pnpm test`, `pnpm run type-check`, and `pnpm lint`

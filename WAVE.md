# Memory

这是AI助手的记忆文件，记录重要信息和上下文。

- 使用 pnpm 而非 npm
- 测试框架是 vitest
- 除非用户明确提及，否则不要创建 Markdown 文档
- 不要写 any 类型
- 使用 HookTester 测试 hooks
- packages/\*/examples 目录下是难以 mock 的真实测试文件，需要创建临时目录，并 chdir，然后通过发送真实消息来测试，cd 到 packages/\*后，用 pnpm tsx 在本地运行
- packages/\*/tests 目录下是容易 mock 的测试文件，可以在本地和 CICD 上运行
- 修改 agent-sdk 后需要 build 才能在 code 里使用
- 修改完，注意使用 pnpm run type-check 和 pnpm run lint 来检查 

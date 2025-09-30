# Memory

这是AI助手的记忆文件，记录重要信息和上下文。

- 使用 pnpm 而非 npm
- 测试框架是 vitest
- 除非用户明确提及，否则不要创建 Markdown 文档
- 不要写 any 类型
- 使用 HookTester 测试 hooks
- 参考 scripts/test-app.tsx 来写没有 mock 的真实测试文件，这些测试文件不会在 CICD 运行，只会手动触发

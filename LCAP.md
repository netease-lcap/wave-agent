# Memory

这是AI助手的记忆文件，记录重要信息和上下文。

- 使用 pnpm 而非 npm
- 测试框架是 vitest
- 直接运行 pnpm xxx 命令，不需要 cd 到某个目录
- 除非用户明确提及，否则不要创建 Markdown 文档
- 不要运行 pnpm dev 等守护进程
- 不要写 any 类型
- 不要单独测试 hooks，要使用 ink-testing-library 来渲染组件，进而测试 hooks

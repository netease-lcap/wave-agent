# DiffViewer 语法高亮功能说明

## 🎨 新功能：全新增代码的语法高亮

### 功能描述
当 DiffViewer 检测到一个 diff 只包含新增行（例如新文件创建或只有新代码添加）时，会自动切换到语法高亮模式显示，而不是传统的 diff 格式。

### 触发条件
1. ✅ Diff 中只包含新增行（`added: true`）
2. ✅ 没有删除或修改行（`removed: true`）
3. ✅ 有实际的代码内容

### 语言检测
- **文件扩展名检测**：支持 30+ 种编程语言
  - `.js, .jsx` → JavaScript
  - `.ts, .tsx` → TypeScript  
  - `.py` → Python
  - `.go` → Go
  - `.rs` → Rust
  - `.java` → Java
  - 等等...

- **内容模式检测**（备选方案）：
  - 包含 `function`, `const`, `let` → JavaScript
  - 包含 `interface`, `type`, `: string` → TypeScript
  - 包含 `def`, `class`, `import` → Python

### 显示效果
```
📄 New file: src/utils/helper.js
Language: javascript

[语法高亮的代码内容]
```

### 回退机制
如果不满足条件（例如有修改或删除），会自动回退到传统的 diff 显示模式。

### 实现位置
- 文件：`packages/code/src/components/DiffViewer.tsx`
- 使用与 MessageList 相同的 `marked-terminal` + `cli-highlight` 技术栈
- 保持与现有 markdown 渲染的一致性
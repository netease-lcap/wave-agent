# MessageList 分页功能

MessageList 组件现在支持智能分页，自动优化CLI应用的性能和用户体验。

## 功能特性

### 🚀 智能分页

- **自动计算页面大小**：基于终端高度动态调整每页消息数量（3-5条）
- **自动跳转最新**：新消息到达时自动跳转到最新页面
- **性能优化**：只渲染当前页面的消息，支持大量消息

### ⌨️ 键盘导航

- `Ctrl + U` - 上一页
- `Ctrl + D` - 下一页
- `Page Up/Down` - 翻页

### 📊 状态显示

- 页面指示器：`第 2/5 页`
- 消息范围：`消息 6-10 / 25`
- 自动模式标识：`(最新)`
- 导航提示：`Ctrl+U/D 翻页`

## 使用方式

```tsx
import { MessageList } from "./components/MessageList";

function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);

  return (
    <Box flexDirection="column">
      <MessageList messages={messages} />
      {/* 其他组件 */}
    </Box>
  );
}
```

## 分页逻辑

### 页面大小计算

```typescript
const messagesPerPage = useMemo(() => {
  if (typeof process !== "undefined" && process.stdout && process.stdout.rows) {
    const availableLines = process.stdout.rows - MIN_LINES_FOR_UI;
    return Math.max(3, Math.min(availableLines, 5)); // 最少3条，最多5条
  }
  return DEFAULT_MESSAGES_PER_PAGE;
}, []);
```

- **最小值**: 3条消息/页
- **最大值**: 5条消息/页
- **动态调整**: 基于 `(终端行数 - 8)` 计算
- **预留空间**: 8行用于输入框和状态信息

### 自动模式 vs 手动模式

- **自动模式**: 始终显示最新消息，新消息到达时自动跳转到最后一页
- **手动模式**: 用户使用键盘导航后进入，保持在用户选择的页面
- **智能切换**:
  - 当用户导航到最后一页时，自动返回自动模式
  - 当消息数量变化且用户在最后一页时，保持自动模式

### 分页信息计算

```typescript
// 自动模式分页信息
const paginationInfo = useMemo((): PaginationInfo => {
  const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
  const currentPage = totalPages; // 始终显示最后一页
  const startIndex = (currentPage - 1) * messagesPerPage;
  const endIndex = Math.min(startIndex + messagesPerPage, messages.length);

  return { currentPage, totalPages, startIndex, endIndex, messagesPerPage };
}, [messages.length, messagesPerPage]);

// 显示信息计算（结合手动控制）
const displayInfo = useMemo((): PaginationInfo => {
  if (manualPage === null) {
    return paginationInfo; // 自动模式
  }
  // 手动模式：显示用户选择的页面
  const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
  const currentPage = Math.min(Math.max(1, manualPage), totalPages);
  // ...
}, [messages.length, messagesPerPage, manualPage, paginationInfo]);
```

## 性能优化

### 内存优化

- 只渲染当前页面的消息：`messages.slice(displayInfo.startIndex, displayInfo.endIndex)`
- 其他消息不参与DOM构建，显著减少内存使用
- 智能重渲染，避免不必要的组件更新

### 用户体验

- 消息编号保持全局一致性：`#{messageIndex + 1}`
- 平滑的翻页体验，无闪烁
- 直观的状态反馈和导航提示
- 空消息状态友好提示

## 键盘事件处理

```typescript
useInput((input, key) => {
  const totalPages = displayInfo.totalPages;
  const currentPage = manualPage ?? displayInfo.currentPage;

  if (key.ctrl) {
    switch (input) {
      case "u": // Ctrl+U - 上一页
        setManualPage(Math.max(1, currentPage - 1));
        break;
      case "d": // Ctrl+D - 下一页
        setManualPage(Math.min(totalPages, currentPage + 1));
        break;
    }
  }

  // Page Up/Down 支持
  if (key.pageUp) {
    setManualPage(Math.max(1, currentPage - 1));
  }
  if (key.pageDown) {
    setManualPage(Math.min(totalPages, currentPage + 1));
  }
});
```

## 界面展示

### 空消息状态

```
Welcome to WAVE Code Assistant!
```

### 普通分页界面

```
👤 You #6
  Can you help me with this code?

🤖 Assistant #7
  📄 Update: src/App.tsx
  ┌─────────────────────────────────────┐
  │ import React from 'react';          │
  │ // Updated code here...             │
  └─────────────────────────────────────┘

👤 You #8
  Thanks! That works perfectly.

┌─────────────────────────────────────────────────────────┐
│ 消息 6-8 / 25                     第 2/5 页      Ctrl+U/D 翻页 │
└─────────────────────────────────────────────────────────┘
```

### 最新页面显示

```
🤖 Assistant #25
  I've successfully updated your code!

┌─────────────────────────────────────────────────────────┐
│ 消息 23-25 / 25              第 5/5 页 (最新)   Ctrl+U/D 翻页 │
└─────────────────────────────────────────────────────────┘
```

## 支持的消息类型

MessageList 组件支持多种消息块类型的渲染：

- **文本消息** (`text`): 普通文本内容
- **文件操作** (`file`): 创建、更新、删除文件的操作
- **错误信息** (`error`): 错误消息显示
- **代码差异** (`diff`): 代码变更对比
- **命令输出** (`command_output`): 终端命令执行结果
- **工具结果** (`tool`): 工具调用结果

每种类型都有对应的图标和颜色标识，提供直观的视觉区分。

## 技术实现要点

### 响应式设计

- 终端大小变化时自动调整页面大小
- 保持用户当前的导航状态
- 智能处理边界情况

### 状态管理

- `manualPage`: 用户手动控制的页面号（null表示自动模式）
- `paginationInfo`: 自动模式的分页计算结果
- `displayInfo`: 最终显示的分页信息

### 自动切换逻辑

```typescript
useEffect(() => {
  if (manualPage !== null) {
    // 如果用户当前在最后一页，则保持自动模式
    const totalPages = Math.ceil(messages.length / messagesPerPage);
    if (manualPage >= totalPages) {
      setManualPage(null);
    }
  }
}, [messages.length, messagesPerPage, manualPage]);
```

这个分页方案有效解决了CLI应用中消息列表的性能问题，提供了流畅的用户体验和直观的导航方式，特别适合在终端环境中处理大量交互消息。

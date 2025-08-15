# FILE_SIZE_LIMIT 修复说明

## 修改内容

本次修改解决了 FILE_SIZE_LIMIT 错误导致文件管理器初始化失败的问题。现在当遇到超过大小限制的文件时：

1. **不再抛出错误阻止初始化** - 文件管理器可以正常初始化和使用
2. **显示警告信息** - 在控制台记录 warn 级别的日志，告知用户哪些文件超过限制  
3. **大文件 code 字段为空** - 超大文件仍会被添加到文件树中，但 `code` 字段设为空字符串
4. **标记超大文件** - 添加 `oversized: true` 标志用于识别

## 修改的文件

### 1. src/utils/scanDirectory.ts
- 将 FILE_SIZE_LIMIT 错误改为警告日志
- 超大文件的 `code` 字段设置为空，添加 `oversized: true` 标记
- 移除错误重新抛出，允许扫描继续进行

### 2. src/services/fileManager.ts  
- `syncFilesFromDisk()`: 不再重新抛出 FILE_SIZE_LIMIT 错误
- `createFileInMemory()`: 同样改为警告处理，不阻止文件添加
- `readFileFromMemory()`: 对标记为 `oversized` 的文件抛出适当错误

### 3. src/types/common.ts
- `FileTreeNode` 接口已支持 `oversized?: boolean` 字段

## 行为变化

**之前**: 遇到大文件时抛出错误，初始化失败，用户无法继续使用
**现在**: 遇到大文件时显示警告，文件管理器正常初始化，大文件内容为空但仍在文件列表中

## 测试建议

用包含大文件（>1MB）的目录测试，应该看到：
- 控制台出现 FILE_SIZE_LIMIT 警告信息
- 文件管理器正常初始化，不报错
- 大文件在文件列表中显示但 code 为空
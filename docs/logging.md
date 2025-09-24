# 日志系统

项目提供了完整的日志功能，所有日志都写入到文件中，帮助开发者调试和监控应用状态。

## 环境变量配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `LOG_LEVEL` | `INFO` | 日志级别，可选：DEBUG、INFO、WARN、ERROR |
| `LOG_KEYWORDS` | - | 关键词过滤，用逗号分隔，只输出包含关键词的日志 |
| `LOG_MAX_FILE_SIZE` | `10485760` | 当前日志文件最大大小（字节），默认10MB，超过将被截断 |
| `LOG_KEEP_LINES` | `1000` | 截断日志文件时保留的行数 |

## 日志文件位置

```bash
# 默认日志文件位置
~/.lcap-code/app.log
```

## 查看日志文件

```bash
# 实时查看日志
tail -f ~/.lcap-code/app.log

# 查看完整日志
cat ~/.lcap-code/app.log

# 清空日志
rm ~/.lcap-code/app.log
```

## 日志级别说明

- **DEBUG**: 详细的调试信息，开发时使用
- **INFO**: 一般信息，默认级别
- **WARN**: 警告信息，潜在问题
- **ERROR**: 错误信息，必须处理的问题

## 关键词过滤

只输出包含特定关键词的日志：

```bash
# 只显示包含 "file" 或 "error" 的日志
LOG_KEYWORDS=file,error lcap-code
```

## 代码中使用日志

```typescript
import { logger } from '../utils/logger';

// 不同级别的日志
logger.debug('详细调试信息', { data: someObject });
logger.info('一般信息');
logger.warn('警告信息', error);
logger.error('错误信息', error);

// 带关键词的日志（便于过滤）
logger.info('[file] 文件加载完成:', filePath);
logger.error('[network] 网络请求失败:', error);
```

## 调试方法

### 开发调试

```bash
# 启用详细日志
LOG_LEVEL=DEBUG lcap-code
```

### 测试调试

```bash
# 测试时启用详细日志
LOG_LEVEL=DEBUG npm test
```

### 生产环境日志

```bash
# 生产环境建议配置
LOG_LEVEL=WARN lcap-code
```

### 调试技巧

1. **多终端查看**：一个终端运行应用，另一个终端实时查看日志
2. **关键词过滤**：使用 LOG_KEYWORDS 只关注特定类型的日志
3. **日志分析**：使用 `grep`、`awk` 等工具过滤和分析日志

```bash
# 过滤特定关键词的日志
grep "ERROR" ~/.lcap-code/app.log

# 查看最近 100 行日志
tail -n 100 ~/.lcap-code/app.log

# 实时过滤特定内容
tail -f ~/.lcap-code/app.log | grep "file"
```

## 兼容性说明

- 所有日志都写入到文件中，不输出到控制台
- 当前日志文件超过10MB时会自动截断，保留最后1000行
- 可通过环境变量自定义截断配置
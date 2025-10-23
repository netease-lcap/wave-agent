# Logging System

The project provides complete logging functionality, with all logs written to files to help developers debug and monitor application status.

## Environment Variable Configuration

| Environment Variable | Default Value | Description |
| ------------------- | ---------- | ---------------------------------------------------- |
| `LOG_LEVEL`         | `INFO`     | Log level, options: DEBUG, INFO, WARN, ERROR             |
| `LOG_KEYWORDS`      | -          | Keyword filtering, comma-separated, only output logs containing keywords       |
| `LOG_MAX_FILE_SIZE` | `10485760` | Maximum size of current log file (bytes), default 10MB, will be truncated when exceeded |
| `LOG_KEEP_LINES`    | `1000`     | Number of lines to keep when truncating log file                             |

## Log File Location

```bash
# Default log file location
~/.wave/app.log
```

## View Log Files

```bash
# View logs in real time
tail -f ~/.wave/app.log

# View complete logs
cat ~/.wave/app.log

# Clear logs
rm ~/.wave/app.log
```

## Log Level Description

- **DEBUG**: Detailed debugging information, used during development
- **INFO**: General information, default level
- **WARN**: Warning information, potential issues
- **ERROR**: Error information, issues that must be handled

## Keyword Filtering

Only output logs containing specific keywords:

```bash
# Only show logs containing "file" or "error"
LOG_KEYWORDS=file,error wave-code
```

## Using Logs in Code

```typescript
import { logger } from "../utils/logger";

// Different log levels
logger.debug("Detailed debugging information", { data: someObject });
logger.info("General information");
logger.warn("Warning information", error);
logger.error("Error information", error);

// Logs with keywords (for easy filtering)
logger.info("[file] File loading completed:", filePath);
logger.error("[network] Network request failed:", error);
```

## Debugging Methods

### Development Debugging

```bash
# Enable detailed logs
LOG_LEVEL=DEBUG wave-code
```

### Test Debugging

```bash
# Enable detailed logs during testing
LOG_LEVEL=DEBUG npm test
```

### Production Environment Logs

```bash
# Recommended production configuration
LOG_LEVEL=WARN wave-code
```

### Debugging Tips

1. **Multi-terminal viewing**: Run application in one terminal, view logs in real-time in another terminal
2. **Keyword filtering**: Use LOG_KEYWORDS to focus only on specific types of logs
3. **Log analysis**: Use tools like `grep`, `awk` to filter and analyze logs

```bash
# Filter logs with specific keywords
grep "ERROR" ~/.wave/app.log

# View last 100 lines of logs
tail -n 100 ~/.wave/app.log

# Real-time filtering of specific content
tail -f ~/.wave/app.log | grep "file"
```

## Compatibility Notes

- All logs are written to files, not output to console
- When current log file exceeds 10MB it will be automatically truncated, keeping the last 1000 lines
- Truncation configuration can be customized through environment variables

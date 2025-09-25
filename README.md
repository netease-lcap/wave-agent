# lcap-code

一个基于 Ink 和 React 的终端编程代理。

## 环境配置

在使用前，需要配置以下环境变量用于AI模型鉴权：

### 必需环境变量

```bash
# AI网关访问令牌（必需）
export AIGW_TOKEN="your_token_here"

# AI网关API地址（必需）
export AIGW_URL="https://your-api-gateway-url.com"
```

### 可选环境变量

```bash
# 指定使用的AI模型（可选，默认使用系统配置的模型）
export AIGW_MODEL="gemini-2.5-flash"

# 指定快速AI模型（可选，用于快速响应场景）
export AIGW_FAST_MODEL="gemini-1.5-flash"

# 日志级别（可选，默认为info）
export LOG_LEVEL="debug"

# 日志文件路径（可选）
export LOG_FILE="/path/to/your/logfile.log"

# 最大日志文件大小（可选，默认10MB）
export LOG_MAX_FILE_SIZE="10485760"

# Token限制（可选，默认64000）
export TOKEN_LIMIT="64000"

# 禁用原始模式（可选，用于测试）
export DISABLE_RAW_MODE="false"
```

### 环境变量设置方式

#### 方法1：直接在命令行设置
```bash
export AIGW_TOKEN="your_token_here"
export AIGW_URL="https://your-api-gateway-url.com"
lcap-code
```

#### 方法2：使用.env文件
创建 `.env` 文件并添加：
```
AIGW_TOKEN=your_token_here
AIGW_URL=https://your-api-gateway-url.com
```

#### 方法3：在shell配置文件中设置
将环境变量添加到 `~/.bashrc`、`~/.zshrc` 或相应的shell配置文件中。

⚠️ **重要提示**：不设置 `AIGW_TOKEN` 和 `AIGW_URL` 环境变量，模型将无法进行鉴权，应用无法正常工作。

## 安装

### 全局安装

```bash
npm install -g lcap-code
```

## 使用方法

### 命令行使用

```bash
# 打开当前目录
lcap-code

lcap-code --help
```

## 文档

- [日志系统](docs/logging.md) - 日志配置和调试方法
- [图片粘贴功能](docs/image-paste.md) - 图片粘贴和处理功能
- [分页功能](docs/PAGINATION.md) - 文件列表分页实现

## 兼容性说明

- 所有日志都写入到文件中，不输出到控制台
---
title: 将 Figma 设计稿转化为前端代码
description: 从设计稿到可运行前端的完整链路：取图、标注、产出与验收
---

# 将 Figma 设计稿转化为前端代码

设计稿还原是前端开发的高频场景。通过 MCP（Model Context Protocol），CodeWave IDE 可以连接 Figma 设计稿数据，让 AI 直接读取设计稿的布局、颜色、字体与图片资源，一键生成与设计稿高度一致的响应式页面。

本教程以 Figma 的 MCP 服务器（`figma-developer-mcp`，社区版）为例，演示从配置到出码的完整流程。Figma 官方也提供 MCP 服务器，如果条件允许，官方 MCP 同样极力推荐。

## 准备：获取 Figma Access Token

Figma 通过 Personal Access Token 授权第三方应用访问设计稿数据。

1. 登录 [Figma](https://www.figma.com/)，点击左上角用户头像 → **Settings**。
2. 在顶部菜单选择 **Security**，滚动到 **Personal access tokens** 部分，点击 **Generate new token**。
3. 输入 Token 名称（如 `codewave-figma`）、设置有效期，并勾选所需权限，点击 **Generate token**。
4. 复制生成的 Token（只显示一次，请妥善保存）。

> 注意：Token 仅授权访问其持有者账号有权限的设计稿；分享设计稿给该账号后再使用。

## 在 CodeWave IDE 中添加 Figma MCP 服务器

打开 CodeWave IDE 设置 → **MCP**，点击「添加 MCP 服务」，选择类型并填写配置：

- **stdio 类型**（推荐，本地运行）：
  ```json
  {
    "mcpServers": {
      "figma": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "figma-developer-mcp", "--stdio"],
        "env": { "FIGMA_API_KEY": "你的 Access Token" }
      }
    }
  }
  ```
- **http 类型**：如果使用远程托管的 Figma MCP 服务，填写服务 URL 并在 headers 中携带 Token。

保存后服务器自动连接，列表显示连接状态。

![MCP 设置页](/screenshots/desktop-settings-mcp.webp)

> 也可以直接在项目根目录创建 `.mcp.json`（同上的 `mcpServers` 结构），启动时自动加载。更多配置方式见 [桌面版文档 - MCP](/desktop/extensions#mcp)。

## 对话中粘贴设计稿链接，提出需求

在本地打开项目文件夹（CodeWave IDE 桌面端「打开项目」，或 IDE 插件中打开工作区），然后把 Figma 设计稿的选中区域链接复制到对话中：

1. 打开 Figma 设计稿，选中要还原的 Frame。
2. 右键 → **Copy/Paste as** → **Copy link to selection**，复制设计稿链接。
3. 在 CodeWave IDE 输入框中粘贴链接并描述需求，例如：

> 请严格按照这个 Figma 链接生成登录页的响应式 HTML，视觉细节要跟设计稿一致：https://www.figma.com/design/9xYkZ0vF/Login-Page（含移动端与桌面端两套布局）

AI 会自动匹配并调用 Figma MCP 工具：先读取设计稿布局信息（`get_figma_data`），再下载其中的图标与图片资源（`download_figma_images`），最后生成 `index.html`：

![Figma 设计稿转代码](/screenshots/desktop-figma-mcp.webp)

**首次调用需授权**：MCP 工具首次使用时弹出权限确认，勾选「总是允许」后存为信任规则，后续调用免确认：

![MCP 工具确认](/screenshots/desktop-mcp-confirm.webp)

## 预览与迭代

生成完成后，在预览面板（或浏览器中）打开 `index.html` 查看效果，继续对话迭代优化：

- "背景色跟设计稿再贴近一点，改成 #4A90D9 的渐变"
- "移动端断点下把表单挤成单列"
- "图标用设计稿里的 SVG，不要用 iconfont"

每一次反馈都会在同一个对话上下文里继续，AI 会基于设计稿数据与你的意见持续调整。

## 常见问题

- **工具调用失败**：确认 Token 有效且对设计稿有访问权限，服务器连接状态正常（设置 → MCP 可查看）。
- **链接无法读取**：使用 **Copy link to selection** 复制的链接，而不是浏览器地址栏的链接；确保设计稿已分享给 Token 所属账号。
- **生成的样式与设计稿有偏差**：在设计稿中确认 Frame 命名与图层结构清晰，描述需求时补充关键要求（如响应式断点、主色值）。

---
name: "文本粘贴"
description: "修复粘贴文本被立即提交：对齐 Claude Code 启用 bracketed paste（DECSET 2004）并在 stdin 原始字节层识别粘贴标记，粘贴内容仅插入不提交"
order: 260
---

# 功能规格说明：文本粘贴

**创建日期**：2026-08-04

## 用户场景与测试 _（必填）_

### 用户故事：粘贴文本仅插入不提交（优先级：P1）

作为 Wave CLI 用户，我希望从 tmux/终端复制并粘贴文本时，粘贴内容只进入输入框而不是立即发送，以便粘贴后我可以先编辑再手动回车提交。

**为什么是这个优先级**：这是用户反馈的 bug（从 tmux 复制 "Watch PR checks until completion" 粘贴到 CLI 立即提交）。根因：tmux 复制内容以换行符结尾，粘贴时终端发送 `\r`；ink 将整段粘贴作为一个回调传入且 `key.return=false`（ink 的 `parseKeypress` 只把孤立的 `\r` 识别为回车），于是落入输入框的 "SSH-coalesced Enter" 启发式（`inputReducer.ts:1258`：多字符 chunk 以单个 `\r` 结尾视为"打字+回车合包"）→ 插入文本后立即提交。Claude Code 不会发生此问题：CC 启用 bracketed paste（DECSET 2004），终端将粘贴内容包裹在 `\x1b[200~` / `\x1b[201~` 中，CC 解析时标记 `isPasted=true`，粘贴内容路由到 `onTextPaste` 仅做归一化插入（`\r`→`\n`），绝不提交，因此 CC 的 coalesced-Enter 启发式只对真实的"打字+回车"生效。Wave 未启用 bracketed paste 也无粘贴状态跟踪，故粘贴尾部 `\r` 落入合包回车误判。

**独立测试**：通过 stdin 注入 `\x1b[200~Watch PR checks until completion\r\x1b[201~`，验证输入框文本变为粘贴内容（`\r` 归一化为 `\n`）且不触发提交。

**验收场景**：

1. **假设**终端支持 bracketed paste 且 Wave 已启用，**当**粘贴单行文本（尾部带换行，如 `Watch PR checks until completion\r`）时，**则**文本插入输入框，不触发提交。
2. **假设**同上，**当**粘贴多行文本（如 `line1\rline2\r`）时，**则**换行统一归一化为 `\n` 插入输入框（对齐 CC `onTextPaste` 的 `\r`→`\n` 替换），不触发提交。
3. **假设**粘贴内容不含换行（纯单行无尾部 `\r`），**当**粘贴时，**则**直接插入文本，不触发提交。
4. **假设**用户手动输入文本后按回车（真实打字+回车在慢链路下合包为 `text\r`），**当**该 chunk 到达时，**则**保留现有 "SSH-coalesced Enter" 行为：插入文本并提交（对齐 CC `useTextInput.ts:485-499`）。
5. **假设**终端不支持 bracketed paste（无 `\x1b[200~` 包裹），**当**粘贴时，**则**退化为现状行为，不报错、不崩溃。
6. **假设**正在输入框中输入，**当**收到非粘贴的普通按键输入（退格、编辑键、快捷键等）时，**则**行为完全不变。

---

### 边界情况

- **长粘贴分块**：终端可能将长粘贴拆成多个 chunk（起始 chunk 含 `\x1b[200~`、中间为纯文本 chunk、结束 chunk 含 `\x1b[201~`）。从检测到粘贴起始标记起进入"粘贴中"状态，缓冲所有中间 chunk，直到 `\x1b[201~` 结束并一次性插入；粘贴中到达的独立 `\r` chunk 必须作为换行内容缓冲，不得触发提交。
- **启用与退出 bracketed paste**：Wave 启动渲染时向 stdout 写入 `\x1b[?2004h`，退出/卸载时写入 `\x1b[?2004l`，避免残留终端模式状态。
- **与既有启发式共存**："SSH-coalesced Enter" 启发式保留（CC 同样保留），仅对不含粘贴标记的输入生效；进入粘贴路径的内容绝不进入该启发式。
- **实施层级**：ink 的 `useInput` 回调层不可靠——chunk 已过 `parseKeypress`（剥离前导 ESC、破坏粘贴起始转义序列）。需在 stdin 原始字节层拦截（参考 ink `confirmKittySupport` 的 `stdin.unshift()` 重注入模式：`prependListener('readable')` 先读 chunk，剥离粘贴标记后把非粘贴字节 `unshift` 回 stdin 交给 ink 正常管线，粘贴内容直接派发"插入文本"事件）。[待确认实现方案]
- **纯文本终端兼容**：不支持 bracketed paste 的终端（如部分旧版 tmux）不发送标记，走现状路径。

## 假设

- 目标终端（tmux、常见 xterm 兼容终端）支持 DECSET 2004 bracketed paste；不支持时行为退化为现状。
- 粘贴内容归一化与 Claude Code `onTextPaste` 一致：`stripAnsi` + `\r`→`\n`；Tab 展开为 4 空格是否纳入本次范围待确认（CC 包含该处理）。[待确认]
- 长粘贴的输入框呈现（多行输入、占位符）沿用现有机制，不在本规格范围内扩展。

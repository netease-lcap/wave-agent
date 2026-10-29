/**
 * `@` 显式点名子代理的标记解析（spec `multi-agent/subagent.md`「用户故事：显式子代理调用」）。
 *
 * 两种拼写是同一条正则的两个分支：webview 的标签落地为 `[@agent:<名称>]`（与
 * `[@file:…]`、`[@ide:…]` 同族，草稿还原与消息气泡复用同一套标记解析），CLI 没有
 * 标签机制直接插 `@agent:<名称>`。判定放在 SDK 而不是 UI：从下拉里选中、手打、
 * 从别处粘贴走同一条路径，四个宿主不必各写一套。
 *
 * 名字字符集与子代理定义一致（frontmatter `name` 校验是
 * `^[a-zA-Z][a-zA-Z0-9-]*$`），另外容许冒号——插件子代理按 `<插件名>:<名称>`
 * 注册（`SubagentManager.registerPluginAgents`）。
 *
 * 前缀用「前面不是字母数字」而不是「前面是空白」：标签插在正文里没有空格
 * （`帮我[@agent:Explore]`），按空白锚会漏；而按词字符排除能挡住
 * `mail@agent:x.com` 这类邮件地址。
 */
const AGENT_MENTION_REGEX = /(?<![\w@])\[?@agent:([a-zA-Z][\w:-]*)\]?/g;

/** 按出现顺序取出正文里点名的子代理名（去重）。 */
export function parseAgentMentions(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  AGENT_MENTION_REGEX.lastIndex = 0;
  while ((match = AGENT_MENTION_REGEX.exec(text)) !== null) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * 点名提醒。语义是**软指定**（与 Claude Code 的 `agent_mention` 一致）：点名、
 * 要求委派，但怎么切分上下文、要不要并行仍由主代理判断。
 *
 * 名字不是已加载的子代理时（手打错名、子代理已删、插件已卸载）不报错也不中断
 * 这一轮，只把可用名单给它——错误消息里带着全部可用名是 `Agent` 工具现有的
 * 兜底方式，这里提前一步说清。
 */
export function buildAgentMentionReminder(
  mentionedNames: string[],
  availableNames: string[],
): string | null {
  const available = new Set(availableNames);
  const known = mentionedNames.filter((name) => available.has(name));
  const unknown = mentionedNames.filter((name) => !available.has(name));
  const parts: string[] = [];

  if (known.length > 0) {
    const quoted = known.map((name) => `"${name}"`).join(", ");
    parts.push(
      known.length === 1
        ? `The user explicitly named the subagent ${quoted} in this message. Use the Agent tool with subagent_type=${quoted} to handle it — delegate the task to that subagent instead of doing the work yourself, and give it the context it needs.`
        : `The user explicitly named the subagents ${quoted} in this message. Use the Agent tool once per subagent, with subagent_type set to the matching name, and split the task between them instead of doing the work yourself.`,
    );
  }

  if (unknown.length > 0) {
    const quoted = unknown.map((name) => `"${name}"`).join(", ");
    parts.push(
      `The user named the subagent ${quoted}, but no subagent by that name is loaded, so it cannot be invoked. Available subagents: ${
        availableNames.length > 0 ? availableNames.join(", ") : "none"
      }. Tell the user the name did not match instead of silently substituting another one.`,
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

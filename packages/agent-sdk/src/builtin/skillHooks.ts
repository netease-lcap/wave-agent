/**
 * 内置技能的代码钩子。
 *
 * 技能是两个装载来源、一张表：代码（`src/builtin/skills/*.ts`，编译进包体，
 * 运行时物化成 SKILL.md 供扫描）与文件（用户 / 项目 / 插件目录里的 SKILL.md）。
 * 落盘那一步会把代码能力丢掉——物化回来只剩正文。这张旁挂表把它接回去，键是
 * 技能名，只在 `skill.type === "builtin"` 时查。
 *
 * 文件来源永远查不到，markdown 侧也不加任何字段，这是刻意的：外部用户拿不到
 * 代码钩子，Claude Code 也不给（它的 markdown skill 同样只有 frontmatter + 正文，
 * `getPromptForCommand` / `onUserTypedArgs` 只挂在内置注册对象上）。
 */

export interface BuiltinSkillHook {
  /**
   * 把 `/技能名` 后面的原始参数解析成一段运行期上下文，接在正文之后交给模型。
   *
   * **不替换正文**：用户点开 `/code-review` 看到的仍是那段可读的流程说明，模型
   * 额外拿到「档位=high、目标=PR #123、要求改代码」这样的结构化结论。这也让
   * `renderSkillContent` 的三处复用（消息正文 / 工具块参数 / 子代理 prompt）保持一致。
   */
  describeArgs?: (raw: string) => string;
}

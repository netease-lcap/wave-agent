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

/** 生成正文时能拿到的运行时事实。只给内置技能的代码钩子用。 */
export interface SkillPromptContext {
  /** 本次会话注册了哪些工具名——判「这个工具在不在这轮里」，例如 Agent。 */
  toolNames: string[];
  /** 此刻清单里有哪些技能名——判「要不要顺手引用另一个技能」。 */
  availableSkills: string[];
  /**
   * 当前仓库 `origin` 的远端地址，没配远端时 `null`。
   *
   * 有些指示要按托管方分叉（敲 `gh` 还是 `glab`、评论走 GitHub 还是 GitLab 的段，
   * 判据见 `utils/repoHost.ts`）。模型自己跑 `git remote` 也读得到，但正文得在这一轮
   * 就把段落选好，所以地址提前进来；传地址而不传平台结论，判据留在消费侧。
   */
  gitRemoteUrl: string | null;
}

export interface BuiltinSkillHook {
  /**
   * 把 `/技能名` 后面的原始参数解析成一段运行期上下文，接在正文之后交给模型。
   *
   * **不替换正文**：用户点开 `/code-review` 看到的仍是那段可读的流程说明，模型
   * 额外拿到「档位=high、目标=PR #123、要求改代码」这样的结构化结论。这也让
   * `renderSkillContent` 的三处复用（消息正文 / 工具块参数 / 子代理 prompt）保持一致。
   */
  describeArgs?: (raw: string) => string;

  /**
   * 按参数与运行时事实选择要注入的段落，接在正文之后（**同样不替换正文**）。
   *
   * 正文是静态字符串，有些指示只能由运行时决定：这次会话有没有 Agent 工具、
   * 用户有没有敲 `--fix`。Claude Code 的 `di(cell, agentToolAvailable, …)` 会整段
   * 换正文，`wi()` 追加 `--fix` 段——它的 prompt 只在模型那边；我方正文同时要给
   * 用户看（消息正文 / 工具块参数 / 子代理 prompt 三处复用），所以走「基线 +
   * 覆盖段」：段落追加在末尾，并写明它覆盖的是哪一节。
   */
  buildPrompt?: (raw: string, ctx: SkillPromptContext) => string;
}

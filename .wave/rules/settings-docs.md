---
paths:
  - "packages/agent-sdk/src/types/configuration.ts"
  - "packages/agent-sdk/src/types/hooks.ts"
  - "packages/agent-sdk/src/types/permissions.ts"
  - "packages/agent-sdk/src/types/telemetry.ts"
  - "packages/agent-sdk/src/types/mcp.ts"
  - "packages/agent-sdk/src/types/mods.ts"
  - "packages/agent-sdk/src/services/configurationService.ts"
  - "packages/agent-sdk/src/managers/permissionManager.ts"
  - "packages/agent-sdk/src/utils/configPaths.ts"
---

你刚碰的是**配置面**：`settings.json` 的键与默认值、hook 事件与字段、环境变量、权限规则，以及各子系统的开关。

模型回答「怎么配 X」时**只读内置 settings 技能**，它过期等于教错用法，所以改完代码要顺带看它一眼 —— `packages/agent-sdk/src/builtin/skills/settings.ts` 里的分册：SKILL.md（全貌）、ENV.md、HOOKS.md、PERMISSIONS.md、PLUGINS.md、MODS.md、COMMANDS.md。

- **新增键 / 事件 / 字段** → 技能里必须有个位置，否则模型不知道它存在。
- **改默认值、取值枚举、解析优先级** → 找到描述它的那句改掉。
- **改语义**（单位、作用域、从布尔变字符串）→ 危险的一类：旧描述仍然通顺，只是不对了。搜技能里的键名确认。
- **常量里的默认值**（`constants/` 下）也常被技能引用，改了就一并核。
- **用户可见的配置行为变了** → 顺带看 `docs/cli.md`、`docs/sdk.md` 的对应段落。
- **纯内部重构、配置面一个字没变** → 不用动技能，在提交说明里写一句「配置面未变」即可。

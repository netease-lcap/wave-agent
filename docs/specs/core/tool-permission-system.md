---
name: "工具权限系统"
description: "权限规则通配符匹配、复合命令结构感知判定、安全区域/附加目录、MCP 工具权限与 `acceptEdits`/`dontAsk` 等模式"
order: 130
---

# 功能规格说明：工具权限系统

## 概述

工具权限系统为 Wave agent 提供了强大的安全层，确保潜在的破坏性或敏感操作经过用户授权。它支持多种权限模式、带通配符的细粒度规则匹配、Shell 管道的安全分解、对特定工具或路径的显式拒绝、跨用户和项目作用域的持久化配置、交互式信任机制，以及文件操作的"安全区域"。

## 用户场景与测试

### 用户故事：带确认的默认安全模式（优先级：P1）

用户运行 Wave CLI 不带任何特殊标志，系统在执行任何潜在的破坏性操作（如文件编辑或 bash 命令）之前提示确认。

**验收场景**：

1. **假设**用户运行 Wave CLI 不带标志，**当** Wave 尝试编辑文件时，**则**出现确认提示，询问"是否继续？"并提供允许或修改请求的选项。
2. **假设**显示了确认提示，**当**用户选择"是"时，**则**操作正常执行。
3. **假设**显示了确认提示，**当**用户输入替代指令时，**则** Wave 通过工具结果字段接收新指令，而不是执行原始操作。
4. **假设** AI 返回多个受限工具调用，**当**每个工具调用被执行时，**则**每个调用都会出现单独的顺序确认提示。

### 用户故事：高级用户的绕过模式（优先级：P2）

高级用户使用 `--dangerously-skip-permissions` 运行 Wave CLI 以绕过所有权限检查，实现不间断操作。

**验收场景**：

1. **假设**绕过模式已启用，**当** Wave 尝试任何受限操作时，**则**不出现确认提示，操作立即执行。

### 用户故事：命令的通配符匹配（优先级：P1）

作为用户，我希望通过使用通配符指定通用模式来允许一组相关命令，这样我就不必在权限中列出每个命令的每个变体。

**验收场景**：

1. **假设** `permissions.allow` 包含 `Bash(git commit *)`，**当** agent 尝试运行 `Bash(git commit -m "initial commit")` 时，**则**操作被允许。
2. **假设** `permissions.allow` 包含 `Bash(git * main)`，**当** agent 尝试运行 `Bash(git push origin main)` 时，**则**操作被允许。

### 用户故事：智能通配符启发式（优先级：P1）

作为用户，我希望信任 `npm install lodash` 这样的命令，这样当我运行 `npm install express` 时不会再被提示。

**验收场景**：

1. **假设**系统提示 `npm install lodash`，**当**用户选择"是，不再询问"时，**则**系统应该建议一个智能通配符模式（如 `npm install *`）并保存。
2. **假设** `npm install *` 已被信任，**当**用户运行 `npm install express` 时，**则**它立即执行而不提示。

### 用户故事：分解和验证链式命令（优先级：P1）

作为用户，我希望当且仅当链中的每个单独命令都已被允许时，系统自动允许复杂命令（使用 `&&`、`|` 等）。

**验收场景**：

1. **假设** `permissions.allow` 包含 `cd /tmp/*` 和 `ls`，**当**用户执行 `cd /tmp/test && ls` 时，**则**系统应该自动允许该命令。
2. **假设** `permissions.allow` 包含 `cd /tmp/*` 但不包含 `rm *`，**当**用户执行 `cd /tmp/test && rm -rf /` 时，**则**系统不得自动允许，应该提示权限确认。
3. **假设** `permissions.allow` 包含 `Bash(node scripts*)` 但不含任何 git 规则，且内置默认允许规则包含 `Bash(git diff*)`，**当**用户执行 `node scripts/version.js && git diff --stat` 时，**则**系统应该自动允许该命令——链中各段可分别由不同规则来源（用户规则、内置默认规则等）覆盖，不要求单一规则来源覆盖所有段。

### 用户故事：拒绝规则与优先级（优先级：P1）

作为注重安全的用户，我希望明确禁止 agent 使用某些工具或访问特定路径，即使它们在其他情况下会被允许。

**验收场景**：

1. **假设** `permissions.deny` 包含 `["Bash"]`，**当** agent 尝试运行任何 bash 命令时，**则**系统必须阻止执行。
2. **假设** `permissions.allow` 包含 `["*"]` 且 `permissions.deny` 包含 `["Bash"]`，**当** agent 尝试运行 bash 命令时，**则**系统必须拒绝请求，因为拒绝规则优先。

### 用户故事：把某个工具钉成「每次都必须问」（优先级：P1）

作为用户，我希望只对个别工具写一条 `ask` 规则，让它在每次调用前都必须问我，即使会话正处在 `bypassPermissions` / `acceptEdits` 模式，或者 `permissions.allow` 里已经放行了它。

**为什么是这个优先级**：真正需要确认的动作往往只占少数（外发、发布、动生产），其余工具不希望被打断。按模式一刀切做不到"只看住一个工具"：`bypassPermissions` 会连它一起放行，切回 `default` 又会把所有工具都叫醒；只靠把 `allow` 规则写全也只是绕路，挡不住用户之后切到绕过模式。

**验收场景**：

1. **假设** `permissions.ask` 包含 `["Artifact"]` 且 `permissions.defaultMode` 为 `bypassPermissions`，**当** agent 每次调用 `Artifact` 时，**则** 每次都弹出确认卡片——绕过模式不豁免 `ask` 规则。
2. **假设** `permissions.ask` 与 `permissions.allow` 都包含同一工具，**当** agent 调用它时，**则** 弹确认，优先级为 deny > ask > allow。
3. **假设** `permissions.deny` 与 `permissions.ask` 都命中同一工具，**当** agent 调用它时，**则** 直接拒绝、不问（deny 优先）。
4. **假设** `permissions.ask` 写的是带模式的形式（如 `Bash(git push *)`），**当** 某次调用的参数命中该模式时，**则** 弹确认；未命中时按其余规则与模式判定，不因写了 `ask` 就一律询问。
5. **假设** `permissions.ask` 只写了整工具级规则（如 `["Bash"]`），且 `sandbox.autoAllowBashIfSandboxed` 已开启、该命令会被沙箱执行，**当** 调用时，**则** 不弹确认（对齐 Claude Code：整工具级的 ask 让位于沙箱兜底）；内容级规则（`ask` 里写 `Bash(git push *)`）不享有这个例外——沙箱内的命令命中它仍然要问。
6. **假设** `permissions.ask` 命中了某次调用，**当** 确认卡片弹出时，**则** 卡片不提供「总是允许 / 不再询问」这一档（对齐 Claude Code 的 `suppressAlwaysAllowRule`）：ask 规则的含义就是每次都要问，不能被一次点击变成常驻放行。
7. **假设** `permissions.ask` 里的规则拼错或工具名不存在，**当** 加载配置时，**则** 与 `allow`/`deny` 同口径处理——不报错、不因无法匹配而拦截。

### 用户故事：删除自身工作目录的内建硬闸（优先级：P1）

作为用户，我希望 agent 无论如何都删不掉「这个会话正在工作的那些目录」——它们本身，以及它们的任何祖先——即使我开着绕过模式、即使 `permissions.allow` 里已经写了 `Bash(rm:*)`。一次 `rm -rf ../..` 就能把整个仓库（含 `.git` 与未提交的改动）就地抹掉，没有回收站，也没有第二次机会。

**为什么是这个优先级**：这是少数「一次误判即不可恢复」的操作，代价与普通越界写不同量级。它又必须落在规则与模式之外：`bypassPermissions` 的设计前提是「我信任这个 agent」，而「把 agent 赖以工作的目录删掉」不是信任问题，是把工作本身毁掉；`allow` 规则写 `Bash(rm:*)` 的本意是「别为清构建产物打扰我」，不是「批准删我的仓库」。

**判定语义**（只做路径算术，不识别「仓库」）：

- **保护根** = 会话工作目录 ∪ 附加目录（会话、实例、系统三档来源，去重后取绝对路径）。
- **危险** = 某次删除的目标**等于**其中一个保护根，或**包含**其中一个保护根（即该目标是某个保护根的祖先）。
- 用 realpath 解析后比较，不读 `.git`、不判断「是不是仓库」：没有 `.git` 的项目目录、`.wave/worktrees/` 下的工作树、`/tmp` 里的临时工作区一视同仁。
- **只认 `rm` / `rmdir` 本身**：包装器与内联 shell 的识别集合、以及命令名归一化都以 Claude Code 为准——超出它的写法只会多出一张不可豁免的卡片，而这条闸的语义是「后果是整个工作区」，不是「这条命令长得可疑」。CC 自己对两类名字用两套口径，本实现照抄：**包装器 / 内联 shell 的名字**剥路径 + 小写 + `.exe` 后缀（它的 `UM`，所以 `sudo.exe`、`bash.exe` 就是 `sudo`、`bash`），**删除命令自己的名字**只剥路径 + 小写（它的 `bPe`），`rm.exe` 因此不是 `rm`。

**验收场景**：

1. **假设** 会话工作目录是 `/p/repo/sub`，**当** agent 执行 `rm -rf .`、`rm -rf /p/repo/sub` 或带引号的等价写法，**则** 命中「工作目录」这条，必须由用户明确批准（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:635`）。
2. **假设** 同一工作目录，**当** 目标换成任意祖先（`..`、`../..`、`./build/../..`、绝对路径、`rmdir -p a/b` 沿途的每一级），**则** 同样命中——判据是「包含工作目录」，不是「等于」（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:546`）。
3. **假设** 目标等于某个附加目录或它的祖先，**当** 判定时，**则** 按同一规则处理；附加目录**之下**的子目录不命中（`packages/agent-sdk/src/managers/permissionManager.ts:694`）。
4. **假设** 目标是文件系统根、用户主目录、或一级系统目录本身，**当** 判定时，**则** 同样命中；Windows 上「任何盘符的一级目录」（`D:\media`、`E:\tmp`）也按一级目录处理，`\\.\` / `\\?\` 这类设备与命名空间路径、以及不是本机的整盘共享（`\\host\admin$`、`\\host\d$`）不解析、直接命中——它们在盘上没有可比对的位置；这几类名单与 PowerShell 通道共用同一份实现（`packages/agent-sdk/src/utils/pathSafety.ts:250`）。
5. **假设** 目标经 realpath 后指向上述任一保护根（符号链接指向工作目录、macOS `/tmp` → `/private/tmp`、Windows 下 `C:\Users\LIUYIQ~1` 这类 8.3 短名），**当** 判定时，**则** 按解析后的路径判定；但原拼写也要单独判一次：名单写的就是一级目录名，而这些名字本身常在别处（macOS 的 `/etc`、`/tmp`、`/var` 指向 `/private` 下，usrmerge 的 `/lib` 指向 `/usr/lib`），只看解析结果反而会漏掉要查的那一条。解析必须走 `realpathSync.native`：JS 版不展开 8.3 短名，`C:\Users\LIUYIQ~1` 与 `C:\Users\liuyiqi02` 就永远比不相等（`packages/agent-sdk/src/utils/pathSafety.ts:250`、`:57`）。
6. **假设** 一次调用带多个目标（`rm -rf a b ..`），**当** 其中任一目标命中，**则** 整体按命中处理；`--` 之后的操作数按目标算，`--help`/`--version` 不算目标。
7. **假设** 命令是复合形态（`a && rm -rf ..`、`cd /x && rm -rf /x`、管道、`sudo`/`env`/`nice` 等包装、`bash -c '…'` 内联、后台 `&`），**当** 判定时，**则** 必须逐个叶子命令、按当时的 `cd` 状态判定——对整串文本跑正则不算数（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:176`）。
8. **假设** 目标无法静态确定（`$UNKNOWN`、`$(pwd)`、反引号、glob 前缀里带变量），**当** 判定时，**则** 按危险处理：跳过它等于给出一条明文的绕过方式（`rm -rf "$PWD"`），代价只是变量命名的目标多一次确认。
9. **假设** 目标是 glob，**当** 判定时，**则** 按其静态前缀判定——`rm -rf *`、`rm -rf build/*` 是普通删除，`rm -rf /*`、`rm -rf ../*` 命中根/祖先。
10. **假设** 命中之后进入决策，**当** 权限模式为 `default` / `acceptEdits` / `plan` / `bypassPermissions`（含创建时已获 bypass 授权的 plan 会话），**则** 一律必须弹确认，且卡片不提供「总是允许 / 不再询问」；`allow` 规则、沙箱自动放行、`acceptEdits`、以及 bypass 模式本身都不得批准它。bypass 在这里同样弹卡，与 CC 一致：CC 给这条判定标的是 `bypassImmune`，撑住询问的是它；`waivableInBypass` 指的是「另有一个显式逃生开关可以豁免」，而那个开关默认不存在（本实现不提供），所以 bypass 下没有豁免路径。判定排在 `allow` 规则与 `acceptEdits` 之前（`packages/agent-sdk/src/managers/permissionManager.ts:1203`、`:1484`）。
11. **假设** 权限模式为 `dontAsk`，**当** 命中时，**则** 直接拒绝并给出原因；**假设** 没有任何审批通道（`-p`、未提供 `canUseTool` 的宿主），**当** 命中时，**则** 同样拒绝，且拒绝消息里带上这条原因，而不是一句泛泛的「需要审批」（`packages/agent-sdk/src/managers/permissionManager.ts:987-1003`）。
12. **假设** 换成 PowerShell 通道（`Remove-Item -Recurse -Force <目标>`），**当** 目标等于/包含工作目录或附加目录，**则** 落在**硬拒绝**档（不询问、规则不可覆盖），与根/主目录/系统目录同档（`packages/agent-sdk/src/tools/powershellTool/pathValidation.ts:78`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:253-268`）。
13. **假设** 删除形态不在判据内（`find -delete`、`mv`、`xargs rm`、脚本内的 `shutil.rmtree`），**当** 判定时，**则** 本条不命中，仍按既有规则处理；解析不了的整体（`eval`、heredoc 等）继续按 fail-closed 回落确认。
14. **假设** Windows 上目标是纯反斜杠（`rm -rf \`），**当** 判定时，**则** 命中：Git Bash 把它读成当前盘符的根，这是拼写与后果差得最远的一种目标（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:561`）。
15. **假设** Windows 上目标的写法让 Git Bash 读成别处——裸反斜杠被吃掉（`rm -rf E:\code\myrepo` 到 `rm` 手里是 `E:codemyrepo`，盘符相对路径），或盘符路径的余部没规范化（`rm -rf D:/proj/x-tb\` 的尾部分隔符、`D:/a/../b`）——**当** 判定时，**则** 一律命中并要求显式批准，卡片说明「这条落点未知」（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:510`）。行尾那一个反斜杠不属于这一类：bash 把它当字面反斜杠交给命令（`ls C:\` 就是列出 `C:\`），读不了它的是本侧的解析器，所以只把那格补齐再解析同一行——`rm -rf \` 仍命中盘符根，`ls C:\`、`mkdir C:\temp\` 不是删除，不命中（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:200`）。
16. **假设** 目标用了 MSYS 或共享拼法（`/d/x`、`/cygdrive/d/x`、`//localhost/D$/x`、`\\?\D:\x`），**当** 判定时，**则** 先还原成 `D:\x` 再比较（`packages/agent-sdk/src/utils/path.ts:133`）。用正向映射（`toWindowsPath`）比较等于「判的路径不是删的路径」：它把 `/usr` 判成本盘的 `\usr`，把 `D:/x` 判成盘符问句认不出的形态。

17. **假设** 命令是 `builtin rm -rf ..`（`builtin` 后面跟的确实是 shell 内建 `rm`），**当** 判定时，**则** 命中：CC 在 AST 路径里就把 `builtin` 剥掉再问「这是不是 rm」（它的 `S1`），`builtin` 也出现在它其余几套包装器表里，所以这里不存在「我方更严」的余地——把它从包装器表里拿掉，等于给这道不可豁免的闸留一个一字前缀的绕过（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:96`）。
18. **假设** 命令只靠我方自加的读法才会被认成删除——包装器 `chronic`（`chronic rm -rf ..`），或删除命令写成 Windows 可执行后缀（`rm.exe`、`rm.bat`），**当** 判定时，**则** 本条不命中，交给既有权限规则处理（普通确认，可被 allow 规则或「不再询问」覆盖）：这两种写法 CC 都不拦（`chronic` 不在它任何一套这个问题的包装器表里；判 rm 身份时它不比后缀），双方对同一条命令给出「不可豁免的卡片 / 可点不再询问的普通卡片」的分歧，是用户能直接感知到的打扰。包装器与内联 shell 一侧仍剥 `.exe`（`sudo.exe rm -rf ..`、`bash.exe -c 'rm -rf ..'` 照常命中，见「只认 rm/rmdir 本身」那条）（`packages/agent-sdk/src/utils/shell/dangerousRemoval.ts:310`、`:321`）。

**为什么是「询问」而不是「拒绝」**（Bash 侧）：主人应该保有这个权力——「删掉我克隆的这个目录」是合法意图，只是不能由 agent 自己拍。CC 在同一处也是问。PowerShell 侧的这类目标本来就在硬拒绝档，本次只是把「工作目录及其祖先」补进那一档，与既有语义保持一致。CC 只覆盖 `rm`/`rmdir`，本实现同样只覆盖这两个命令；`find -delete`、`mv`、脚本内删除等形态明确不覆盖。`bypassPermissions` 在这里也不例外：这条判定问的不是「规则许不许」，而是「后果是不是整个工作区」，所以它与根/主目录同档，只能由人在卡片上作答；`dontAsk` 与没有审批通道的宿主直接拒绝，因为它们的处境是「问不出去」，而不是「批准我」。

### 用户故事：基于路径的权限（优先级：P1）

作为用户，我希望通过为操作文件路径的工具定义拒绝规则来防止 agent 访问特定文件（如 `.env` 文件）。

**验收场景**：

1. **假设** `permissions.deny` 包含 `["Read(**/.env)"]`，**当** agent 尝试读取任何目录中名为 `.env` 的文件时，**则**系统必须拒绝请求。

### 用户故事：内置安全命令与只读命令自动放行（优先级：P2）

作为用户，我希望常见的只读命令（如 `cat`、`sed`、`grep`、`awk`、`jq`、`find`）默认自动允许执行而无需逐次确认，以便代理在探查代码库时不被频繁打断；但能改写文件系统或执行任意命令的变体（如 `sed -i`、`find -delete`、写重定向、进程替换）仍须提示确认。只读命令（含 `cd`、`ls`、`cat`、`grep` 等）访问安全区域（工作目录 + 附加目录）之外的路径时须提示确认（对齐 Claude Code 的路径范围检查）；路径在安全区域内、或命令不访问任何文件系统路径时自动允许。命令替换（`$( )`/反引号）与 shell 控制结构（`for`/`if`/`while`/`case` 等）包裹的命令，其嵌套命令按「复合命令与命令替换的结构感知判定」用户故事独立判定，不因外层语法而整体禁止。

**验收场景**：

1. **假设** CWD 是 `/home/user/project`，**当**用户执行 `cd src` 时，**则**系统应该自动允许。
2. **假设** CWD 是 `/home/user/project`，**当**用户执行 `cd /etc` 时，**则**系统不得自动允许。
3. **假设**任何目录，**当**用户执行 `find . -name "*.ts"` 时，**则**系统应该自动允许。
4. **假设**任何目录，**当**用户执行 `find . -delete` 时，**则**系统不得自动允许，必须提示权限确认。
5. **假设**任何文件，**当**用户执行 `sed -n '19631,19900p' file.d.ts` 时，**则**系统应该自动允许（输出到 stdout，不修改文件）。
6. **假设**任何文件，**当**用户执行 `sed -i 's/old/new/' file.txt` 时，**则**系统不得自动允许（原地编辑即写操作），必须提示权限确认。
7. **假设**任何文件，**当**用户执行 `awk '{print $1}' file` 或 `jq '.x' file.json` 时，**则**系统应该自动允许。
8. **假设**任何命令，**当**用户执行 `cat $(rm important)` 或 `grep x \`whoami\``时，**则**系统不得自动允许（命令替换内嵌套`rm`/`whoami`非只读命令，须独立判定后提示确认；进程替换`<(...)`/`>(...)` 一律不得自动允许），必须提示权限确认。
9. **假设**链式命令 `sed -n '1,10p' a.txt | grep foo`，**当** 执行时，**则** 系统应该自动允许（每段均为只读）。
10. **假设**任何 git 仓库，**当**用户执行 `git -C /path/to/repo status`、`git -C /path/to/repo diff --stat` 或 `git -C /path/to/repo log --oneline` 时，**则** 系统应该自动允许（`git` 的全局作用域选项如 `-C <path>`、`-c <key>=<value>`、`--git-dir <path>` 只改变目标仓库或配置，不改变子命令的只读属性；匹配 `Bash(git status*)` 等规则时忽略这些前缀）。
11. **假设**任何目录，**当**用户执行 `git -C /path/to/repo commit -m "msg"`、`git -C /path/to/repo push` 或 `git -C /path/to/repo branch -D feature` 时，**则** 系统不得自动允许，必须提示权限确认。
12. **假设** CWD 是 `/home/user/project`，**当**用户执行 `ls src` 时，**则**系统应该自动允许（相对路径解析后在工作目录内）。
13. **假设** CWD 是 `/home/user/project`，**当**用户执行 `ls /etc` 时，**则**系统不得自动允许，必须提示权限确认（只读命令访问工作目录外路径）。
14. **假设** CWD 是 `/home/user/project`，**当**用户执行 `cat /etc/passwd` 或 `grep root /etc/passwd` 时，**则**系统不得自动允许，必须提示权限确认（只读命令访问工作目录外路径，与 `ls` 一致）。
15. **假设** CWD 是 `/home/user/project`，**当**用户执行 `cat ../secret.txt` 时，**则**系统不得自动允许（`..` 解析到真实路径后在工作目录外）。
16. **假设** `permissions.additionalDirectories` 包含 `/data/exports`，**当**用户执行 `ls /data/exports` 时，**则**系统应该自动允许（路径在附加目录内，属于安全区域）。
17. **假设** CWD 是 `/home/user/project`，**当**用户执行 `pwd` 或 `echo hello` 时，**则**系统应该自动允许（不访问文件系统路径，无路径范围可检查）。

### 用户故事：复合命令与命令替换的结构感知判定（优先级：P1）

作为用户，我希望以循环（`for`/`while`/`until`）、分支（`if`/`case`）等 shell 控制结构包裹的、或通过命令替换（`$( )`/反引号）嵌套的**只读**命令，与直接执行的同一条只读命令一样被自动允许，以便 Explore/Plan 等只读代理批量探查代码时不因外层 shell 语法而被逐次打断；同时，被包裹/嵌套的任何破坏性命令仍须像直接执行时一样提示确认，不因藏在循环体或命令替换里而获得放行。

**验收场景**：

1. **假设** CWD 是 `/home/user/project` 且目录下存在 `a.txt`/`b.txt`，**当**用户执行 `for f in a.txt b.txt; do head -5 "$f"; done` 时，**则**系统应该自动允许（循环体内仅 `head`，只读且在安全区域内；控制结构关键字 `for`/`do`/`done` 不作为命令参与判定）。
2. **假设** CWD 是 `/home/user/project`，**当**用户执行 `for f in "$@"; do sed -n '1,10p' "$f"; done`、`while read -r line; do echo "$line"; done < input.txt`、`case "$x" in foo) grep foo docs/;; esac` 或 `if grep -q pattern docs/specs/; then echo found; fi` 时，**则**系统应该自动允许（`while`/`if`/`case` 的控制结构关键字同样不参与判定，体内每条命令只读即放行）。
3. **假设**任何目录，**当**用户执行 `for f in $(ls docs/); do echo "== $f =="; head -3 "docs/$f"; done` 时，**则**系统应该自动允许（`$(ls docs/)` 中嵌套的 `ls` 只读；`echo`/`head` 只读）。
4. **假设**任何目录，**当**用户执行 `count=$(grep -c error log.txt | tr -d ' ')` 后在同一命令内以 `echo "count=$count"` 引用该变量时，**则**系统应该自动允许（`$( )` 内 `grep`/`tr` 与后续 `echo` 均只读；赋值语句只记录变量来源，不作为命令判定）。
5. **假设**任何目录，**当**用户执行 `for f in a.txt b.txt; do rm "$f"; done` 或 `if true; then git push; fi` 时，**则**系统不得自动允许，必须提示权限确认（循环/分支体内嵌套 `rm`/`git push` 等破坏性或非只读命令，与直接执行同样判定）。
6. **假设**任何目录，**当**用户执行 `head -5 $(rm -f a.txt)` 或 `echo $(git commit -m x)` 时，**则**系统不得自动允许，必须提示权限确认（命令替换内嵌套破坏性/非只读命令，须独立判定后提示）。
7. **假设**任何目录，**当**用户执行 `cat <(echo hi)`、`diff <(sort a) <(sort b)` 或 `while read x; do echo "$x"; done >(tee out)` 时，**则**系统不得自动允许（进程替换 `<(...)`/`>(...)` 语义无法静态还原，一律须提示确认）。
8. **假设**任何目录，**当**用户执行 `for f in $(cat /etc/passwd); do echo "$f"; done` 时，**则**系统不得自动允许（`$(cat /etc/passwd)` 内 `cat` 访问安全区域外路径，路径越界规则逐命令生效）。
9. **假设**任何目录，**当**用户执行包含无法解析的语法（解析失败/超时）、或含算术展开 `$((...))`、brace 展开 `{a,b}`、`eval`、`trap` 等无法静态还原结构的命令时，**则**系统不得自动允许，必须提示确认（无法确认即不自动放行，fail-closed）。
10. **假设**任何目录，**当**用户执行 `for i in -rf /; do rm $i; done` 或循环体内以裸 `$i`/`$f`（未加引号）引用循环变量时，**则**系统不得自动允许（循环变量/命令替换捕获值在裸参数位可能被拆分或通配展开为额外参数，其值无法静态确定，相关部分不做自动放行）。
11. **假设** `permissions.allow` 包含 `Bash(node scripts*)`，**当**用户执行 `for f in $(ls scripts); do node "scripts/$f" --dry-run; done` 时，**则**系统应该自动允许（规则匹配与只读判定同样以展开后的每条叶命令为对象，`$(ls scripts)` 内 `ls` 只读自动放行、`node scripts/* --dry-run` 命中 allow 规则）。
12. **假设**任何目录，**当**用户执行 `cd /etc && for f in $(ls); do echo "$f"; done` 时，**则**系统不得自动允许（`cd /etc` 超出安全区域，既有 cd 路径规则不因外层为循环结构而改变）。

### 用户故事：MCP 工具权限（优先级：P1）

作为用户，我希望 MCP 工具受到与内置受限工具相同的权限检查，这样我就可以控制 agent 可以执行哪些外部工具。

**验收场景**：

1. **假设**调用了 MCP 工具（以 `mcp__` 为前缀），**当**没有匹配的权限规则时，**则**系统必须提示确认。
2. **假设**显示了 MCP 工具的确认提示，**当**用户选择"是，不再询问"时，**则**系统必须以 `mcp__server__tool` 格式保存持久规则。
3. **假设**存在持久规则 `mcp__server__tool`，**当** agent 调用该特定 MCP 工具时，**则**它必须立即执行而不提示。
4. **假设** `REPL` 脚本内嵌套调用某个 `mcp__` 工具（见 `docs/specs/core/repl-tool.md`），**当**没有匹配的权限规则时，**则**必须弹出与直接调用时相同的确认——规则匹配的对象是被调用的叶子工具全名，外层是 `REPL` 不改变内层工具的身份，也不构成豁免。
5. **假设**存在针对某叶子工具全名的拒绝规则，**当** `REPL` 脚本内嵌套调用该工具时，**则**该次调用必须被拒绝，且拒绝理由作为该次调用的错误回到脚本。

### 用户故事：编程式和会话特定权限（优先级：P1）

作为使用 SDK 的开发者或 CLI 上的用户，我希望提供仅应用于当前 agent 实例或会话的临时权限规则（包括允许和禁止）。这允许在不修改全局设置的情况下进行细粒度的安全控制。

**验收场景**：

1. **假设**通过 SDK 创建的 Agent 配置了 `disallowedTools: ["Bash(rm *)"]`，**当** AI 尝试运行 `rm -rf /` 时，**则**操作被拒绝，即使 `Bash` 在其他情况下被允许。
2. **假设** CLI 启动时带有 `--allowedTools "Bash(git status)"`，**当** agent 运行 `git status` 时，**则**仅在该会话中自动批准。
3. **假设** agent 配置了 `tools: ["Bash"]`（过滤）和 `disallowedTools: ["Bash(rm *)"]`（权限），**当** AI 尝试 `ls` 时，**则**被允许；**当**尝试 `rm` 时，**则**被拒绝。

### 用户故事：配置权限模式（优先级：P1）

一个经常需要为开发工作流绕过权限的开发者希望避免每次都输入 `--dangerously-skip-permissions`。他们希望设置持久化配置，使绕过权限成为其项目的默认行为。settings 的配置键为 `permissions.defaultMode`（与 Claude Code 的 settings schema 键名对齐；运行时权限上下文与 CLI `--permission-mode` 仍沿用 permission mode 命名）。

**验收场景**：

1. **假设**项目没有 `defaultMode` 设置，**当**用户运行 agent 命令时，**则**应用默认权限模式行为（受限工具需要确认）。
2. **假设** `settings.json` 包含 `"permissions": {"defaultMode": "bypassPermissions"}`，**当**用户运行 agent 命令时，**则**权限被绕过而不提示。
3. **假设** `settings.json` 包含 `"permissions": {"defaultMode": "default"}`，**当**用户运行 agent 命令时，**则**用户对受限工具被提示确认。
4. **假设** `settings.json` 包含无效的 `defaultMode` 值，**当** agent 启动时，**则**系统回退到默认权限行为并记录警告。
5. **假设**存量配置（改名前的 `settings.json`）仍使用旧键 `permissions.permissionMode`，**当** agent 启动时，**则**该键不再被识别（忽略），有效权限模式回落到默认 `default`（受限工具需确认）；存量文件须一次性迁移为 `permissions.defaultMode`（彻底改名，不做兼容读取）。

### 用户故事：从提示自动接受文件编辑（优先级：P1）

作为用户，当我被提示确认文件编辑或目录创建时，我希望能够选择自动接受当前会话中所有未来的编辑，这样我就不必逐个确认。

**验收场景**：

1. **假设** agent 处于 `default` 模式，**当** agent 尝试 `Write` 或 `mkdir` 操作时，**则**确认提示显示一个选项："是，并自动接受编辑"。
2. **假设**显示了 `Write` 或 `mkdir` 操作的确认提示，**当**用户选择"是，并自动接受编辑"时，**则**当前操作被执行，agent 的权限模式设置为 `acceptEdits`。
3. **假设** agent 的权限模式通过提示被设置为 `acceptEdits`，**当** agent 尝试后续的 `Edit` 或 `mkdir` 操作时，**则**它被执行而不提示。

### 用户故事：持久化 Bash 命令权限（优先级：P1）

作为用户，当我被提示确认 Bash 命令时，我希望能够允许该特定命令在当前项目中无需再次询问即可运行，以便我可以安全地自动化重复任务。

**验收场景**：

1. **假设** agent 处于 `default` 模式，**当** agent 尝试命令为 `ls` 的 `Bash` 操作时，**则**确认提示显示一个选项："是，并在此工作目录中不再为此命令询问"。
2. **假设**显示了 `Bash` 命令 `ls` 的确认提示，**当**用户选择"是，不再询问..."时，**则**命令被执行，`Bash(ls)` 被添加到 `.wave/settings.local.json` 的 `permissions.allow` 数组中。
3. **假设** `Bash(ls)` 在本地项目设置的 `permissions.allow` 数组中，**当** agent 尝试命令为 `ls` 的 `Bash` 操作时，**则**它被执行而不提示。

### 用户故事：第二个 shell 工具（PowerShell）的权限与持久化（优先级：P1）

作为没有 Git Bash 的 Windows 用户，我希望 PowerShell 命令经过与 `Bash` 同等强度的判定——只读的自动放行、破坏性的必须确认、危险形态直接拒绝——而不是因为换了执行器就少一道闸；同时「不再询问」落下的规则必须能在下次真的命中。

**优先级原因**：PowerShell 是第二个 shell 工具，不是 bash 的别名：它有对象管道、脚本块、别名与参数缩写，bash 的结构感知判定套不上去（解析器都不同）。判定若不独立实现，就会出现两种坏结果——把 `Invoke-Expression` 当普通命令放行，或者把只读的 `Get-ChildItem` 每次都拦。持久化规则也必须按工具命名空间隔离，否则一条 `Bash(...)` 规则会悄悄授权 PowerShell 里语义不同的命令。

**独立测试**：在 PowerShell 会话里依次执行 `Get-ChildItem`、`Get-Content C:\Windows\win.ini`、`Set-Content note.txt x`、`Invoke-Expression $cmd`、`powershell -EncodedCommand <base64>`、`Remove-Item -Recurse -Force C:\`，核对依次为「不问直接放行」「询问」「询问且不给不再询问」「询问但保留不再询问」「直接拒绝」「直接拒绝」；再对复合命令选择「不再询问」，核对落盘的是每段一条 `PowerShell(...)` 规则且重跑不再询问。

**验收场景**：

1. **假设** 规则写成 `PowerShell(...)`，**当** 判定 PowerShell 命令时，**则** 必须以 `PowerShell` 为命名空间匹配，`Bash(...)` 规则一律不匹配（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:75-87`）；反之 bash 上下文也不读 `PowerShell(...)` 规则（`packages/agent-sdk/src/managers/permissionManager.ts:1557`、`:1587-1600`）。
2. **假设** 存在 deny 规则，**当** 判定开始时，**则** 必须先对原始命令文本跑 deny，再进入解析——解析器读不懂的命令也不能绕过 deny（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:192-203`）。
3. **假设** 命令无法被解析（语法错、解析超时、没有 PowerShell），**当** 判定时，**则** 永不得自动放行，只能按语句边界再跑一遍 deny 后询问，并隐藏「不再询问」选项（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:205-224`）。
4. **假设** 所有叶子命令都是只读 cmdlet（如 `Get-ChildItem`、`Get-Content`、`Select-Object`、`Test-Path`，共 42 项白名单）、参数里没有脚本块/子表达式、抽出的每个路径都在安全区域内、且没有文件重定向，**当** 判定时，**则** 必须不问直接放行；任一条件不满足都不得自动放行（`packages/agent-sdk/src/tools/powershellTool/readOnly.ts:31-79`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:157-173`、`:287-294`）。
5. **假设** 只读 cmdlet 的参数是安全区域之外的路径（如 `Get-Content C:\Windows\win.ini`），**当** 判定时，**则** 必须询问——只读不等于可越界（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:165-172`、`packages/agent-sdk/src/managers/permissionManager.ts:661-715`）。
6. **假设** 命令使用 `-EncodedCommand`（含 `-enc` 等缩写）或同一条语句里「下载并执行」，**当** 判定时，**则** 必须直接拒绝且不给「不再询问」（`packages/agent-sdk/src/tools/powershellTool/security.ts:114-162`）。
7. **假设** 命令使用脚本块或动态执行（`Invoke-Expression`、`Invoke-Command`、`Start-Job`、`Register-*Event`、`New-Object -ComObject` 等），**当** 判定时，**则** 必须询问但**保留**「不再询问」——落盘的是这条精确命令（`packages/agent-sdk/src/tools/powershellTool/security.ts:164-203`）。
8. **假设** 破坏性 cmdlet 的目标是文件系统根、用户主目录或其等价写法（`~`、`$HOME`、`%USERPROFILE%`）、或 `Windows`/`System32`/`Program Files` 这类系统目录本身，**当** 判定时，**则** 必须直接拒绝，规则不可覆盖；系统目录**之下**的普通路径仍走询问（`packages/agent-sdk/src/tools/powershellTool/pathValidation.ts:27-61`、`:92-120`）。
9. **假设** 存在 allow 规则，**当** 判定复合命令时，**则** 必须要求每个叶子都被覆盖才放行——一条规则不能带走第二条命令（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:268-283`）。
10. **假设** 命令进入询问，**当** 提示是否给出建议前缀时，**则** 只有单叶子命令才给；多叶子命令一律不给前缀，但仍可写整条命令的精确规则（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:299-304`）。
11. **假设** 用户选择「不再询问」，**当** 落盘规则时，**则** 必须按叶子拆分：每个 `CommandAst` 叶子各一条 `PowerShell(<leaf.text>)`；命令不可解析时一条都不写（`packages/agent-sdk/src/managers/permissionManager.ts:1941-1963`、`:1979-1987`）。
12. **假设** 危险 cmdlet 出现在命令里，**当** 生成建议时，**则** 只有两档抑制、且必须区分：命中通配前缀黑名单（`Invoke-Expression`、`Start-Process`、`ForEach-Object` 等）只是不给 `*` 前缀，「不再询问」照常可用；命中破坏性黑名单（`Remove-Item`、`Set-Content`、`Out-File` 等，含别名）才连「不再询问」一并隐藏；含文件写重定向的命令同样隐藏（`packages/agent-sdk/src/utils/powershellStructure/dangerousCmdlets.ts:257-261`、`:278-279`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:331-339`）。
13. **假设** 权限模式为 `dontAsk` 且没有匹配的 allow 规则，**当** 判定结果为询问时，**则** 必须按拒绝处理，用户不会被提示（`packages/agent-sdk/src/managers/permissionManager.ts:1223-1286`）。

### 用户故事：安全区域内的自动文件编辑（优先级：P1）

作为用户，我希望 agent 在我的项目目录或明确允许的目录内自动应用文件编辑，而无需每次都征求我的许可，这样当我信任 agent 的更改时可以提高工作效率。

**验收场景**：

1. **假设** agent 处于 `acceptEdits` 模式且文件在安全区域内（CWD 或 `additionalDirectories`），**当** agent 尝试使用 `Edit`、`Delete` 或 `Write` 工具时，**则**操作立即执行，无需权限提示。
2. **假设** agent 处于 `acceptEdits` 模式且目录在安全区域内，**当** agent 尝试通过 `Bash` 工具使用 `mkdir` 时，**则**操作立即执行，无需权限提示。
3. **假设** 自动记忆已开启，**则** 记忆目录与用户记忆文件按安全区域放行读写，但**不构成 shell 可停留的目录**：`Bash` 把当前目录 `cd` 到记忆目录时必须复位回会话原工作目录（见 [bash-tools.md](bash-tools.md)「执行前台命令」场景 5）——它们是为免权限提示而发的内部白名单，不是用户声明的附加目录。

### 用户故事：越界安全确认（优先级：P1）

作为用户，我希望系统在修改项目或允许目录之外的任何文件之前征求我的明确许可，即使我已启用自动接受模式，以便我可以防止对我的系统进行意外或恶意更改。

**验收场景**：

1. **假设**文件位于安全区域之外，**当**系统尝试写入或编辑该文件时，**则**向用户显示确认提示，无论 `acceptEdits` 设置如何。
2. **假设**系统处于 `acceptEdits` 模式，**当**尝试越界文件操作时，**则**系统仍必须显示确认提示，而不是自动执行。

### 用户故事：附加工作目录（优先级：P1）

作为用户，我希望将工作目录之外的其他目录加入 agent 的安全区域，使这些目录中的文件操作在 `acceptEdits` 模式下自动放行、并让 agent 在系统提示词中感知这些目录的存在，从而允许 agent 安全地访问我指定的外部目录而无需反复确认。

**验收场景**：

1. **假设** `settings.json` 的 `permissions.additionalDirectories` 包含 `/data/exports`，**当** agent 启动时，**则** `/data/exports` 属于安全区域，且主 agent 系统提示词的 `# Environment` 段包含 `Additional working directories:` 及其下的目录列表。
2. **假设** 主 agent 系统提示词已列出附加目录，**当** agent 处于 `acceptEdits` 模式并尝试 `Edit`、`Delete` 或 `Write` 附加目录内的文件时，**则** 操作立即执行，无需权限提示。
3. **假设** 目录不在安全区域内，**当** agent 尝试修改该目录内的文件时，**则** 即使处于 `acceptEdits` 模式仍显示确认提示（与"越界安全确认"一致）。
4. **假设** 用户以 `wave --add-dir /data/exports` 启动 CLI，**当** agent 运行时，**则** `/data/exports` 仅在当前会话内属于安全区域并在提示词中列出，会话结束后不写入任何配置文件。
5. **假设** CLI 会话进行中，**当** 用户输入 `/add-dir /data/exports` 时，**则** `/data/exports` 在当前会话立即加入安全区域，系统提示词在下一次构建时包含该目录。
6. **假设** 用户输入 `/add-dir --remember /data/exports`，**当** 命令执行后，**则** `/data/exports` 除当前会话生效外，还被追加到 `.wave/settings.local.json` 的 `permissions.additionalDirectories`，后续会话自动加载。
7. **假设** 用户输入无参数的 `/add-dir`，**当** 命令执行时，**则** 显示用法说明及当前会话的附加目录列表。
8. **假设** agent 派生子 agent，**当** 子 agent 的系统提示词构建时，**则** `<env>` 中包含单行 `Additional working directories: /data/exports`（附加目录并集），且子 agent 的权限检查同样将附加目录视为安全区域。
9. **假设** `permissions.additionalDirectories` 的某项路径以 `~` 或 `~/` 开头（如 `~/github`），**当** 该路径被解析进安全区域时，**则** 按当前用户主目录展开为绝对路径（`~/github` → `<主目录>/github`，对齐 Claude Code），安全区域判定与系统提示词均使用展开后的路径；配置文件中保留 `~` 写法，不暴露本机用户名。
10. **假设** agent 处于确认流程且 `Write`/`Edit` 的目标文件位于安全区域之外，**当** 确认弹窗展示时（三端 GUI 或交互式 CLI），**则** 弹窗在"批准并继续"之外额外提供"允许本会话编辑 `<目录名>/`"选项（`<目录名>` 为目标文件所在目录的末级目录名）——GUI 文案为"是，且允许本会话编辑 `<目录名>/`"，CLI 文案为 `Yes, and allow all edits in <目录名>/ this session`；该选项仅在目标文件越界时出现。
11. **假设** 用户在越界确认弹窗中选择"是，且允许本会话编辑 `<目录名>/`"，**当** 操作执行后，**则** 目标文件所在目录立即加入当前会话的安全区域（仅内存，不写入任何配置文件），本会话内该目录下的后续 `Edit`/`Write` 不再触发确认，且主 agent 系统提示词在下一次构建时列出该目录。
12. **假设** 用户在越界确认弹窗中选择"批准并继续"，**当** 操作执行后，**则** 仅本次操作放行，该目录不加入安全区域，后续对该目录内文件的编辑仍显示确认弹窗。
13. **假设** `Write`/`Edit` 的目标文件位于安全区域内（例如 `default` 模式下安全区内文件的首次写入），**当** 确认弹窗展示时，**则** 不出现"是，且允许本会话编辑"选项。

### 用户故事：CLI 模式切换（优先级：P2）

作为 CLI 用户，我希望在会话期间使用键盘快捷键快速切换权限模式，以便我可以轻松地在手动控制、自动编辑、规划和绕过之间切换。

**验收场景**：

1. **假设** CLI 会话处于活动状态且为 `default` 模式，**当**用户按下 `Shift+Tab` 时，**则**权限模式更改为 `acceptEdits`。
2. **假设** CLI 处于 `acceptEdits` 模式，**当**用户按下 `Shift+Tab` 时，**则**权限模式更改为 `plan`。
3. **假设** CLI 处于 `plan` 模式，**当**用户按下 `Shift+Tab` 时，**则**权限模式更改为 `bypassPermissions`。
4. **假设** CLI 处于 `bypassPermissions` 模式，**当**用户按下 `Shift+Tab` 时，**则**权限模式更改回 `default`。

### 用户故事：GUI 端权限模式菜单快捷键（优先级：P2）

作为 GUI 用户（VS Code 插件 / JetBrains 插件 / 桌面端，共享 webview），我希望按 `Cmd+Shift+M`（macOS）/ `Ctrl+Shift+M`（Windows/Linux）打开权限模式菜单并从中选择模式，以便无需点击输入框左下角的模式按钮、也不必循环多个模式即可直接切换（对齐 Claude Code 桌面端的 `Cmd+Shift+M` 打开权限模式菜单）。

**为什么是这个优先级**：与 CLI 的 Shift+Tab 循环并列的 GUI 快捷入口；CLI 端保持 Shift+Tab 循环不变，GUI 端不再用 Shift+Tab 循环权限模式（该键恢复默认焦点移动行为）。

**验收场景**：

1. **假设** GUI webview 输入框聚焦且当前为 `default` 模式，**当**用户按下 `Cmd+Shift+M`（macOS）/ `Ctrl+Shift+M`（Windows/Linux）时，**则**打开权限模式菜单（输入框左下角下拉），展示 `default` / `acceptEdits` / `plan` / `bypassPermissions` 四个选项（与 CLI Shift+Tab 循环顺序一致），而非直接切换模式。
2. **假设**权限模式菜单已通过快捷键打开，**当**用户从菜单中选择某个模式（如 `acceptEdits`）时，**则**权限模式更改为该模式且菜单关闭，行为与点击模式按钮打开后选择完全一致。
3. **假设** GUI webview 输入框聚焦，**当**用户按下 `Shift+Tab` 时，**则**不再循环权限模式，按键落到浏览器默认行为（移动焦点）。
4. **假设**桌面端用户查看应用菜单栏，**则**「对话」菜单下存在「权限模式…」菜单项并显示对应快捷键，点击菜单项与按快捷键等效，均打开权限模式菜单。
5. **假设** JetBrains 插件 webview 聚焦（IDE 的 `Cmd/Ctrl+Shift+M` 默认绑定为"移动到匹配括号"），**当**用户按下快捷键时，**则**打开权限模式菜单且 IDE 动作不触发（组件级拦截转发到 webview）。
6. **假设** VS Code 中 webview 聚焦（VS Code 的 `Cmd/Ctrl+Shift+M` 默认绑定为"聚焦问题面板"），**当**用户按下快捷键时，**则**打开权限模式菜单且问题面板不弹出。
7. **假设**权限模式菜单展开（无论从按钮点开、快捷键打开，还是远控页手机上点开），**则**每个选项都是「图标 + 档位名」一行，**图标与文案落在同一条水平线上**（居中对齐，不按文字基线排），两者之间留出间距，不得出现图标浮在文字上方、字形贴着文字的样子。四端（桌面端 / VS Code / JetBrains / 远控页）同一套排布，差异只在字号与图标尺寸的密度档；文字档与图标档出的都是这一个菜单，形状一致。

### 用户故事：自动拒绝未批准的工具（优先级：P1）

作为用户，我希望当我处于 `dontAsk` 模式时，未经预批准的工具被自动拒绝，这样我就不会被未明确允许的工具的权限请求打断。

**验收场景**：

1. **假设**权限模式设置为 `dontAsk` 且 `Bash` 不在 `permissions.allow` 中，**当** agent 调用 `Bash` 时，**则**工具调用被立即拒绝，agent 收到"权限拒绝"错误，用户不会被提示。

### 用户故事：配置 dontAsk 模式（优先级：P2）

作为用户，我希望能够将权限模式设置为 `dontAsk`，以便我可以跨会话强制执行此行为。

**验收场景**：

1. **假设**配置文件中有 `defaultMode: "dontAsk"`，**当** agent 启动时，**则**有效权限模式为 `dontAsk`。

### ~~用户故事：Bash Heredoc 写入重定向到专用工具（优先级：P1）~~

_已移除。基于 Heredoc 的 bash 命令不再被自动拒绝。用户应依赖工具权限规则和软提示引导来鼓励使用专用的 Write/Edit 工具。_

## 关键实体

- **权限模式**：确定所需用户干预级别的配置。settings 中由 `permissions.defaultMode` 配置（对齐 Claude Code settings schema 键名），运行时权限上下文（`PermissionContext.permissionMode`）与 CLI `--permission-mode` 沿用 permission mode 命名。
- **权限规则**：定义允许、必须询问或拒绝操作的字符串（如 `Bash(git *)`、`Read(**/*.env)`），分三档 `permissions.allow` / `permissions.ask` / `permissions.deny`。判定优先级为 **deny > ask > allow > 权限模式**：`ask` 命中即必须问人，`bypassPermissions` / `acceptEdits` 与 `allow` 规则都不得把它降级。
- **简单命令**：从管道中提取的带参数的单个可执行命令。
- **智能通配符**：用 `*` 替换动态参数的启发式生成模式。
- **两档危险命令集合（shell 工具共用同一套语义）**：`NO_PREFIX_SUGGEST` 只抑制通配**前缀**（建议值退化为这条精确命令，「不再询问」仍可点）；`BLOCK_PERSIST` 是其子集，额外抑制**整个「不再询问」选项**（判据是破坏性且不可逆）。两套集合都做别名展开。Bash 侧由 `DANGEROUS_COMMANDS` 等黑名单承担同一角色，PowerShell 侧见 `packages/agent-sdk/src/utils/powershellStructure/dangerousCmdlets.ts:257-261`、`:278-279`。
- **PermissionDecision**：权限检查的结果，扩展为包含可选的 `newPermissionMode`、`newPermissionRule` 与 `newAdditionalDirectory`（会话级地把指定目录加入安全区域）以通知系统更新其状态。`newAdditionalDirectory` 同时登记该目录下 `Edit`/`Write` 的会话级允许规则，使"允许本会话编辑"的承诺对后续编辑同样成立（`default` 模式本就对每次 `Edit`/`Write` 要求确认，仅加入安全区域不足以免除后续确认）。
- **安全区域**：允许 agent 执行文件操作而无需每次操作都经用户明确确认的文件系统路径集合。
- **附加目录**：用户可配置的路径列表，将安全区域扩展到默认工作目录之外。可通过 `settings.json` 的 `permissions.additionalDirectories`、CLI 的 `--add-dir` 启动选项、`/add-dir` 斜杠命令（会话级）或越界确认弹窗的"允许本会话编辑 `<目录名>/`"选项（会话级）加入；其中 `--add-dir` 与 `/add-dir` 为 CLI 专属入口，弹窗选项为三端 GUI 与交互式 CLI 共有（两者都不写配置文件）。路径支持相对路径（相对工作目录解析）与 `~`/`~/` 前缀（按用户主目录展开）。
- **删除自身工作区域的硬闸**：作用于 shell 工具（Bash 的 `rm`/`rmdir`、PowerShell 的破坏性 cmdlet）。保护根 = 会话工作目录 ∪ 附加目录；目标是保护根本身或它的祖先即命中。判据是纯路径算术 + realpath，不识别「仓库」；变量/命令替换等无法静态确定的目标按命中处理。Bash 侧落在 `permissions.ask` 同一档，且排在 `allow` 规则与 `acceptEdits` 之前（`packages/agent-sdk/src/managers/permissionManager.ts:1203`）；`bypassPermissions`（及 `plan` 下持有绕过授权的会话）也豁免不了它——CC 靠 `bypassImmune` 在这里保留询问，`waivableInBypass` 指的是一个默认不存在的显式逃生开关，本实现不提供。PowerShell 侧落在硬拒绝档。
- **绕过授权（会话级）**：会话创建时的有效权限模式为 `bypassPermissions` 时获得，用于在 `plan` 模式下替代绕过判定（见 `plan-mode.md`「计划模式继承会话的绕过授权」）。会话中途切换到 `bypassPermissions` 不会获得该授权；仅按用户配置自动放行的场景不受影响，常驻的 `default`/`acceptEdits`/`dontAsk` 会话行为不变。

## 边界情况

- **嵌套操作符**：如 `cmd1 && (cmd2 | cmd3)` 的管道必须递归分解。
- **结构感知解析失败**：shell 控制结构或命令替换无法被结构感知解析（语法不支持、解析超时、变量值无法静态确定等）时不得自动放行，一律回落至确认（fail-closed），防止以复杂语法绕过只读判定。
- **优先级**：拒绝规则 > 询问规则 > 允许规则；询问规则命中时，绕过模式与允许规则都不豁免它（唯一例外是整工具级 `ask` 与 `sandbox.autoAllowBashIfSandboxed` 同时成立时会被沙箱执行的命令）。
- **ask 规则先于工具内建的自动放宽**：工具自己的「这个会话已经确认过，不再问」这类放宽（如 Artifact 的同会话重复发布）排在规则判定之后——deny / ask 命中时按规则走，且 `ask` 命中时确认卡片不提供「不再询问」（对齐 Claude Code 的 `suppressAlwaysAllowRule`）。
- **绕过授权不豁免的检查**：穿透权限检查的判定（`bypassPermissions` 模式，或 `plan` 模式下持有绕过授权的会话）不豁免四类拦截：实例与配置的 deny 规则、`permissions.ask` 命中的工具、worktree 内对主仓库的越界写保护、以及需要用户交互的工具（`AskUserQuestion`、`ExitPlanMode`——后者即计划批准，离开计划模式始终是用户决定）。删除自身工作目录的硬闸**也在此列**：bypass 与 plan 持授权下同样弹卡（见「删除自身工作区域的硬闸」）。
- **敏感命令**：如 `rm` 等命令被列入智能通配符建议的黑名单，以防止意外的广泛权限。
- **PowerShell 的「解析失败」不是放行**：bash 用结构感知解析器，PowerShell 用自己的 AST 解析器（需 spawn 一次 `pwsh`/`powershell`，超时 5 秒、超时重试一次、结果进 256 项 LRU）；解析失败或没有 PowerShell 可用时一律回落到询问并隐藏「不再询问」，绝不自动放行（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:205-224`、`packages/agent-sdk/src/utils/powershellStructure/psParser.ts:35-50`）。
- **规则命名空间互不可见**：`Bash(...)` 与 `PowerShell(...)` 各自只被同名工具的判定读取，一次「不再询问」不会跨执行器生效（见 [powershell-tool.md](powershell-tool.md)「持久化规则按叶子拆分」）。
- **转义字符**：`echo "&&"` 必须被视为单个命令，不得拆分。
- **缺少 `.wave` 目录**：如果用户选择持久化 Bash 选项且 `.wave` 不存在，系统应该创建它。
- **格式错误的 `settings.json`**：如果设置文件格式错误，系统应该优雅地处理。
- **重复规则**：如果规则已存在，再次选择该选项不应创建重复项。
- **受限与不受限工具**：不受限工具（不在 `RESTRICTED_TOOLS` 中的工具）仍应被自动允许，即使在 `dontAsk` 模式下。
- **符号链接**：系统应该解析真实路径并对照安全区域检查，以防止通过符号链接绕过。
- **嵌套目录**：列出目录或其子目录内的任何文件都应被视为安全。
- **重复附加目录**：同一目录通过配置、`--add-dir`、`/add-dir` 与越界确认弹窗选项等多个入口重复加入时，系统提示词列表与 `--remember` 持久化均应去重，不产生重复项。
- **`REPL` 嵌套调用与规则匹配**：权限规则按**叶子 MCP 工具全名**（`mcp__server__tool`）匹配，不按外层 `REPL` 匹配；拒绝 `REPL` 只影响 `REPL` 自身是否声明与可调用，不得连带拒绝其池中的 MCP 工具（此时它们退回扁平声明，安全语义不变）。

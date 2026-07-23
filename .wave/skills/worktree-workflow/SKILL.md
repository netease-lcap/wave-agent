---
name: worktree-workflow
description: 管理 wave-agent 的 git worktree：创建 worktree、与 root 同步、退出 worktree。当用户提到 worktree、相互 rebase、对齐/合入分支、退出 worktree 时使用。
---

# Worktree 工作流 (wave-agent)

本项目用 `EnterWorktree` / `ExitWorktree` 工具 + 手动 `git rebase` 管理 worktree。
**基准仓库路径**：`/Users/liuyiqi/github/wave-agent`（root）。

## 铁律：先查事实，再说话

**永不凭记忆/推断叙述 git 分支关系。** 任何关于"哪个分支领先/落后/已合并"的判断，必须先跑命令读输出：

- `git merge-base --is-ancestor <A> <B>` → 退出码 0 表示 A 是 B 的祖先（B 已包含 A）
- `git rev-list --left-right --count <A>...<B>` → 左=A 独有，右=B 独有
- `git log --oneline <A>..<B>` → B 有而 A 没有的提交
- `git log --oneline <A>...<B>` → 三点对称差集（两边各自独有）
- `git worktree list` → 各 worktree 路径 + 检出的分支

rebase 会**重写 SHA**。回答"commit X 在不在分支 Y 里"必须用 `git merge-base --is-ancestor X Y`，绝不能凭 commit message 判断（rebase 副本 message 相同、SHA 不同）。

## 阶段一：创建 worktree

`EnterWorktree(name)` 只有一个可选 `name` 参数，**从基准仓库当前 HEAD 建分支**——这通常是 `main`/`origin/main`，**不是**用户说的"当前分支"（feature 分支）。所以创建后通常需要 `git reset --hard <feature>` 对齐。

### 三种常见意图

**a) "基于 <feature> 建 worktree" / "在 <feature> 基础上继续开发"**
```
EnterWorktree(name)            # 从 base HEAD 建，可能落后 feature
git reset --hard <feature>     # 对齐到 feature tip
```
之后新提交落在 `worktree-<name>` 上，与 root 检出隔离。

**b) "带未提交改动进 worktree"**（root 有 uncommitted changes）
```
# 在 root: git stash push -m "..." (-u 连 untracked)
# EnterWorktree(name)
# git reset --hard <feature>   # 先对齐到与 stash 相同的 feature tip
# git stash pop                # 应用，因 base 相同通常无冲突
```

**c) "从当前分支 tip 拉 worktree"**（已身处某个 worktree 检出，EnterWorktree 拒绝嵌套时）
```
git worktree add -b <new-branch> .wave/worktrees/<name> HEAD
# 不切换 session cwd，后续操作用绝对路径或 git -C <path>
```

### ⚠️ 在 worktree 里频繁提交

worktree 目录可能**会话中途消失**（shell 报 `spawn /bin/sh ENOENT` = cwd 被删）。**未提交的改动会永久丢失**。每个自包含改动完成后立即 commit；不要在 worktree 里积累数小时未提交工作。

## 阶段二：与 root 同步（相互 rebase，禁用 cherry-pick）

**本项目既定偏好：worktree↔feature 同步一律用相互 rebase，永不 cherry-pick**（cherry-pick 只在历史必须保留的共享分支才考虑，本项目分支均为本地未推送，故不用）。

两个方向都是 rebase，不产生 merge commit：

**方向 a — worktree 追上 feature**（在 worktree 内）：
```
git rebase <feature-branch>
```

**方向 b — feature 吸收 worktree 的提交**（在 root 仓库内，因 feature 在此检出）：
```
cd /Users/liuyiqi/github/wave-agent && git rebase worktree-<name>
# 当 feature 严格落后时这步是 fast-forward
```

### 选方向前先读 merge-base + 两侧 tip

- worktree 严格领先 feature → 跑方向 b（ff）
- worktree 落后 feature → 跑方向 a（worktree 追上）
- **两者已分叉**（各有独有提交）："合过去/sync to root" 的标准做法：
  1. 在 worktree `git rebase <feature>` —— 把 worktree 新提交 replay 到 feature tip，使 worktree 严格领先
  2. 验证 `git log --oneline worktree-<name>..<feature>` 为空（feature 严格落后 → 可 ff）
  3. 在 root `git merge --ff-only worktree-<name>` —— 无冲突 ff，两分支同 tip

### 注意

- **不能 rebase / checkout 另一个 worktree 正检出的分支** —— `fatal: ... already used by worktree at <path>`。对该分支的操作必须在拥有它的 worktree 目录里跑（或 `git -C <path> ...`）。
- 在 root 跑 `git rebase`/`git merge` 会把 session 的 shell cwd 重置回 base 仓库——之后用绝对路径或重新 `cd` 进 worktree。
- **root 有未提交 WIP 时要 ff 它** → 不能直接 ff（需干净树）。用 **stash → ff → pop**，且**先征求用户确认**（那是用户的在制工作，绝不擅自 discard）。

## 阶段三：退出 worktree

`ExitWorktree` 只管理**当前会话自己创建**的 worktree。会话外预存的 worktree（用户的既有设置）需手动清理，且**删除前先问**：

```
git worktree remove --force .wave/worktrees/<name>
git branch -D worktree-<name>     # 仅当已完全合并
```

### 退出前先确保提交已同步

若 worktree 有 feature 还没有的提交：**先跑阶段二方向 b 把它们 ff 进 feature**，再 exit。否则删 worktree 分支会丢这些提交。

### "N commits will be discarded" 警告可能只是共享历史

ExitWorktree 报"N 个提交将被丢弃"时别慌——worktree 从较早 HEAD 分出，其 tip 可能链过 feature 自己的提交。验证：

```
git log --oneline <feature>...worktree-<name>   # 三点对称差集
# 输出为空 = worktree 无独有提交，安全 discard
```

或对比两侧 tip SHA 完全一致（刚 ff 过）→ discard 对内容是空操作。确认后用 `discard_changes: true` 重新调用。

### keep vs remove

- `keep` — 保留 worktree 目录 + 分支（之后还要 rebase root onto 它时用）
- `remove` — 删目录 + 分支（清理时用）

### worktree 目录已消失时

若 `cd` 进 worktree 报 `No such file or directory`（目录被外部删除）：`ExitWorktree` 会失败，直接 `git worktree prune`（root 内）清理注册表即可。前提是先确认提交已进 feature 分支，删除才无害。

## 检查清单（每次 worktree 操作前过一遍）

1. 我**跑了** git 事实命令吗？还是凭记忆推断？（铁律）
2. worktree 有未提交/未同步的提交吗？→ 先提交 + 同步再删
3. 要操作的目标分支在哪个 worktree 检出？→ 用 `git worktree list` 确认，去拥有者目录操作
4. root 有未提交 WIP 吗？→ stash→ff→pop 并先确认，别 discard
5. "N commits to discard" 是共享历史吗？→ `...` 三点差集验证

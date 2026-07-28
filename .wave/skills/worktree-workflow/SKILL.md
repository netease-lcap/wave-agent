---
name: worktree-workflow
description: 管理 wave-agent 的 git worktree：创建 worktree、与 root 同步、退出 worktree。当用户提到 worktree、相互 rebase、对齐/合入分支、退出 worktree 时使用。
---

# Worktree 工作流 (wave-agent)

基准仓库（root）：`/Users/liuyiqi/github/wave-agent`。

## 铁律：先查事实，再说话

分支关系（谁领先/落后/已合并）必须先跑命令读输出，**永不凭记忆或 commit message 推断**：

- `git rev-list --left-right --count A...B` → 左=A 独有，右=B 独有
- `git merge-base --is-ancestor A B` → 退出码 0 = B 已包含 A（rebase 会重写 SHA，判断"commit X 在不在分支 Y"只能用它）
- `git worktree list` → 各分支在哪个 worktree 检出

## 创建

**`EnterWorktree(name)` 固定从 origin/main tip 建分支，与 root 当前检出的分支无关（实测，勿再推断）。** 要基于 feature 分支工作，进入后立即对齐——worktree 无独有提交时这步是快进：

```
git rebase <feature>
```

**勤提交**：worktree 目录可能会话中途消失（shell 报 `spawn /bin/sh ENOENT` = cwd 被删），未提交改动永久丢失。每个自包含改动完成后立即 commit。

已身处 worktree 时 EnterWorktree 拒绝嵌套，改用 `git worktree add -b <branch> .wave/worktrees/<name> HEAD`，不切换 session cwd，用 `git -C <path>` 操作。

## 同步：只用 rebase，禁 cherry-pick

本项目分支均本地未推送，两个方向都是 rebase，不产生 merge commit：

- worktree 追 feature：worktree 内 `git rebase <feature>`
- feature 收 worktree：root 内 `git rebase worktree-<name>`（feature 严格落后时即 fast-forward；用 `git -C <root>` 避免 session cwd 被重置）
- 已分叉（各有独有提交）：先在 worktree `git rebase <feature>` 使其严格领先，再在 root `git merge --ff-only worktree-<name>`

注意：

- **不能 rebase/checkout 别的 worktree 正检出的分支**（`already used by worktree`），去拥有者目录操作。
- root 有未提交 WIP 又要 ff → stash → ff → pop，**先问用户**，绝不擅自 discard。

## 退出

- 退出前先把 worktree 独有提交同步进 feature（上文方向 b），否则删分支会丢提交。
- ExitWorktree 报"N commits to discard"时，先验证是否只是共享历史：`git log --oneline <feature>...worktree-<name>` 为空 = 无独有提交，可 `discard_changes: true` 重调。
- worktree 目录已被外部删除 → root 内 `git worktree prune` 清理注册表（先确认提交已同步）。
- 会话外预存的 worktree/分支，删除前先问用户。

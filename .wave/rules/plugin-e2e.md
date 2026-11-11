---
paths:
  - "packages/vscode/tests-e2e/**/*"
  - "packages/vscode/scripts/run*E2E.mjs"
  - "packages/jetbrains/src/integrationTest/**/*"
  - "packages/jetbrains/build.gradle.kts"
---

# 插件端真机套件

- 跑或改这两套真编辑器 e2e 之前，先读 `.wave/skills/real-machine-testing/references/plugin-hosts.md`：跑法、显示服务、「套件没起来 ≠ 代码有缺陷」的判红口径都在那里。
- 两条最容易踩空的前置：JetBrains 在 Linux 上必须自起免鉴权 X（`Xvfb :<n> -ac` 再 `DISPLAY=:<n> pnpm jb:test:ui`），用 `xvfb-run` 会让 IDE 以 `Can't connect to X11 window server` exit 3；VS Code 版本要满足 `engines.vscode`，否则扩展被静默拒载（表现是 spec 报 `extension … is not loaded`）。

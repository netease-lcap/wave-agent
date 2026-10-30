# CI 集成

把 Wave 跑进流水线：PR 提上来，job 装 CLI、执行一段提示词（例如 `/code-review`）、把结论写回 PR，并用退出码决定这个 check 是红还是绿。

整条链路上的三个部件都在这个页面上：认证（两个环境变量）、权限预设（无人值守时不卡在确认框）、结构化结果（`wave-result.json`）。

## 一、跑起来是什么样 {#overview}

GitHub 仓库加一个文件 `.github/workflows/review.yml`：

```yaml
name: Review

on:
  pull_request:

jobs:
  review:
    uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@main
    secrets: inherit
    permissions:
      contents: read
      pull-requests: write
    with:
      prompt: /code-review
```

`secrets: inherit` 要求仓库里已经有 `WAVE_API_KEY`（Settings → Secrets and variables → Actions）。

提一个 PR 后会发生三件事：

1. 内置的 `/code-review` 技能读本次改动，结论以 PR 评论的形式发出来；
2. job 的 Summary 里有一段「跑成什么样」的摘要，`wave-result.json` 作为 artifact 保留；
3. 运行失败时 job 变红（退出码 1），成功时变绿。

## 二、认证 {#auth}

CI 里不用登录态，三个环境变量就够：

| 变量            | 必填 | 说明                                                     |
| --------------- | ---- | -------------------------------------------------------- |
| `WAVE_API_KEY`  | 是   | 模型服务的 API Key                                       |
| `WAVE_MODEL`    | 是   | 模型名，如 `deepseek-flash`。**CI 里没有本地配置可继承** |
| `WAVE_BASE_URL` | 否   | 模型网关地址，留空则用 CLI 默认                          |

三个变量都会进入 SDK 的配置解析链，与本地 `~/.wave/settings.json` 里的同名键等价；少给 `WAVE_MODEL` 时 CLI 会直接报 `Agent configuration requires model`。

放哪里：`WAVE_API_KEY` 是密钥，放平台的 secret 机制（GitHub：Settings → Secrets and variables → **Actions → Secrets**）；`WAVE_MODEL` 与 `WAVE_BASE_URL` 不是密钥，放**仓库变量**（同页 **Variables**）更省事，团队里一眼能看到用的是哪个模型。两者都不要写进仓库文件——`wave-result.json` 与 job 日志里都不含它们。

## 三、权限预设 {#permissions}

CI 里没有人在旁边点「允许」，所以要用一套不需要交互就能跑完的权限组合。三个参数分工明确：

| 参数                        | 作用                                             | CI 里怎么给          |
| --------------------------- | ------------------------------------------------ | -------------------- |
| `--permission-mode dontAsk` | 未命中预批规则的受限工具**直接拒绝**，不等待输入 | 恒定用它             |
| `--tools`                   | 只注册列表里的工具，其它工具模型根本看不见       | 按任务收窄，见下表   |
| `--allowed-tools`           | 预批规则，如 `Bash(git status*)`                 | 只放开确实要跑的命令 |

三种常见任务的最小组合：

| 任务             | `--tools`             | `--allowed-tools`                               |
| ---------------- | --------------------- | ----------------------------------------------- |
| 只读审查         | `Read,Glob,Grep,Bash` | `Bash(git diff*),Bash(git log*)`                |
| 还要跑测试       | 上面 + 你的项目工具   | 上面 + `Bash(pnpm test*),Bash(pnpm -F * test*)` |
| 允许改文件并提交 | 上面 + `Edit,Write`   | 上面 + `Bash(git commit*),Bash(git push*)`      |

`dontAsk` 下被拒的工具不是报错退出：拒绝原因作为一次工具结果回到模型，模型会换路子继续完成任务。技能自己声明的 `allowed-tools`（`/code-review` 这类内置技能都带）在执行该技能时也会自动注册成临时规则，不必在 `allowed-tools` 里重复。

## 四、GitHub Actions {#github-actions}

### 4.1 用现成的可复用 workflow {#github-reusable}

`uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@<ref>`，`<ref>` 建议写 tag 或 commit，别跟 `main`。输入与输出：

| 输入              | 默认值                | 说明                                               |
| ----------------- | --------------------- | -------------------------------------------------- |
| `prompt`          | 必填                  | 传给 `wave -p` 的提示词，如 `/code-review`         |
| `wave-version`    | `latest`              | `wave-code` 版本；生产请 pin 具体版本              |
| `output-format`   | `json`                | `text` / `json` / `stream-json`                    |
| `permission-mode` | `dontAsk`             | 见上一节                                           |
| `tools`           | `Read,Glob,Grep,Bash` | 启用的工具，逗号分隔                               |
| `allowed-tools`   | 空                    | 预批规则，逗号分隔                                 |
| `base-url`        | 空                    | 模型网关地址；空则读调用方仓库变量 `WAVE_BASE_URL` |
| `model`           | 空                    | 模型名；空则读调用方仓库变量 `WAVE_MODEL`（必需）  |
| `timeout-minutes` | `20`                  | 整个 job 的超时；审查类提示词不建议小于 20         |

| 输出          | 说明                                 |
| ------------- | ------------------------------------ |
| `result`      | 最后一条助手消息的纯文本             |
| `subtype`     | `success` / `error_during_execution` |
| `is-error`    | `true` 表示这次运行失败              |
| `result-file` | 结果 JSON 在工作区里的路径           |

`model` / `base-url` 留空时会读**调用方仓库的 Variables**，所以绝大多数仓库只需要配一次 `WAVE_MODEL` 变量 + 一个 `WAVE_API_KEY` secret，调用方 `with:` 里只写 `prompt`。想写死也可以显式传 `with: { model: deepseek-flash }`。

用输出串联下游 job：

```yaml
jobs:
  review:
    uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@main
    secrets: inherit
    with:
      prompt: /code-review
  report:
    needs: review
    if: needs.review.outputs.is-error == 'false'
    runs-on: ubuntu-latest
    steps:
      - run: echo '${{ needs.review.outputs.result }}'
```

### 4.2 自己写一个 step {#github-step}

不想依赖本仓库的 workflow，就让 job 自己装 CLI：

```yaml
name: Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # 审查要算 merge-base，浅克隆会退化成 HEAD~1
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      # 生产环境把 latest 换成具体版本：上游发版即改变流水线行为
      - run: npm i -g wave-code@latest
      - name: Review
        env:
          WAVE_API_KEY: ${{ secrets.WAVE_API_KEY }}
          WAVE_MODEL: ${{ vars.WAVE_MODEL }} # 如 deepseek-flash；CI 里没有本地配置可继承
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          wave -p '/code-review' \
            --output-format json \
            --permission-mode dontAsk \
            --tools 'Read,Glob,Grep,Bash' \
            > wave-result.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: wave-result
          path: wave-result.json
```

两处容易踩：

- **`fetch-depth: 0` 不能省**。内置审查技能用 `git merge-base HEAD main` 定位改动范围，浅克隆下算出的范围不是这个 PR。
- **本地没有 `main` 时会退化**。技能里那行是 `git merge-base HEAD main 2>/dev/null || echo HEAD~1`；`pull_request` 事件检出的是 PR 的 merge commit，`HEAD~1` 恰好落在 base 分支尖上、等于没评。要让审查按 base 分支算，先建本地分支：

  ```yaml
  - run: git fetch --no-tags origin "refs/heads/${GITHUB_BASE_REF}:refs/heads/${GITHUB_BASE_REF}"
  ```

`--allowed-tools` 在这里没给：`/code-review` 的 `allowed-tools` 已经包含 `git diff*` / `git log*` / `git show*` / `git merge-base*` / `gh pr view*`，执行技能时会自动注册成临时规则。换成自己的提示词时，才需要按第三节的表格补。

### 4.3 变成阻断合并的门禁 {#github-required-check}

1. 跑通一次上面的 job；
2. 仓库 Settings → Branches → 分支保护规则 → Require status checks to pass，勾上这个 job 的名字；
3. 之后这个 check 变红时 PR 不可合并。

红绿来自 CLI 的退出码，判据见第六节。

## 五、GitLab CI {#gitlab}

把下面这段合进 `.gitlab-ci.yml`（或 `include` 指向 [ci/gitlab-ci.yml](https://github.com/netease-lcap/wave-agent/blob/main/ci/gitlab-ci.yml) 的 raw URL），并在 Settings → CI/CD → Variables 里加一个 masked 变量 `WAVE_API_KEY`：

```yaml
wave-review:
  image: node:22
  variables:
    WAVE_VERSION: "latest" # 生产请 pin 具体版本
    WAVE_PROMPT: "/code-review"
    WAVE_MODEL: "deepseek-flash"
    WAVE_TOOLS: "Read,Glob,Grep,Bash"
    GIT_DEPTH: "0"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - npm i -g "wave-code@${WAVE_VERSION}"
  script:
    - |
      set -uo pipefail
      status=0
      wave -p "$WAVE_PROMPT" \
        --output-format json \
        --permission-mode dontAsk \
        --tools "$WAVE_TOOLS" > wave-result.json || status=$?
      if [ -s wave-result.json ]; then
        node -e 'const r=require("./wave-result.json");console.log(r.subtype, r.result ?? "")'
      fi
      exit "$status"
  artifacts:
    when: always
    expire_in: 1 week
    paths:
      - wave-result.json
```

`GIT_DEPTH: "0"` 与 GitHub 侧的 `fetch-depth: 0` 同因；`node:22` 镜像里没有 `jq`，读结果用镜像自带的 `node -e`。

## 六、结果与产物 {#result}

结果文件就是 `--output-format json` 的那一条信封，字段表见 [CLI 结构化输出](/cli#structured-output)。CI 里最常用的是四个：

| 字段       | 用途                                 |
| ---------- | ------------------------------------ |
| `subtype`  | `success` / `error_during_execution` |
| `is_error` | 布尔，等同退出码的语义               |
| `result`   | 结论正文；失败版没有这个字段         |
| `errors`   | 失败原因，仅在非空时出现             |

退出码只看两件事，满足任一即为 `1`：建 agent 或发消息抛错；运行结束时错误块非空且一句正文都没产出。工具执行失败不算运行失败（记在 `tool_calls[].success` 上）。

## 七、局限 {#limits}

- **fork 来的 PR 拿不到 secret**：GitHub 不把 `WAVE_API_KEY` 交给 fork PR 的 workflow，这类 PR 上 job 会失败。要么改用 `pull_request_target` 并只做只读操作，要么由维护者在评论里手动触发。
- **版本要 pin**：`wave-version` 默认 `latest`，上游发版即改变流水线行为。
- **一次运行没有记忆**：每个 job 都是新会话，上一轮审查的结论不会带到下一轮。

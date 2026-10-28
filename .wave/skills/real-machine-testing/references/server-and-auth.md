# 服务端二选一：测试环境 / 线上，以及登录态

真机测试默认**端到端全真**（真 CLI / 真 IDE / 真插件 + 真模型），所以先定「真模型从哪个服务端来」：

| 目标     | 地址                                                                     | 什么时候用                                               | 登录态                                      |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| 线上生产 | `https://codechat.codewave.163.com`（不设 `WAVE_SERVER_URL` 时的默认值） | 本机已有 token、要验真实线上行为、缺陷只在生产数据下暴露 | **不用签发**，本机 `~/.wave/auth.json` 现成 |
| 测试环境 | `https://codechat.codewave-test.163yun.com`                              | 验 wave 侧（CLI/IDE/桌面）时的默认选择，不动生产额度     | 测试账号密码登录，或复用现成 `auth.json`    |

指向哪个服务端只有一条路：`WAVE_SERVER_URL`（会被镜像进 `process.env`，也可写进 settings.json 的 `env`）。**换环境 = 换登录态**：只要有 SSO token，网关就固定为 `${serverUrl}/api/v1` + 该 token，`WAVE_BASE_URL` / `WAVE_API_KEY` 整段被跳过（见 `environment.md`）。注意 `neteasecc.*` 是运营平台域，不是 AI 服务域。

## 线上：不用签发

`~/.wave/auth.json` 就是现成登录态，`cp` 进任何假 HOME 直接可用（2026-10-21 查过：四个键齐全、有效期还够）。它绑定生产的 serverUrl，`WAVE_SERVER_URL` 一旦指向别处就 401。

## 测试环境：测试账号密码登录

测试环境支持**邮箱 + 密码**登录（`POST /api/auth/login`），不用过 SSO、也不需要任何集群权限：

```sh
HOME_DIR=/tmp/probe-home; mkdir -p "$HOME_DIR/.wave"
curl -sS -X POST https://codechat.codewave-test.163yun.com/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"<测试账号>","password":"<密码>"}' -o /tmp/login.json
node -e '
const d = require("/tmp/login.json");
if (!d.token) throw new Error(JSON.stringify(d));            // 账号/密码不对会回 401
require("fs").writeFileSync(process.argv[1], JSON.stringify({
  SSO_TOKEN: d.token, SSO_REFRESH_TOKEN: d.refreshToken,
  SSO_TOKEN_EXPIRES_AT: Date.now() + d.expiresInSeconds * 1000,
  user: { id: d.user.id, email: d.user.email } }, null, 2));' "$HOME_DIR/.wave/auth.json"
rm -f /tmp/login.json; chmod 600 "$HOME_DIR/.wave/auth.json"
```

- **账号**：复用团队已有的测试账号；密码问持有人或让管理员重置一次，之后一直密码登录。**账号密码不进仓库、不进提交**。
- 这个端点的字段和 `/api/auth/token` 不同：`expiresInSeconds`（不是 `expiresIn`），映射见上面脚本。
- 顺带好处：登录态自带 refresh token，过期自动续——不像手签的还得盯 `exp`。
- 手边已有可用的 `auth.json` 时更省事：**直接 `cp` 进假 HOME**，这就是「隔离 + 真服务」同时成立的关键。

## 坑

- **`auth.json` 与签发它的环境绑定**：跨环境用会 401。401/403 时 `createAuthAwareFetch` 会刷新一次，刷新被拒不光是失败——直接 `clearAuth()` 清掉，现象是「跑着跑着突然变未登录」（日志有 `Refresh token rejected`）。
- **长跑套件盯过期**：到期前 5 分钟进刷新缓冲；refresh token 失效就没兜底，补全用例会静默退化成「等不到 ghost text」。JetBrains 首跑要下 IDE，先确认寿命够。
- **多进程共用假 HOME 没问题**：`auth.json` mtime 变了会重读，能捡到另一进程刷新的 token。
- **`WAVE_MODEL` 的 settings.json `env` 盖过 shell**，切环境时两处都看一眼。

## 已验证到哪一步

- **2026-10-21 本机，测试环境密码登录端到端跑通**：`POST /api/auth/login` 换取登录态（无 SSO、无集群权限）→ `HOME=/tmp/probe-pw WAVE_SERVER_URL=https://codechat.codewave-test.163yun.com WAVE_MODEL=deepseek-flash pnpm run wave -p "只回复两个字：收到"` 输出 `收到`。
- **同日**：线上与测试域的 `POST /api/auth/token` 都活着（瞎 code 回 `401 无效或已过期的授权码`）；本机 `~/.wave/auth.json` 是未过期的线上 token。

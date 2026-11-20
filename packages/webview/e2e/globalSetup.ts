/**
 * Playwright 全局准备：远控页产物 `remote/dist` **一次**就好。
 *
 * 它原先由 `remote-page-mod-prompt-edit` 与 `remote-page-slash-filter` 各自的
 * `beforeAll` 现建。单 worker 时没问题，`workers > 1` 时两个文件会同时跑：
 * `remote/build.mjs` 的第一步是 `rmSync(remote/dist)` 清场，然后按内容 hash 写
 * 新的 `chat-<hash>.js` —— 于是 A 的 http 服务刚把 `index.html` 发出去、B 正好
 * 把带 hash 的资源删掉重建，A 那个页面就 404（或者拿到两份不同 hash 的半成品）。
 * 构建本身幂等，但「两个进程并发写同一个输出目录」不是。
 *
 * 挪到这里只跑一次：产物仍然每次运行现出（不留陈旧 `remote/dist`），并发写没了。
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function globalSetup(): void {
  const webviewRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("node", ["remote/build.mjs"], {
    cwd: webviewRoot,
    stdio: "ignore",
  });
}

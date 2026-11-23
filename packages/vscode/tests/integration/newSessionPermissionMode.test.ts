/**
 * 真机回归（跨进程层）—— 新对话里先选权限档位，再发第一条消息。
 *
 * 上报的现象只出现在「会话还没建起来」的那段窗口：`initialize` 还在等
 * `wave --stdio` 子进程启动，输入框早已能用，此刻的 `setPermissionMode` 没有
 * sessionId 可归属。单测层（mock 掉 JSON-RPC）看不见这个窗口 —— 它靠的是真实
 * 子进程的启动耗时 —— 所以这里起**真的 CLI 子进程**，走真 JSON-RPC，用真的
 * `ChatSession`：档位是否落到 agent 上，读的是 CLI 自己回来的
 * `permissionModeChange` 通知。
 *
 * 依赖 `packages/code/dist/bundle/wave.mjs`（CI 在跑测试前 `pnpm build`）；本机
 * 手跑先 `pnpm -F wave-code build`。
 */

import { existsSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationRouter, type PermissionMode } from "wave-agent-sdk/host";
import {
  ChatSession,
  type ChatSessionCallbacks,
} from "../../src/session/chatSession";
import { StdioClient } from "../../src/stdio/stdioClient";

const CLI_BUNDLE = path.resolve(
  __dirname,
  "../../../code/dist/bundle/wave.mjs",
);

/** 一个最小 OpenAI 兼容流式端点：一轮就回一句文本。 */
async function startFakeModel() {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const chunk = (delta: unknown, finish: string | null) =>
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-vscode-realhost",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "test-model",
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "回复：OK" }, null);
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function callbacks(seen: { mode?: PermissionMode }) {
  const cbs: ChatSessionCallbacks = {
    onTasksChange: () => {},
    onSessionIdChange: () => {},
    onStreamingChange: () => {},
    onQueueChange: () => {},
    onCommandRunningChange: () => {},
    onPermissionModeChange: (mode) => {
      seen.mode = mode;
    },
    onWorkdirChange: () => {},
    onToolPermissionRequest: async () => ({ behavior: "allow" }),
    onError: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    onCompactBlockAdded: () => {},
    onMessagesReplaced: () => {},
  };
  return cbs;
}

let model: Awaited<ReturnType<typeof startFakeModel>>;
let client: StdioClient | undefined;
let home: string;

beforeEach(async () => {
  // 一次性 HOME：真 CLI 不去碰开发机上真实的 ~/.wave 状态。
  home = path.join(
    os.tmpdir(),
    `wave-vscode-realhost-${process.pid}-${Date.now()}`,
  );
  model = await startFakeModel();
});

afterEach(async () => {
  client?.dispose();
  client = undefined;
  await model.close();
});

describe("ChatSession · 会话建起来之前选的权限档位（真 CLI 子进程）", () => {
  it("把空白态选的档位交给真会话，第一条消息按它跑", async () => {
    expect(
      existsSync(CLI_BUNDLE),
      `缺 CLI 产物：先 pnpm -F wave-code build（${CLI_BUNDLE}）`,
    ).toBe(true);

    const seen: { mode?: PermissionMode } = {};
    client = new StdioClient(CLI_BUNDLE, ["--stdio"], {
      HOME: home,
      USERPROFILE: home,
      WAVE_LOGS_DIR: path.join(home, ".wave", "logs"),
      WAVE_API_KEY: "test-key",
      WAVE_BASE_URL: model.baseURL,
      WAVE_MODEL: "test-model",
      WAVE_FAST_MODEL: "test-model",
    });
    const router = new NotificationRouter(client);
    router.attach();
    const session = new ChatSession("sidebar", undefined, callbacks(seen));

    // 窗口：`initialize` 还在等子进程，sessionId 尚不存在。
    const initializing = session.initialize(undefined, client, router);
    await session.setPermissionMode("bypassPermissions");
    await initializing;

    // 会话落地后，真 CLI 报回来的档位就是用户选的那一档。
    expect(seen.mode).toBe("bypassPermissions");

    // 第一条消息：真子进程真跑一轮（模型是本地假端点），档位不许被打回默认。
    await session.sendMessage("你好");
    expect(model.requests.length).toBeGreaterThan(0);
    expect(seen.mode).toBe("bypassPermissions");
  }, 120_000);
});

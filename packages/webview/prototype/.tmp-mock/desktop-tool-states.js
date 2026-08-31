"use strict";
var __waveMockCase = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if ((from && typeof from === "object") || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, {
            get: () => from[key],
            enumerable:
              !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
          });
    }
    return to;
  };
  var __toCommonJS = (mod) =>
    __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/webview/prototype/mock/desktop-tool-states.ts
  var desktop_tool_states_exports = {};
  __export(desktop_tool_states_exports, {
    default: () => desktop_tool_states_default,
  });
  var desktop_tool_states_default = {
    name: "\u5DE5\u5177\u72B6\u6001\uFF1Astream/running/success/fail",
    description:
      "\u5DE5\u5177\u5757\u56DB\u6001\u9759\u6001\u5FEB\u7167 + Bash \u52A8\u6001\u751F\u547D\u5468\u671F\uFF08\u6D41\u5F0F\u53C2\u6570\u2192\u6267\u884C\u2192\u6210\u529F\uFF09",
    host: "desktop",
    messages: [
      {
        message: {
          command: "desktopWorkdirState",
          workdir: "/Users/dev/projects/wave-agent",
          host: "local",
          hosts: ["local"],
          recentWorkdirs: ["/Users/dev/projects/wave-agent"],
        },
      },
      {
        message: {
          command: "updateCurrentSession",
          session: {
            id: "sess-1",
            title: "\u5DE5\u5177\u72B6\u6001\u6F14\u793A",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:30:00.000Z",
          },
        },
      },
      {
        delay: 150,
        message: {
          command: "updateMessages",
          messages: [
            {
              id: "m1",
              role: "user",
              timestamp: "2026-08-28T10:00:01.000Z",
              blocks: [
                {
                  type: "text",
                  content:
                    "\u8DD1\u4E00\u4E0B\u6784\u5EFA\u548C\u6D4B\u8BD5\uFF0C\u987A\u4FBF\u770B\u4E0B lint \u4E0E\u53D1\u5E03\u811A\u672C\u7684\u60C5\u51B5\u3002",
                },
              ],
            },
            {
              id: "m2",
              role: "assistant",
              timestamp: "2026-08-28T10:00:02.000Z",
              blocks: [
                {
                  type: "reasoning",
                  content:
                    "\u5E76\u884C\u6267\u884C\uFF1A\u5148\u6784\u5EFA\u3001\u518D\u8DD1\u6D4B\u8BD5\uFF0C\u540C\u65F6\u68C0\u67E5 lint \u548C\u53D1\u5E03\u811A\u672C\u662F\u5426\u6B63\u5E38\u3002",
                },
                {
                  type: "text",
                  content:
                    "\u597D\u7684\uFF0C\u6211\u4F9D\u6B21\u6267\u884C\u6784\u5EFA\u3001\u6D4B\u8BD5\u3001lint\uFF0C\u5E76\u68C0\u67E5\u53D1\u5E03\u811A\u672C\u3002",
                },
                {
                  // ① streaming：参数还在流式接收（灰点 + 命令头部）
                  type: "tool",
                  id: "tool-bash-stream",
                  name: "Bash",
                  parameters: '{"command": "npm run build -- --mode pr',
                  stage: "streaming",
                },
                {
                  // ② running：执行中（灰点呼吸，无 result 只显示命令）
                  type: "tool",
                  id: "tool-bash-run",
                  name: "Bash",
                  parameters: '{"command": "npm run test"}',
                  stage: "running",
                },
                {
                  // ③ success：成功完成（绿点 + 完整输出）
                  type: "tool",
                  id: "tool-bash-ok",
                  name: "Bash",
                  parameters: '{"command": "pnpm lint"}',
                  result:
                    "pnpm lint\n\n./src/main.ts 0 errors, 0 warnings\n\u2728 Done in 3.2s",
                  shortResult: "0 errors, 0 warnings",
                  stage: "end",
                  success: true,
                },
                {
                  // ④ fail：失败（红点 + error 内容）
                  type: "tool",
                  id: "tool-bash-fail",
                  name: "Bash",
                  parameters:
                    '{"command": "curl -fsSL https://down.example.com/pkg.tar.gz -o pkg.tar.gz"}',
                  result: "",
                  shortResult: "",
                  error:
                    "curl: (22) The requested URL returned error: 404 Not Found\n\u547D\u4EE4\u6267\u884C\u5931\u8D25\uFF0C\u9000\u51FA\u7801 22",
                  stage: "end",
                  success: false,
                },
              ],
            },
          ],
        },
      },
      // ── 动态生命周期：第一个 Bash 块 streaming → running → end success ──
      {
        delay: 800,
        message: {
          command: "updateToolBlock",
          params: {
            messageId: "m2",
            id: "tool-bash-stream",
            parametersChunk: 'oduction"}',
          },
        },
      },
      {
        delay: 600,
        message: {
          command: "updateToolBlock",
          params: {
            messageId: "m2",
            id: "tool-bash-stream",
            stage: "running",
          },
        },
      },
      {
        delay: 1200,
        message: {
          command: "updateToolBlock",
          params: {
            messageId: "m2",
            id: "tool-bash-stream",
            stage: "end",
            success: true,
            result:
              "npm run build -- --mode production\n\n\u2713 built in 8.4s\ndist/ \u4EA7\u7269\u5DF2\u751F\u6210",
            shortResult: "\u2713 built in 8.4s",
          },
        },
      },
      {
        delay: 300,
        message: {
          command: "contextUsage",
          percent: 42,
        },
      },
      {
        delay: 200,
        message: {
          command: "desktopSessionTree",
          groups: [
            {
              host: "local",
              workdir: "/Users/dev/projects/wave-agent",
              sessions: [
                {
                  sessionId: "sess-1",
                  title: "\u5DE5\u5177\u72B6\u6001\u6F14\u793A",
                  lastActiveAt: 1782e9,
                  hasWorktree: false,
                  running: false,
                },
              ],
            },
          ],
        },
      },
    ],
    responders: {},
  };
  return __toCommonJS(desktop_tool_states_exports);
})();

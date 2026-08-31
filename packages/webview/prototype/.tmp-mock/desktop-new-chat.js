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

  // packages/webview/prototype/mock/desktop-new-chat.ts
  var desktop_new_chat_exports = {};
  __export(desktop_new_chat_exports, {
    default: () => desktop_new_chat_default,
  });
  var desktop_new_chat_default = {
    name: "\u684C\u9762\u7AEF\uFF1A\u65B0\u5BF9\u8BDD",
    description:
      "\u672A\u9009\u76EE\u5F55 + \u7A7A\u4F1A\u8BDD\u6B22\u8FCE\u9875 + \u4F1A\u8BDD\u6811\uFF08\u542B running \u4F1A\u8BDD\uFF09",
    host: "desktop",
    messages: [
      {
        message: {
          command: "desktopWorkdirState",
          workdir: "",
          host: "local",
          hosts: ["local"],
          // 空 recents + 空 workdir → picker 显示「选择工作目录…」占位，
          // 不触发分支查询/worktree 控件（对齐设计师 welcome 场景）
          recentWorkdirs: [],
        },
      },
      {
        delay: 100,
        // 对齐真实桌面端新会话流程：setInitialState（空消息）→ initialized →
        // 显示欢迎页（WelcomeView），而非 LoadingLogo 扫光。
        message: {
          command: "setInitialState",
          messages: [],
          tasks: [],
          isStreaming: false,
          sessions: [],
          isAuthenticated: true,
          configurationData: {
            baseURL: "https://api.anthropic.com/v1",
            model: "claude-sonnet-4-20250514",
          },
          permissionMode: "default",
        },
      },
      {
        delay: 200,
        message: {
          command: "updateCurrentSession",
          session: {
            id: "sess-new",
            title: "\u65B0\u5BF9\u8BDD",
            createdAt: "2026-08-28T11:00:00.000Z",
            updatedAt: "2026-08-28T11:00:00.000Z",
          },
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
                  sessionId: "sess-new",
                  title: "\u65B0\u5BF9\u8BDD",
                  lastActiveAt: 1782004e6,
                  hasWorktree: false,
                  running: false,
                },
                {
                  sessionId: "sess-bg",
                  title:
                    "\u4FEE\u4E00\u7248 release \u811A\u672C\u7684 Windows \u5206\u652F",
                  lastActiveAt: 17820041e5,
                  hasWorktree: true,
                  running: true,
                },
              ],
            },
          ],
        },
      },
      {
        delay: 300,
        message: {
          command: "desktopAccountInfo",
          isAuthenticated: true,
          user: { id: "user-1", email: "alice@example.com" },
          plan: { monthlyQuota: 100, months: 12, used: 240 },
          apiQuota: { limit: null, used: 1153.14 },
          update: void 0,
        },
      },
    ],
    responders: {},
  };
  return __toCommonJS(desktop_new_chat_exports);
})();

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

  // packages/webview/prototype/mock/desktop-restoring.ts
  var desktop_restoring_exports = {};
  __export(desktop_restoring_exports, {
    default: () => desktop_restoring_default,
  });
  var desktop_restoring_default = {
    name: "\u684C\u9762\u7AEF\uFF1A\u4F1A\u8BDD\u6062\u590D\u626B\u5149",
    description:
      "setInitialState isRestoring \u2192 \u626B\u5149\u52A8\u753B 2.5s \u2192 \u6062\u590D\u5B8C\u6210\u663E\u793A\u6B22\u8FCE\u9875 + input",
    host: "desktop",
    messages: [
      {
        message: {
          command: "desktopWorkdirState",
          workdir: "",
          host: "local",
          hosts: ["local"],
          recentWorkdirs: [],
        },
      },
      {
        delay: 100,
        // 恢复进行中：isRestoring → LoadingLogo 扫光覆盖 message + input 区域
        message: {
          command: "setInitialState",
          isRestoring: true,
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
        delay: 2500,
        // 恢复完成：不带 isRestoring → 扫光结束，欢迎页 + input 出现
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
              ],
            },
          ],
        },
      },
    ],
    responders: {},
  };
  return __toCommonJS(desktop_restoring_exports);
})();

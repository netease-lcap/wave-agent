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

  // packages/webview/prototype/mock/desktop-logged-out.ts
  var desktop_logged_out_exports = {};
  __export(desktop_logged_out_exports, {
    default: () => desktop_logged_out_default,
  });
  var desktop_logged_out_default = {
    name: "\u684C\u9762\u7AEF\uFF1A\u672A\u767B\u5F55",
    description:
      "\u4F1A\u8BDD\u6811 + \u6D88\u606F\u6D41 + \u672A\u767B\u5F55\u8D26\u6237\u5361\u7247\uFF08\u767B \u5F55\u6309\u94AE\uFF09",
    host: "desktop",
    messages: [
      {
        message: {
          command: "desktopWorkdirState",
          workdir: "/Users/dev/projects/wave-agent",
          host: "local",
          hosts: ["local"],
          recentWorkdirs: [
            "/Users/dev/projects/wave-agent",
            "/Users/dev/projects/web-dashboard",
            "/Users/dev/projects/sre-toolbox",
          ],
        },
      },
      {
        message: {
          command: "updateCurrentSession",
          session: {
            id: "sess-1",
            title: "\u4FEE\u590D\u767B\u5F55\u9875\u6837\u5F0F",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:30:00.000Z",
          },
        },
      },
      {
        message: {
          command: "updateSessions",
          sessions: [
            {
              id: "sess-1",
              title: "\u4FEE\u590D\u767B\u5F55\u9875\u6837\u5F0F",
              createdAt: "2026-08-28T10:00:00.000Z",
              updatedAt: "2026-08-28T10:30:00.000Z",
            },
            {
              id: "sess-2",
              title: "\u91CD\u6784\u652F\u4ED8\u6A21\u5757",
              createdAt: "2026-08-28T09:00:00.000Z",
              updatedAt: "2026-08-28T09:40:00.000Z",
            },
            {
              id: "sess-3",
              title: "\u5BA1\u67E5\u5206\u5E03\u5F0F\u4E8B\u52A1\u7ADE\u6001",
              createdAt: "2026-08-28T08:00:00.000Z",
              updatedAt: "2026-08-28T08:50:00.000Z",
            },
          ],
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
                    "\u5E2E\u6211\u4FEE\u590D\u767B\u5F55\u9875\u7684\u6837\u5F0F\u95EE\u9898\uFF1A\u6309\u94AE\u5728\u7A84\u5C4F\u4E0B\u6362\u884C\u9519\u4F4D\uFF0C\u8F93\u5165\u6846\u95F4\u8DDD\u4E5F\u4E0D\u7EDF\u4E00\u3002",
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
                    "\u5148\u5B9A\u4F4D\u767B\u5F55\u9875\u7EC4\u4EF6\uFF1A\u68C0\u67E5\u6309\u94AE\u5BB9\u5668\u662F\u5426\u7528\u4E86 flex-wrap\u3001\u95F4\u8DDD\u53D8\u91CF\u662F\u5426\u8D70\u8BBE\u8BA1\u4EE4\u724C\uFF0C\u518D\u5BF9\u7167\u7A84\u89C6\u53E3\u65AD\u70B9\u770B\u5A92\u4F53\u67E5\u8BE2\u3002",
                },
                {
                  type: "text",
                  content:
                    "\u6211\u5148\u770B\u4E00\u4E0B\u767B\u5F55\u9875\u7EC4\u4EF6\u7684\u6837\u5F0F\u6587\u4EF6\uFF0C\u627E\u51FA\u5BF9\u9F50\u95EE\u9898\u7684\u539F\u56E0\u3002\n\n\u5206\u6790 `src/pages/Login.vue`\uFF1A\n- \u6309\u94AE\u5BB9\u5668 `btn-group` \u7528\u4E86\u56FA\u5B9A\u5BBD\u5EA6\uFF0C\u7A84\u5C4F\u4E0B\u4E24\u4E2A\u6309\u94AE\u4E92\u76F8\u6324\u538B\n- \u8F93\u5165\u6846\u95F4\u8DDD\u786C\u7F16\u7801 `12px`\uFF0C\u4E0E\u8868\u5355\u5176\u4ED6\u533A\u57DF\u7684 `16px` \u4E0D\u4E00\u81F4\n\n**\u4FEE\u590D\u65B9\u6848**\uFF1A\n1. \u6309\u94AE\u5BB9\u5668\u6539\u4E3A `flex-wrap: wrap` + `gap: 8px`\n2. \u95F4\u8DDD\u7EDF\u4E00\u8D70 `--space-form-item` \u8BBE\u8BA1\u4EE4\u724C\n3. \u6DFB\u52A0 `@media (max-width: 480px)` \u65AD\u70B9\u8BA9\u6309\u94AE\u5168\u5BBD\u5806\u53E0",
                },
              ],
            },
            {
              id: "m3",
              role: "user",
              timestamp: "2026-08-28T10:05:00.000Z",
              blocks: [
                {
                  type: "text",
                  content:
                    "\u597D\u7684\uFF0C\u53E6\u5916\u770B\u770B\u5E95\u90E8\u300C\u63D0\u4EA4\u300D\u6309\u94AE\u5728\u6D45\u8272\u6A21\u5F0F\u4E0B\u5BF9\u6BD4\u5EA6\u591F\u4E0D\u591F\u3002",
                },
              ],
            },
            {
              id: "m4",
              role: "assistant",
              timestamp: "2026-08-28T10:05:01.000Z",
              blocks: [
                {
                  type: "reasoning",
                  content:
                    "\u68C0\u67E5\u4E3B\u9898\u8272\u5BF9\u6BD4\u5EA6\uFF1A\u4E3B\u6309\u94AE\u524D\u666F/\u80CC\u666F\u5728\u6D45\u8272\u4E3B\u9898\u4E0B\u7684\u6BD4\u503C\u662F\u5426\u8FBE\u5230 WCAG AA\uFF084.5:1\uFF09\u3002",
                },
                {
                  type: "text",
                  content:
                    "\u68C0\u67E5\u7ED3\u679C\uFF1A\u6D45\u8272\u6A21\u5F0F\u4E0B\u300C\u63D0\u4EA4\u300D\u6309\u94AE\u80CC\u666F `--color-primary-600`\uFF08#2563eb\uFF09\u914D\u767D\u8272\u524D\u666F\uFF0C\u5BF9\u6BD4\u5EA6 **5.9:1**\uFF0C\u6EE1\u8DB3 WCAG AA\u3002\n\n\u53E6\u5916\u6211\u6CE8\u610F\u5230\u767B\u5F55\u8868\u5355\u7684\u9A8C\u8BC1\u63D0\u793A\u6837\u5F0F\u4E5F\u53EF\u4EE5\u987A\u624B\u7EDF\u4E00\u4E00\u4E0B\uFF0C\u9700\u8981\u4E00\u5E76\u5904\u7406\u5417\uFF1F",
                },
              ],
            },
            {
              id: "m5",
              role: "assistant",
              timestamp: "2026-08-28T10:06:00.000Z",
              blocks: [
                {
                  // Running 工具块：演示设计师的呼吸圆点动画
                  // （timeline-row--running + status-pulse）。
                  type: "tool",
                  name: "Bash",
                  parameters: "npm run build -- --mode production",
                  stage: "running",
                },
              ],
            },
          ],
        },
      },
      {
        delay: 300,
        message: {
          command: "contextUsage",
          percent: 64,
        },
      },
      {
        delay: 400,
        message: {
          command: "desktopAccountInfo",
          isAuthenticated: false,
          user: null,
          plan: null,
          apiQuota: null,
          update: void 0,
        },
      },
      {
        delay: 500,
        message: {
          command: "desktopSessionTree",
          groups: [
            {
              host: "local",
              workdir: "/Users/dev/projects/wave-agent",
              sessions: [
                {
                  sessionId: "sess-1",
                  title: "\u4FEE\u590D\u767B\u5F55\u9875\u6837\u5F0F",
                  lastActiveAt: 1782e9,
                  hasWorktree: false,
                  running: false,
                },
                {
                  sessionId: "sess-2",
                  title: "\u91CD\u6784\u652F\u4ED8\u6A21\u5757",
                  lastActiveAt: 17820001e5,
                  hasWorktree: true,
                  running: true,
                },
                {
                  sessionId: "sess-3",
                  title:
                    "\u5BA1\u67E5\u5206\u5E03\u5F0F\u4E8B\u52A1\u7ADE\u6001",
                  lastActiveAt: 17820002e5,
                  hasWorktree: false,
                  running: false,
                  waitingConfirmation: true,
                },
              ],
            },
            {
              host: "local",
              workdir: "/Users/dev/projects/web-dashboard",
              sessions: [
                {
                  sessionId: "sess-4",
                  title: "\u642D\u5EFA\u8BA2\u5355\u7BA1\u7406\u540E\u53F0",
                  lastActiveAt: 17820003e5,
                  hasWorktree: false,
                  running: false,
                },
              ],
            },
          ],
        },
      },
    ],
    responders: {
      getConfiguration: (_payload, helpers) => {
        helpers.send({
          command: "configurationResponse",
          data: {
            baseURL: "https://api.anthropic.com/v1",
            model: "claude-sonnet-4-20250514",
            fastModel: "claude-haiku-4-20250514",
          },
        });
      },
      setAgentsContent: (payload, helpers) => {
        helpers.send({
          command: "agentsContentSaved",
          scope: payload.scope,
          ok: true,
        });
      },
    },
  };
  return __toCommonJS(desktop_logged_out_exports);
})();

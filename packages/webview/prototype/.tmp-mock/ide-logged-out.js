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

  // packages/webview/prototype/mock/ide-logged-out.ts
  var ide_logged_out_exports = {};
  __export(ide_logged_out_exports, {
    default: () => ide_logged_out_default,
  });
  var ide_logged_out_default = {
    name: "IDE \u63D2\u4EF6\uFF1A\u672A\u767B\u5F55",
    description:
      "\u6D88\u606F\u6D41 + \u672A\u8BA4\u8BC1\uFF08\u804A\u5929\u5934\u90E8\u663E\u793A\u767B\u5F55\u6309\u94AE\uFF09",
    host: "vscode",
    messages: [
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
                  type: "text",
                  content:
                    "\u6211\u5148\u770B\u4E00\u4E0B\u767B\u5F55\u9875\u7EC4\u4EF6\u7684\u6837\u5F0F\u6587\u4EF6\uFF0C\u627E\u51FA\u5BF9\u9F50\u95EE\u9898\u7684\u539F\u56E0\u3002\n\n\u5206\u6790 `src/pages/Login.vue`\uFF1A\n- \u6309\u94AE\u5BB9\u5668\u7528\u4E86\u56FA\u5B9A\u5BBD\u5EA6\uFF0C\u7A84\u5C4F\u4E0B\u4E24\u4E2A\u6309\u94AE\u4E92\u76F8\u6324\u538B\n- \u8F93\u5165\u6846\u95F4\u8DDD\u786C\u7F16\u7801 `12px`\uFF0C\u4E0E\u8868\u5355\u5176\u4ED6\u533A\u57DF\u7684 `16px` \u4E0D\u4E00\u81F4\n\n**\u4FEE\u590D\u65B9\u6848**\uFF1A\n1. \u6309\u94AE\u5BB9\u5668\u6539\u4E3A `flex-wrap: wrap` + `gap: 8px`\n2. \u95F4\u8DDD\u7EDF\u4E00\u8D70\u8BBE\u8BA1\u4EE4\u724C",
                },
              ],
            },
          ],
        },
      },
      {
        delay: 300,
        message: {
          command: "authStatusResponse",
          isAuthenticated: false,
          user: null,
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
    },
  };
  return __toCommonJS(ide_logged_out_exports);
})();

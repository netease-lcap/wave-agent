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

  // packages/webview/prototype/mock/smoke.ts
  var smoke_exports = {};
  __export(smoke_exports, {
    default: () => smoke_default,
  });
  var smoke_default = {
    name: "\u5192\u70DF\uFF1A\u4E24\u6761\u6D88\u606F",
    description:
      "user + assistant \u6587\u672C\u6D88\u606F\uFF0C\u9A8C\u8BC1\u6D88\u606F\u6D41\u6E32\u67D3",
    messages: [
      {
        message: {
          command: "updateCurrentSession",
          session: {
            id: "smoke-1",
            title: "\u5192\u70DF\u4F1A\u8BDD",
            createdAt: "2026-08-28T10:00:00.000Z",
            updatedAt: "2026-08-28T10:00:00.000Z",
          },
        },
      },
      {
        message: {
          command: "updateSessions",
          sessions: [
            {
              id: "smoke-1",
              title: "\u5192\u70DF\u4F1A\u8BDD",
              createdAt: "2026-08-28T10:00:00.000Z",
              updatedAt: "2026-08-28T10:00:00.000Z",
            },
          ],
        },
      },
      {
        delay: 200,
        message: {
          command: "updateMessages",
          messages: [
            {
              id: "m-user",
              role: "user",
              timestamp: "2026-08-28T10:00:01.000Z",
              blocks: [
                {
                  type: "text",
                  content:
                    "\u4F60\u597D\uFF0C\u4ECB\u7ECD\u4E00\u4E0B\u4F60\u81EA\u5DF1",
                },
              ],
            },
            {
              id: "m-assistant",
              role: "assistant",
              timestamp: "2026-08-28T10:00:02.000Z",
              blocks: [
                {
                  type: "text",
                  content:
                    "\u4F60\u597D\uFF01\u6211\u662F Wave \u4EE3\u7801\u667A\u804A\uFF0C\u53EF\u4EE5\u5E2E\u4F60\u5B8C\u6210\u8F6F\u4EF6\u5DE5\u7A0B\u4EFB\u52A1\u3002**\u652F\u6301 Markdown** \u4E0E `\u884C\u5185\u4EE3\u7801`\u3002",
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
          data: { language: "zh-CN" },
        });
      },
    },
  };
  return __toCommonJS(smoke_exports);
})();

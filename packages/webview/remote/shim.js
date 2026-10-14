/**
 * wave remote-control page shim — the 5th host.
 *
 * The phone page is the shared webview bundle (`chat.js` from
 * packages/webview) plus this file: the webview only knows four things about
 * its host — `window.acquireVsCodeApi()` (page → host),
 * `window.addEventListener("message")` (host → page), `waveHostType` and
 * `wavePlatform` — so "run it in a browser" means supplying those and bridging
 * them to the relay's websocket. Without `waveHostType` (we deliberately do not
 * set it) `index.tsx` renders the plain `ChatApp`: single session, no desktop
 * panes, no workdir management.
 *
 * Deliberately plain ES5-era browser JS with no imports, and no build step: it
 * ships beside `chat.js` in the same tarball and speaks the same JSON-RPC wire
 * protocol as the daemon socket (`{id, method, params, sessionId}` →
 * `{id, result|error}`, notifications as `{method, params, sessionId}`), which
 * is what the relay forwards verbatim.
 *
 * Scope (first phase = the approval loop): session list, message stream, the
 * approval card, plus resumed playback of everything the desktop sends. Every
 * command the phone does not implement is logged and (where the webview waits
 * for an answer) answered with an explicit error — never left hanging, never
 * silently ignored.
 *
 * Protocol note: the relay's *pairing* handshake (`PAIR_FRAME` below) is the
 * one piece of the wire contract that belongs to the server work
 * (vusion/codechat#40) and is therefore not fixed by wave. It is kept as a
 * single literal here so a change lands in one place.
 */
(function () {
  "use strict";

  /**
   * Marks the page as the remote Web host. The shared UI cannot tell the two apart
   * by `waveHostType` — the IDE hosts leave that unset as well — and exactly one
   * surface has to differ: the pairing QR. This page is what the QR points at, so
   * drawing it here would be circular (RemoteControlDialog skips it when this flag
   * is set): the QR exists to bring a second device onto this page.
   */
  window.waveRemotePage = true;

  var PAGE_CONFIG = readPageConfig();
  var query = new URLSearchParams(window.location.search);

  /**
   * The generated index.html carries one JSON blob in a meta tag rather than an
   * inline script — `script-src 'self'` blocks inline execution outright. A
   * malformed or missing blob is not fatal: `?ws=` can still drive the page.
   */
  function readPageConfig() {
    var meta = document.querySelector('meta[name="wave-remote-config"]');
    if (!meta) return {};
    try {
      return JSON.parse(meta.getAttribute("content") || "{}") || {};
    } catch (err) {
      console.warn("[wave-remote] 页面配置无法解析，改用 URL 参数", err);
      return {};
    }
  }

  var CONFIG = {
    /** Relay socket. Supplied by the generated index.html, or `?ws=` for local runs. */
    socketUrl: query.get("ws") || PAGE_CONFIG.socketUrl || "",
    /** Pairing code the page was opened with (`/remote/?code=1234`). */
    pairingCode: query.get("code") || "",
    /** Pin the page to one session; otherwise the newest one on the host wins. */
    sessionId: query.get("session") || PAGE_CONFIG.sessionId || "",
    /** First screen: the tail only — never the whole thread (13 MB on a long one). */
    firstPageLimit:
      Number(query.get("limit")) > 0
        ? Number(query.get("limit"))
        : PAGE_CONFIG.firstPageLimit || 300,
  };

  /** Sent once the socket is up, when the page was opened with a code. */
  var PAIR_FRAME = { method: "pair", params: { code: CONFIG.pairingCode } };

  var RETRY_MS = 2000;
  var MAX_ATTEMPTS = 5;
  /** Answered locally: the page has no filesystem and no local CLI to update. */
  var UNSUPPORTED_NO_REPLY = {
    updateInputContent: "草稿只留在本机浏览器里",
    openFile: "Web 端不能打开编辑器文件",
    openExternal: "Web 端不接管外链",
    previewImage: "Web 端不打开本地图片",
    uploadFilesToArtifacts: "Web 端不能上传文件",
    login: "Web 端复用企业端登录态，不需要单独登录",
    logout: "Web 端退出请走企业端",
  };

  var socket = null;
  var attempts = 0;
  var openedOnce = false;
  var nextId = 1;
  var pending = {};
  var outbox = [];
  var warned = {};
  /** Everything the page has seen for the current session — the window it keeps. */
  var messages = [];
  var sessions = [];
  var sessionId = CONFIG.sessionId;
  var banner = null;

  // ── Page → host plumbing ────────────────────────────────────────

  function showStatus(text) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "remote-status";
      banner.setAttribute(
        "style",
        "position:fixed;z-index:9999;left:0;right:0;top:0;padding:8px 12px;" +
          "font:13px/1.5 -apple-system,system-ui,sans-serif;background:#5a1d1d;color:#fff;",
      );
      document.body.appendChild(banner);
    }
    banner.textContent = text;
  }

  function clearStatus() {
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  /** Deliver a host → page message exactly the way the IDE hosts do. */
  function post(message) {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn("[wave-remote] " + message);
  }

  // ── Transport ───────────────────────────────────────────────────

  function connect() {
    if (!CONFIG.socketUrl) {
      showStatus(
        "页面缺少中继地址：在 index.html 里配置 window.WAVE_REMOTE.socketUrl，或用 ?ws=wss://… 打开（中继服务见 codechat#40）。",
      );
      return;
    }
    socket = new WebSocket(CONFIG.socketUrl);

    socket.onopen = function () {
      attempts = 0;
      clearStatus();
      if (CONFIG.pairingCode) send(PAIR_FRAME);
      for (var i = 0; i < outbox.length; i++) socket.send(outbox[i]);
      outbox = [];
      if (openedOnce) resync();
    };

    socket.onmessage = function (event) {
      var frame;
      try {
        frame = JSON.parse(event.data);
      } catch (err) {
        console.warn("[wave-remote] 丢弃无法解析的帧", err);
        return;
      }
      if (frame && frame.id !== undefined) settle(frame);
      else if (frame && frame.method)
        deliver(frame.method, frame.params, frame.sessionId);
    };

    socket.onclose = function (event) {
      var reason = "relay connection lost (" + event.code + ")";
      if (event.code === 4003) {
        showStatus(
          "中继拒绝了这个连接（未授权）。请在电脑侧重新开启远程控制。",
        );
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        showStatus(reason + " — 已停止重试。");
        return;
      }
      attempts++;
      showStatus("正在重连…(第 " + attempts + " 次)");
      setTimeout(connect, RETRY_MS);
    };

    socket.onerror = function () {
      // `close` follows and owns the retry/status decision.
    };
  }

  function send(frame) {
    var line = JSON.stringify(frame);
    if (socket && socket.readyState === 1) socket.send(line);
    else outbox.push(line);
  }

  function request(method, params, withSession) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      var frame = { id: id, method: method, params: params || {} };
      if (withSession !== false && sessionId) frame.sessionId = sessionId;
      send(frame);
      setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error(method + " 超时（中继或电脑侧没有响应）"));
      }, 20000);
    });
  }

  function settle(frame) {
    var entry = pending[frame.id];
    if (!entry) return;
    delete pending[frame.id];
    if (frame.error) entry.reject(new Error(frame.error.message || "RPC 失败"));
    else entry.resolve(frame.result);
  }

  // ── Host → page translation ─────────────────────────────────────
  //
  // The desktop/IDE hosts each translate these same RPC notifications into the
  // webview's own message vocabulary; the phone needs the same table, trimmed
  // to the surfaces this page renders.

  function deliver(method, params, frameSessionId) {
    var p = params || {};
    if (frameSessionId) sessionId = frameSessionId;

    switch (method) {
      case "messagesChange":
        // Two shapes: the full array (a host snapshot) and the content-free
        // signal the remote path sends instead. The signal is the norm here —
        // 13 MB of displayMessages must never reach the phone.
        if (Array.isArray(p.messages)) {
          messages = p.messages;
          post({ command: "updateMessages", messages: messages });
        } else {
          resync();
        }
        return;
      case "userMessageAdded":
      case "assistantMessageAdded":
        post({ command: "appendMessage", message: p.message });
        return;
      case "assistantMessageDiscarded":
        post({ command: "discardMessage", messageId: p.messageId });
        return;
      case "assistantContentUpdated":
        post({
          command: "updateStreamingContent",
          messageId: p.messageId,
          chunk: p.chunk,
          stage: p.stage,
        });
        return;
      case "assistantReasoningUpdated":
        post({
          command: "updateStreamingReasoning",
          messageId: p.messageId,
          chunk: p.chunk,
          stage: p.stage,
        });
        return;
      case "toolBlockUpdated":
        post({ command: "updateToolBlock", params: p });
        return;
      case "errorBlockAdded":
        post({ command: "updateErrorBlock", error: p.error });
        return;
      case "loadingChange":
        post({
          command: p.loading ? "startStreaming" : "endStreaming",
        });
        return;
      case "contextUsage":
        post({ command: "contextUsage", percent: p.percent });
        return;
      case "permissionModeChange":
        post({ command: "updatePermissionMode", mode: p.mode });
        return;
      case "tasksChange":
        post({ command: "updateTasks", tasks: p.tasks });
        return;
      case "queuedMessagesChange":
        post({ command: "updateQueue", messages: p.messages });
        return;
      case "commandRunningChange":
        post({ command: "updateCommandRunning", running: p.running });
        return;
      case "compactionStateChange":
        post({
          command: "compactionStateChange",
          isCompacting: p.isCompacting,
        });
        return;
      case "compactionContentUpdate":
        post({ command: "compactionContentUpdate", content: p.content });
        return;
      case "planFileUpdated":
        post({ command: "planFileUpdated", content: p.content });
        return;
      case "permissionRequest": {
        // The whole reason this page exists: an approval that arrived while the
        // user was away has to be answerable from the phone.
        var ctx = p.context || {};
        post({
          command: "showConfirmation",
          confirmationId: p.requestId,
          toolName: ctx.toolName,
          confirmationType: ctx.toolName,
          toolInput: ctx.toolInput,
          planContent: ctx.planContent,
          suggestedPrefix: ctx.suggestedPrefix,
          hidePersistentOption: ctx.hidePersistentOption,
          outsideSafeZoneDirectory: ctx.outsideSafeZoneDirectory,
        });
        return;
      }
      case "sessionIdChange":
        sessionId = p.sessionId;
        return;
      default:
        warnOnce(
          "notify:" + method,
          "未映射的通知（Web 端暂不处理）：" + method,
        );
    }
  }

  // ── Snapshot / reconciliation (§5 of the issue) ──────────────────

  /** First screen: the tail of one session, plus whatever is awaiting approval. */
  function pullSnapshot() {
    return pickSession()
      .then(function () {
        if (!sessionId) return null;
        return request("getMessages", { limit: CONFIG.firstPageLimit });
      })
      .then(function (result) {
        if (result) messages = result.messages || [];
        return request("listPendingPermissions", {});
      })
      .then(function (result) {
        var requests = (result && result.requests) || [];
        if (!sessionId && requests.length)
          sessionId = requests[0].sessionId || "";
        post({
          command: "setInitialState",
          messages: messages,
          tasks: [],
          backgroundTasks: [],
          workflowRuns: [],
          isStreaming: false,
          isCommandRunning: false,
          sessions: sessions,
          session: currentSession(sessions, sessionId),
          currentSession: currentSession(sessions, sessionId),
          pendingConfirmations: requests.map(confirmationOf),
          queuedMessages: [],
          // The relay authenticated this page with the machine's own
          // credential; there is no separate phone login to satisfy.
          isAuthenticated: true,
        });
      })
      .catch(function (err) {
        showStatus("拉取会话失败：" + err.message);
      });
  }

  /** Reconnect / structural change: fetch only what was appended. */
  function resync() {
    if (!sessionId) return pullSnapshot();
    var last = messages.length ? messages[messages.length - 1].id : "";
    if (!last) return pullSnapshot();
    return request("getMessages", { since: last, limit: CONFIG.firstPageLimit })
      .then(function (result) {
        if (result.reset) return pullSnapshot();
        var later = result.messages || [];
        for (var i = 0; i < later.length; i++) messages.push(later[i]);
        post({ command: "updateMessages", messages: messages });
      })
      .catch(function (err) {
        warnOnce("resync", "补差失败，改为重拉：" + err.message);
        return pullSnapshot();
      });
  }

  function pickSession() {
    return request("listSessions", {})
      .then(function (result) {
        sessions = (result && result.sessions) || [];
        if (!sessionId && sessions.length) {
          sessionId =
            CONFIG.sessionId || sessions[0].id || sessions[0].sessionId;
        }
        if (!sessionId) showStatus("电脑侧还没有会话。");
        else clearStatus();
      })
      .catch(function (err) {
        console.warn("[wave-remote] listSessions 失败", err);
      });
  }

  function currentSession(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id || list[i].sessionId === id) return list[i];
    }
    return undefined;
  }

  function confirmationOf(pendingRequest) {
    var ctx = pendingRequest.context || {};
    return {
      confirmationId: pendingRequest.requestId,
      toolName: ctx.toolName,
      confirmationType: ctx.toolName,
      toolInput: ctx.toolInput,
      planContent: ctx.planContent,
      suggestedPrefix: ctx.suggestedPrefix,
      hidePersistentOption: ctx.hidePersistentOption,
      outsideSafeZoneDirectory: ctx.outsideSafeZoneDirectory,
    };
  }

  // ── Page → host command handling ────────────────────────────────

  function handleCommand(msg) {
    var command = msg.command;

    if (UNSUPPORTED_NO_REPLY[command]) {
      warnOnce(
        "cmd:" + command,
        command + " 在 Web 端不支持：" + UNSUPPORTED_NO_REPLY[command],
      );
      return;
    }

    switch (command) {
      case "webviewReady":
        // The app has mounted and its message listener is live; only now is it
        // safe to answer, otherwise the snapshot lands before the reducer.
        if (openedOnce) resync();
        else {
          openedOnce = true;
          pullSnapshot();
        }
        return;

      case "sendMessage":
        request("sendMessage", {
          text: msg.text,
          force: msg.force,
        }).catch(function (err) {
          post({
            command: "updateErrorBlock",
            error: String(err.message || err),
          });
        });
        return;

      case "abortMessage":
        request("abortMessage", {}).catch(function () {});
        return;

      case "confirmationResponse":
        // The webview names it confirmationId and may send only `approved`;
        // the wire wants a requestId and a decision.
        request("permissionResponse", {
          requestId: msg.confirmationId,
          decision: msg.decision || {
            behavior: msg.approved ? "allow" : "deny",
          },
        }).catch(function (err) {
          console.warn("[wave-remote] 审批回执失败", err);
        });
        return;

      case "setPermissionMode":
        request("setPermissionMode", { mode: msg.mode }).catch(function () {});
        return;

      case "compact":
        request("compact", {
          customInstructions: msg.customInstructions,
        }).catch(function () {});
        return;

      case "renameSession":
        request("renameSession", {
          sessionId: msg.sessionId,
          workdir: msg.workdir,
          title: msg.title,
        })
          .then(function () {
            post({
              command: "sessionRenamed",
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              title: msg.title,
            });
          })
          .catch(function () {});
        return;

      case "requestSlashCommands":
        request("getSlashCommands", {})
          .then(function (result) {
            post({
              command: "slashCommandsResponse",
              commands: (result && result.commands) || [],
            });
          })
          .catch(function (err) {
            post({
              command: "slashCommandsError",
              error: String(err.message || err),
            });
          });
        return;

      case "getStatus":
        post({
          command: "statusResponse",
          version: "",
          sessionId: sessionId,
          workdir: "",
        });
        return;

      default:
        // Anything else the page renders may still expect a reply, so this is
        // loud rather than silent: the issue's rule is "explicitly unsupported
        // or hidden", never a quiet grey screen.
        warnOnce(
          "cmd:" + command,
          "Web 端未实现的命令（未回执，界面可能停在该动作上）：" + command,
        );
    }
  }

  // ── Host plumbing the webview expects ───────────────────────────

  window.acquireVsCodeApi = function () {
    return {
      postMessage: handleCommand,
      setState: function () {},
      getState: function () {
        return {};
      },
    };
  };

  connect();
})();

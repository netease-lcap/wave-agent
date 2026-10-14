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
 * Login is not this page's own: it rides the enterprise login the user already
 * has (same origin, same `localStorage.token`). That access token lives an hour
 * while the refresh token behind it lives a month, so an expired one is renewed
 * in place (`renewSession`) instead of being paid for with a login — this page
 * stays open for days, and a token that ages out under it is the norm, not an
 * error. Only a renewal that comes back empty-handed hands the user to the
 * enterprise login page and asks to be returned to this same address afterwards
 * (`hopToLogin`) — the one case where the page navigates away instead of
 * reporting a status.
 *
 * Protocol note: the relay's handshake (`authFrame` below) belongs to the server
 * work (vusion/codechat#40). Its shape is fixed there; the frame types are kept
 * as literals here so a change lands in one place.
 */
(function () {
  "use strict";

  /**
   * Marks the page as the remote Web host. The shared UI cannot tell the two apart
   * by `waveHostType` — the IDE hosts leave that unset as well — and exactly one
   * surface has to differ: the QR that brings a second device here. This page is
   * what that QR points at, so drawing it here would be circular
   * (RemoteControlDialog skips it when this flag is set).
   */
  window.waveRemotePage = true;

  /**
   * The same fact, in the DOM: this page is the only host a browser runs, so it is
   * the only one whose viewport shrinks and grows with browser chrome and whose
   * edges sit under the system UI. `globals.css` keys those rules on this
   * attribute and they must not reach the other four hosts. Not `data-host`: that
   * one selects the desktop density tokens, and this page belongs to the `ide`
   * default with the IDE hosts. Set before `chat.js` runs, so the first paint
   * already has it (index.html loads this file first).
   */
  document.documentElement.setAttribute("data-remote-page", "1");

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
    /**
     * Relay socket. Normally derived from the page's own origin — the page is
     * served from `/remote/` on the relay's domain, so there is nothing to
     * configure (see `deriveSocketUrl`). `?ws=` and the generated meta stay as
     * the local-debug override.
     */
    socketUrl: query.get("ws") || PAGE_CONFIG.socketUrl || "",
    /** Channel key: the `?host=` from the page address the computer printed. */
    hostId: query.get("host") || PAGE_CONFIG.hostId || "",
    /** Pin the page to one session; otherwise the most recently active one wins.
     * A pin is honored only while that session is still live in the serving
     * process — the list has no other rule for what the page may open. */
    sessionId: query.get("session") || PAGE_CONFIG.sessionId || "",
    /**
     * First screen: the tail only — never the whole thread (13 MB on a long
     * one). 100 messages is ≈0.57 MB at the measured 5.7 KB/message, and that
     * is the point: the relay's per-subscriber buffer is 1 MiB, and a frame
     * over it is dropped **without an error** — the phone would then ask for
     * the same page again, forever. The machine trims any page that comes back
     * over budget too, so this number is an economy rather than the guarantee.
     */
    firstPageLimit:
      Number(query.get("limit")) > 0
        ? Number(query.get("limit"))
        : PAGE_CONFIG.firstPageLimit || 100,
  };

  var RETRY_MS = 2000;
  var MAX_ATTEMPTS = 5;
  /** The relay closes an unauthenticated connection after this long. */
  var AUTH_TIMEOUT_CLOSE = 4003;
  /** Application-level keepalive; the relay answers each `ping` with a `pong`. */
  var HEARTBEAT_MS = 30000;
  /**
   * The enterprise login page, and the parameter it reads to know where to send
   * the user back to. Same-origin coupling like the `token` key below: this page
   * is served from the enterprise's own domain, so both names belong to its
   * frontend and are written exactly once, here.
   */
  var LOGIN_PATH = "/login";
  var REDIRECT_PARAM = "redirect";
  /**
   * The rest of the enterprise's stored session and the endpoint that renews it
   * — the other half of the same coupling: these four names and the shape of
   * that answer belong to the enterprise frontend, so they are written once,
   * here. Getting one wrong does not break the page: it degrades to the login
   * hop below, which is the failure mode we chose over a hard dependency.
   */
  var REFRESH_KEY = "refreshToken";
  var EXPIRES_KEY = "expiresAt";
  var USER_KEY = "user";
  var REFRESH_PATH = "/api/auth/refresh";
  /** How long one automatic login round-trip counts as "just happened" (ms). */
  var LOGIN_HOP_MS = 30000;
  var LOGIN_HOP_KEY = "wave_remote_login_hop";
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
  /** The relay completed the handshake — nothing may be sent before that. */
  var authed = false;
  /** One successful handshake has happened, so a later one is a reconnect. */
  var connectedOnce = false;
  /** Non-empty ⇒ this page can never reach a host; the reason stays on screen. */
  var blocked = "";
  /** Set when the relay refused us for good (4003): the reason, and no retry. */
  var fatal = "";
  /** The enterprise login token — the credential the relay credits as subscriber. */
  var credential = "";
  /** Browser storage is unusable, so a login page could not persist a token either. */
  var storageBlocked = false;
  /** This page's one automatic renewal has been spent (see `renewSession`). */
  var renewedOnce = false;
  /** The renewal in flight, shared by every caller while it lasts. */
  var refreshPromise = null;
  var heartbeatTimer = null;
  var nextId = 1;
  var pending = {};
  var outbox = [];
  var warned = {};
  /** Everything the page has seen for the current session — the window it keeps. */
  var messages = [];
  /** The serving process's live sessions, as the shared session list renders them. */
  var sessions = [];
  var sessionId = CONFIG.sessionId;
  /** False until the page has chosen a session once: `?session=` only wins then. */
  var picked = false;
  /** Bumped by every pull and by every switch, so a reply that a switch
   *  overtook can be recognized and dropped instead of landing in the new view. */
  var pullToken = 0;
  /**
   * Whether the session on screen is generating, as the page last learned it.
   *
   * One variable rather than a value read off each push, because this state has
   * two sources and they must not disagree: the host's `loadingChange` is a
   * *transition* (only the start or end that happens while this page is
   * listening) while the session registry is a *state* readable at any moment.
   * A page that arrived mid-turn has heard neither, so the composer would offer
   * 「发送」 for the whole turn — and a phone has no Escape key to reach
   * `abortMessage` any other way. See `applyStreaming`.
   */
  var streaming = false;
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

  // ── Where to go, and what to say ────────────────────────────────
  //
  // Both are same-origin facts rather than build-time config: the page is
  // served from `/remote/` on the relay's own domain, so its socket address is
  // derivable, and the credential is the enterprise login the user already has
  // (same origin ⇒ same storage). The enterprise frontend owns those key names,
  // when they expire, and the endpoint that renews them — a coupling we do not
  // control, so every name of theirs is spelled out once, in the constants at
  // the top of this file, and nowhere else.

  /** Relay channel path; mirrors `hostChannelPath` from `GET /api/relay/config`. */
  var CHANNEL_PATH = "/v1/hosts/ws/{hostId}/subscribe";

  function readStored(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (err) {
      // Storage blocked (private mode, partitioned context): indistinguishable
      // from "not logged in" here, and the relay would refuse us anyway. It also
      // means a login round-trip is pointless — the login page could not store
      // the token we came back for.
      storageBlocked = true;
      warnOnce("storage", "读不到浏览器存储，按未登录处理：" + err.message);
      return "";
    }
  }

  /**
   * Write a renewed credential back. A storage that refuses writes is the same
   * situation as one that refuses reads (the login page could not persist a
   * token either), so it sets the same flag — but the caller still holds a
   * usable credential for as long as this page stays open.
   */
  function writeStored(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      storageBlocked = true;
      warnOnce(
        "storage-write",
        "写不进浏览器存储（新凭证只在本次打开期间有效）：" + err.message,
      );
    }
  }

  /**
   * Whether the stored token is past its own expiry. An absent `expiresAt`
   * counts as usable: that key belongs to the enterprise, and a blank answer is
   * not evidence of expiry — the handshake is the only authority we trust on it.
   */
  function tokenExpired() {
    var at = Number(readStored(EXPIRES_KEY));
    return !!at && Date.now() >= at;
  }

  /**
   * Renew the enterprise session in place. The enterprise's own SPA does exactly
   * this on cold start, and not doing it is why an hour-old page used to cost a
   * login round-trip even though the refresh token was good for 30 days.
   *
   * One request at a time, and one attempt per page load. At a time, because
   * renewal rotates the refresh token — a second request would carry the one the
   * first just invalidated. Per page load, because a renewal the relay still
   * refuses must not become the page bouncing between a renewal and a login
   * page.
   *
   * False means "no usable credential came out of this", never "the stored
   * credentials are bad": nothing is written unless the whole answer arrived, so
   * a network blip cannot cost the user a refresh token that is still valid.
   */
  function renewSession() {
    // A renewal already in flight is shared, not repeated: the refresh token
    // rotates, so a second request would carry the one the first just
    // invalidated — and both callers are asking the same question.
    if (refreshPromise) return refreshPromise;
    if (renewedOnce) return Promise.resolve(false);
    renewedOnce = true;
    if (storageBlocked) return Promise.resolve(false);
    var refreshToken = readStored(REFRESH_KEY);
    if (!refreshToken) return Promise.resolve(false);
    refreshPromise = fetch(REFRESH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshToken }),
    })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (body) {
        // The answer is the login response's shape (see the constants above), and
        // a body without a token is not one.
        if (!body || !body.token) return false;
        credential = body.token;
        writeStored("token", body.token);
        // A field the answer left out keeps the value already stored, rather than
        // being written as "undefined" / "NaN": the enterprise's own SPA writes
        // every one of them unconditionally, but a refresh token turned into a
        // literal is one nothing can repair short of a fresh login, and it would
        // replace one that may still be good. Only what actually arrived is
        // written.
        if (body.refreshToken) writeStored(REFRESH_KEY, body.refreshToken);
        if (body.expiresInSeconds)
          writeStored(
            EXPIRES_KEY,
            String(Date.now() + body.expiresInSeconds * 1000),
          );
        // Same shape as login, so the freshest user comes back too (an email
        // changed elsewhere should not be displayed from the old one).
        if (body.user) writeStored(USER_KEY, JSON.stringify(body.user));
        return true;
      })
      .catch(function (err) {
        warnOnce("refresh", "静默续期失败：" + err.message);
        return false;
      })
      .then(function (renewed) {
        refreshPromise = null;
        return renewed;
      });
    return refreshPromise;
  }

  function deriveSocketUrl(hostId) {
    var url = new URL(window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = CHANNEL_PATH.replace("{hostId}", encodeURIComponent(hostId));
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  /**
   * Whether there is a login page to send the user to. In production the page is
   * served from the enterprise's own domain, so the login page is one path away;
   * the local debug copy (`file:`, localhost) has nothing to log in to, and
   * navigating would only land on a 404 — it keeps the on-page notice instead.
   */
  function canReachLogin() {
    var protocol = window.location.protocol;
    if (protocol !== "http:" && protocol !== "https:") return false;
    var host = window.location.hostname;
    return (
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      host !== "[::1]" &&
      !/\.localhost$/.test(host)
    );
  }

  /**
   * One automatic round-trip per window. The marker must outlive the navigation
   * (we leave the page and come back), so it lives in sessionStorage — per tab,
   * and dropped with it. Without it, a login that cannot fix the credential
   * (revoked account, storage the page cannot read) would ping-pong the browser
   * between the two pages forever.
   */
  function hoppedRecently() {
    try {
      var at = Number(window.sessionStorage.getItem(LOGIN_HOP_KEY));
      return !!at && Date.now() - at < LOGIN_HOP_MS;
    } catch {
      return true;
    }
  }

  /**
   * Take the user to the enterprise login page and bring them back to this very
   * address (channel key included) once they are logged in. Returns false when
   * that is not an option, so the caller puts the reason on the page instead:
   * local debug page, unusable storage, or we just came back from a hop that
   * fixed nothing.
   *
   * The login page owns the "logged in, now go back" half — all this page does is
   * hand it a same-origin path and ask to be returned to it. Nothing is preserved
   * beyond the address, because there is nothing else to preserve: no state, no
   * second account.
   */
  function hopToLogin() {
    if (!canReachLogin() || storageBlocked || hoppedRecently()) return false;
    var target = window.location.pathname + window.location.search;
    try {
      window.sessionStorage.setItem(LOGIN_HOP_KEY, String(Date.now()));
    } catch {
      // The marker is only the loop guard; the hop itself still works.
    }
    warnOnce("login", "登录态不可用，转去企业端登录页：" + target);
    window.location.replace(
      LOGIN_PATH + "?" + REDIRECT_PARAM + "=" + encodeURIComponent(target),
    );
    return true;
  }

  function authFrame() {
    // `version` belongs at the top level — inside `params` the relay cannot
    // read it and quietly lets everything through.
    return {
      type: "auth",
      credential: { type: "sso", token: credential },
      version: PAGE_CONFIG.version || "",
    };
  }

  /** Resolve where to connect and what to say, then connect. */
  function boot() {
    credential = readStored("token");
    // The ordinary case for a page that stays open, or is opened days later: a
    // token with nothing wrong with it goes straight out, no request spent on
    // asking whether it is still good.
    if (credential && !tokenExpired()) return startConnecting();
    // Missing or stale — the two look the same from here, and both are worth one
    // renewal before the user is asked for a password.
    renewSession().then(function (renewed) {
      if (renewed) startConnecting();
      else noCredential();
    });
  }

  /** Everything after "there is a credential": where to go, and what to say. */
  function startConnecting() {
    if (CONFIG.socketUrl) return connect();
    if (CONFIG.hostId) {
      CONFIG.socketUrl = deriveSocketUrl(CONFIG.hostId);
      return connect();
    }
    fail("地址里没有通道键（host=）：请打开电脑侧给出的那个页面地址。");
  }

  /**
   * Nothing usable to say to the relay and no way to renew one: go get a
   * credential (see `hopToLogin`). When a round-trip is not available, the
   * reason stays on the page.
   */
  function noCredential() {
    if (hopToLogin()) return;
    fail("请先在企业端登录，再打开这个页面（页面复用企业端登录态）。");
  }

  function fail(reason) {
    blocked = reason;
    showStatus(reason);
  }

  // ── Transport ───────────────────────────────────────────────────

  function connect() {
    if (!CONFIG.socketUrl) {
      fail(
        "页面缺少中继地址：地址里要有 host=，或用 ?ws=wss://… 打开（中继服务见 codechat#40）。",
      );
      return;
    }
    authed = false;
    fatal = "";
    // `socket` is always the connection in use: a handshake redone after a
    // renewal abandons the refused one, and that socket's late frames (its own
    // `auth_error`, or the 4003 the relay follows it with) describe a connection
    // nobody is using — they must not paint over the live one or schedule a
    // retry on its behalf.
    var ws = new WebSocket(CONFIG.socketUrl);
    socket = ws;

    ws.onopen = function () {
      if (ws !== socket) return;
      attempts = 0;
      clearStatus();
      // The handshake owns the first frame. On an unauthenticated connection
      // the relay parses *every* frame as `auth`, and a parse failure is a
      // permanent 4003 — so nothing else may go out until `auth_ok`.
      ws.send(JSON.stringify(authFrame()));
    };

    ws.onmessage = function (event) {
      if (ws !== socket) return;
      var frame;
      try {
        frame = JSON.parse(event.data);
      } catch (err) {
        console.warn("[wave-remote] 丢弃无法解析的帧", err);
        return;
      }
      // Control frames (a top-level `type`, no `method`) are the relay's own
      // and must never reach the agent bridge; JSON-RPC never carries `type`.
      if (
        frame &&
        typeof frame.type === "string" &&
        frame.method === undefined
      ) {
        handleControl(frame);
        return;
      }
      if (frame && frame.id !== undefined) settle(frame);
      else if (frame && frame.method)
        deliver(frame.method, frame.params, frame.sessionId);
    };

    ws.onclose = function (event) {
      if (ws !== socket) return;
      authed = false;
      stopHeartbeat();
      if (fatal) {
        showStatus(fatal);
        return;
      }
      if (event.code === AUTH_TIMEOUT_CLOSE) {
        showStatus(
          "中继拒绝了这个连接（未授权）。请在电脑侧重新开启远程控制。",
        );
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        showStatus("中继连接断开（" + event.code + "）— 已停止重试。");
        return;
      }
      attempts++;
      showStatus(
        event.code === 4001
          ? "电脑侧不在线，正在重试…(第 " + attempts + " 次)"
          : "正在重连…(第 " + attempts + " 次)",
      );
      setTimeout(connect, RETRY_MS);
    };

    ws.onerror = function () {
      // `close` follows and owns the retry/status decision.
    };
  }

  /** The relay's own frames: five kinds, none of which is an RPC call. */
  function handleControl(frame) {
    switch (frame.type) {
      case "auth_ok":
        authed = true;
        startHeartbeat();
        flushOutbox();
        // A reconnect only needs the delta; the first connection already has
        // its initial pull queued (or about to be asked for).
        if (connectedOnce) {
          resync();
          // …but a delta carries no state, and the turn the user came back to
          // may be one that started while the connection was down — its
          // `loadingChange` was never delivered. See `refreshStreaming`.
          refreshStreaming();
        }
        connectedOnce = true;
        return;
      case "pong":
        return;
      case "auth_error":
        // A token we did send came back invalid (expired or revoked). It may
        // only be an hour old while the refresh token behind it is good for a
        // month, so the first refusal gets a silent renewal before the login
        // round-trip; `renewSession` owns "one, and only one".
        if (frame.error === "invalid_token") {
          renewSession().then(function (renewed) {
            // `connect` sends the handshake again, by then carrying whatever
            // credential we hold.
            if (renewed) connect();
            else settleAuthError(frame);
          });
          return;
        }
        settleAuthError(frame);
        return;
      case "peer_disconnected":
        showStatus("电脑侧已断开（这台机器没在跑，或刚重启过）。");
        return;
      case "resync_required":
        // The relay dropped frames for a slow subscriber. The delta anchor is
        // no longer trustworthy, so this is the full re-pull.
        warnOnce("resync_required", "中继丢弃了积压的帧，正在重拉快照。");
        pullSnapshot();
        return;
      default:
        warnOnce("ctrl:" + frame.type, "未识别的中继控制帧：" + frame.type);
    }
  }

  /**
   * The ending every refused handshake shares: an unusable token is the login
   * page's business, anything else is a permanent reason to park on screen. The
   * two lines the `auth_error` branch has always ended with, moved out so a
   * renewal that came back empty-handed exits through the very same door.
   */
  function settleAuthError(frame) {
    if (frame.error === "invalid_token" && hopToLogin()) return;
    fatal = authErrorMessage(frame);
    showStatus(fatal);
  }

  function authErrorMessage(frame) {
    switch (frame.error) {
      case "invalid_token":
        return "登录态无效或已过期：请在企业端重新登录后再打开这个页面。";
      case "unknown_host":
        return "这台电脑没有登记过这个通道（可能已被解绑）：请在电脑侧重新开启远程控制。";
      case "unauthorized":
        return "这个通道不属于当前账号。";
      case "invalid_channel":
        return "地址里的通道键形状不对：请用电脑侧给出的页面地址打开。";
      case "host_version_unsupported":
        return (
          "电脑侧 wave 版本过低（需要 ≥ " +
          (frame.minVersion || "?") +
          "），请升级电脑侧。"
        );
      case "auth_timeout":
        return "握手超时：中继没有在时限内收到凭证。";
      case "relay_disabled":
        return "这个部署没有启用远程会话。";
      default:
        return "中继拒绝了握手（" + (frame.error || "未知原因") + "）。";
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(function () {
      if (socket && socket.readyState === 1)
        socket.send(JSON.stringify({ type: "ping" }));
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function send(frame) {
    var line = JSON.stringify(frame);
    if (authed && socket && socket.readyState === 1) socket.send(line);
    else outbox.push(line);
  }

  function flushOutbox() {
    if (!socket || socket.readyState !== 1) return;
    var queued = outbox;
    outbox = [];
    for (var i = 0; i < queued.length; i++) socket.send(queued[i]);
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

  /**
   * A reply arrives in the host's JSON-RPC envelope — `{id, method:"result",
   * params:{result}}`, or `method:"error"` with `params:{code,message}` — not as
   * a bare `{result}`. Reading `frame.result` resolved every request to
   * `undefined`: `listSessions` fell through to "电脑侧还没有会话。", an empty
   * `getMessages` page looked like the beginning of the conversation, and no
   * reply ever rejected.
   */
  function settle(frame) {
    var entry = pending[frame.id];
    if (!entry) return;
    delete pending[frame.id];
    var params = frame.params || {};
    if (frame.method === "error") {
      entry.reject(new Error(params.message || "RPC 失败"));
    } else {
      entry.resolve(params.result);
    }
  }

  // ── Host → page translation ─────────────────────────────────────
  //
  // The desktop/IDE hosts each translate these same RPC notifications into the
  // webview's own message vocabulary; the phone needs the same table, trimmed
  // to the surfaces this page renders.

  function deliver(method, params, frameSessionId) {
    var p = params || {};
    // The channel is device-level: every session this machine's process holds
    // emits on it, and the envelope's sessionId is the only thing that says
    // which one a frame belongs to. The page renders exactly one conversation,
    // so a frame for another session is dropped here — dropping costs nothing
    // (a session the user switches to is re-read through `getMessages`), while
    // letting it through mixes two conversations into one list and, worse,
    // re-points the page's own sessionId at whichever session spoke last.
    //
    // Approvals are the exception: a pending request is a process-wide fact
    // (`listPendingPermissions` reports every session's, and the reply is routed
    // by requestId, not by session), and it is the one thing the user must not
    // miss — it is usually waiting in a session they are not looking at.
    if (
      frameSessionId &&
      frameSessionId !== sessionId &&
      method !== "permissionRequest"
    ) {
      return;
    }

    switch (method) {
      case "messagesChange":
      // The machine's remote path sends the same notification under the older
      // name when the CLI on the other end predates the rename; both mean "the
      // list changed, no payload".
      case "messagesChanged":
        // Two shapes: the full array (a host snapshot) and the content-free
        // signal the remote path sends instead. The signal is the norm here —
        // 13 MB of displayMessages must never reach the phone.
        if (Array.isArray(p.messages)) {
          messages = p.messages;
          post({ command: "updateMessages", messages: messages });
        } else if (p.full) {
          // The signal that stands in for a frame too large to send. It may
          // have been an approval request (those carry the command and the
          // diff), so re-reading only the messages is not enough — the whole
          // snapshot, pending approvals included, is what makes it recoverable.
          pullSnapshot();
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
        applyStreaming(p.loading === true);
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
    // Nothing to ask: `boot` already put the reason on screen (not logged in,
    // no channel key, handshake refused).
    if (blocked) return Promise.resolve();
    var token = ++pullToken;
    return pickSession()
      .then(function () {
        if (token !== pullToken || !sessionId) return null;
        return request("getMessages", { limit: CONFIG.firstPageLimit });
      })
      .then(function (result) {
        if (token !== pullToken) return null;
        if (result) messages = result.messages || [];
        return request("listPendingPermissions", {});
      })
      .then(function (result) {
        if (token !== pullToken) return null;
        var requests = (result && result.requests) || [];
        if (!sessionId && requests.length)
          sessionId = requests[0].sessionId || "";
        post({
          command: "setInitialState",
          messages: messages,
          tasks: [],
          backgroundTasks: [],
          workflowRuns: [],
          // Read off the registry by `pickSession`, not assumed: a page that
          // arrives mid-turn must still offer the stop button — the phone has no
          // Escape key. Read here rather than captured, so a transition that
          // arrived while `getMessages` was in flight still wins.
          isStreaming: streaming,
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
        if (blocked || token !== pullToken) return;
        showStatus("拉取会话失败：" + err.message);
      });
  }

  /**
   * Scroll-up paging: the page the reader pulled the list up to the top of. The
   * host's `before` is an EXCLUSIVE anchor and `hasMore` says whether anything is
   * older still — false is "this was the beginning", which the page shows and
   * stops asking after. A failure moves nothing and does not fall back to a tail
   * re-pull: that path replaces the very position the reader is holding on to
   * (spec「Web 页作为第五种宿主」场景 12).
   */
  function loadOlder(before, requestId) {
    if (!sessionId || !before) {
      post({
        command: "olderMessages",
        requestId: requestId,
        messages: [],
        hasMore: false,
      });
      return;
    }
    request("getMessages", { before: before, limit: CONFIG.firstPageLimit })
      .then(function (result) {
        var earlier = (result && result.messages) || [];
        // This array is the page's window: `resync` anchors its `since` on the
        // last entry of it. Older messages join the front, exactly as they do in
        // the webview's own list.
        if (earlier.length) messages = earlier.concat(messages);
        post({
          command: "olderMessages",
          requestId: requestId,
          messages: earlier,
          hasMore: !!(result && result.hasMore),
        });
      })
      .catch(function (err) {
        warnOnce("older", "翻更早失败：" + err.message);
        post({
          command: "olderMessagesError",
          requestId: requestId,
          error: String(err.message || err),
        });
      });
  }

  /** Reconnect / structural change: fetch only what was appended. */
  function resync() {
    if (!sessionId) return pullSnapshot();
    var last = messages.length ? messages[messages.length - 1].id : "";
    if (!last) return pullSnapshot();
    var token = pullToken;
    return request("getMessages", { since: last, limit: CONFIG.firstPageLimit })
      .then(function (result) {
        // A switch since this was sent owns the view now: its own snapshot is
        // already on its way, and this reply describes the previous session.
        if (token !== pullToken) return null;
        if (result.reset) return pullSnapshot();
        var later = result.messages || [];
        for (var i = 0; i < later.length; i++) messages.push(later[i]);
        post({ command: "updateMessages", messages: messages });
      })
      .catch(function (err) {
        if (token !== pullToken) return null;
        warnOnce("resync", "补差失败，改为重拉：" + err.message);
        return pullSnapshot();
      });
  }

  /**
   * The sessions this machine's process holds **right now** — the page's session
   * list, and the only set it can actually open.
   *
   * Deliberately `listDaemonSessions` (the in-memory registry) and not
   * `listSessions` (the transcripts on disk): reading a session requires it to
   * be live in the serving process, so the disk list would render entries that
   * fail the moment they are tapped, and it only spans one working directory.
   * Entries are mapped onto the shape the shared list renders, so the webview
   * needs no special case.
   */
  function pickSession() {
    return loadSessions()
      .then(function () {
        chooseSession();
        // The registry is read right here anyway, and it is the only place the
        // busy state exists as a *state* rather than as a transition — see
        // `applyStreaming`. Reading it off the same reply also means a page that
        // opens (or switches) mid-turn knows it is mid-turn.
        applyStreaming(isBusy(currentSession(sessions, sessionId)));
        if (!sessionId) showStatus("电脑侧还没有正在跑的会话。");
        else clearStatus();
      })
      .catch(function (err) {
        // A refusal here is not cosmetic: with no list there is no session, so
        // the page would otherwise sit there blank. The likeliest cause is a
        // machine older than this page (the method is behind the machine's own
        // remote allowlist), which the relay's version floor is meant to catch
        // before this can happen.
        showStatus("读不到电脑侧的会话列表：" + err.message);
      });
  }

  /** Re-read the live session registry into `sessions`. */
  function loadSessions() {
    return request("listDaemonSessions", {}).then(function (result) {
      sessions = ((result && result.sessions) || []).map(toSessionMetadata);
      // Most recently active first: the list is a picker, and this is the only
      // ordering signal the page has (it cannot see the computer's screen).
      sessions.sort(function (a, b) {
        return String(b.lastActiveAt || "").localeCompare(
          String(a.lastActiveAt || ""),
        );
      });
    });
  }

  /**
   * Catch up on the one thing a reconnect cannot have heard: `loadingChange`.
   *
   * A connection that was down missed every transition that happened while it
   * was down — including the one that started the turn the user is coming back
   * to, which is the common case on a phone (a backgrounded page has its socket
   * dropped and its turn keeps running). `resync` carries a message delta and no
   * state, so the busy flag is re-read from the registry, which is where the
   * transitions come from in the first place. The pick is deliberately left
   * alone: a reconnect is not a reason to move the reader to another
   * conversation, and a pick that died meanwhile fails on its own read and lands
   * on `pullSnapshot`, which re-picks.
   *
   * `force` is for the caller that knows the UI is **not** where this page left
   * it (a re-mounted app reset its own reducer to idle), where "already told
   * them once" is no longer a reason to stay quiet.
   */
  function refreshStreaming(force) {
    return loadSessions()
      .then(function () {
        applyStreaming(isBusy(currentSession(sessions, sessionId)), force);
      })
      .catch(function () {});
  }

  /** A registry entry's busy flag: the host's own "this turn is running". */
  function isBusy(entry) {
    return !!(entry && entry.isLoading === true);
  }

  /**
   * Set the composer's busy state and tell the page.
   *
   * Both sources land here and the later one wins, which is the right rule on an
   * ordered channel: whichever of the two describes the machine later also
   * arrives later. Only a change is sent (a page that is idle and hears "idle"
   * has nothing to do), and every snapshot re-states the flag in its own
   * `setInitialState` payload anyway, so the two together cover both the
   * silent-agreement case and a UI that re-mounted behind our back.
   */
  function applyStreaming(busy, force) {
    if (!force && busy === streaming) return;
    streaming = busy;
    post({ command: busy ? "startStreaming" : "endStreaming" });
  }

  /**
   * Keep the current pick if it is still live, else re-pick. A session can end
   * while the page sits idle (the user closed it, or the daemon was restarted),
   * and a dead id would only produce "Session not found" on every read.
   */
  function chooseSession() {
    if (currentSession(sessions, sessionId)) {
      picked = true;
      return;
    }
    // `?session=` is a pin from the address, honored only on the first pick and
    // only when it names a session this process holds — the same rule the list
    // itself follows. Afterwards the user's own choice wins.
    var pinned = picked
      ? undefined
      : currentSession(sessions, CONFIG.sessionId);
    picked = true;
    var next = pinned || sessions[0];
    sessionId = next ? next.id : "";
  }

  /** Registry entry (`listDaemonSessions`) → what the shared list renders. */
  function toSessionMetadata(entry) {
    return {
      id: entry.sessionId,
      sessionType: "main",
      workdir: entry.workingDirectory,
      customTitle: entry.customTitle,
      firstMessage: entry.firstMessage,
      lastActiveAt: entry.lastActiveAt,
      isLoading: entry.isLoading === true,
    };
  }

  function currentSession(list, id) {
    if (!id) return undefined;
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
        if (openedOnce) {
          resync();
          // A re-mounted app reset its own reducer to idle, so the flag is
          // re-stated even if this page believes it already said so.
          refreshStreaming(true);
        } else {
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

      case "restoreSession": {
        // "Show me that conversation in this view" — answered **locally**, which
        // is the whole point of the phone being a control surface. The machine's
        // own `restoreSession` is an *in-place* load: it swaps the target
        // conversation into the session it replaces, which on a desktop host is
        // the conversation the user is looking at. The page only re-points its
        // own view at a session that is already live in the serving process, so
        // nothing on the computer moves (spec remote-control「Web 页作为第五种
        // 宿主」场景 9).
        if (!msg.sessionId || msg.sessionId === sessionId) return;
        var target = currentSession(sessions, msg.sessionId);
        if (!target) {
          // Only live sessions are actionable; the list is built from them, so
          // this is the "the session ended while the list was open" case.
          showStatus("这条会话已经不在电脑侧的运行中了。");
          return;
        }
        sessionId = target.id;
        picked = true;
        messages = [];
        // Re-pull instead of asking the machine to switch: the target is already
        // live, so its tail and its pending approvals come through the same
        // `getMessages` + `listPendingPermissions` path a cold start uses.
        pullSnapshot();
        return;
      }

      case "abortMessage":
        request("abortMessage", {}).catch(function () {});
        return;

      case "loadOlderMessages":
        loadOlder(msg.before, msg.requestId);
        return;

      case "confirmationResponse": {
        // An approval is a **notification**, not a request: that is the frame
        // shape this protocol defines for `permissionResponse` (the IDE and
        // desktop hosts send it through `sendPermissionResponse` → `notify`,
        // with no id), and the host side has no request handler for it. Both
        // `AgentBridge` and `RemoteControlCliHost` answer an id-carrying
        // `permissionResponse` with "Method not found" — so asking it as a
        // request made every approval on this page fail invisibly: the reply
        // came back as an error frame the page logged and dropped, the machine
        // kept waiting, and the approval reappeared on the next resync.
        //
        // The webview names it confirmationId and may send only `approved`;
        // the wire wants a requestId and a decision.
        var approval = {
          method: "permissionResponse",
          params: {
            requestId: msg.confirmationId,
            decision: msg.decision || {
              behavior: msg.approved ? "allow" : "deny",
            },
          },
        };
        if (sessionId) approval.sessionId = sessionId;
        send(approval);
        return;
      }

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

  boot();
})();

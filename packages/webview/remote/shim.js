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
  /**
   * Backoff ceiling for the transient-close retry loop. The loop itself is
   * unbounded — the page outlives the outage it is waiting out (a machine that
   * switched remote control off and on, a relay restart), and a budget spent
   * means a home-screen page that never comes back on its own.
   */
  var RETRY_MS_MAX = 30000;
  /** The relay closes an unauthenticated connection after this long. */
  var AUTH_TIMEOUT_CLOSE = 4003;
  /** Application-level keepalive; the relay answers each `ping` with a `pong`. */
  var HEARTBEAT_MS = 30000;
  /**
   * How long a request may stay unanswered, by method.
   *
   * 20s is the budget for "the machine answers at once": every read and every
   * control write. A **turn-length** method is the exception — its reply is sent
   * only once the whole turn is over, and a turn has no upper bound. It can loop
   * through tools for minutes, and it parks indefinitely on an approval nobody
   * has answered yet — usually the person holding this phone. Waiting for that
   * reply is therefore not a liveness check at all: the message is delivered the
   * moment the frame leaves, and the turn itself is visible in the message
   * stream. `TURN_METHODS` is what keeps a 40-second turn from being reported as
   * a failure; see `timeoutText` and the `sendMessage` case.
   */
  var REQUEST_TIMEOUT_MS = 20000;
  var TURN_TIMEOUT_MS = 300000;
  var TURN_METHODS = { sendMessage: true, compact: true };
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
  /**
   * The machine list, and where the last choice is remembered. Same-origin REST
   * on the page's own deployment (the CSP carries `connect-src 'self'` for
   * exactly this — and for the renewal just above, which predates it); the
   * credential is the same enterprise JWT the handshake uses.
   */
  var HOSTS_PATH = "/api/relay/hosts";
  var LAST_HOST_KEY = "wave_remote_last_host";
  /** What the machine registered with (`process.platform`) → display label. */
  var PLATFORM_LABELS = { darwin: "macOS", win32: "Windows", linux: "Linux" };
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
  /** The pending reconnect timer, and the delay the next one waits. */
  var retryTimer = null;
  var retryDelay = RETRY_MS;
  /**
   * Set by a machine switch: the view on screen still describes the previous
   * machine, so the next `auth_ok` must re-pull a full snapshot. The app is
   * already mounted by then (no second `webviewReady` will come), which is what
   * makes pulling from `auth_ok` safe — on a cold start the first pull belongs
   * to `webviewReady`, whose ordering guarantee the snapshot relies on.
   */
  var needsSnapshot = false;
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
  /**
   * The approvals this page is showing because this shim put the cards there —
   * the ids, not the cards.
   *
   * It exists for the re-read in `refreshPending`: the registry is a *state*, so
   * a request it reports may be one the page already has from the notification
   * (which is a *transition*), and the page's reducer **appends** — posting the
   * same id twice would leave two cards standing for one approval, and the
   * dialog only ever shows the first. An id leaves this set when the user answers
   * on this page, and only then: the card is gone from the page either way, so
   * keeping it would merely stop a request the machine is still waiting on from
   * ever being offered again.
   */
  var shownApprovals = {};
  var banner = null;

  // ── Page → host plumbing ────────────────────────────────────────

  /**
   * The banner's look. Two tones, because the banner says two different kinds of
   * thing: a refusal (`#5a1d1d` — the link is down or something was refused) and
   * `"progress"` (`#333333` — the page is doing something and has nothing else
   * to show yet). A progress line in the error colour reads as 「出事了」, which
   * is why the machine list moved its own two states off this banner entirely
   * (spec「机器列表与切换」场景 8).
   */
  function bannerStyle(tone) {
    return (
      "position:fixed;z-index:9999;left:0;right:0;top:0;padding:8px 12px;" +
      "display:flex;align-items:center;flex-wrap:wrap;gap:8px;" +
      "font:13px/1.5 -apple-system,system-ui,sans-serif;color:#fff;" +
      "background:" +
      (tone === "progress" ? "#333333" : "#5a1d1d") +
      ";"
    );
  }

  /**
   * The page's status surface. `actions` adds tappable buttons after the text —
   * the two things this page can always do for itself while the link is down:
   * retry now, or go pick another machine (spec「断线自愈」场景 4、「机器列表与
   * 切换」场景 5). Without actions it is the plain banner it always was.
   *
   * Every call states its tone: the banner outlives a single message, so the one
   * that follows a refusal must be able to paint it neutral again.
   */
  function showStatus(text, actions, tone) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "remote-status";
      document.body.appendChild(banner);
    }
    banner.setAttribute("style", bannerStyle(tone));
    banner.textContent = "";
    var label = document.createElement("span");
    label.textContent = text;
    banner.appendChild(label);
    for (var i = 0; i < (actions || []).length; i++) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = actions[i].label;
      button.setAttribute(
        "style",
        "padding:2px 10px;font:inherit;color:#fff;background:rgba(255,255,255,0.14);" +
          "border:1px solid rgba(255,255,255,0.4);border-radius:6px;cursor:pointer;",
      );
      button.onclick = actions[i].onClick;
      banner.appendChild(button);
    }
  }

  function clearStatus() {
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  /** The banner actions, built per call so the closures see fresh state. */
  function reconnectAction() {
    return { label: "重新连接", onClick: manualReconnect };
  }

  function switchHostAction() {
    return { label: "换机器", onClick: openMachinePicker };
  }

  function retryHostsAction(surface) {
    return { label: "重试", onClick: surface.retry };
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
    // No channel key in the address — the normal shape for the home-screen
    // icon. The page picks the machine itself: the last choice, or the list.
    chooseHost();
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
    // Already serving: a manual reconnect tap during a live session is a no-op.
    // A handshake redone after a renewal still passes — its socket was refused,
    // so `authed` is false by then.
    if (authed && socket && socket.readyState === 1) return;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
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
      // Any open counts as success: the next drop starts from the fastest step.
      retryDelay = RETRY_MS;
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
      // Permanent refusals stop here and keep their reason on screen: retrying
      // cannot change a revoked token, a wrong channel, or an old machine, and
      // would only bury the explanation under activity (spec「断线自愈」场景 3).
      if (fatal) {
        showStatus(fatal, [switchHostAction()]);
        return;
      }
      if (event.code === AUTH_TIMEOUT_CLOSE) {
        showStatus(
          "中继拒绝了这个连接（未授权）。请在电脑侧重新开启远程控制。",
          [switchHostAction()],
        );
        return;
      }
      // Everything else is transient (4001 machine offline, network blip,
      // relay restart) and the page outlives it: wait out the outage with an
      // unbounded, capped backoff instead of a retry budget that runs dry
      // while the machine is still off (spec「断线自愈」场景 1 / 2).
      attempts++;
      var delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_MS_MAX);
      showStatus(
        event.code === 4001
          ? "电脑侧不在线，等待上线…（第 " + attempts + " 次重试）"
          : "连接断开（" +
              event.code +
              "），正在重连…（第 " +
              attempts +
              " 次）",
        [reconnectAction(), switchHostAction()],
      );
      scheduleRetry(delay);
    };

    ws.onerror = function () {
      // `close` follows and owns the retry/status decision.
    };
  }

  /**
   * One pending reconnect at a time: a scheduled retry that a manual reconnect
   * replaced must not fire afterwards and open a second socket behind the live
   * one.
   */
  function scheduleRetry(delay) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      retryTimer = null;
      connect();
    }, delay);
  }

  /** The banner's 「重新连接」: forget the backoff and try this second. */
  function manualReconnect() {
    if (!CONFIG.socketUrl) return;
    retryDelay = RETRY_MS;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    // A handshake is already on its way out; stacking another on top would
    // abandon it for no gain.
    if (socket && socket.readyState === 0) return;
    clearStatus();
    connect();
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
          // Same reason, and the cost of missing it is higher: an approval that
          // asked while the link was down was dropped, and no amount of message
          // delta brings it back. See `refreshPending`.
          refreshPending();
          // …and the session-state family (mode, todo list, compaction, command
          // running, queue) was equally dropped mid-change, leaving the page on
          // values the session no longer has. See `refreshSessionState`.
          refreshSessionState();
        }
        connectedOnce = true;
        if (needsSnapshot) {
          // A machine switch just finished: the mounted app still shows the
          // previous machine's view, and no `webviewReady` will come to replace
          // it — this pull is that replacement (spec「机器列表与切换」场景 5).
          needsSnapshot = false;
          pullSnapshot();
        }
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

  // ── Which machine ───────────────────────────────────────────────
  //
  // One page, one icon, every machine: the address no longer has to carry the
  // channel key. When `?host=` is absent the page asks the relay's REST API for
  // the account's machines and connects to the last one picked — or shows the
  // list. A link that does carry `?host=` behaves exactly as before and never
  // fetches the list (spec「机器列表与切换」场景 1).

  function platformLabel(platform) {
    return PLATFORM_LABELS[platform] || platform || "";
  }

  /** The account's machines, as the relay's REST API reports them. */
  function fetchHosts() {
    return fetch(HOSTS_PATH, {
      headers: { Authorization: "Bearer " + credential },
    }).then(function (response) {
      if (response.status === 401) {
        // A refusal here never reaches the handshake's own ladder
        // (`auth_error` → renew → hop), so the same ladder runs for the REST
        // call: one silent renewal, then the login page.
        throw Object.assign(new Error("unauthorized"), { authRequired: true });
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json().then(function (body) {
        var hosts = (body && body.hosts) || [];
        var clean = [];
        for (var i = 0; i < hosts.length; i++) {
          if (hosts[i] && typeof hosts[i].id === "string" && hosts[i].id)
            clean.push(hosts[i]);
        }
        return clean;
      });
    });
  }

  /**
   * Where a machine-list refusal is painted, and what its 重试 runs.
   *
   * There are two, because the two entry points are in different situations: on a
   * cold start the banner *is* the page's only surface (nothing else has anything
   * to say yet), while a reader who came from the header already has a dialog in
   * front of them — and an untouched banner behind it (spec 场景 8).
   */
  function bannerSurface() {
    return {
      show: function (text, actions) {
        showStatus(text, actions);
      },
      retry: chooseHost,
    };
  }

  function pickerSurface(list) {
    return {
      show: function (text, actions) {
        // The reader closed the dialog while the request was out: this refusal
        // was for a list nobody is looking at any more, so it goes nowhere —
        // the 重试 that would answer it went with the dialog.
        if (!pickerOpen()) return;
        paintMachineList(list, null, { text: text, actions: actions });
      },
      retry: function () {
        loadMachineList(list);
      },
    };
  }

  /** What both entry points do when the list will not come. */
  function hostsFetchFailed(err, surface) {
    if (err && err.authRequired) {
      renewSession().then(function (renewed) {
        if (renewed) return surface.retry();
        if (hopToLogin()) return;
        // Neither round-trip is available, so this page can never reach a machine
        // (see `fail`) — the sentence just lands wherever this read was being read.
        var text = "登录态无效：请在企业端重新登录后再打开这个页面。";
        blocked = text;
        surface.show(text, [retryHostsAction(surface)]);
      });
      return;
    }
    surface.show("取不到机器列表：" + (err.message || err), [
      retryHostsAction(surface),
    ]);
  }

  /**
   * Cold start with no channel key in the address. The remembered choice
   * connects directly — the home-screen icon opens to the same machine it was
   * last used with — unless that machine is no longer in the list, which is
   * what the fetch is for: without it, an unbound channel would fail the
   * handshake with nothing but a refusal to show (spec 场景 2 / 3).
   */
  function chooseHost() {
    // A progress line, not a refusal: on a cold start this banner is the only
    // thing the page can say while it reads (spec 场景 8).
    showStatus("正在读取机器列表…", [], "progress");
    fetchHosts()
      .then(function (hosts) {
        var saved = readStored(LAST_HOST_KEY);
        for (var i = 0; i < hosts.length; i++) {
          if (hosts[i].id === saved) return adoptHost(hosts[i]);
        }
        // Nothing remembered, or it is gone: the list is the answer, and from
        // here on the dialog carries it — so the banner goes back to saying
        // nothing rather than keep a line the dialog now repeats.
        clearStatus();
        paintMachineList(showMachinePicker(false), hosts);
      })
      .catch(function (err) {
        hostsFetchFailed(err, bannerSurface());
      });
  }

  /**
   * The standing 「换机器」 entry (header button on this page, banner action
   * while disconnected): always shows the list, even when a machine is already
   * connected — the current connection stays up until one is chosen.
   */
  function openMachinePicker() {
    if (pickerOpen()) return;
    loadMachineList(showMachinePicker(!!CONFIG.hostId));
  }

  /**
   * One read of the list, painted into the dialog's own slot: reading now, then
   * either the rows or a refusal with 重试. The page banner is deliberately not
   * involved — it belongs to the connection, which stays exactly as it was,
   * including the 「重新连接 / 换机器」 a reader may have opened this dialog from
   * and must find again when they close it (spec 场景 8).
   */
  function loadMachineList(list) {
    paintMachineList(list, null, { text: "正在读取机器列表…" });
    fetchHosts()
      .then(function (hosts) {
        // Closed while the request was out: the reply has nothing left to paint.
        if (pickerOpen()) paintMachineList(list, hosts);
      })
      .catch(function (err) {
        hostsFetchFailed(err, pickerSurface(list));
      });
  }

  /**
   * Commit a machine choice: remember it, write it into the address (the URL
   * becomes shareable and refresh-stable again), and connect. Anything the
   * previous machine left on screen is dropped first — a switch is a cold
   * start that keeps the mounted app.
   */
  function adoptHost(host) {
    writeStored(LAST_HOST_KEY, host.id);
    var url = new URL(window.location.href);
    url.searchParams.set("host", host.id);
    // A `?session=` pin named a session on the *previous* machine; carrying it
    // into the next one's address would pin a session that machine has never
    // heard of (spec 场景 5).
    url.searchParams.delete("session");
    window.history.replaceState(null, "", url.toString());
    CONFIG.hostId = host.id;
    CONFIG.sessionId = "";
    sessionId = "";
    picked = false;
    resetMachineView();
    CONFIG.socketUrl = deriveSocketUrl(host.id);
    connect();
  }

  /**
   * The view is about to describe another machine: drop everything the old one
   * left behind. Its in-flight requests can never be answered by the new
   * machine, and a late frame from the old socket must not repaint the new
   * view — so both the socket and every piece of per-machine state go.
   */
  function resetMachineView() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (socket) {
      var dead = socket;
      socket = null;
      dead.onopen = dead.onmessage = dead.onclose = dead.onerror = null;
      try {
        dead.close();
      } catch {
        // Closing a socket that never opened is fine.
      }
    }
    stopHeartbeat();
    authed = false;
    fatal = "";
    connectedOnce = false;
    streaming = false;
    messages = [];
    sessions = [];
    shownApprovals = {};
    pending = {};
    pullToken++;
    // The mounted app (if the app has mounted) is showing the previous
    // machine's view; the next `auth_ok` must replace it wholesale. On a cold
    // start the app has not mounted yet and its `webviewReady` owns the first
    // pull — pulling here would land before the reducer is live.
    needsSnapshot = openedOnce;
    removePicker();
  }

  /** The dialog's plain buttons: 取消 and the list's 重试 look the same. */
  var PICKER_BUTTON_STYLE =
    "padding:6px 16px;font:inherit;color:inherit;background:none;" +
    "border:1px solid var(--vscode-widget-border,#313131);border-radius:8px;" +
    "cursor:pointer;";

  /**
   * The machine dialog's shell: title, the list slot, the home-screen guide and
   * 取消 when a machine is already connected. It returns that slot, which
   * `paintMachineList` fills — the list is a request away, and the shell must not
   * wait for it before it can be seen (spec 场景 8).
   */
  function showMachinePicker(canCancel) {
    removePicker();
    var overlay = document.createElement("div");
    overlay.id = "remote-machine-picker";
    overlay.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;" +
        "justify-content:center;padding:16px;background:rgba(0,0,0,0.6);",
    );
    var panel = document.createElement("div");
    panel.setAttribute(
      "style",
      "width:100%;max-width:360px;max-height:80vh;overflow:auto;" +
        "background:var(--vscode-editor-background,#1f1f1f);" +
        "color:var(--vscode-editor-foreground,#dddddd);" +
        "border:1px solid var(--vscode-widget-border,#313131);" +
        "border-radius:12px;padding:16px;",
    );
    var title = document.createElement("div");
    title.textContent = "选择要连接的电脑";
    title.setAttribute(
      "style",
      "font-size:17px;font-weight:600;margin-bottom:4px;",
    );
    panel.appendChild(title);
    var subtitle = document.createElement("div");
    subtitle.textContent = "同一账号下开启了远程控制的机器，选一台连上。";
    subtitle.setAttribute(
      "style",
      "font-size:13px;opacity:0.7;margin-bottom:8px;",
    );
    panel.appendChild(subtitle);
    var list = document.createElement("div");
    list.id = "remote-machine-list";
    panel.appendChild(list);

    // The one thing this page cannot do for the reader is put itself on the
    // home screen — and the wrong container silently cannot either
    // (spec「PWA 主屏元信息」场景 4).
    var guide = document.createElement("div");
    guide.setAttribute(
      "style",
      "margin-top:12px;padding-top:12px;font-size:13px;line-height:1.6;opacity:0.65;" +
        "border-top:1px solid var(--vscode-widget-border,#313131);",
    );
    guide.textContent =
      "添加到主屏幕：请用相机扫码或在 Safari 中打开本页，再「添加到主屏幕」；" +
      "控制中心的扫码器打开的容器加不了主屏。";
    panel.appendChild(guide);

    if (canCancel) {
      var cancel = document.createElement("button");
      cancel.id = "remote-machine-cancel";
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.setAttribute("style", PICKER_BUTTON_STYLE + "margin-top:12px;");
      cancel.onclick = removePicker;
      panel.appendChild(cancel);
    }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return list;
  }

  /**
   * Fill the dialog's list slot: the machines, or one line saying why there are
   * none — with 重试 when that line is a refusal.
   *
   * Both non-row states live here rather than on the page banner: their subject
   * is *this dialog*, while the banner's subject is the connection, and the
   * reader has not closed the connection by opening the list (spec 场景 8).
   */
  function paintMachineList(list, hosts, note) {
    list.textContent = "";
    if (note) {
      var line = document.createElement("div");
      line.textContent = note.text;
      line.setAttribute(
        "style",
        "padding:20px 0 12px;text-align:center;font-size:14px;",
      );
      list.appendChild(line);
      for (var n = 0; n < (note.actions || []).length; n++) {
        var action = document.createElement("button");
        action.type = "button";
        action.textContent = note.actions[n].label;
        action.setAttribute(
          "style",
          PICKER_BUTTON_STYLE + "display:block;margin:0 auto;",
        );
        action.onclick = note.actions[n].onClick;
        list.appendChild(action);
      }
      return;
    }
    if (!hosts.length) {
      // An empty account is a state, not a blank screen: the dialog says what is
      // missing and where to switch it on (spec 场景 4).
      var empty = document.createElement("div");
      empty.setAttribute("style", "padding:20px 0 12px;text-align:center;");
      var emptyTitle = document.createElement("div");
      emptyTitle.textContent = "还没有开启远程控制的电脑";
      emptyTitle.setAttribute("style", "font-size:15px;margin-bottom:4px;");
      empty.appendChild(emptyTitle);
      var emptyHint = document.createElement("div");
      emptyHint.textContent =
        "在电脑侧运行 wave remote-control on，这里就会出现它。";
      emptyHint.setAttribute("style", "font-size:13px;opacity:0.7;");
      empty.appendChild(emptyHint);
      list.appendChild(empty);
    }
    for (var i = 0; i < hosts.length; i++)
      list.appendChild(machineRow(hosts[i]));
  }

  /** One machine in the list: name, platform, and its online state. */
  function machineRow(host) {
    var row = document.createElement("button");
    row.type = "button";
    row.setAttribute(
      "style",
      "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
        "width:100%;padding:12px 4px;font:inherit;color:inherit;text-align:left;" +
        "background:none;border:none;" +
        "border-bottom:1px solid var(--vscode-widget-border,#313131);cursor:pointer;",
    );
    var name = document.createElement("span");
    name.textContent = host.name || host.id;
    name.setAttribute(
      "style",
      "font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
    );
    var meta = document.createElement("span");
    meta.setAttribute(
      "style",
      "flex:none;font-size:13px;opacity:0.75;display:flex;align-items:center;gap:6px;",
    );
    var dot = document.createElement("span");
    dot.setAttribute(
      "style",
      "width:8px;height:8px;border-radius:50%;flex:none;background:" +
        (host.online
          ? "#4caf50"
          : "var(--vscode-descriptionForeground,#888888)") +
        ";",
    );
    meta.appendChild(dot);
    var label = document.createElement("span");
    label.textContent = [
      platformLabel(host.platform),
      host.online ? "在线" : "离线",
    ]
      .filter(Boolean)
      .join(" · ");
    meta.appendChild(label);
    row.appendChild(name);
    row.appendChild(meta);
    row.onclick = function () {
      adoptHost(host);
    };
    return row;
  }

  /** Is the machine dialog up? Its id is the only handle on it (see `removePicker`). */
  function pickerOpen() {
    return !!document.getElementById("remote-machine-picker");
  }

  function removePicker() {
    var old = document.getElementById("remote-machine-picker");
    if (old) old.remove();
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
      setTimeout(
        function () {
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error(timeoutText(method)));
        },
        TURN_METHODS[method] ? TURN_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
      );
    });
  }

  /**
   * What a missing reply is called. A turn-length method must not be described
   * as 「中继或电脑侧没有响应」: both ends did answer — the machine is still working,
   * which is exactly what the message stream shows. That wording is what made
   * every turn past 20s read as a delivery failure.
   */
  function timeoutText(method) {
    return TURN_METHODS[method]
      ? method + " 还没有回执（电脑侧仍在处理，回合可能还没结束）"
      : method + " 超时（中继或电脑侧没有响应）";
  }

  /**
   * A control write the user drives from this page — stop the turn, switch the
   * permission tier, compact the context. Their **success** needs no reply: the
   * new state grows back out of the message stream (the busy flag, the mode, the
   * shortened list). Their **failure** must not be swallowed, which is what an
   * empty `.catch` used to do: 「点了暂停但没反应」 then had no explanation anywhere
   * on screen, and a phone has neither an Escape key nor a terminal to go look.
   */
  function controlRequest(method, params, label) {
    request(method, params).catch(function (err) {
      showStatus(label + "指令没有回执：" + (err.message || err));
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
      case "permissionRequest":
        // The whole reason this page exists: an approval that arrived while the
        // user was away has to be answerable from the phone.
        showApproval(p);
        return;
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
    // The session-state read (`getSessionInfo`) feeds the snapshot below. Kept
    // in the chain rather than fired and forgotten so the first paint — the
    // page's one transition-free initialization — carries the *current* values
    // of the state family (spec Web-page story scenario 26), not the reducer's
    // defaults.
    var state = null;
    var usage;
    return pickSession()
      .then(function () {
        if (token !== pullToken || !sessionId) return null;
        return request("getSessionInfo", {});
      })
      .then(function (info) {
        if (token !== pullToken) return null;
        state = info;
        return request("getMessages", { limit: CONFIG.firstPageLimit });
      })
      .then(function (result) {
        if (token !== pullToken) return null;
        if (result) messages = result.messages || [];
        // The context ring lives outside the reducer (the webview keeps it in
        // its own state), so it is posted rather than folded into the snapshot;
        // every `getMessages` reply carries the percent, which is why no extra
        // read is needed — each (re)pull realigns it for free.
        usage = result && result.contextUsagePercent;
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
          // Read off `getSessionInfo`, not assumed: an empty todo list, a quiet
          // queue or "not compacting" in the snapshot must mean the machine
          // *said so*, not that this build cannot ask (scenario 26). Absent
          // fields — an older host — fall back to the neutral values; posting
          // `undefined` into the reducer is not an option.
          tasks: (state && state.tasks) || [],
          backgroundTasks: [],
          workflowRuns: [],
          // Read off the registry by `pickSession`, not assumed: a page that
          // arrives mid-turn must still offer the stop button — the phone has no
          // Escape key. Read here rather than captured, so a transition that
          // arrived while `getMessages` was in flight still wins.
          isStreaming: streaming,
          isCompacting: !!(state && state.isCompacting),
          isCommandRunning: !!(state && state.isCommandRunning),
          // Folded in from the same read: the hosts' own snapshots carry the
          // mode too, and the standalone re-read (`refreshSessionState`) keeps
          // covering the paths that do not rebuild the snapshot.
          permissionMode: (state && state.permissionMode) || "default",
          sessions: sessions,
          session: currentSession(sessions, sessionId),
          currentSession: currentSession(sessions, sessionId),
          pendingConfirmations: requests.map(confirmationOf),
          queuedMessages: (state && state.queuedMessages) || [],
          // The relay authenticated this page with the machine's own
          // credential; there is no separate phone login to satisfy.
          isAuthenticated: true,
        });
        if (typeof usage === "number")
          post({ command: "contextUsage", percent: usage });
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
        // Same reply, same rule as the snapshot's: the percent rides every
        // `getMessages` answer, so a reconnect realigns the ring with the
        // delta it was already pulling — no read of its own.
        if (typeof result.contextUsagePercent === "number")
          post({
            command: "contextUsage",
            percent: result.contextUsagePercent,
          });
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
        // The session-state family is deliberately NOT read here: every caller
        // of `pickSession` is a snapshot path (`pullSnapshot`), and the snapshot
        // chain reads `getSessionInfo` itself and folds it into
        // `setInitialState` — one read, one paint. The paths that do not rebuild
        // the snapshot (reconnect, remount, resume) use `refreshSessionState`.
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

  /**
   * Re-read the approvals the machine is waiting on, and hand the page the cards
   * it is not already showing.
   *
   * A re-read rather than a notification, for the reason `refreshStreaming` is
   * one: the notification is a *transition*, and the link drops it while there is
   * no subscriber ("nothing to serve while the link is down" — `RemoteControlService`).
   * The message delta a reconnect pulls carries no approvals at all, so without
   * this the request the model is parked on never reaches the phone: the list
   * shows the tool block (name and icon) and the options — which only the approval
   * card renders — are simply absent, looking like a stuck turn. A cold start goes
   * through the snapshot instead (which does read the registry), which is why
   * killing the app brings the options back.
   *
   * Not scoped to the session on screen: the registry reports every session's
   * requests, and an approval is usually waiting in one the user is not looking at
   * (see the note in `deliver`).
   *
   * `force` forgets what this shim believed was up: a page that re-mounted reset
   * its own list, so "already shown" is no longer true.
   */
  function refreshPending(force) {
    if (force) shownApprovals = {};
    return request("listPendingPermissions", {})
      .then(function (result) {
        var requests = (result && result.requests) || [];
        for (var i = 0; i < requests.length; i++) {
          if (shownApprovals[requests[i].requestId]) continue;
          showApproval(requests[i]);
        }
      })
      .catch(function (err) {
        warnOnce("pending", "待审批补读失败：" + err.message);
      });
  }

  /**
   * Re-read the session's **state** — the family of values the page otherwise
   * only ever hears as *transitions*: permission mode, the todo list,
   * compaction, command running, the outbound queue (spec Web-page story
   * scenario 26). Busy and pending approvals have their own reads
   * (`refreshStreaming` / `refreshPending`) because their sources are the
   * registry and the process-wide request list, not this method.
   *
   * The adapter pushes each of these as a change notification, so a phone that
   * is connected and looking at this session follows along — but a value set
   * *before* the page arrived never reaches it, and the page then renders its
   * own reducer defaults: an empty todo list, 「修改前询问」 for a mode the
   * session does not have, a queue that looks empty while the machine holds
   * messages. `getSessionInfo` is the method that carries them — it is in the
   * remote white list and both hosts answer it.
   *
   * Field by field, and only what the reply carries: a host **older** than
   * this page does not answer the new fields (which build serves the session
   * is not ours to pick), and writing a missing field would clobber a value we
   * already hold with `undefined` — a missing list there means "this build
   * cannot say", not "the machine has none".
   *
   * No local mirror of what the page believes (unlike `applyStreaming`): the
   * reply is a read of the truth, so re-stating an unchanged value costs one
   * frame and is what puts a re-mounted app — whose reducer went back to its
   * defaults — right again.
   */
  function refreshSessionState() {
    var asked = sessionId;
    if (!asked) return Promise.resolve();
    return request("getSessionInfo", {})
      .then(function (info) {
        // The request named the session it was asked for: a pick that moved on
        // while it was in flight must not repaint the page with the state of
        // the conversation the reader has left.
        if (asked !== sessionId) return;
        if (!info) return;
        if (info.permissionMode)
          post({ command: "updatePermissionMode", mode: info.permissionMode });
        if (info.tasks) post({ command: "updateTasks", tasks: info.tasks });
        if (typeof info.isCompacting === "boolean")
          post({
            command: "compactionStateChange",
            isCompacting: info.isCompacting,
          });
        if (typeof info.isCommandRunning === "boolean")
          post({
            command: "updateCommandRunning",
            running: info.isCommandRunning,
          });
        if (info.queuedMessages)
          post({ command: "updateQueue", messages: info.queuedMessages });
      })
      .catch(function (err) {
        warnOnce("sessionState", "会话状态补读失败：" + err.message);
      });
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

  /**
   * Put one approval card on the page, and remember that it is up.
   *
   * One payload shape for both ways a card gets here — the `permissionRequest`
   * notification, and a re-read of the registry (`refreshPending`) — because they
   * describe the same request and the page must not be able to tell them apart.
   * `confirmationOf` is that shape; the snapshot's `pendingConfirmations` uses it
   * too.
   */
  function showApproval(pendingRequest) {
    if (!pendingRequest || !pendingRequest.requestId) return;
    shownApprovals[pendingRequest.requestId] = true;
    post(
      Object.assign(
        { command: "showConfirmation" },
        confirmationOf(pendingRequest),
      ),
    );
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
          // …and its copy of the pending approvals went with it. This side keeps
          // the same list, which is now a list of cards that are not on screen.
          refreshPending(true);
          // …as did the session-state family: the remounted reducer is back at
          // its defaults while the session may be mid-compaction with a todo
          // list and a queue. See `refreshSessionState`.
          refreshSessionState();
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
          // A late reply is only an error when no turn is running. While the page
          // knows this session is generating, the stream itself proves the message
          // landed — a red block under a running turn reads as 「没发出去」, the user
          // resends, and the machine receives the same message twice. (This block
          // is where 「sendMessage 超时」 came from, on every turn past 20s.)
          if (streaming) {
            warnOnce(
              "sendMessage-late",
              "sendMessage 没有回执，但这条会话仍在生成",
            );
            return;
          }
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
        controlRequest("abortMessage", {}, "暂停");
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
        // The page hid its own card the moment the user tapped it (it hides
        // optimistically, in `handleConfirmation`), so there is no card left to
        // reconcile against — forget the id rather than remember it. An answer
        // can still be lost on the way out (`permissionResponse` is a
        // notification with no reply), and an approval the machine is still
        // waiting on has to be able to come back on the next re-read.
        delete shownApprovals[msg.confirmationId];
        if (sessionId) approval.sessionId = sessionId;
        send(approval);
        return;
      }

      case "setPermissionMode":
        controlRequest("setPermissionMode", { mode: msg.mode }, "切换权限档");
        return;

      case "compact":
        controlRequest(
          "compact",
          { customInstructions: msg.customInstructions },
          "压缩上下文",
        );
        return;

      case "renameSession":
        // The page's rename handler is 「乐观更新 → 按 requestId 关联回复 → 失败回滚」
        // (useSessionRename), and it reads `ok` off this reply: `ok !== true` is
        // treated as a **failure** and rolls the title back. Leaving `ok` out
        // (as this used to) made a successful rename snap back the moment the
        // reply landed, with no error shown anywhere.
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
              ok: true,
            });
          })
          .catch(function (err) {
            post({
              command: "sessionRenamed",
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              title: msg.title,
              ok: false,
              error: String(err.message || err),
            });
          });
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

      // ── 发起新会话（spec ui/remote-control.md「Web 端也能发起新会话」）──
      // The dialog itself is the page's own UI state; the shim only ferries the
      // four whitelisted RPCs behind it. All four are session-less utility
      // calls — the envelope must not carry the page's current sessionId
      // (`withSession: false`), or creating a session from an empty view would
      // be refused before it starts and browsing would be tied to one.

      case "newSessionListDirs":
        request("listDirectories", { dir: msg.dir }, false)
          .then(function (result) {
            post({
              command: "newSessionDirs",
              requestId: msg.requestId,
              resolvedPath: result && result.resolvedPath,
              dirs: (result && result.dirs) || [],
            });
          })
          .catch(function (err) {
            post({
              command: "newSessionDirs",
              requestId: msg.requestId,
              error: String(err.message || err),
            });
          });
        return;

      case "newSessionListBranches":
        request("listGitBranches", { workdir: msg.workdir }, false)
          .then(function (result) {
            post({
              command: "newSessionBranches",
              requestId: msg.requestId,
              result: result || null,
            });
          })
          .catch(function (err) {
            post({
              command: "newSessionBranches",
              requestId: msg.requestId,
              result: null,
              error: String(err.message || err),
            });
          });
        return;

      case "newSessionCreate": {
        // Worktree first (the desktop's FR-022/FR-023 two-step), then
        // `initialize` pointed at the directory to run in. The remote gate on
        // the machine side picks `initialize` apart — only `workdir` /
        // `permissionMode` survive — so nothing else the page might send gets
        // through even if this call site grew a knob by accident.
        var createParams = {
          workdir: msg.workdir,
          permissionMode: msg.permissionMode,
        };
        var worktreeName;
        var worktreeStep = msg.useWorktree
          ? request(
              "createWorktree",
              {
                workdir: msg.workdir,
                baseBranch: msg.baseBranch,
                name: msg.name,
              },
              false,
            ).then(function (worktree) {
              worktreeName = worktree && worktree.name;
              createParams.workdir = worktree.path;
            })
          : Promise.resolve();
        worktreeStep
          .then(function () {
            return request("initialize", createParams, false);
          })
          .then(function (result) {
            // The machine created a session in its registry; this side does
            // exactly what 「会话」切换 does — re-point its own view, then let
            // the same snapshot path a cold start uses fill it in. Nothing
            // else on the computer moves.
            sessionId = result.sessionId;
            picked = true;
            messages = [];
            pullSnapshot();
            post({
              command: "newSessionCreated",
              requestId: msg.requestId,
              sessionId: result.sessionId,
              workingDirectory: result.workingDirectory,
              worktreeName: worktreeName,
            });
          })
          .catch(function (err) {
            post({
              command: "newSessionCreateFailed",
              requestId: msg.requestId,
              error: String(err.message || err),
            });
          });
        return;
      }

      case "getStatus":
        post({
          command: "statusResponse",
          version: "",
          sessionId: sessionId,
          workdir: "",
        });
        return;

      case "openMachinePicker":
        // This page's header chip: show the account's machines and switch if
        // one is chosen. The current connection stays up until then.
        openMachinePicker();
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

  // ── Coming back to the foreground ───────────────────────────────

  /**
   * The page was backgrounded and is on screen again.
   *
   * While it was away nothing was delivered — iOS suspends a backgrounded page
   * outright, and frames are not queued behind it — so the page comes back to a
   * picture of the past: messages that stop short, a busy/idle state that may
   * have flipped, and no card for anything that asked for approval while nobody
   * was listening. That is the disconnect gap one level up, so it is repaired the
   * same way: the re-reads `auth_ok` does.
   *
   * Only when the link can carry them. A request sent while it cannot just piles
   * up in the outbox and ends as a timeout describing nothing real, and the
   * reconnect that follows does these same reads on its own.
   */
  function onResume() {
    if (document.visibilityState !== "visible") return;
    if (!connectedOnce) return;
    if (authed && socket && socket.readyState === 1) {
      resync();
      refreshStreaming(true);
      refreshPending(true);
      refreshSessionState();
      return;
    }
    // Waiting in the backoff (or sitting between attempts): the phone coming
    // back to hand is the best retry moment there is — try now, from the
    // fastest step, instead of waiting out the tail of the current backoff
    // (spec「断线自愈」场景 5). Permanent failures keep their reason on screen.
    if (blocked || fatal) return;
    manualReconnect();
  }

  document.addEventListener("visibilitychange", onResume);
  // A page restored from the back/forward cache gets its own event, and the
  // socket behind it is normally already gone — `onResume` no-ops on that and the
  // retry path owns it. `persisted` is what tells a restore apart from the first
  // load, which fires the same event.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) onResume();
  });

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

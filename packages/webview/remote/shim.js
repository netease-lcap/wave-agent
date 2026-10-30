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
   * (the settings page's remote-control view skips it when this flag is set).
   */
  window.waveRemotePage = true;

  /**
   * The same fact, in the DOM: this page is the only host a browser runs, so it is
   * the only one whose viewport shrinks and grows with browser chrome and whose
   * edges sit under the system UI. `globals.css` keys those rules on this
   * attribute and they must not reach the other four hosts. Not `data-host`: that
   * one selects the desktop density tokens, and this page belongs to the `plugin`
   * default with the VS Code / JetBrains plugins. Set before `chat.js` runs, so the
   * first paint already has it (index.html loads this file first).
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
     * 首屏尾段：只取最近这一段，不取整条线程（长会话能到 13 MB）。**没有更早可
     * 翻**——拉到顶就是这条会话在手机上的起点，页面不发请求、也不提示。
     *
     * 为什么是 100：按实测 5.7 KB/条，100 条约 0.57 MB，而中继的每订阅者缓冲是
     * 1 MiB，超出的帧**被静默丢弃**（不报错）。机器侧对超预算的回包还会从最早一条
     * 开始丢，所以这个数是一个经济性取值，真正的保证在机器侧。
     */
    firstPageLimit:
      Number(query.get("limit")) > 0
        ? Number(query.get("limit"))
        : PAGE_CONFIG.firstPageLimit || 100,
  };

  var RETRY_MS = 2000;
  /**
   * 首屏那一次读失败之后的重试节拍（毫秒），用完就停在状态条上由用户手动重试。
   *
   * Bounded on purpose, and much shorter than the connection's backoff: this is a
   * **read**, not a link. A machine that can answer gets there within seconds; one
   * that keeps not answering (the relay dropped the frame, the host is wedged) is
   * not helped by a fourth attempt, and one that **refuses** the method outright
   * (`-32601` — an older allowlist) never will be. So: three tries, then the
   * 「重试」 action on the status line takes over. See `pickSession`.
   */
  var SNAPSHOT_RETRY_MS = [2000, 4000, 8000];
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
  var TURN_METHODS = { sendMessage: true, compact: true, askBtw: true };
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
  /**
   * Web Push, same-origin REST again (spec「锁屏也能知道——会话等着我、或者
   * 跑完了」): the relay owns the VAPID key and the subscription table, while the
   * id it hands back is what a later revocation needs — so it is stored here
   * under our own key rather than recomputed.
   */
  var VAPID_PATH = "/api/relay/push/public-key";
  var SUBSCRIPTIONS_PATH = "/api/relay/push/subscriptions";
  var PUSH_SUB_KEY = "wave_remote_push_sub";
  /**
   * The service worker's file name inside the page bundle. `build.mjs` fills
   * this in (the file is content-hashed like every other asset, so the name
   * cannot be a literal here); a page built without it simply fails to
   * register the worker, which `registerServiceWorker` reports once.
   */
  var SERVICE_WORKER_PATH = "./__SW_FILE__";
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
  /**
   * "The channel would carry this method, but **this host** has not implemented
   * it" — the machine-side constant is `REMOTE_HOST_UNSUPPORTED` in
   * `packages/code/src/remote/remoteControlService.ts`. Duplicated as a literal
   * because this file is browser JS shipped verbatim beside the bundle and
   * imports nothing; the three failures it separates are `-32601` (the whitelist
   * refuses the method — upgrade the machine), `-32602` (bad parameters) and
   * this one (a foreground CLI session serves one conversation, so the method
   * exists on the channel but not on that host).
   */
  var HOST_UNSUPPORTED = -32011;
  /**
   * JSON-RPC's own "no such method", which the remote allowlist answers when the
   * machine predates the method. Distinct from `HOST_UNSUPPORTED` in what it
   * means for the user (upgrade the machine vs. this session cannot) and in what
   * it means for a retry: **neither** will ever change on its own, so neither is
   * retried (see `pickSession`).
   */
  var METHOD_NOT_FOUND = -32601;

  /**
   * How a failed request is shown. An unsupported method is worded as what it
   * is (this computer cannot do that) rather than as a transport failure, which
   * would send the user looking for a network problem.
   */
  function failureText(label, err) {
    if (err && err.code === HOST_UNSUPPORTED) {
      return label + "：这台电脑上的会话不支持这个操作（" + err.message + "）";
    }
    return label + "失败：" + ((err && err.message) || err);
  }

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
  /**
   * 首屏是否成功上屏过。`false` 期间页面没有「当前视图」可言——会话列表没读到，
   * 就既不知道该显示哪条，也没有消息与待审批可对——所以这时每一条对齐路径
   * （回前台 / 页面重挂 / 重连）都必须重跑整份快照，而不是增量补差
   * （spec「首屏读失败能自己恢复」场景 4 / 5）。
   *
   * 只在**列表读成功**时置位，不能在整条链跑完时置位：链失败后照样会走到最后
   * 一次 `setInitialState`（空会话），那是「画了一张空的首屏」，不是「读到了」。
   */
  var snapshotReady = false;
  var snapshotRetryStep = 0;
  var snapshotRetryTimer = null;
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
  /** 这一页看过的当前会话内容：首屏尾段，之后只靠 `since` 增量往后补。 */
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
   * 会话列表两类标记的原始事实：**有待确认请求**的会话 id、**注册表里
   * `isLoading`** 的会话 id（两个集合都含当前这条，标不标当前那条由列表自己定）。
   *
   * 两个集合来自两次**不同的读**（`listPendingPermissions` 与会话注册表
   * `listDaemonSessions`），所以各自维护、不互相推导；当前这条的「运行中」还在
   * `runningIds` 里按 `streaming` 现算，见那里。合起来是本故事的整个设计：「弹哪张
   * 卡是会话级的、标记是进程级的」——读是进程级的（报告全部会话），弹只弹当前这条，
   * 别条会话的等待由这两个集合在会话列表上承接（spec remote-control.md「待确认只在
   * 它自己的对话里弹，对话状态在会话列表标出来」）。
   */
  var waitingSessionIds = [];
  var runningSessionIds = [];
  /**
   * 会话列表另外两条标记与一条删除前的判据，同样来自注册表那一次读
   * （`listDaemonSessions`）：
   *
   * - `backgroundSessionIds`：前台这一轮结束了但还有后台任务在跑（`/tasks` 里那些），
   *   「看起来空闲、其实还在干活」的会话不能显示成静止；
   * - `worktreeSessionIds`：这条会话是建在一个 **linked worktree** 里的（宿主从
   *   会话的 `createdWorkdir` 推出来的）。它决定删除确认卡说不说工作树那段话、按钮
   *   写「删除会话」还是「删除会话与工作树」，所以必须来自这次列表读，而不是删除
   *   那一刻再问一遍——问不到就等于静默删。
   *
   * 两个集合都随注册表重读重建（`loadSessions`），不是一个可以单独过期的缓存。
   */
  var backgroundSessionIds = [];
  var worktreeSessionIds = [];
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
  /**
   * Which state the banner is currently showing, and which states the user has
   * closed.
   *
   * The mute is keyed by **state**, never by the text: 「等待上线」carries its
   * retry count, so the words change on every backoff step. Keyed by text, a
   * close would be undone two seconds later by the next attempt, which is
   * exactly the 「关不掉的错误」 this surface was reported for. A state leaves the
   * set when it is over (`clearStatus`) — i.e. when it comes back after that, it
   * is a new occurrence and may show again.
   */
  var bannerKey = null;
  var mutedStatusKeys = {};

  // ── Page → host plumbing ────────────────────────────────────────

  /**
   * Whether the page's main pointer is a finger — the same judgement the phone
   * tier's CSS uses (`pointer: coarse` / `hover: none` in
   * `src/styles/remote-page.css`, spec 场景 16 / 27). Asked at paint time, not
   * memoised: the banner is rebuilt from scratch on every status, so a pointer
   * that changed in between (an iPad that picked up a mouse) is answered by the
   * next repaint — the CSS half re-evaluates on its own for the same reason.
   *
   * `matchMedia` is guarded because the shim also runs under the test harness's
   * hand-made window, which has no media-query surface; 「no answer」 reads as
   * 「the pointer is a mouse」, i.e. the design-sheet density.
   */
  function isTouchPointer() {
    return (
      typeof window.matchMedia === "function" &&
      (window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches)
    );
  }

  /**
   * The banner's numbers, per device tier.
   *
   * The phone tier is the page's own icon-button tier (40×40 with a 20px glyph,
   * spec 场景 27) applied to this line: the close is a target a finger has to
   * hit, and the 32×32 box it had was sized for a mouse pointer and reported too
   * small on a phone (2026-10-27).
   *
   * The line's own padding drops 8 → 4 on that tier so the taller target does
   * not make it 56px tall: 4 + 40 + 4 = 48. The **text** stays at 13px, which is
   * this page's 「辅助信息」 tier on a phone too (`remote-page.css`: prompts,
   * empty states, tool results all 13px; only 阅读主体 goes to 15).
   */
  var BANNER_TIER = {
    // Mouse pointer (the design sheet's density) — unchanged.
    fine: {
      padding: "8px 12px",
      close: "width:32px;height:32px;font-size:18px;",
    },
    // Finger — the close takes the page's icon-button numbers.
    coarse: {
      padding: "4px 12px",
      close: "width:40px;height:40px;font-size:20px;",
    },
  };

  function bannerTier() {
    return isTouchPointer() ? BANNER_TIER.coarse : BANNER_TIER.fine;
  }

  /**
   * The banner's look. Two tones, because the banner says two different kinds of
   * thing: a refusal (`#5a1d1d` — the link is down or something was refused) and
   * `"progress"` (`#333333` — the page is doing something and has nothing else
   * to show yet). A progress line in the error colour reads as 「出事了」, which
   * is why the machine list moved its own two states off this banner entirely
   * (spec「机器列表与切换」场景 8).
   *
   * It is a **line in the page flow**, not a floating overlay: this surface
   * reports *states*, and a state lasts (「等待上线」backs off indefinitely). A
   * `position:fixed; top:0` banner sat on top of the whole header, so for as
   * long as it was up the four header buttons could be neither seen nor
   * tapped — including 「切换电脑」, the entry that exists precisely for the
   * disconnected case. Being in the flow also means the body's
   * `padding-top: env(safe-area-inset-top)` carries it (a `top:0` overlay
   * bypasses that padding and paints under the status bar).
   *
   * The label may wrap; the close never does, so it stays visible on the first
   * line however long the message is (spec「状态只在一条流内状态条上播报」
   * 场景 4 / 9).
   */
  function bannerStyle(tone) {
    var tier = bannerTier();
    return (
      "flex:0 0 auto;box-sizing:border-box;padding:" +
      tier.padding +
      ";display:flex;align-items:center;gap:8px;" +
      "font:13px/1.5 -apple-system,system-ui,sans-serif;color:#fff;" +
      "background:" +
      (tone === "progress" ? "#333333" : "#5a1d1d") +
      ";"
    );
  }

  function bannerLabelStyle() {
    // `min-width:0` is what lets a flex item's text wrap instead of forcing the
    // row wider than the screen.
    return "flex:1 1 auto;min-width:0;overflow-wrap:anywhere;";
  }

  /**
   * The close's box, its glyph size, and nothing else.
   *
   * The size is spelled out (`font-size` + `font-family: inherit`) rather than
   * through the `font` shorthand: `font: 18px/1 inherit` is **invalid** CSS — a
   * CSS-wide keyword cannot be a component of the shorthand — so the whole
   * declaration was dropped and the button rendered at the UA's default
   * 13.33px Arial. Measured in Chromium, not guessed; it is why the × read as
   * 「too small」 even at a 32px box.
   */
  function bannerCloseStyle() {
    return (
      "flex:0 0 auto;padding:0;" +
      bannerTier().close +
      "font-family:inherit;line-height:1;" +
      "color:#fff;background:transparent;border:0;cursor:pointer;opacity:0.85;"
    );
  }

  /**
   * The page's status surface: one sentence and the close.
   *
   * It carries **no actions** (2026-10-29). It used to offer 「重新连接」 /
   * 「换机器」 / 「重试」, and on a phone those two text buttons ate half the row
   * next to the sentence they were supposed to serve, so the sentence itself got
   * the leftover width. Neither action is lost: the backoff retries on its own
   * (coming back to the page retries immediately, `onResume`), and 「切换电脑」
   * is a standing header button that is never covered by this line
   * (`bannerStyle`).
   *
   * `key` names the **state**, for the mute: the caller that reports a state
   * whose words drift (`「等待上线…（第 N 次重试）」`) passes a stable key so a close
   * survives the next retry. Everything else leaves it out and the text is the
   * identity — those messages do not change while the state stands.
   *
   * Every call states its tone: the banner outlives a single message, so the one
   * that follows a refusal must be able to paint it neutral again.
   */
  function showStatus(text, tone, key) {
    var statusKey = key || text;
    if (mutedStatusKeys[statusKey]) {
      // Closed by the user and the state has not ended: stay quiet. The element
      // goes (if any) but the mute stays, so the next retry is quiet too.
      removeBanner();
      return;
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "remote-status";
      banner.setAttribute("role", "status");
      // First child of the body: above the app, inside the flow, so the header
      // below it keeps every pixel it had.
      document.body.insertBefore(banner, document.body.firstChild);
    }
    bannerKey = statusKey;
    banner.setAttribute("style", bannerStyle(tone));
    banner.textContent = "";
    var label = document.createElement("span");
    // Its own id: the line carries a close as well as its sentence, so 「what
    // does it say」 has to be addressable apart from 「what is in the row」.
    label.id = "remote-status-text";
    label.setAttribute("style", bannerLabelStyle());
    label.textContent = text;
    banner.appendChild(label);
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.setAttribute("style", bannerCloseStyle());
    close.onclick = muteStatus;
    banner.appendChild(close);
  }

  /**
   * 「看够了」: drop this line until the state itself ends. It is deliberately
   * not a way to silence the *connection*: the backoff keeps retrying, the
   * page keeps re-reading, and a reconnect repaints as usual — only this
   * line's presentation is muted (spec 场景 5).
   */
  function muteStatus() {
    if (bannerKey !== null) mutedStatusKeys[bannerKey] = true;
    removeBanner();
  }

  function removeBanner() {
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  /**
   * The state is over (connected, list read, session gone): the line goes, and
   * so do the mutes — whatever comes back after this is a new occurrence.
   */
  function clearStatus() {
    removeBanner();
    mutedStatusKeys = {};
  }

  /**
   * The machine list's own 「重试」, for the dialog's refusal row. The status line
   * has no actions any more, so this is the only place it is used.
   */
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
    // Independent of the link and of the login state: the worker only needs to
    // exist by the time the user opens the menu, and registering it costs
    // nothing (no permission, no request).
    registerServiceWorker();
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
        showStatus(fatal);
        return;
      }
      if (event.code === AUTH_TIMEOUT_CLOSE) {
        showStatus(
          "中继拒绝了这个连接（未授权）。请在电脑侧重新开启远程控制。",
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
        // Error tone (the default); the key is the argument after it.
        undefined,
        // The words carry the retry count, so the mute has to be keyed to the
        // state instead: one close covers the whole outage (spec「状态只在一条
        // 流内状态条上播报」场景 6).
        "reconnecting",
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

  /**
   * Forget the backoff and dial this second. Reached from the page coming back
   * to hand (`onResume`), never from a button on the status line — that line
   * carries only its sentence and the close.
   */
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
          if (snapshotPending()) {
            // Deltas extend a snapshot the app does not have. Rebuild it, which
            // is also what retries the read that failed (spec 场景 4).
            needsSnapshot = false;
            pullSnapshot();
          } else {
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
   * Where a machine-list refusal is painted.
   *
   * There are two, because the two entry points are in different situations: on a
   * cold start the banner *is* the page's only surface (nothing else has anything
   * to say yet), while a reader who came from the header already has a dialog in
   * front of them — and an untouched banner behind it (spec 场景 8). The banner
   * half says the sentence and nothing else; the dialog half keeps its own
   * 「重试」 (a button inside the dialog, not on this line).
   */
  function bannerSurface() {
    return {
      // The line has no actions: `hostsFetchFailed` hands both surfaces the same
      // arguments, and this one drops the second (see `showStatus`).
      show: function (text) {
        showStatus(text);
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
    showStatus("正在读取机器列表…", "progress");
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
   * The standing 「换机器」 entry (a header button on this page — the only entry
   * since the status line dropped its actions): always shows the list, even when
   * a machine is already connected — the current connection stays up until one
   * is chosen.
   */
  function openMachinePicker() {
    if (pickerOpen()) return;
    loadMachineList(showMachinePicker(!!CONFIG.hostId));
  }

  /**
   * One read of the list, painted into the dialog's own slot: reading now, then
   * either the rows or a refusal with 重试. The page banner is deliberately not
   * involved — it belongs to the connection, which stays exactly as it was, and
   * must read the same when the dialog closes (spec 场景 8).
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

  /**
   * @param withSession `false` for the session-less utilities (`listDirectories`
   *   &c.), which must not be bound to whichever conversation the page happens
   *   to be showing.
   * @param forSession Address **another** session instead of the one on screen.
   *   Only the row-level session actions use it: 删除 / 查 worktree 改动 name the
   *   row the user acted on, which need not be the conversation in the pane (the
   *   session list is exactly where you touch the others). Everything else means
   *   「the conversation I am reading」, which the module-level `sessionId`
   *   already is.
   */
  function request(method, params, withSession, forSession) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      var frame = { id: id, method: method, params: params || {} };
      if (forSession) frame.sessionId = forSession;
      else if (withSession !== false && sessionId) frame.sessionId = sessionId;
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
      showStatus(
        err && err.code === HOST_UNSUPPORTED
          ? label + "：这台电脑上的会话不支持这个操作"
          : label + "指令没有回执：" + (err.message || err),
      );
    });
  }

  /**
   * A reply arrives in the host's JSON-RPC envelope — `{id, method:"result",
   * params:{result}}`, or `method:"error"` with `params:{code,message}` — not as
   * a bare `{result}`. Reading `frame.result` resolved every request to
   * `undefined`: `listSessions` fell through to "电脑侧还没有会话。", an empty
   * `getMessages` reply looked like a conversation with no messages, and no
   * reply ever rejected.
   */
  function settle(frame) {
    var entry = pending[frame.id];
    if (!entry) return;
    delete pending[frame.id];
    var params = frame.params || {};
    if (frame.method === "error") {
      // The code rides along: `HOST_UNSUPPORTED` has to stay distinguishable
      // from a transport failure and from the whitelist's `-32601`, because the
      // three mean different things to the user (this host cannot / upgrade the
      // machine / something broke). `failureText` is where that split is read.
      var err = new Error(params.message || "RPC 失败");
      err.code = params.code;
      entry.reject(err);
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
    // **Approvals are no exception.** They used to be one, on the grounds that a
    // pending request is a process-wide fact the user must not miss — and that is
    // true, but a card in the conversation on screen is the wrong carrier: it has
    // no room to say which conversation it came from (`confirmationOf` maps the
    // tool and its input, not the owner), so answering it in someone else's
    // context is exactly the bug the user hit on 2026-10-15 (spec scenario 1),
    // and it could even hide the current conversation's own card behind it. What
    // the frame *does* still do here is feed the session list's 「待确认」 marker:
    // absorbed, not rendered (see `markWaiting`).
    if (frameSessionId && frameSessionId !== sessionId) {
      if (method === "permissionRequest") markWaiting(frameSessionId);
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
      case "backgroundTasksChange":
        // 后台任务（`/tasks` 弹窗的数据）：与 `tasksChange` 那条**待办清单**不是
        // 一回事——那是 `TaskCreate`/`TaskUpdate` 的任务，这是 shell/subagent/
        // workflow 的后台进程。桌面端与 IDE 宿主都用 `updateBackgroundTasks`
        // 这条 webview 命令投递它，这里照抄同一个名字。
        post({ command: "updateBackgroundTasks", tasks: p.tasks });
        return;
      case "queuedMessagesChange":
        // The webview message carries the queue under `queue` (same as the VSCE
        // and desktop hosts); the host's notification calls it `messages`. Send
        // the wrong name and the webview reads `undefined`, writes it into
        // `state.queuedMessages`, and the list render throws — which unmounts
        // the whole app.
        post({ command: "updateQueue", queue: p.messages });
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
      case "btwContent":
        // `/btw` 的流式增量（spec「Web 页也能用 /btw 旁路提问」场景 3）。宿主的
        // 通知叫 `btwContent`、字段是 `{question, content, type}`；页面这一侧沿用
        // IDE / 桌面端那条 `btwStream`（字段名一致），面板按 `question` 判归属 ——
        // 少了 question，切会话后迟到的增量会画进新问题的面板里。
        post({
          command: "btwStream",
          question: typeof p.question === "string" ? p.question : "",
          type: p.type,
          content: p.content,
        });
        return;
      case "permissionRequest":
        // The whole reason this page exists: an approval that arrived while the
        // user was away has to be answerable from the phone — but only in the
        // conversation it belongs to (the filter above drops the others). An
        // untagged frame (`frameSessionId` absent) lands here for the current
        // session, which is the fail-open rule `belongsToCurrentSession` states.
        if (!belongsToCurrentSession(p)) return;
        markWaiting(frameSessionId || sessionId);
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

  /** 首屏：一条会话的尾段（最近 `firstPageLimit` 条），加上此刻等着审批的卡。 */
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
    /** 这一拍有没有读到会话列表——只有读到才算「首屏就绪」，见 `snapshotReady`。 */
    var listOk = false;
    return pickSession()
      .then(function (ok) {
        listOk = ok;
        if (token !== pullToken || !sessionId) return null;
        return request("getSessionInfo", {});
      })
      .then(function (info) {
        // `pickSession` leaves `sessionId` empty when the machine holds no
        // conversation at all — the state right after the last one is deleted.
        // Both session reads are skipped then: the machine answers a session-less
        // `getMessages` with 「Session ID is required」, which surfaced as a red
        // banner on top of the honest 「电脑侧还没有正在跑的会话。」. Everything
        // below this point is process-wide (the pending approvals, the workflow
        // runs), so the empty snapshot still paints.
        if (token !== pullToken || !sessionId) return null;
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
        // The read is process-wide, the cards are not: this is where 「读是进程级的、
        // 弹是会话级的」 lands. The wait set is rewritten from the reply (a fact, not
        // an accumulation — scenario 4) and the cards are filtered to the session on
        // screen, whose own requests are the only ones whose context the reader is
        // looking at (scenario 1/2). Nothing new is read for either of them.
        waitingSessionIds = [];
        var cards = [];
        for (var i = 0; i < requests.length; i++) {
          var owner = requests[i].sessionId;
          if (owner && waitingSessionIds.indexOf(owner) === -1)
            waitingSessionIds.push(owner);
          if (belongsToCurrentSession(requests[i]))
            cards.push(confirmationOf(requests[i]));
        }
        post({
          command: "setInitialState",
          messages: messages,
          // Read off `getSessionInfo`, not assumed: an empty todo list, a quiet
          // queue or "not compacting" in the snapshot must mean the machine
          // *said so*, not that this build cannot ask (scenario 26). Absent
          // fields — an older host — fall back to the neutral values; posting
          // `undefined` into the reducer is not an option.
          tasks: (state && state.tasks) || [],
          // 后台任务（`/tasks` 弹窗）与待办清单同族：以「读」为准的状态，所以
          // 从 `getSessionInfo` 取当前值。没有它，手机在任务开跑之后才连上时
          // 打开 `/tasks` 会看到空表——`backgroundTasksChange` 只在**变化**时推。
          backgroundTasks: (state && state.backgroundTasks) || [],
          // 工作流运行没有「变化就推」的通道（bridge 只为后台任务发
          // `backgroundTasksChange`），所以它和 session-state 一样是**读**出来的。
          // 首屏先给空列表，读回来再补 `updateWorkflowRuns`（见下方
          // `refreshWorkflowRuns()`）——顺序由 post 顺序保证，`/workflows`
          // 打开时数据已经在了。
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
          pendingConfirmations: cards,
          // The session list is re-posted only by a snapshot, so the markers ride
          // this one (spec 「待确认只在它自己的对话里弹，对话状态在会话列表标出来」);
          // the paths that do not rebuild the snapshot send them through
          // `updateSessionStatus` instead.
          sessionStatus: {
            waiting: waitingSessionIds,
            running: runningIds(),
            background: backgroundSessionIds,
            worktrees: worktreeSessionIds,
          },
          queuedMessages: (state && state.queuedMessages) || [],
          // The relay authenticated this page with the machine's own
          // credential; there is no separate phone login to satisfy.
          isAuthenticated: true,
        });
        if (typeof usage === "number")
          post({ command: "contextUsage", percent: usage });
        // After the snapshot, so `updateWorkflowRuns` can never land first.
        refreshWorkflowRuns();
        // Only the list read counts as "the first screen is up": the chain below
        // it runs on an empty registry too (`pickSession` answers `false`, the
        // reads are skipped, and `setInitialState` still paints a blank page).
        // Keying readiness on the whole chain would therefore call a page that
        // never showed a session ready.
        if (listOk) {
          snapshotReady = true;
          snapshotRetryStep = 0;
          if (snapshotRetryTimer) {
            clearTimeout(snapshotRetryTimer);
            snapshotRetryTimer = null;
          }
        }
      })
      .catch(function (err) {
        if (blocked || token !== pullToken) return;
        showStatus("拉取会话失败：" + err.message);
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
        return true;
      })
      .catch(function (err) {
        // A refusal here is not cosmetic: with no list there is no session, so
        // the page would otherwise sit there blank.
        //
        // Two ways out, and they are different kinds of failure. A machine that
        // **refuses** the method (`-32601` — its remote allowlist predates it) or
        // its session says 「不支持」 will answer the same thing forever, so
        // retrying only buries the reason. Everything else (a dropped frame, a
        // host that is briefly not answering, the 20s read budget running out)
        // is usually momentary, so it gets `SNAPSHOT_RETRY_MS` — a bounded set
        // of steps. The line carries no button to press (2026-10-29): once the
        // steps are spent, the ways back are the ones that re-run the snapshot
        // anyway — coming back to the page, the page being remounted
        // (spec「首屏读失败能自己恢复」场景 4 / 5).
        var permanent =
          err &&
          (err.code === METHOD_NOT_FOUND || err.code === HOST_UNSUPPORTED);
        showStatus(
          "读不到电脑侧的会话列表：" + (err && err.message ? err.message : err),
        );
        if (!permanent) scheduleSnapshotRetry();
        return false;
      });
  }

  /**
   * One pending retry at a time (spec 场景 6).
   */
  function scheduleSnapshotRetry() {
    if (snapshotRetryStep >= SNAPSHOT_RETRY_MS.length) return;
    var delay = SNAPSHOT_RETRY_MS[snapshotRetryStep++];
    if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer);
    snapshotRetryTimer = setTimeout(function () {
      snapshotRetryTimer = null;
      pullSnapshot();
    }, delay);
  }

  /**
   * Has the first screen ever been painted? The alignment paths (reconnect,
   * remount, resume) send deltas, and a delta only means something on top of a
   * snapshot. A page whose first read died before `setInitialState` — the list
   * refused, or a later read in the chain threw — has no snapshot to extend, so
   * those paths rebuild the whole thing instead (spec 场景 4).
   */
  function snapshotPending() {
    return !snapshotReady;
  }

  /** Re-read the live session registry into `sessions`. */
  function loadSessions() {
    return request("listDaemonSessions", {}).then(function (result) {
      var entries = (result && result.sessions) || [];
      sessions = entries.map(toSessionMetadata);
      // Same read, second fact: which sessions are generating. The registry is
      // the only place that state exists as a *state* (see `applyStreaming`), so
      // the 「运行中」 marker rides this read rather than adding one — which is
      // also why no extra RPC is needed for either marker (spec scenario 8).
      // 「有后台任务在跑」 and 「这是不是一条 worktree 会话」 are two more facts off
      // the same row for the same reason: they are per-session state the registry
      // already carries, and asking again per row would mean a git call per row
      // on every list refresh (the host's `worktree` field exists precisely so it
      // does not have to).
      runningSessionIds = [];
      backgroundSessionIds = [];
      worktreeSessionIds = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.sessionId) continue;
        if (entry.isLoading === true) runningSessionIds.push(entry.sessionId);
        if (entry.hasRunningBackgroundWork === true)
          backgroundSessionIds.push(entry.sessionId);
        if (entry.worktree) worktreeSessionIds.push(entry.sessionId);
      }
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
        // That read also realigned 「谁在跑」: post it even when the busy flag
        // itself did not change (`applyStreaming` then posts nothing), because
        // *another* session's run may have started or ended while the link was
        // down (spec scenarios 5 and 8).
        postSessionStatus();
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
   * requests, and the 「待确认」 marker on the session list is where the others
   * surface (see the note in `deliver`). The **cards** it posts are scoped: only
   * the requests belonging to the conversation on screen become cards, because a
   * card carries no notion of which conversation asked (spec scenario 1/2).
   *
   * `force` forgets what this shim believed was up: a page that re-mounted reset
   * its own list, so "already shown" is no longer true.
   */
  function refreshPending(force) {
    if (force) shownApprovals = {};
    return request("listPendingPermissions", {})
      .then(function (result) {
        var requests = (result && result.requests) || [];
        // The reply is the truth *now*, so the wait set is rewritten rather than
        // appended to: a request the user answered on the computer (or one that
        // went away with its session) only disappears in this read — the marker
        // goes with it on the next one (spec scenario 4).
        waitingSessionIds = [];
        for (var i = 0; i < requests.length; i++) {
          var owner = requests[i].sessionId;
          if (owner && waitingSessionIds.indexOf(owner) === -1)
            waitingSessionIds.push(owner);
          if (!belongsToCurrentSession(requests[i])) continue;
          if (shownApprovals[requests[i].requestId]) continue;
          showApproval(requests[i]);
        }
        postSessionStatus();
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
    // 工作流运行与它同一次对齐（两条独立读，不值得为它们串成一条链）。
    refreshWorkflowRuns();
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
          post({ command: "updateQueue", queue: info.queuedMessages });
        // 后台任务同上：没有这条，手机在任务开跑之后才连上时打开 `/tasks` 会
        // 一直看到「暂无后台任务」，直到下一次变化（`backgroundTasksChange` 只
        // 报变化，页面到位之前就开跑的那批它照不到）。
        if (info.backgroundTasks)
          post({
            command: "updateBackgroundTasks",
            tasks: info.backgroundTasks,
          });
      })
      .catch(function (err) {
        warnOnce("sessionState", "会话状态补读失败：" + err.message);
      });
  }

  /**
   * 工作流运行（`/workflows` 弹窗的数据）：
   *
   * 桌面端拿到它的方式是同一件事——后台任务通知或切会话时调
   * `agent.getWorkflowRuns()`，再推 `updateWorkflowRuns`（`desktopHost.ts` 的
   * `refreshWorkflowRuns`）。页面这边没有「运行时进度」这条推送源（bridge 只为
   * 后台任务发 `backgroundTasksChange`），所以由对齐路径主动读一次：读到的是
   * **当前事实**，弹窗打开时就有内容，而不是等下一次进度事件。
   */
  function refreshWorkflowRuns() {
    var asked = sessionId;
    if (!asked) return Promise.resolve();
    return request("getWorkflowRuns", {})
      .then(function (result) {
        if (asked !== sessionId) return;
        post({
          command: "updateWorkflowRuns",
          runs: (result && result.runs) || [],
        });
      })
      .catch(function (err) {
        // Best-effort, same as the desktop host: the cached runs stay as the last
        // known state, and an unsupported host simply leaves the list empty.
        warnOnce("workflowRuns", "工作流运行补读失败：" + err.message);
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
    // The current session's 「运行中」 marker is derived from this very value (see
    // `runningIds`), so it moves with the transition instead of waiting for the
    // next registry read — the run the reader just started shows up in the list.
    postSessionStatus();
  }

  // ── Session-list markers (「待确认」 / 「运行中」) ───────────────────
  //
  // Two facts, two reads, one broadcast to the session list. The *card* is
  // per-conversation and the *marker* is process-wide: this page pops an
  // approval only in the conversation that asked, and answers the question
  // 「别处有东西在等我吗」 on the session list instead (spec remote-control.md
  // 「待确认只在它自己的对话里弹，对话状态在会话列表标出来」).

  /**
   * Does this pending request belong to the conversation on screen?
   *
   * **An untagged request counts as the current session** (fail-open): the
   * `sessionId` is a field a machine older than this page does not send, and in
   * that case showing the card is the old behaviour while hiding it would put an
   * approval somewhere the reader cannot reach at all.
   */
  function belongsToCurrentSession(pendingRequest) {
    var owner = pendingRequest && pendingRequest.sessionId;
    return !owner || owner === sessionId;
  }

  /**
   * The sessions the list should mark 「运行中」.
   *
   * The registry read gives that set as a *state*, but the conversation on
   * screen is reported by `streaming` — the one variable the busy state is
   * allowed to live in, fed by both the registry and the `loadingChange`
   * transitions ("two sources, the later one wins", see its declaration). So the
   * current session is taken from there and the others from the registry: one
   * value per session, never two that disagree.
   */
  function runningIds() {
    var ids = [];
    for (var i = 0; i < runningSessionIds.length; i++) {
      if (runningSessionIds[i] !== sessionId) ids.push(runningSessionIds[i]);
    }
    if (sessionId && streaming) ids.push(sessionId);
    return ids;
  }

  /**
   * Record 「这条会话在等我」 and say so at once: the notification path is the
   * only thing that knows about an approval which arrived while the page was
   * connected, and the next re-read (`refreshPending`) may be a reconnect away.
   */
  function markWaiting(id) {
    if (!id || waitingSessionIds.indexOf(id) !== -1) return;
    waitingSessionIds.push(id);
    postSessionStatus();
  }

  /**
   * Hand both marker sets to the session list. The snapshot path carries the same
   * pair inside `setInitialState` (one read, one paint); every path that does not
   * rebuild the snapshot uses this command — the session list itself is only
   * re-posted by a snapshot, so a marker change has no other way to reach it.
   *
   * Sent whether or not anything changed: it is two small arrays, and "unchanged"
   * is not worth a local mirror that could drift from what the page holds (the
   * page may have re-mounted behind our back and reset its own copy).
   */
  function postSessionStatus() {
    post({
      command: "updateSessionStatus",
      waiting: waitingSessionIds,
      running: runningIds(),
      background: backgroundSessionIds,
      worktrees: worktreeSessionIds,
    });
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

  /**
   * Registry entry (`listDaemonSessions`) → what the shared list renders.
   *
   * `repoRoot` rides along with the same rule the rest of `entry.worktree`
   * follows (see `worktreeSessionIds`): it is the registry's fs-derived answer
   * for "which repository does this session's directory belong to", and it is
   * what the new-session dialog's 最近目录 groups by so a worktree session
   * offers the repository root instead of the worktree path. `workdir` stays
   * the real cwd — `joinWorkdir` builds `@file` paths from it, so rewriting it
   * would point those at the wrong directory. Absent = not a worktree, or the
   * host could not tell; the dialog then lists the directory as-is.
   */
  function toSessionMetadata(entry) {
    return {
      id: entry.sessionId,
      sessionType: "main",
      workdir: entry.sessionCwd,
      repoRoot: entry.worktree && entry.worktree.repoRoot,
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

  /**
   * `searchFiles` 的 `{path, type}` → webview 的 `FileItem`（与桌面端
   * `findWorkspaceFiles` 同一套字段）。`path` 只在这页上当 React key 用：这一页
   * 没有编辑器、也不发 `openFile`，真正被插进正文的是 `relativePath`
   * （`[@file:<relativePath>]`）。拼接分隔符跟着 workdir 走——被控的那台机器
   * 可能是 Windows。
   */
  function toFileSuggestions(files, filterText) {
    var list = [];
    var needle = (filterText || "").toLowerCase();
    for (var i = 0; i < files.length; i++) {
      var relativePath = String(files[i].path || "");
      if (!relativePath) continue;
      var trimmed = relativePath.replace(/[\\/]+$/, "");
      var name = trimmed.split(/[\\/]/).pop() || trimmed;
      var dot = name.lastIndexOf(".");
      list.push({
        path: joinWorkdir(relativePath),
        relativePath: relativePath,
        name: name,
        extension: dot > 0 ? name.slice(dot + 1) : "",
        icon: files[i].type === "directory" ? "codicon-folder" : "codicon-file",
        isDirectory: files[i].type === "directory",
      });
    }
    // 与桌面端 `findWorkspaceFiles` 同一个排序：名字以过滤词开头的排前面，
    // 然后目录优先，最后按名字。同一份宿主数据在两端落成同一个顺序。
    list.sort(function (a, b) {
      var aHead = needle !== "" && a.name.toLowerCase().indexOf(needle) === 0;
      var bHead = needle !== "" && b.name.toLowerCase().indexOf(needle) === 0;
      if (aHead && !bHead) return -1;
      if (!aHead && bHead) return 1;
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  /**
   * `@` 下拉里的子代理条目（spec multi-agent/subagent.md「显式子代理调用」）。
   * 与三宿主同一个形状：`path` 是 `agent:<名称>` 占位值、`agentName` 是判据、
   * `agentDescription` 是条目第二行。名字/描述的过滤在 webview 做。
   */
  function toAgentSuggestions(configurations) {
    var list = [];
    for (var i = 0; i < configurations.length; i++) {
      var name = String(configurations[i].name || "");
      if (!name) continue;
      list.push({
        path: "agent:" + name,
        relativePath: "",
        name: name,
        extension: "",
        icon: "codicon-hubot",
        isDirectory: false,
        agentName: name,
        agentDescription: String(configurations[i].description || ""),
      });
    }
    return list;
  }

  /** 会话列表里那条会话的工作目录（条目上叫 `workdir`，见 `toSessionMetadata`）。 */
  function joinWorkdir(relativePath) {
    var entry = currentSession(sessions, sessionId);
    var dir = entry && entry.workdir;
    if (!dir) return relativePath;
    var sep = dir.indexOf("\\") >= 0 ? "\\" : "/";
    return dir.replace(/[\\/]+$/, "") + sep + relativePath;
  }

  /**
   * 历史提示词：`requestHistory` / `searchHistory` → `getPromptHistory` /
   * `searchPromptHistory`，回包一律是 `historyResponse {requestId, history}`。
   * 这条此前是**死弹窗**：入口与请求都写好了，这里却没有 case，`default:` 只
   * `warnOnce` 不回执 ⇒ 打开「历史提示词」永远停在加载中。
   */
  function readHistory(requestId, method, params) {
    request(method, params)
      .then(function (result) {
        post({
          command: "historyResponse",
          requestId: requestId,
          history: (result && result.history) || [],
        });
      })
      .catch(function (err) {
        post({
          command: "historyError",
          requestId: requestId,
          error: failureText("读取历史提示词", err),
        });
      });
  }

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
          if (snapshotPending()) {
            // Same reasoning as the reconnect path: a re-mounted reducer and no
            // snapshot behind it means the deltas have nothing to extend.
            pullSnapshot();
          } else {
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
          }
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

      // ── 会话列表行级动作：删除（spec ui/remote-control.md「手机端的会话列表与
      // 删除」）──
      //
      // 删除 = `destroy`（可选 `removeWorktree`）。**没有**放行裸 `removeWorktree`：
      // 那是一个「删掉这个路径」的能力，而手机能做的是「删掉这条会话」，工作树是
      // 这条会话的附带物，由电脑侧从会话自己的 `createdWorkdir` 推出来（白名单只有
      // `destroy` / `getSessionWorktreeChanges`，见 `REMOTE_ALLOWED_METHODS`）。
      //
      // 三条回复约定：
      // 1. 先重读列表再回执，页面拿到「已删除」时列表已经是删完的那份——不会先回执
      //    再让用户看着一行还在的会话；
      // 2. 删掉的如果是**正在看**的那条，重新挑一条活的并把视图重画（`pullSnapshot`
      //    的第一拍会 `chooseSession`），但**不进页面**：读者仍停在会话列表上，
      //    「已删除」横幅由页面自己显示。没有这一拍，返回对话页会停在一条已经不
      //    存在的会话上，发什么都报「Session not found」；
      // 3. 电脑侧定位不到工作树时**会话照删**，`worktreeRemoved: false` 只是把
      //    「工作树没跟着删掉」这个事实告诉页面（spec 场景 8）。
      case "deleteSession": {
        var deletingId = msg.sessionId || sessionId;
        request(
          "destroy",
          { removeWorktree: msg.removeWorktree === true },
          undefined,
          deletingId,
        )
          .then(function (result) {
            var wasCurrent = deletingId === sessionId;
            if (wasCurrent) {
              // The conversation is about to stop existing: drop the window now so
              // a re-pull cannot show the tail of a session that is already gone.
              messages = [];
            }
            return loadSessions().then(function () {
              post({ command: "updateSessions", sessions: sessions });
              postSessionStatus();
              post({
                command: "sessionDeleted",
                requestId: msg.requestId,
                sessionId: deletingId,
                ok: true,
                worktreeRemoved: !!(result && result.worktreeRemoved),
              });
              if (wasCurrent) {
                // Re-pick whatever is still live and repaint behind the list — the
                // page stays where it is (spec 场景 11：不自动跳进别的会话).
                sessionId = "";
                picked = true;
                pullSnapshot();
              }
            });
          })
          .catch(function (err) {
            post({
              command: "sessionDeleted",
              requestId: msg.requestId,
              sessionId: deletingId,
              ok: false,
              error: String(err.message || err),
            });
          });
        return;
      }

      // 删除确认卡要说的那句话（「N 个未提交文件 / M 个未合并提交」）——**按需读**，
      // 不在列表里逐行跑 git（那是每次重连、每个快照都要付的账，见宿主的
      // `worktree` 字段注释）。宿主回 `null` = 「读不到」：页面按「降级泛警告」处理，
      // 绝不当作「没有改动」而静默删除（spec 场景 7）。
      case "getSessionWorktreeChanges": {
        var askedId = msg.sessionId;
        request("getSessionWorktreeChanges", {}, undefined, askedId)
          .then(function (result) {
            post({
              command: "sessionWorktreeChanges",
              requestId: msg.requestId,
              sessionId: askedId,
              changes: result || null,
            });
          })
          .catch(function (err) {
            post({
              command: "sessionWorktreeChanges",
              requestId: msg.requestId,
              sessionId: askedId,
              changes: null,
              error: String(err.message || err),
            });
          });
        return;
      }

      case "abortMessage":
        controlRequest("abortMessage", {}, "暂停");
        return;

      case "backgroundCurrentTask":
        // 把这一轮正在前台跑的工具转到后台（spec: task-background-execution.md
        // 「前台工具后台化」场景 3/5）。页面不需要专门的回执：转过去之后工具块会
        // 带着 `backgroundTaskId` 经 `toolBlockUpdated` 回来，那才是界面上要看的结果。
        controlRequest("backgroundCurrentTask", {}, "转后台");
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

      // `/btw` 旁路提问（spec ui/remote-control.md「Web 页也能用 /btw 旁路提问」）。
      // 与 compact 不同，它**有**回执而且回执就是答案本身，所以不能走
      // controlRequest（那一条只报失败）：整段答案在这里落地成 `btwResponse`，
      // 流式尾部另走 `btwContent` 通知（见 deliver）。question 原样回给页面——
      // 面板靠它判定「这块内容属于我还开着的那个问题」。
      case "askBtw": {
        var btwQuestion = typeof msg.question === "string" ? msg.question : "";
        request("askBtw", { question: btwQuestion })
          .then(function (result) {
            post({
              command: "btwResponse",
              question: btwQuestion,
              answer: typeof result === "string" ? result : "",
            });
          })
          .catch(function (err) {
            // 宿主侧没接这个方法时说清「这台电脑上的会话不支持」，其余按传输
            // 失败说；两种情况面板都会显示出来，不停在加载中。
            post({
              command: "btwError",
              question: btwQuestion,
              error:
                err && err.code === HOST_UNSUPPORTED
                  ? "这台电脑上的会话还不支持附带提问"
                  : "附带提问失败：" + ((err && err.message) || err),
            });
          });
        return;
      }

      // ── 第二批解禁（spec「页面能执行的那批宿主命令」）───────────────
      // 这一组背后全是 `AgentBridge` 上早就实现的方法，缺的只是白名单一行 +
      // 这里一个 case + 页面一道远端守卫。两条写操作（回滚、清空）与写用户级
      // 设置的模型切换在页面侧各带一次确认，这里只负责发出去并如实回执。

      case "listRewindCheckpoints":
        request("listRewindCheckpoints", {})
          .then(function (result) {
            post({
              command: "rewindCheckpoints",
              checkpoints: (result && result.checkpoints) || [],
            });
          })
          .catch(function (err) {
            // 回空列表 + 一句原因：页面的 loading 只在这条回包上落定，不回就
            // 会一直转在「正在读取回滚点」上。
            showStatus(failureText("读取回滚点", err));
            post({ command: "rewindCheckpoints", checkpoints: [] });
          });
        return;

      case "rewindToMessage":
        // 与桌面端同一条链路：截断对话 **+ 按 `file_history` 快照还原本机工作区
        // 文件**。页面已在执行前确认过一次（文案写明会撤销电脑侧的文件改动），
        // 所以这里只负责发出去并把结果如实回执——`ok` 是页面切自己那份列表的
        // 唯一依据（回执不携带消息列表）。
        request("rewindToMessage", { messageId: msg.messageId })
          .then(function () {
            post({
              command: "rewindResult",
              requestId: msg.requestId,
              messageId: msg.messageId,
              ok: true,
            });
          })
          .catch(function (err) {
            post({
              command: "rewindResult",
              requestId: msg.requestId,
              messageId: msg.messageId,
              ok: false,
              error: String(err.message || err),
            });
            showStatus(failureText("回滚", err));
          });
        return;

      case "clearChat":
        // IDE 端与页面共用这一条（桌面端 `/clear` 整端移除、走不到这里）：宿主
        // 换绑新 sessionId 并跑 Session hooks，页面执行前已确认过一次。成功不需要
        // 回执——列表自己会从 `messagesChange` 信号重新拉出来。
        controlRequest("clearMessages", {}, "清空对话");
        return;

      case "getConfiguredModels":
        // 页面挂载时就发了这一条（`ChatApp` 的模型清单 effect），而首屏的会话还没
        // 选出来：信封里因此没有 `sessionId`（`request` 只在有值时带），机器侧的
        // `getConfiguredModels` 却要按会话读当前模型，于是必然回一句
        // 「sessionId is required」——一条错误色状态条压在刚上屏的首屏上，而它问的
        // 东西紧接着由页面自己再问一次（会话定下来后那个 effect 会重跑）。
        // 所以这一枪不发，按「还没有候选」回执：与机器上真没有活会话时同一个形状
        // （选择器自己隐藏），也与下面这条失败路径的回执同形。
        // PWA 从主屏冷启动时正好没有 `?session=`（manifest 的 `start_url` 是 `./`），
        // 所以手机上是稳定复现，而不是偶发。
        if (!sessionId) {
          post({ command: "configuredModels", models: [] });
          return;
        }
        request("getConfiguredModels", {})
          .then(function (result) {
            post({
              command: "configuredModels",
              models: (result && result.models) || [],
              currentModel: result && result.currentModel,
            });
          })
          .catch(function (err) {
            showStatus(failureText("读取模型列表", err));
            post({ command: "configuredModels", models: [] });
          });
        return;

      case "setModel":
        // 写的是**用户级** `~/.wave/settings.json` 的 `model` 键——这台机器上
        // 所有会话（以及此后新开的）都跟着换，所以页面先确认一次再发。成功不回
        // 执：下一次 `getConfiguredModels` 会读到它，页面也已经在本地更新了。
        request("setModel", { model: msg.model }).catch(function (err) {
          showStatus(failureText("切换模型", err));
        });
        return;

      case "updateQueuedMessage":
        request("updateQueuedMessage", {
          id: msg.id,
          text: msg.text,
          images: msg.images,
        })
          .then(function (result) {
            // 页面已乐观改过队列；宿主说没这条（并发删掉了）就让它撤稿——与两个
            // 本机宿主同一条 `updateQueuedMessageMissing`。
            if (result && result.ok === false)
              post({ command: "updateQueuedMessageMissing", id: msg.id });
          })
          .catch(function (err) {
            post({ command: "updateQueuedMessageMissing", id: msg.id });
            showStatus(failureText("修改排队消息", err));
          });
        return;

      case "deleteQueuedMessageById":
        // 「立即发送」的第二步也走这里：`sendMessage{force}` 把这条立刻发出去，
        // 再删掉队列里的那条，否则它会再发一遍（与 IDE / 桌面同一套做法，没有
        // 专门的宿主方法）。
        request("deleteQueuedMessageById", { id: msg.id }).catch(
          function (err) {
            showStatus(failureText("删除排队消息", err));
          },
        );
        return;

      case "getBackgroundTaskOutput":
        request("getBackgroundTaskOutput", { taskId: msg.taskId })
          .then(function (result) {
            // 宿主回的是信封 `{output}`，webview 读 `output` 本身。
            post({
              command: "backgroundTaskOutput",
              taskId: msg.taskId,
              output: (result && result.output) || null,
            });
          })
          .catch(function (err) {
            post({
              command: "backgroundTaskOutput",
              taskId: msg.taskId,
              output: null,
            });
            // 轮询失败不刷屏（每秒一次），但「这个宿主不支持」要说成那件事，
            // 不是「读取失败」。
            warnOnce("taskOutput", failureText("读取后台任务输出", err));
          });
        return;

      case "stopBackgroundTask":
        request("stopBackgroundTask", { taskId: msg.taskId })
          .then(function (result) {
            post({
              command: "backgroundTaskStopped",
              taskId: msg.taskId,
              success: !!(result && result.success),
            });
          })
          .catch(function (err) {
            post({
              command: "backgroundTaskStopped",
              taskId: msg.taskId,
              success: false,
            });
            showStatus(failureText("停止后台任务", err));
          });
        return;

      case "stopWorkflowRun":
        request("stopWorkflowRun", { runId: msg.runId })
          .then(function (result) {
            post({
              command: "workflowRunStopped",
              runId: msg.runId,
              success: !!(result && result.success),
            });
            // 停完立刻重读一次：被停下的那个不再产生进度事件，等推送是等不到的。
            refreshWorkflowRuns();
          })
          .catch(function (err) {
            post({
              command: "workflowRunStopped",
              runId: msg.runId,
              success: false,
            });
            showStatus(failureText("停止工作流", err));
          });
        return;

      case "requestFileSuggestions": {
        // `@` 文件建议：`query` 就是 `@` 后面那段过滤文本，工作目录由宿主按信封
        // `sessionId` 取（页面不猜目录）。条数与桌面端同一个 20。
        var filter = typeof msg.filterText === "string" ? msg.filterText : "";
        // 子代理条目与文件建议同一条回包、排在前面（spec
        // multi-agent/subagent.md「显式子代理调用」）；名字/描述的过滤在 webview
        // 做，这里只报「这个会话有哪些子代理」。读不到就只给文件建议。
        Promise.all([
          request("searchFiles", { query: filter, maxResults: 20 }),
          request("getSubagentConfigurations", {}).catch(function () {
            return { configurations: [] };
          }),
        ])
          .then(function (results) {
            var fileResult = results[0];
            var agentResult = results[1];
            post({
              command: "fileSuggestionsResponse",
              requestId: msg.requestId,
              filterText: filter,
              suggestions: toAgentSuggestions(
                (agentResult && agentResult.configurations) || [],
              ).concat(
                toFileSuggestions(
                  (fileResult && fileResult.files) || [],
                  filter,
                ),
              ),
            });
          })
          .catch(function (err) {
            post({
              command: "fileSuggestionsError",
              requestId: msg.requestId,
              error: failureText("获取文件建议", err),
            });
          });
        return;
      }

      case "requestHistory":
        readHistory(msg.requestId, "getPromptHistory", {});
        return;

      case "searchHistory":
        readHistory(msg.requestId, "searchPromptHistory", {
          query: msg.query,
        });
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
        // `surface`: 服务端据此把远控页能用的宿主本地命令一并下发（同一张表，
        // spec ui/slash-commands.md「弹窗里的宿主命令只有一份表」）。
        request("getSlashCommands", { surface: "remote-page" })
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

      // 除了活会话派生的那些，弹窗还要列这台机器最近打开过的目录（spec
      // core/recent-workdirs.md）。**无会话也能问**——会话被删光时它仍然有内容，
      // 那正是这份列表存在的理由。读不到（旧版电脑没有这个方法）就回空表：页面
      // 只按活会话派生的那些列，不把一次「没有这项能力」显示成错误。
      case "getRecentWorkdirs":
        request("getRecentWorkdirs", {}, false)
          .then(function (result) {
            post({
              command: "recentWorkdirsResponse",
              requestId: msg.requestId,
              dirs: (result && result.dirs) || [],
            });
          })
          .catch(function (err) {
            post({
              command: "recentWorkdirsResponse",
              requestId: msg.requestId,
              dirs: [],
              error: String(err.message || err),
            });
          });
        return;

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
            // 把用户选的那个目录记进机器侧的最近目录（spec
            // core/recent-workdirs.md）：记的是 `msg.workdir`——worktree 时它是
            // 仓库根，不是上面 `createParams.workdir` 里那个工作树路径。写失败
            // 静默：记不住一个目录，不该让「新建成功」看起来像出错。
            request(
              "rememberRecentWorkdir",
              { workdir: msg.workdir },
              false,
            ).catch(function () {});
            post({
              command: "newSessionCreated",
              requestId: msg.requestId,
              sessionId: result.sessionId,
              currentWorkdir: result.currentWorkdir,
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

      case "getPushState":
        // The menu asks once on mount; every change answers with the same
        // message, so the two ends cannot drift.
        postPushState("");
        return;

      case "enablePushNotifications":
        enablePush();
        return;

      case "disablePushNotifications":
        disablePush();
        return;

      case "openMachinePicker":
        // This page's header chip: show the account's machines and switch if
        // one is chosen. The current connection stays up until then.
        openMachinePicker();
        return;

      default:
        // Not silent any more. A command with no case leaves the page stuck on
        // whatever spinner that action started, with nothing on screen to say
        // why — and the phone has no terminal to go look. So: the log line, plus
        // one line on the page. (Commands the page answers locally live in
        // `UNSUPPORTED_NO_REPLY` above; they never reach here.)
        warnOnce(
          "cmd:" + command,
          "Web 端未实现的命令（已回一句提示，界面不会停在那个动作上）：" +
            command,
        );
        showStatus("这个操作在 Web 端还没有接通：" + command);
    }
  }

  // ── Web Push ────────────────────────────────────────────────────

  /**
   * Notifications, the page's only channel that works while nobody is looking
   * (spec「锁屏也能知道——会话等着我、或者跑完了」).
   *
   * The service worker is the load-bearing half: the relay sends the push to the
   * browser's push service, which wakes `sw.js` — not this page, which by then
   * may be frozen or closed. So the split is: this file owns the subscription
   * lifecycle (permission, VAPID key, register/revoke with the relay), and the
   * worker owns the banner. The banner's one rule that belongs here is the
   * worker's message back — a push that arrived while the page was visible is
   * not announced, it is aligned onto (`onWorkerMessage`).
   */

  /** What this browser can do, and the one case where the answer is iOS-shaped. */
  function pushEnvironment() {
    var supportsWorker = !!(
      navigator.serviceWorker && navigator.serviceWorker.register
    );
    return {
      supportsWorker: supportsWorker,
      supportsPush: supportsWorker && typeof window.PushManager === "function",
      standalone:
        window.navigator.standalone === true ||
        !!(
          window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches
        ),
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent || ""),
    };
  }

  /** The subscription id we registered, or "" — what revoking it needs. */
  function storedPushId() {
    return readStored(PUSH_SUB_KEY);
  }

  /**
   * The page's picture of the feature. `reason` explains a refusal in the
   * vocabulary the menu renders (see MoreMenu): `needs-home-screen` is the iOS
   * case — in a Safari tab `PushManager` does not exist at all (iOS 16.4+ only
   * exposes it to a home-screen web app), so reporting "unsupported" there
   * would be true of the tab and useless to the user.
   */
  function postPushState(reason) {
    var env = pushEnvironment();
    post({
      command: "pushState",
      supported: env.supportsPush,
      subscribed: env.supportsPush && storedPushId() !== "",
      needsHomeScreen: !env.supportsPush && env.isIOS && !env.standalone,
      reason: reason || "",
    });
  }

  /** Relay REST with this page's credential; a 401 leaves as `authRequired`. */
  function relayRest(path, init) {
    var options = init || {};
    options.headers = Object.assign(
      { Authorization: "Bearer " + credential },
      options.headers || {},
    );
    return fetch(path, options).then(function (response) {
      if (response.status === 401) {
        // The machine list refuses the same way for the same reason: this call
        // never passes through the handshake's own ladder, so its caller turns
        // this into one silent renewal and then the login page.
        throw Object.assign(new Error("unauthorized"), { authRequired: true });
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response;
    });
  }

  /** Run one relay call, spending a single silent renewal on a 401. */
  function withRenewal(run) {
    return run().catch(function (err) {
      if (!err || !err.authRequired) throw err;
      return renewSession().then(function (renewed) {
        if (!renewed) throw err;
        return run();
      });
    });
  }

  /** A VAPID key arrives base64url; `subscribe` wants the raw bytes. */
  function urlBase64ToUint8Array(base64) {
    var pad = (4 - (base64.length % 4)) % 4;
    var normalized = (base64 + "====".slice(0, pad))
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    var raw = window.atob(normalized);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  /** Have a worker at all. Silent — that part needs no permission. */
  function registerServiceWorker() {
    if (!pushEnvironment().supportsWorker) return;
    var registered = navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    if (!registered || typeof registered.catch !== "function") return;
    registered.catch(function (err) {
      warnOnce(
        "sw",
        "Service Worker 注册失败：" + (err && err.message ? err.message : err),
      );
    });
  }

  /** Notifications on: permission → VAPID → subscribe → register with the relay. */
  function enablePush() {
    var env = pushEnvironment();
    if (!env.supportsPush) {
      postPushState(
        env.isIOS && !env.standalone ? "needs-home-screen" : "unsupported",
      );
      return;
    }
    if (typeof window.Notification === "undefined") {
      postPushState("unsupported");
      return;
    }
    // The permission prompt has to come from this call, which the page makes
    // from a user gesture — hence "开启通知" is a menu action, never an
    // automatic one on load.
    var asked = window.Notification.requestPermission();
    if (!asked || typeof asked.then !== "function") {
      // An old callback-only signature is not worth a second code path: the
      // browsers that have PushManager also have the promise form.
      postPushState("denied");
      return;
    }
    asked
      .then(function (permission) {
        if (permission !== "granted") {
          postPushState("denied");
          return null;
        }
        return withRenewal(function () {
          return relayRest(VAPID_PATH).then(function (response) {
            return response.json();
          });
        })
          .then(function (body) {
            var key = body && body.publicKey;
            if (!key) throw new Error("中继没有返回 VAPID 公钥");
            return navigator.serviceWorker.ready.then(function (registration) {
              return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key),
              });
            });
          })
          .then(function (subscription) {
            var json = subscription.toJSON();
            return withRenewal(function () {
              return relayRest(SUBSCRIPTIONS_PATH, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  endpoint: json.endpoint,
                  keys: json.keys,
                }),
              }).then(function (response) {
                return response.json();
              });
            }).then(function (created) {
              // Registered: the id is the only handle on this subscription, so
              // losing it means the relay keeps pushing to a browser that no
              // longer listens — store it before reporting success.
              writeStored(PUSH_SUB_KEY, (created && created.id) || "");
              postPushState("");
            });
          });
      })
      .catch(function (err) {
        warnOnce(
          "push-enable",
          "开启通知失败：" + (err && err.message ? err.message : err),
        );
        postPushState("failed");
      });
  }

  /** Notifications off: revoke with the relay first, then drop the browser side. */
  function disablePush() {
    var id = storedPushId();
    var revoke = id
      ? withRenewal(function () {
          return relayRest(SUBSCRIPTIONS_PATH + "/" + encodeURIComponent(id), {
            method: "DELETE",
          });
        })
      : Promise.resolve();

    revoke
      .then(function () {
        writeStored(PUSH_SUB_KEY, "");
        if (!navigator.serviceWorker || !navigator.serviceWorker.ready)
          return null;
        return navigator.serviceWorker.ready
          .then(function (registration) {
            return registration.pushManager.getSubscription();
          })
          .then(function (subscription) {
            return subscription ? subscription.unsubscribe() : null;
          })
          .catch(function () {
            // Best-effort: the relay has already forgotten the endpoint, and
            // that is what actually stops the pushes. A browser-side leftover
            // would be replaced by the next subscribe().
            return null;
          });
      })
      .then(function () {
        postPushState("");
      })
      .catch(function (err) {
        // The revocation did not land, so the subscription is still live at
        // the relay. Keep the id and say so: pretending it is off would leave
        // pushes arriving for a switch the user believes is off.
        warnOnce(
          "push-revoke",
          "注销订阅失败：" + (err && err.message ? err.message : err),
        );
        postPushState("failed");
      });
  }

  /**
   * A push landed while the page was on screen. The worker deliberately shows
   * no banner then (spec 场景 4); this is the page's half of that bargain —
   * re-read the state so the confirmation card or the waiting marker is there
   * without the user doing anything.
   */
  function onWorkerMessage(event) {
    var data = event && event.data;
    if (!data || data.type !== "wave-push") return;
    onResume();
  }

  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
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
      if (snapshotPending()) {
        // The link is fine; the first screen is not. Same call as the other two
        // alignment paths: rebuild rather than extend (spec 场景 4).
        pullSnapshot();
        return;
      }
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

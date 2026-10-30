/**
 * Service Worker for the remote-control page — it exists for Web Push alone.
 *
 * Why a service worker at all: a phone that has the page closed (or a locked
 * screen) has no page to receive anything; the relay's `Web Push` is delivered
 * to the browser's push service and wakes *this* file, not the page. That is
 * the only path by which "a session is waiting for you" reaches someone who is
 * not looking at the page — see spec `remote/remote-web.md`
 * 「锁屏也能知道——会话等着我、或者跑完了」.
 *
 * What it deliberately does **not** do: cache the page, intercept fetches, or
 * answer offline. The page is a live view of a machine that may well be off;
 * a cached shell would answer with yesterday's conversation instead of the
 * 「等待上线」 state the page already renders honestly.
 *
 * One build-time substitution, filled in by `build.mjs` (this file is hashed
 * and served like the other assets — see the header of that file): the
 * notification icon's hashed file name. The shim carries the other one — this
 * file's own hashed name. The scope is the directory this file is served from
 * (`/remote/`), which is also where the page lives, so no
 * `Service-Worker-Allowed` header is needed.
 */
"use strict";

var ICON = "./__ICON_FILE__";

self.addEventListener("install", function () {
  // A page that is already open should start using this version right away:
  // there is no other asset to keep in lockstep, and a stale service worker
  // would keep a just-redeployed push payload parser.
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/**
 * Any visible page under our scope, or null.
 *
 * This single check carries the spec's rule that a visible page means *no*
 * banner (spec 场景 4): the user is looking at the page the notification is
 * about, so a system banner on top of it is a duplicate. Everything else —
 * backgrounded, locked, closed — falls through to `showNotification`.
 *
 * `includeUncontrolled` matters on the first load after an update, when the
 * (already open) page may not be controlled by this registration yet.
 */
function visibleClient() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].visibilityState === "visible") return list[i];
      }
      return null;
    });
}

self.addEventListener("push", function (event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A payload we cannot read is still a signal — fall back to the bare text
    // rather than dropping the event, which on a locked phone is the only
    // notice the user gets.
    payload = { body: event.data ? event.data.text() : "" };
  }
  var title = payload.title || "CodeWave 远程控制";
  var data = payload.data || {};
  var url = payload.url || "./";

  event.waitUntil(
    visibleClient().then(function (client) {
      if (client) {
        // The page is in front of the user: let it re-read the session state
        // itself (`postMessage` → the page's own realign path) instead of
        // stacking a banner on the view it is already showing. The relay and
        // the page carry the same fact through different channels, and the
        // toast-free version of it is the one the spec asks for.
        client.postMessage({
          type: "wave-push",
          hostId: data.hostId,
          sessionId: data.sessionId,
          state: data.state,
        });
        return undefined;
      }
      return self.registration.showNotification(title, {
        body: payload.body || "",
        // One notification per session: a later push for the same session
        // replaces the earlier one instead of stacking, so a machine that
        // ping-pongs through several approvals cannot bury the phone.
        tag: data.sessionId || "wave-remote",
        renotify: false,
        icon: ICON,
        badge: ICON,
        data: { url: url, hostId: data.hostId, sessionId: data.sessionId },
      });
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || "./";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        // Prefer the page the user already has (a home-screen web app is a
        // single window — opening a second one would strand them outside it).
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (new URL(client.url).origin !== self.location.origin) continue;
          return client.focus().then(function () {
            // Navigate rather than postMessage: the address carries the
            // session to land on (`?host=…&session=…`, the same shape the
            // computer prints and the relay's landing-page template uses),
            // and the page already pins itself from it on load.
            return client.navigate(url);
          });
        }
        return self.clients.openWindow(url);
      }),
  );
});

(function () {
  var acquired = false;
  var queue = [];
  var bridgeReady = typeof window.__wavePostMessage === 'function';

  function send(msg) {
    var payload = JSON.stringify(msg);
    if (bridgeReady) {
      window.__wavePostMessage(payload);
    } else {
      queue.push(payload);
    }
  }

  // __wavePostMessage is injected by Kotlin on each page load (onLoadEnd). React mounts
  // and fires webviewReady before that, so queue early messages and flush once ready.
  function poll() {
    if (typeof window.__wavePostMessage === 'function') {
      bridgeReady = true;
      while (queue.length > 0) {
        window.__wavePostMessage(queue.shift());
      }
    } else {
      setTimeout(poll, 10);
    }
  }
  poll();

  window.acquireVsCodeApi = function () {
    if (acquired) throw new Error('An instance of the VS Code API was already acquired');
    acquired = true;
    return {
      postMessage: send,
      getState: function () { return null; },
      setState: function () { return null; }
    };
  };
  // Kotlin → JS: dispatcher that triggers the existing 'message' listener
  window.__waveReceive = function (s) {
    var data = JSON.parse(s);
    window.dispatchEvent(new MessageEvent('message', { data: data }));
  };
})();

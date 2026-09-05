/*
 * Sandbox frame bridge.
 *
 * Runs on an opaque origin. It cannot fetch anything from the app's origin —
 * that would be a cross-origin request without CORS headers — so the worker's
 * source is handed to it by the parent and turned into a blob Worker here,
 * where blob URLs inherit this frame's opaque origin.
 *
 * One worker per execution beyond a trivial size, and terminate on timeout.
 * Never leave a runaway loop holding the tab.
 */
(function () {
  'use strict';

  var parentWindow = window.parent;
  var workerSource = null;
  var worker = null;
  var current = null; // { id, timer }

  function post(message) {
    // The parent is the only correct recipient and it verifies the source.
    parentWindow.postMessage(message, '*');
  }

  function makeWorker() {
    if (!workerSource) return null;
    var blob = new Blob([workerSource], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var w = new Worker(url);
    // The blob is captured by the worker; releasing the URL immediately keeps
    // a long session from accumulating one entry per execution.
    URL.revokeObjectURL(url);
    w.onmessage = onWorkerMessage;
    w.onerror = function (e) {
      finish({ ok: false, error: String(e.message || 'The sandbox worker failed to start.') });
    };
    return w;
  }

  function ensureWorker() {
    if (!worker) worker = makeWorker();
    return worker;
  }

  function killWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function finish(result) {
    if (!current) return;
    clearTimeout(current.timer);
    var id = current.id;
    current = null;
    post({ type: 'chalk-sandbox-result', id: id, result: result });
  }

  function onWorkerMessage(e) {
    var msg = e.data || {};
    if (msg.type === 'result') {
      finish(msg.result);
    } else if (msg.type === 'progress') {
      // Loading Pyodide takes a few seconds; the board says so rather than
      // showing an unexplained pause.
      post({ type: 'chalk-sandbox-progress', id: current ? current.id : null, message: msg.message });
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parentWindow) return;
    var msg = e.data || {};

    if (msg.type === 'chalk-sandbox-init') {
      workerSource = msg.source;
      post({ type: 'chalk-sandbox-ready' });
      return;
    }

    if (msg.type === 'chalk-sandbox-run') {
      if (current) {
        post({
          type: 'chalk-sandbox-result',
          id: msg.id,
          result: { ok: false, error: 'The sandbox is already running something.' },
        });
        return;
      }

      var w = ensureWorker();
      if (!w) {
        post({
          type: 'chalk-sandbox-result',
          id: msg.id,
          result: { ok: false, error: 'The sandbox worker is not available.' },
        });
        return;
      }

      current = {
        id: msg.id,
        timer: setTimeout(function () {
          // Ten seconds, then the worker dies. A fresh one starts next time,
          // which also drops whatever state the runaway code had built up.
          killWorker();
          finish({ ok: false, timedOut: true, stdout: '', result: '', figures: [] });
        }, msg.timeoutMs || 10000),
      };

      w.postMessage({
        type: 'run',
        language: msg.language,
        source: msg.source,
        seed: msg.seed,
        pyodideBaseUrl: msg.pyodideBaseUrl,
      });
      return;
    }

    if (msg.type === 'chalk-sandbox-halt') {
      killWorker();
      finish({ ok: false, error: 'Stopped.', stdout: '', result: '', figures: [] });
    }
  });

  post({ type: 'chalk-sandbox-frame-loaded' });
})();

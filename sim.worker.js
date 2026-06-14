/* ============================================================================
 * sim.worker.js — Web Worker wrapper around engine.js.
 * Runs the Monte Carlo off the main thread so live recompute never janks the UI.
 *
 * Loads data.js + engine.js via importScripts (both attach to the worker's
 * global `self`). Engine functions read self.WC.
 *
 * Protocol (postMessage to worker):
 *   { id, type:'simulate',  config }   -> { id, type:'result',    results }
 *   { id, type:'calibrate', championMarket, opts }
 *                                       -> { id, type:'calibrated', fit }
 *   { id, type:'calibrateChampion', championMarket, opts }
 *                                       -> { id, type:'calibratedChampion', fit }
 *   { id, type:'calibrateReach', reachMarkets, opts }
 *                                       -> { id, type:'calibratedReach', fit }
 *   { id, type:'verify' }              -> { id, type:'verified',  annexC }
 *
 * On error: { id, type:'error', message }.
 * `id` is echoed back so the caller can match request<->response.
 *
 * Results are postMessaged structurally; the heavy raw counters (_matchupRaw)
 * are kept so the main thread can run queryMatchup/queryVenue locally.
 * ==========================================================================*/

/* eslint-disable no-undef */
(function () {
  'use strict';

  // Resolve sibling script URLs relative to this worker file.
  var base;
  try {
    base = self.location.href.replace(/[^/]*$/, '');
  } catch (e) {
    base = './';
  }

  try {
    importScripts(base + 'data.js', base + 'engine.js');
  } catch (e) {
    // Surface load failures clearly.
    self.postMessage({ id: null, type: 'error', message: 'importScripts failed: ' + e.message });
    return;
  }

  var WCEngine = self.WCEngine;

  function strip(results) {
    // Keep the full structure (including _matchupRaw) — it is plain JSON-able
    // and lets the UI call WCEngine.queryMatchup on the main thread. If payload
    // size ever matters, drop _matchupRaw here and answer queries in-worker.
    return results;
  }

  self.onmessage = function (ev) {
    var msg = ev.data || {};
    var id = msg.id != null ? msg.id : null;
    try {
      if (msg.type === 'simulate') {
        var t0 = (self.performance && performance.now) ? performance.now() : Date.now();
        var results = WCEngine.simulate(msg.config || {});
        var t1 = (self.performance && performance.now) ? performance.now() : Date.now();
        results.elapsedMs = t1 - t0;
        self.postMessage({ id: id, type: 'result', results: strip(results) });
      } else if (msg.type === 'calibrate') {
        var fit = WCEngine.calibrate(msg.championMarket || {}, msg.opts || {});
        self.postMessage({ id: id, type: 'calibrated', fit: fit });
      } else if (msg.type === 'calibrateChampion') {
        var fitC = WCEngine.calibrateChampion(msg.championMarket || {}, msg.opts || {});
        self.postMessage({ id: id, type: 'calibratedChampion', fit: fitC });
      } else if (msg.type === 'calibrateReach') {
        var fitR = WCEngine.calibrateReach(msg.reachMarkets || {}, msg.opts || {});
        self.postMessage({ id: id, type: 'calibratedReach', fit: fitR });
      } else if (msg.type === 'verify') {
        self.postMessage({ id: id, type: 'verified', annexC: WCEngine.verifyAnnexC() });
      } else {
        self.postMessage({ id: id, type: 'error', message: 'unknown message type: ' + msg.type });
      }
    } catch (err) {
      self.postMessage({ id: id, type: 'error', message: (err && err.message) || String(err) });
    }
  };

  // Announce readiness (caller may ignore).
  self.postMessage({ id: null, type: 'ready' });
})();

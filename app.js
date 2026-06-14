/* ============================================================================
 * app.js — WorldcupOdds front-end (Preact + htm, no build step).
 *
 * PURPOSE: see WHICH teams might play WHERE and WHEN, with probabilities, so
 * the user can decide which tickets to buy — and watch it move live as
 * results / markets shift.
 *
 * Pipeline on load:
 *   1. sim baseline (ELO, temperature 1) via the Web Worker  → instant skeleton
 *   2. markets.fetchAll()  → live Polymarket marginals
 *   3. calibrate to the champion market in TWO stages: a global temperature
 *      pre-step, then a per-team Elo rake so the sim champion vector can match
 *      (and reorder to) the market — a single scalar temperature alone cannot
 *      reorder teams away from the Elo ranking.
 *   4. re-simulate with calibrated temperature + per-team Elo deltas + group
 *      W/D/L overrides (de-vigged per-match market) + what-if locked results.
 *   5. status bar: model ⊕ market blend, last update, auto-refresh every 5 min
 *   Any what-if change (lock group winner / match result) → recompute.
 *
 * NOTE on stage marginals: the champion market drives calibration (temp + rake).
 * The reach-stage markets (reachR16/QF/SF/Final) and the to-advance/R32 basket
 * are fetched and shown SIDE-BY-SIDE with the model in the stage table for
 * comparison, but are NOT raked into the sim. (A per-stage IPF pass toward the
 * well-calibrated R32/to-advance basket, with per-team stage monotonicity, is a
 * possible future enhancement — the champion rake already pulls each team's
 * earlier-stage reach in the right direction via the funnel.)
 *
 * Reads window.WC (data.js), window.WCEngine (engine.js, also runs in worker),
 * window.WCMarkets (markets.js). Worker = sim.worker.js.
 * ==========================================================================*/
(function () {
'use strict';

var h = preact.h, render = preact.render, Component = preact.Component;
var html = htm.bind(h);
var WC = window.WC, ENG = window.WCEngine, MK = window.WCMarkets;

/* ---------------- i18n ---------------------------------------------------- */
var I18N = {
  zh: {
    tagline: '哪些球队 · 在哪 · 什么时候碰面 — 实时概率帮你挑票',
    sub: '模型 ⊕ Polymarket · 自动更新',
    window: 'JUN 11 — JUL 19',
    tabs: { radar: '明星对阵', venue: '场馆/日期', path: '球队路径', table: '阶段概率' },
    tabsSub: { radar: '雷达', venue: '浏览器', path: '探索', table: '总表' },
    simming: '模拟中…',
    statusModel: '纯模型 (ELO)',
    statusBlend: '模型 ⊕ Polymarket',
    statusCalib: '已校准 · 温度',
    updated: '更新于',
    refreshing: '刷新行情中…',
    refresh: '刷新',
    live: '实时',
    runs: '次模拟',
    // radar
    radarTitle: '明星对阵雷达',
    radarIntro: '选两支球队(或两位球星),看他们在淘汰赛碰面的概率 — 以及每一种可能的碰面:轮次、场馆、城市、日期与概率。最可能的一场,就是最值得买的票。',
    pickMode: '选择方式',
    byTeam: '按球队',
    byStar: '按球星',
    teamA: '球队 A', teamB: '球队 B',
    starA: '球星 A', starB: '球星 B',
    pickPlaceholder: '— 选择 —',
    meetProb: '碰面概率(任意淘汰赛)',
    sameGroup: '同组提示',
    sameGroupNote: '两队同在一组,小组赛必碰;此处只算淘汰赛再相遇。',
    noMeet: '在当前模型下,这两队几乎不会在淘汰赛相遇(< 0.1%)。',
    everyMeeting: '所有可能的碰面',
    bestTicket: '🎟️ 最值得买的票',
    round: '轮次', venueCol: '场馆 / 城市', dateCol: '日期', probCol: '概率',
    pickTwo: '请在上方选择两支球队 / 两位球星。',
    samePick: '请选择两支不同的球队。',
    // venue
    venueTitle: '场馆 / 日期浏览器',
    venueIntro: '挑一场淘汰赛(按场馆 + 日期),看最可能在那里上演的对阵、明星指数,以及每支热门球队现身的概率。买票前先看看哪场最有看头。',
    pickMatch: '选择淘汰赛',
    starPower: '明星指数',
    starPowerNote: '= 预计现身的明星分之和(STARS 加权)',
    likelyPairs: '最可能的对阵',
    marqueeApp: '热门球队现身概率',
    appProb: '现身概率',
    vs: '对',
    // path
    pathTitle: '球队晋级路径',
    pathIntro: '选一支球队,看它一轮一轮最可能的对手、场馆、日期,以及打进各阶段(32/16/8/4 强、决赛、夺冠)的概率。',
    pickTeam: '选择球队',
    funnel: '晋级漏斗',
    roundByRound: '逐轮路径',
    likelyOpp: '最可能对手',
    likelyVenue: '最可能场馆 · 日期',
    reachProb: '打进概率',
    noPath: '请在上方选择一支球队。',
    champion: '夺冠',
    // table
    tableTitle: '全队阶段概率表',
    tableIntro: '48 支球队 × 各阶段概率。点表头排序。可切换「模型」与「Polymarket 行情」并排对照。',
    showModel: '模型',
    showMarket: 'Polymarket',
    showBoth: '并排',
    teamCol: '球队',
    // whatif
    whatifTitle: '情景假设 (What-if)',
    whatifIntro: '锁定一个小组头名,或锁定一场已结束比赛的胜方,然后看概率怎么变。',
    lockGroupWinner: '锁定小组头名',
    lockMatch: '锁定比赛结果',
    noGroup: '— 不锁定 —',
    clearAll: '清空所有假设',
    delta: '相对基线变化',
    recomputing: '重新计算中…',
    activeWhatif: '当前假设',
    // stages
    st: { r32: '32 强', r16: '16 强', qf: '8 强', sf: '4 强', final: '决赛', champion: '夺冠' },
    footer: '模型校准至 Polymarket,仅供娱乐;以 FIFA 官方为准 · 行情来自 Polymarket · 概率为模型推演',
    lang: 'EN'
  },
  en: {
    tagline: 'Which teams · where · when they meet — live odds to pick your tickets',
    sub: 'Model ⊕ Polymarket · auto-updating',
    window: 'JUN 11 — JUL 19',
    tabs: { radar: 'Star Radar', venue: 'Venue/Date', path: 'Team Path', table: 'Stage Odds' },
    tabsSub: { radar: 'matchups', venue: 'browser', path: 'explorer', table: 'table' },
    simming: 'Simulating…',
    statusModel: 'Model only (ELO)',
    statusBlend: 'Model ⊕ Polymarket',
    statusCalib: 'Calibrated · temp',
    updated: 'Updated',
    refreshing: 'Refreshing odds…',
    refresh: 'Refresh',
    live: 'live',
    runs: 'runs',
    radarTitle: 'Star Matchup Radar',
    radarIntro: 'Pick two teams (or two stars) and see the probability they meet in the knockouts — plus every possible meeting: round, venue, city, date and the odds. The single most likely one is the ticket worth buying.',
    pickMode: 'Pick by',
    byTeam: 'Team',
    byStar: 'Star',
    teamA: 'Team A', teamB: 'Team B',
    starA: 'Star A', starB: 'Star B',
    pickPlaceholder: '— choose —',
    meetProb: 'P(meet in any knockout)',
    sameGroup: 'Same group',
    sameGroupNote: 'These two share a group, so they meet in the group stage; this only counts a knockout rematch.',
    noMeet: 'Under the current model these two almost never meet in the knockouts (< 0.1%).',
    everyMeeting: 'Every possible meeting',
    bestTicket: '🎟️ Best ticket to buy',
    round: 'Round', venueCol: 'Venue / City', dateCol: 'Date', probCol: 'Prob',
    pickTwo: 'Pick two teams / stars above.',
    samePick: 'Pick two different teams.',
    venueTitle: 'Venue / Date Browser',
    venueIntro: 'Pick a knockout match (by venue + date) to see the most likely matchups there, a star-power score, and how likely each marquee team is to appear. Scout the best ticket before you buy.',
    pickMatch: 'Pick a knockout',
    starPower: 'Star power',
    starPowerNote: '= sum of STARS expected to appear',
    likelyPairs: 'Most likely matchups',
    marqueeApp: 'Marquee team appearance',
    appProb: 'Appears',
    vs: 'vs',
    pathTitle: 'Team Path Explorer',
    pathIntro: 'Pick a team to see its round-by-round most likely opponents, venues and dates, plus the probability of reaching each stage (R32/R16/QF/SF/Final/Champion).',
    pickTeam: 'Pick a team',
    funnel: 'Advancement funnel',
    roundByRound: 'Round by round',
    likelyOpp: 'Most likely opponent',
    likelyVenue: 'Most likely venue · date',
    reachProb: 'Reach',
    noPath: 'Pick a team above.',
    champion: 'Champion',
    tableTitle: 'Stage Probability Table',
    tableIntro: '48 teams × stage probabilities. Click a header to sort. Toggle model vs Polymarket marginals side by side.',
    showModel: 'Model',
    showMarket: 'Polymarket',
    showBoth: 'Both',
    teamCol: 'Team',
    whatifTitle: 'What-if',
    whatifIntro: 'Lock a group winner, or lock the winner of a finished match, then watch the probabilities move.',
    lockGroupWinner: 'Lock a group winner',
    lockMatch: 'Lock a match result',
    noGroup: '— none —',
    clearAll: 'Clear all',
    delta: 'Δ vs baseline',
    recomputing: 'Recomputing…',
    activeWhatif: 'Active assumptions',
    st: { r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'Final', champion: 'Champion' },
    footer: 'Model calibrated to Polymarket · for fun only; FIFA is authoritative · odds from Polymarket · probabilities are model output',
    lang: '中文'
  }
};

/* ---------------- marquee stars -> team code -----------------------------
 * The brief wants "Messi vs Ronaldo" pickable. A star resolves to its team;
 * the simulation is team-level, so two stars meet exactly when their teams do.
 * Order roughly by STARS tier then fame. */
var STARS_PLAYERS = [
  ['梅西 Messi', 'Messi', 'arg'], ['C罗 Ronaldo', 'Ronaldo', 'por'],
  ['姆巴佩 Mbappé', 'Mbappé', 'fra'], ['亚马尔 Yamal', 'Yamal', 'esp'],
  ['哈兰德 Haaland', 'Haaland', 'nor'], ['贝林厄姆 Bellingham', 'Bellingham', 'eng'],
  ['维尼修斯 Vinícius', 'Vinícius', 'bra'], ['凯恩 Kane', 'Kane', 'eng'],
  ['德布劳内 De Bruyne', 'De Bruyne', 'bel'], ['范戴克 Van Dijk', 'Van Dijk', 'ned'],
  ['穆西亚拉 Musiala', 'Musiala', 'ger'], ['莫德里奇 Modrić', 'Modrić', 'cro'],
  ['普利西奇 Pulisic', 'Pulisic', 'usa'], ['哈基米 Hakimi', 'Hakimi', 'mar'],
  ['奥纳纳 / 三笘 Mitoma', 'Mitoma', 'jpn'], ['努涅斯 Núñez', 'Núñez', 'uru'],
  ['迪亚斯 L. Díaz', 'L. Díaz', 'col'], ['马内 / 凯塔', 'Mané', 'sen'],
  ['劳塔罗 Lautaro', 'Lautaro', 'arg'], ['菲利克斯 Félix', 'Félix', 'por']
];

/* ---------------- helpers ------------------------------------------------ */
function teamName(code, lang) {
  var t = WC.TEAMS[code];
  if (!t) return code || '?';
  return t[1] + ' ' + t[0]; // flag + zh always (names are short, recognizable)
}
function flag(code) { var t = WC.TEAMS[code]; return t ? t[1] : '🏳️'; }
function shortName(code) { var t = WC.TEAMS[code]; return t ? t[0] : (code || '?'); }
function venName(v, idx) { var V = WC.VEN[v]; return V ? V[idx] : v; }
function pct(p, dp) { if (p == null || isNaN(p)) return '—'; return (p * 100).toFixed(dp == null ? 1 : dp) + '%'; }
function fmtDate(d) { var x = new Date(d + 'T12:00:00'); return (x.getMonth() + 1) + '/' + x.getDate(); }
function weekday(d, lang) {
  var wd = lang === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var x = new Date(d + 'T12:00:00'); return wd[x.getDay()];
}
function roundLabelZh(no, lang) {
  var T = I18N[lang].st;
  if (no >= 73 && no <= 88) return T.r32;
  if (no >= 89 && no <= 96) return T.r16;
  if (no >= 97 && no <= 100) return T.qf;
  if (no === 101 || no === 102) return T.sf;
  if (no === 103) return lang === 'en' ? '3rd' : '季军战';
  if (no === 104) return T.final;
  return '';
}
// team -> group letter
var TEAM_GROUP = {};
Object.keys(WC.GROUPS).forEach(function (g) {
  WC.GROUPS[g].forEach(function (t) { TEAM_GROUP[t] = g; });
});
// KO matches that are real fixtures with a venue+date (the bracket).
var KO_MATCHES = WC.KO.slice();

/* ---------------- App component ------------------------------------------ */
function App() {
  Component.call(this);
  var lang = 'zh';
  try { var l = localStorage.getItem('wco-lang'); if (l === 'en' || l === 'zh') lang = l; } catch (e) {}
  this.state = {
    lang: lang,
    tab: 'radar',
    results: null,        // latest sim results (blended if market loaded)
    baseline: null,       // pure-ELO baseline results (for what-if deltas)
    N: 20000,
    phase: 'init',        // 'init' | 'ready'
    simming: true,
    recomputing: false,
    snapshot: null,       // markets.fetchAll() output
    temp: 1,
    calib: null,          // {s, kl, deltas}
    calibDeltas: null,    // per-team Elo deltas from the champion rake
    blended: false,
    updatedAt: null,
    refreshing: false,
    workerErr: null,
    // selections
    rTeamA: 'arg', rTeamB: 'por', rMode: 'team', rStarA: 0, rStarB: 1,
    vMatch: 100,          // default to 7/11 Arrowhead QF (the showcase case)
    pTeam: 'usa',
    tblSort: 'champion', tblDir: -1, tblView: 'both',
    // what-if
    lockGroup: {},        // groupLetter -> winner code
    lockMatch: {}         // koMatchNo -> winner code
  };
  this._reqId = 0;
  this._pending = {};     // reqId -> {resolve}
}
App.prototype = Object.create(Component.prototype);
App.prototype.constructor = App;

App.prototype.componentDidMount = function () {
  this.bootWorker();
  this.runBaseline();
};

App.prototype.componentWillUnmount = function () {
  if (this._refreshTimer) clearInterval(this._refreshTimer);
  if (this.worker) this.worker.terminate();
};

/* ---- worker plumbing ---- */
App.prototype.bootWorker = function () {
  var self = this;
  try {
    this.worker = new Worker('./sim.worker.js');
    this.worker.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.type === 'ready') { self._workerReady = true; return; }
      if (msg.type === 'error') {
        self.setState({ workerErr: msg.message, simming: false, recomputing: false });
        var p0 = self._pending[msg.id]; if (p0) { p0.reject(new Error(msg.message)); delete self._pending[msg.id]; }
        return;
      }
      var p = self._pending[msg.id];
      if (p) { p.resolve(msg); delete self._pending[msg.id]; }
    };
    this.worker.onerror = function (e) {
      self.setState({ workerErr: (e && e.message) || 'worker error', simming: false, recomputing: false });
    };
  } catch (e) {
    self.worker = null; // fall back to main-thread sim
  }
};

// run a worker job; if worker unavailable, run on main thread synchronously.
App.prototype.simulate = function (config) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = {
        resolve: function (msg) { resolve(msg.results); },
        reject: reject
      };
      self.worker.postMessage({ id: id, type: 'simulate', config: config });
    });
  }
  // main-thread fallback
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.simulate(config)); }, 0);
  });
};

App.prototype.calibrateWorker = function (championMarket, opts) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: function (msg) { resolve(msg.fit); }, reject: reject };
      self.worker.postMessage({ id: id, type: 'calibrate', championMarket: championMarket, opts: opts });
    });
  }
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.calibrate(championMarket, opts)); }, 0);
  });
};

// Two-stage fit: temperature pre-step + per-team Elo rake so the sim champion
// vector can REORDER to honour a market that disagrees with Elo ordering.
// Returns { s, deltas, kl, championSim }.
App.prototype.calibrateChampionWorker = function (championMarket, opts) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: function (msg) { resolve(msg.fit); }, reject: reject };
      self.worker.postMessage({ id: id, type: 'calibrateChampion', championMarket: championMarket, opts: opts });
    });
  }
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.calibrateChampion(championMarket, opts)); }, 0);
  });
};

/* ---- pipeline ---- */
App.prototype.runBaseline = function () {
  var self = this;
  this.setState({ simming: true });
  this.simulate({ N: this.state.N, temperature: 1, seed: 0x9E3779B9 }).then(function (res) {
    self.setState({ baseline: res, results: res, simming: false, phase: 'ready' });
    // then layer in live markets
    self.refreshMarkets(true);
    self._refreshTimer = setInterval(function () { self.refreshMarkets(false); }, 5 * 60 * 1000);
  }).catch(function (e) {
    self.setState({ simming: false, workerErr: String(e && e.message || e) });
  });
};

// fetch markets, calibrate, then re-simulate blended (with any what-if locks).
App.prototype.refreshMarkets = function (force) {
  var self = this;
  if (!MK) return;
  this.setState({ refreshing: true });
  MK.fetchAll({ force: !!force }).then(function (snap) {
    self.setState({ snapshot: snap });
    var champ = snap.champion && snap.champion.normalized;
    if (champ && Object.keys(champ).length) {
      // Two-stage fit on a smaller N for speed: temperature pre-step + per-team
      // Elo rake so the sim champion vector can match (and reorder to) the
      // market. Then full re-sim with both temp AND the per-team deltas.
      return self.calibrateChampionWorker(champ, { N: 8000 }).then(function (fit) {
        var temp = (fit && fit.s) ? fit.s : 1;
        var deltas = (fit && fit.deltas) ? fit.deltas : null;
        self.setState({ calib: fit, temp: temp, calibDeltas: deltas });
        return self.recompute(temp, snap, deltas);
      });
    }
    return self.recompute(self.state.temp, snap);
  }).then(function () {
    self.setState({ refreshing: false, updatedAt: new Date(), blended: true });
  }).catch(function (e) {
    self.setState({ refreshing: false });
  });
};

// build group overrides + locked results from snapshot & what-if, re-simulate.
App.prototype.recompute = function (temp, snap, deltas) {
  var self = this;
  snap = snap || this.state.snapshot;
  temp = temp || this.state.temp;
  // per-team Elo deltas from the champion rake (reorder to market). Fall back to
  // the last calibrated deltas so what-if recomputes keep the market fit.
  if (deltas === undefined) deltas = this.state.calibDeltas || null;
  this.setState({ recomputing: true });

  var groupOverrides = {};
  if (snap && snap.perMatch) {
    Object.keys(snap.perMatch).forEach(function (no) {
      var pm = snap.perMatch[no];
      var dv = pm && pm.devigged;
      if (dv && dv.pA != null) groupOverrides[no] = { pA: dv.pA, pD: dv.pD, pB: dv.pB };
    });
  }

  // Translate per-team Elo deltas into an absolute-Elo override for the sim.
  var eloOverride = null;
  if (deltas) {
    eloOverride = {};
    Object.keys(deltas).forEach(function (c) {
      if (WC.ELO[c] != null) eloOverride[c] = WC.ELO[c] + deltas[c];
    });
  }

  // locked results: from what-if group winners + match winners.
  var locked = this.buildLockedResults();

  var cfg = {
    N: this.state.N,
    temperature: temp,
    elo: eloOverride,
    groupOverrides: groupOverrides,
    lockedResults: locked,
    seed: 0x9E3779B9
  };
  return this.simulate(cfg).then(function (res) {
    self.setState({ results: res, recomputing: false });
    return res;
  });
};

// Translate what-if state into engine lockedResults.
//   - lockGroup[g] = code: force that team to top its group. We approximate by
//     locking each of that team's 3 group matches as a win for them (token by
//     GM t1/t2 orientation). Engine reorients reversed fixtures internally.
//   - lockMatch[no] = winnerCode for a knockout match.
App.prototype.buildLockedResults = function () {
  var locked = {};
  var lg = this.state.lockGroup, lm = this.state.lockMatch;
  // group winner: lock all of that team's group matches as a 1-0 win.
  Object.keys(lg).forEach(function (g) {
    var code = lg[g];
    if (!code) return;
    WC.GM.forEach(function (m) {
      var no = m[0], grp = m[2], t1 = m[3], t2 = m[4];
      if (grp !== g) return;
      if (t1 === code) locked[no] = 'A';      // home win
      else if (t2 === code) locked[no] = 'B'; // away win
    });
  });
  // knockout match winners.
  Object.keys(lm).forEach(function (no) {
    if (lm[no]) locked[no] = lm[no];
  });
  return locked;
};

App.prototype.setLang = function () {
  var nl = this.state.lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('wco-lang', nl); } catch (e) {}
  this.setState({ lang: nl });
};

/* ---- what-if actions ---- */
App.prototype.setGroupLock = function (g, code) {
  var lg = {}; for (var k in this.state.lockGroup) lg[k] = this.state.lockGroup[k];
  if (code) lg[g] = code; else delete lg[g];
  var self = this;
  this.setState({ lockGroup: lg }, function () { self.recompute(); });
};
App.prototype.setMatchLock = function (no, code) {
  var lm = {}; for (var k in this.state.lockMatch) lm[k] = this.state.lockMatch[k];
  if (code) lm[no] = code; else delete lm[no];
  var self = this;
  this.setState({ lockMatch: lm }, function () { self.recompute(); });
};
App.prototype.clearWhatif = function () {
  var self = this;
  this.setState({ lockGroup: {}, lockMatch: {} }, function () { self.recompute(); });
};

/* ====================================================================== *
 * RENDER
 * ====================================================================== */
App.prototype.render = function () {
  var st = this.state || {};
  var lang = (st.lang === 'en' || st.lang === 'zh') ? st.lang : 'zh';
  var T = I18N[lang];
  var self = this;

  var tabs = ['radar', 'venue', 'path', 'table'];

  return html`
<div style="min-height:100vh">
  ${this.renderHeader(T, lang)}
  ${this.renderStatusBar(T, lang)}
  ${this.renderNav(tabs, T)}
  <main style="min-height:60vh">
    ${st.phase === 'init' || (st.simming && !st.results)
      ? this.renderBoot(T)
      : html`
        ${st.tab === 'radar' && this.renderRadar(T, lang)}
        ${st.tab === 'venue' && this.renderVenue(T, lang)}
        ${st.tab === 'path' && this.renderPath(T, lang)}
        ${st.tab === 'table' && this.renderTable(T, lang)}
      `}
    ${this.renderWhatif(T, lang)}
  </main>
  <footer style="padding:22px 16px calc(34px + env(safe-area-inset-bottom));text-align:center;font-size:11px;color:#6F6856;line-height:1.7">
    ${T.footer}
    <div style="margin-top:8px"><button class="pressable" onClick=${function () { self.setLang(); }} style="background:none;border:1px solid #D5CEB8;color:#6B7263;font-weight:600;border-radius:7px;padding:4px 12px;cursor:pointer">${T.lang}</button></div>
  </footer>
</div>`;
};

/* ---- header (accent band reused from reference) ---- */
App.prototype.renderHeader = function (T, lang) {
  return html`
<div style="position:relative;overflow:hidden;background:#142019;color:#F4F0E4;padding:calc(22px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) 18px calc(18px + env(safe-area-inset-left))">
  <span style="position:absolute;right:-12px;top:-40px;font-family:'Anton',sans-serif;font-size:190px;line-height:1;color:rgba(244,240,228,.07);letter-spacing:-6px;pointer-events:none">26</span>
  <div style="display:flex;gap:8px;align-items:center;font-size:11px;letter-spacing:2.5px;color:#9FB8A8;font-weight:600;font-family:'Barlow',sans-serif">
    <span>${T.window}</span><span style="width:4px;height:4px;border-radius:50%;background:#C8332B"></span><span>WORLDCUP<span style="color:#E8C25A">ODDS</span></span>
  </div>
  <div style="margin-top:9px;font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-weight:700;font-size:clamp(30px,7vw,44px);line-height:1.05;letter-spacing:.5px">世界杯 <span style="font-family:'Anton',sans-serif;color:#E8C25A;letter-spacing:1px">2026</span> 实时概率 · 看球买票</div>
  <div style="margin-top:8px;font-size:12.5px;color:#B9C4B6">${T.tagline}</div>
</div>
<div style="height:5px;display:flex"><i style="flex:1;background:#C8332B"></i><i style="flex:1;background:#0E8C4F"></i><i style="flex:1;background:#1D5FBF"></i></div>`;
};

/* ---- live status bar ---- */
App.prototype.renderStatusBar = function (T, lang) {
  var st = this.state, self = this;
  var blended = st.blended;
  var label = blended ? T.statusBlend : T.statusModel;
  var time = st.updatedAt ? st.updatedAt.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  var calibTxt = (blended && st.calib) ? (T.statusCalib + ' ' + (st.temp).toFixed(2)) : '';
  return html`
<div style="position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#1B2A21;color:#D8E2D5;padding:7px calc(14px + env(safe-area-inset-right)) 7px calc(14px + env(safe-area-inset-left));font-size:11.5px;border-bottom:1px solid #0E1B15">
  <span style="display:flex;align-items:center;gap:6px;font-weight:700;color:#EEF3EC"><span class="livedot"></span>${label}</span>
  ${calibTxt && html`<span style="color:#9FB8A8">${calibTxt}</span>`}
  <span style="flex:1"></span>
  ${(st.refreshing || st.recomputing)
    ? html`<span style="display:flex;align-items:center;gap:6px;color:#E8C25A"><span style="width:11px;height:11px;border:2px solid rgba(232,194,90,.35);border-top-color:#E8C25A;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span>${st.recomputing ? T.recomputing : T.refreshing}</span>`
    : html`<span style="color:#9FB8A8">${time ? (T.updated + ' ' + time) : ('N=' + st.N.toLocaleString())}</span>`}
  <button class="pressable" onClick=${function () { self.refreshMarkets(true); }} style="background:none;border:1px solid #2E4435;color:#B9C4B6;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:11px;font-weight:600">↻ ${T.refresh}</button>
</div>`;
};

/* ---- nav (sticky, reused style) ---- */
App.prototype.renderNav = function (tabs, T) {
  var st = this.state, self = this;
  return html`
<nav style="position:sticky;top:33px;z-index:50;display:flex;background:rgba(242,238,226,.96);backdrop-filter:blur(8px);border-bottom:1px solid #DCD6C2">
  ${tabs.map(function (t) {
    var on = st.tab === t;
    return html`
    <button onClick=${function () { self.setState({ tab: t }); }} style=${'flex:1;padding:10px 3px 7px;background:none;border:none;cursor:pointer;font-family:\'Barlow Condensed\',\'Noto Sans SC\',sans-serif;font-weight:600;letter-spacing:1px;color:' + (on ? '#191D17' : '#8B8770')}>
      <div style="font-size:16px">${T.tabs[t]}</div>
      <div style="font-size:9.5px;letter-spacing:1.5px;color:#A9A38C;margin-top:1px">${T.tabsSub[t]}</div>
      <div style=${'height:3px;width:34px;border-radius:2px;margin:5px auto 0;background:' + (on ? '#C8332B' : 'transparent')}></div>
    </button>`;
  })}
</nav>`;
};

/* ---- boot shimmer ---- */
App.prototype.renderBoot = function (T) {
  return html`
<section style="max-width:780px;margin:0 auto;padding:24px 14px;animation:fadeup .25s ease">
  <div style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#3D443C;margin-bottom:16px">
    <span style="width:16px;height:16px;border:3px solid #D5CEB8;border-top-color:#0E8C4F;border-radius:50%;display:inline-block;animation:spin .8s linear infinite"></span>
    ${T.simming}
  </div>
  ${[0, 1, 2, 3].map(function (i) {
    return html`<div class="shim" style=${'height:' + (i === 0 ? 64 : 48) + 'px;border-radius:12px;margin-bottom:10px'}></div>`;
  })}
</section>`;
};

/* intro note block (reused warm style) */
function introBox(text) {
  return html`<div style="font-size:12.5px;color:#6B7263;background:#E9E4D2;border-radius:10px;padding:11px 14px;margin-bottom:14px;line-height:1.6">${text}</div>`;
}
function sectionTitle(title) {
  return html`<div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:22px;font-weight:700;margin:4px 2px 4px">${title}</div>`;
}
function selectBox(value, onChange, options) {
  return html`
<select value=${value} onChange=${onChange} style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid #D8D2BE;background:#FFFFFF;font-size:15px;color:#191D17;font-weight:600">
  ${options.map(function (o) { return html`<option value=${o.v} disabled=${o.dis}>${o.label}</option>`; })}
</select>`;
}

/* ====================================================================== *
 * VIEW 1 — Star Matchup Radar
 * ====================================================================== */
App.prototype.renderRadar = function (T, lang) {
  var st = this.state, self = this, res = st.results;

  var codeA, codeB, labelA, labelB;
  if (st.rMode === 'star') {
    var pa = STARS_PLAYERS[st.rStarA], pb = STARS_PLAYERS[st.rStarB];
    codeA = pa[2]; codeB = pb[2];
    labelA = (lang === 'en' ? pa[1] : pa[0]); labelB = (lang === 'en' ? pb[1] : pb[0]);
  } else {
    codeA = st.rTeamA; codeB = st.rTeamB;
    labelA = teamName(codeA, lang); labelB = teamName(codeB, lang);
  }

  var teamOpts = [{ v: '', label: T.pickPlaceholder, dis: true }].concat(
    Object.keys(WC.TEAMS).sort(function (a, b) { return (WC.ELO[b] || 0) - (WC.ELO[a] || 0); })
      .map(function (c) { return { v: c, label: teamName(c, lang) }; }));
  var starOpts = STARS_PLAYERS.map(function (p, i) { return { v: String(i), label: (lang === 'en' ? p[1] : p[0]) + ' · ' + shortName(p[2]) }; });

  var meetings = (res && codeA && codeB && codeA !== codeB)
    ? ENG.queryMatchup(res, codeA, codeB) : [];
  var totalProb = meetings.reduce(function (s, m) { return s + m.prob; }, 0);
  var sameGroup = TEAM_GROUP[codeA] && TEAM_GROUP[codeA] === TEAM_GROUP[codeB];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('⭐ ' + T.radarTitle)}
  ${introBox(T.radarIntro)}

  <div style="display:flex;gap:6px;margin-bottom:12px">
    ${[['team', T.byTeam], ['star', T.byStar]].map(function (m) {
      var on = st.rMode === m[0];
      return html`<button class="pressable" onClick=${function () { self.setState({ rMode: m[0] }); }} style=${'flex:1;padding:9px;border-radius:9px;border:1px solid ' + (on ? '#191D17' : '#D8D2BE') + ';background:' + (on ? '#191D17' : '#FFF') + ';color:' + (on ? '#F2EEE2' : '#191D17') + ';font-weight:700;font-size:13.5px;cursor:pointer'}>${m[1]}</button>`;
    })}
  </div>

  <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:9px;align-items:center;margin-bottom:14px">
    <div>
      <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${st.rMode === 'star' ? T.starA : T.teamA}</div>
      ${st.rMode === 'star'
        ? selectBox(String(st.rStarA), function (e) { self.setState({ rStarA: parseInt(e.target.value, 10) }); }, starOpts)
        : selectBox(codeA, function (e) { self.setState({ rTeamA: e.target.value }); }, teamOpts)}
    </div>
    <div style="font-family:'Anton',sans-serif;font-size:20px;color:#C8332B;padding-top:18px">VS</div>
    <div>
      <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${st.rMode === 'star' ? T.starB : T.teamB}</div>
      ${st.rMode === 'star'
        ? selectBox(String(st.rStarB), function (e) { self.setState({ rStarB: parseInt(e.target.value, 10) }); }, starOpts)
        : selectBox(codeB, function (e) { self.setState({ rTeamB: e.target.value }); }, teamOpts)}
    </div>
  </div>

  ${codeA === codeB
    ? html`<div style="font-size:13px;color:#A23227;background:#FBEDEA;border:1px solid #E3C7C2;border-radius:10px;padding:12px 14px">${T.samePick}</div>`
    : html`
  <div style="background:linear-gradient(135deg,#14261E,#0E1B15);color:#F4F0E4;border-radius:14px;padding:16px;text-align:center;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:15px;font-weight:700">
      <span>${flag(codeA)} ${labelA}</span><span style="color:#E8C25A">⚔</span><span>${flag(codeB)} ${labelB}</span>
    </div>
    <div style="font-size:11px;letter-spacing:2px;color:#9FB8A8;margin-top:12px">${T.meetProb}</div>
    <div style="font-family:'Anton',sans-serif;font-size:46px;line-height:1.1;margin-top:2px;color:${totalProb > 0.001 ? '#E8C25A' : '#7C8C82'}">${pct(totalProb, totalProb < 0.1 ? 2 : 1)}</div>
    ${sameGroup && html`<div style="font-size:11px;color:#C8A95A;margin-top:6px">⚠ ${T.sameGroupNote}</div>`}
  </div>

  ${meetings.length === 0
    ? html`<div style="font-size:13px;color:#6B7263;background:#E9E4D2;border-radius:10px;padding:14px">${T.noMeet}</div>`
    : html`
    <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:18px;font-weight:700;margin:4px 2px 8px">${T.everyMeeting}</div>
    ${meetings.map(function (m, i) {
      var best = i === 0;
      return html`
      <div style=${'display:flex;align-items:stretch;background:#FFF;border:1px solid ' + (best ? '#E0C77F' : '#DCD6C2') + ';border-radius:12px;margin-bottom:8px;overflow:hidden;' + (best ? 'box-shadow:0 2px 12px rgba(184,134,11,.14)' : '')}>
        <div style=${'width:6px;flex:none;background:' + (best ? '#E8C25A' : '#D5CEB8')}></div>
        <div style="flex:1;padding:11px 13px">
          ${best && html`<div style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.5px;color:#7A5A00;background:#F4E3AC;padding:2px 8px;border-radius:5px;margin-bottom:6px">${T.bestTicket}</div>`}
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-family:'Anton',sans-serif;font-size:15px">${roundLabelZh(m.matchNo, lang)}</span>
            <span style="font-size:11px;color:#857E68;font-weight:600">M${m.matchNo}</span>
            <span style="flex:1"></span>
            <span style="font-family:'Anton',sans-serif;font-size:22px;color:${best ? '#B8860B' : '#191D17'}">${pct(m.prob, m.prob < 0.1 ? 2 : 1)}</span>
          </div>
          <div style="font-size:12.5px;color:#6B7263;margin-top:5px">📍 <b style="color:#191D17;font-weight:600">${m.venueName}</b> · ${m.city}</div>
          <div style="font-size:12px;color:#6B7263;margin-top:2px">🗓️ ${fmtDate(m.date)} ${weekday(m.date, lang)}</div>
        </div>
      </div>`;
    })}`}
  `}
</section>`;
};

/* ====================================================================== *
 * VIEW 2 — Venue / Date Browser
 * ====================================================================== */
App.prototype.renderVenue = function (T, lang) {
  var st = this.state, self = this, res = st.results;

  // KO matches sorted by date then match number; build picker label.
  var matches = KO_MATCHES.slice().sort(function (a, b) {
    if (a.d !== b.d) return a.d < b.d ? -1 : 1; return a.no - b.no;
  });
  var matchOpts = matches.map(function (m) {
    var V = WC.VEN[m.v];
    return { v: String(m.no), label: 'M' + m.no + ' · ' + roundLabelZh(m.no, lang) + ' · ' + fmtDate(m.d) + ' · ' + (V ? V[0] : m.v) + ' / ' + (V ? V[1] : '') };
  });

  var sel = null;
  for (var i = 0; i < matches.length; i++) if (matches[i].no === st.vMatch) { sel = matches[i]; break; }
  if (!sel) sel = matches[0];

  var vq = (res && sel) ? ENG.queryVenue(res, sel.v, sel.d) : { pairs: [], appearances: [] };

  // star power = sum over teams of (P(appear) * STARS tier)
  var starPower = 0;
  vq.appearances.forEach(function (a) { starPower += a.prob * (WC.STARS[a.code] || 1); });

  // marquee appearance list: top teams by appearance prob, STARS>=3 highlighted.
  var apps = vq.appearances.slice(0, 12);
  var maxApp = apps.length ? apps[0].prob : 1;

  // most likely pairs (already sorted desc)
  var pairs = vq.pairs.slice(0, 10);
  var maxPair = pairs.length ? pairs[0].prob : 1;

  var V = WC.VEN[sel.v];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('🏟️ ' + T.venueTitle)}
  ${introBox(T.venueIntro)}

  <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${T.pickMatch}</div>
  ${selectBox(String(sel.no), function (e) { self.setState({ vMatch: parseInt(e.target.value, 10) }); }, matchOpts)}

  <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:14px;padding:14px;margin:14px 0 12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-family:'Anton',sans-serif;font-size:18px">${roundLabelZh(sel.no, lang)}</span>
      <span style="font-size:11px;color:#857E68;font-weight:600">M${sel.no}</span>
    </div>
    <div style="font-size:13.5px;color:#191D17;font-weight:600;margin-top:6px">📍 ${V ? V[0] : sel.v} · ${V ? V[1] : ''}</div>
    <div style="font-size:12.5px;color:#6B7263;margin-top:2px">🗓️ ${fmtDate(sel.d)} ${weekday(sel.d, lang)} · ${sel.d}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:11px;border-top:1px dashed #E0DAC6">
      <div style="flex:none">
        <div style="font-size:10.5px;letter-spacing:1px;color:#8B8770;font-weight:600">${T.starPower}</div>
        <div style="font-family:'Anton',sans-serif;font-size:30px;color:#B8860B;line-height:1">${starPower.toFixed(1)}</div>
      </div>
      <div style="flex:1">
        <div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:#EFEADB">
          <i style=${'display:block;height:100%;width:' + Math.min(100, starPower / 10 * 100) + '%;background:linear-gradient(90deg,#E8C25A,#B8860B)'}></i>
        </div>
        <div style="font-size:10.5px;color:#8B8770;margin-top:4px">${T.starPowerNote}</div>
      </div>
    </div>
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.likelyPairs}</div>
  ${pairs.length === 0
    ? html`<div class="shim" style="height:48px;border-radius:10px;margin-bottom:8px"></div>`
    : pairs.map(function (p) {
      var a = p.pair[0], b = p.pair[1];
      return html`
      <div style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid #EFEADB">
        <span style="min-width:120px;flex:none;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${flag(a)} ${shortName(a)} <span style="color:#857E68;font-size:11px">${T.vs}</span> ${flag(b)} ${shortName(b)}</span>
        <span style="flex:1;height:8px;border-radius:4px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(2, Math.round(p.prob / maxPair * 100)) + '%;background:#0E8C4F'}></i></span>
        <span style="width:50px;flex:none;text-align:right;font-size:12.5px;font-weight:700">${pct(p.prob, 1)}</span>
      </div>`;
    })}

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:18px 2px 8px">${T.marqueeApp}</div>
  ${apps.map(function (a) {
    var star = (WC.STARS[a.code] || 1) >= 4;
    return html`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 6px">
      <span style="font-size:16px;flex:none">${flag(a.code)}</span>
      <span style="min-width:66px;flex:none;font-size:13px;font-weight:600;color:${star ? '#191D17' : '#3D443C'}">${shortName(a.code)}${star ? ' ⭐' : ''}</span>
      <span style="flex:1;height:8px;border-radius:4px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(2, Math.round(a.prob / maxApp * 100)) + '%;background:' + (star ? '#B8860B' : '#1D5FBF')}></i></span>
      <span style="width:50px;flex:none;text-align:right;font-size:12.5px;font-weight:700">${pct(a.prob, 1)}</span>
    </div>`;
  })}
</section>`;
};

/* ====================================================================== *
 * VIEW 3 — Team Path Explorer
 * ====================================================================== */
App.prototype.renderPath = function (T, lang) {
  var st = this.state, self = this, res = st.results;
  var code = st.pTeam;
  var teamOpts = Object.keys(WC.TEAMS).sort(function (a, b) { return (WC.ELO[b] || 0) - (WC.ELO[a] || 0); })
    .map(function (c) { return { v: c, label: teamName(c, lang) }; });

  var stage = (res && res.teamStage[code]) ? res.teamStage[code] : null;
  var path = (res && res.teamPath[code]) ? res.teamPath[code] : null;

  var funnelRows = [
    ['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf],
    ['sf', T.st.sf], ['final', T.st.final], ['champion', T.st.champion]
  ];
  var ROUNDS = [['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf], ['sf', T.st.sf], ['final', T.st.final]];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('🧭 ' + T.pathTitle)}
  ${introBox(T.pathIntro)}

  <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${T.pickTeam}</div>
  ${selectBox(code, function (e) { self.setState({ pTeam: e.target.value }); }, teamOpts)}

  ${!stage ? html`<div class="shim" style="height:80px;border-radius:12px;margin-top:14px"></div>` : html`
  <div style="background:linear-gradient(135deg,#14261E,#0E1B15);color:#F4F0E4;border-radius:14px;padding:16px;margin:14px 0 12px;text-align:center">
    <div style="font-size:30px">${flag(code)}</div>
    <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:24px;font-weight:700">${shortName(code)}</div>
    <div style="font-size:11px;color:#9FB8A8;margin-top:2px">ELO ${WC.ELO[code] || '—'} · ${TEAM_GROUP[code]}${lang === 'en' ? ' group' : ' 组'} · ${'⭐'.repeat(WC.STARS[code] || 1)}</div>
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.funnel}</div>
  <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:14px;padding:13px 14px;margin-bottom:14px">
    ${funnelRows.map(function (r) {
      var p = stage[r[0]] || 0;
      var champ = r[0] === 'champion';
      return html`
      <div style="display:flex;align-items:center;gap:9px;padding:4px 0">
        <span style="width:42px;flex:none;font-size:12.5px;font-weight:600;color:#3D443C">${r[1]}</span>
        <span style="flex:1;height:13px;border-radius:7px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(1.5, p * 100) + '%;background:' + (champ ? 'linear-gradient(90deg,#E8C25A,#B8860B)' : '#0E8C4F')}></i></span>
        <span style="width:52px;flex:none;text-align:right;font-family:'Anton',sans-serif;font-size:15px;color:${champ ? '#B8860B' : '#191D17'}">${pct(p, p < 0.1 ? 1 : 0)}</span>
      </div>`;
    })}
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.roundByRound}</div>
  ${ROUNDS.map(function (rd) {
    var pr = path ? path[rd[0]] : null;
    if (!pr || pr.reach < 0.0005) {
      return html`
      <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:#FAF8F0;border:1px solid #EAE5D5;border-radius:11px;margin-bottom:8px;opacity:.7">
        <span style="font-family:'Anton',sans-serif;font-size:14px;width:42px;flex:none">${rd[1]}</span>
        <span style="font-size:12.5px;color:#8B8770">${lang === 'en' ? 'unlikely to reach' : '基本无缘'}</span>
      </div>`;
    }
    var opp = pr.opponents && pr.opponents[0];
    var ven = pr.venues && pr.venues[0];
    var V = ven ? WC.VEN[ven.venue] : null;
    return html`
    <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:11px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:#F7F4E9">
        <span style="font-family:'Anton',sans-serif;font-size:15px">${rd[1]}</span>
        <span style="font-size:11px;color:#6B7263">${T.reachProb} <b style="color:#0E8C4F">${pct(pr.reach, 1)}</b></span>
        <span style="flex:1"></span>
        ${ven && html`<span style="font-size:11.5px;color:#857E68;font-weight:600">🗓️ ${fmtDate(ven.date)} ${weekday(ven.date, lang)}</span>`}
      </div>
      <div style="padding:9px 12px;display:flex;flex-direction:column;gap:6px">
        ${opp && html`<div style="font-size:13px"><span style="color:#857E68">${T.likelyOpp}:</span> <b>${flag(opp.code)} ${shortName(opp.code)}</b> <span style="color:#857E68;font-size:11.5px">${pct(opp.prob / (pr.reach || 1), 0)}${lang === 'en' ? ' of the time' : ' 的可能'}</span></div>`}
        ${V && html`<div style="font-size:13px"><span style="color:#857E68">${T.likelyVenue}:</span> <b>${V[0]}</b> · ${V[1]} <span style="color:#857E68;font-size:11.5px">${ven ? pct(ven.prob / (pr.reach || 1), 0) : ''}</span></div>`}
      </div>
    </div>`;
  })}
  `}
</section>`;
};

/* ====================================================================== *
 * VIEW 4 — Stage Probability Table (sortable + model/market toggle)
 * ====================================================================== */
App.prototype.renderTable = function (T, lang) {
  var st = this.state, self = this, res = st.results, snap = st.snapshot;
  if (!res) return html`<section style="max-width:980px;margin:0 auto;padding:16px 14px"><div class="shim" style="height:200px;border-radius:12px"></div></section>`;

  // market marginals per stage (where available), basket-normalized already.
  var mkt = {
    r32: snap && snap.advance ? snap.advance : null,
    r16: snap && snap.reachR16 ? snap.reachR16 : null,
    qf: snap && snap.reachQF ? snap.reachQF : null,
    sf: snap && snap.reachSF ? snap.reachSF : null,
    final: snap && snap.reachFinal ? snap.reachFinal : null,
    champion: snap && snap.champion ? snap.champion.normalized : null
  };

  var cols = [
    ['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf],
    ['sf', T.st.sf], ['final', T.st.final], ['champion', T.st.champion]
  ];

  var rows = Object.keys(WC.TEAMS).map(function (c) {
    var stg = res.teamStage[c] || {};
    return { code: c, stage: stg };
  });
  var sortKey = st.tblSort, dir = st.tblDir;
  rows.sort(function (a, b) {
    // dir = -1 => descending (highest/Z first, the ▾ arrow); +1 => ascending.
    if (sortKey === 'team') {
      var na = shortName(a.code), nb = shortName(b.code);
      return -dir * (na < nb ? -1 : na > nb ? 1 : 0);
    }
    return -dir * ((b.stage[sortKey] || 0) - (a.stage[sortKey] || 0));
  });

  function sortBy(k) {
    var nd = (st.tblSort === k) ? -st.tblDir : -1;
    self.setState({ tblSort: k, tblDir: nd });
  }
  function arrow(k) { return st.tblSort === k ? (st.tblDir < 0 ? ' ▾' : ' ▴') : ''; }

  var view = st.tblView; // 'model' | 'market' | 'both'
  var hasMarket = !!snap;

  return html`
<section style="max-width:980px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('📊 ' + T.tableTitle)}
  ${introBox(T.tableIntro)}

  <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
    ${[['model', T.showModel], ['market', T.showMarket], ['both', T.showBoth]].map(function (m) {
      var on = view === m[0];
      var dis = (m[0] !== 'model' && !hasMarket);
      return html`<button class="pressable" disabled=${dis} onClick=${function () { if (!dis) self.setState({ tblView: m[0] }); }} style=${'padding:7px 14px;border-radius:8px;border:1px solid ' + (on ? '#191D17' : '#D8D2BE') + ';background:' + (on ? '#191D17' : '#FFF') + ';color:' + (on ? '#F2EEE2' : (dis ? '#C0BAA6' : '#191D17')) + ';font-weight:600;font-size:12.5px;cursor:' + (dis ? 'default' : 'pointer')}>${m[1]}</button>`;
    })}
    ${!hasMarket && html`<span style="font-size:11px;color:#8B8770">${lang === 'en' ? 'market loading…' : '行情加载中…'}</span>`}
  </div>

  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #DCD6C2;border-radius:12px;background:#FFF">
    <table style="border-collapse:collapse;width:100%;min-width:${view === 'both' ? '760px' : '520px'};font-size:12.5px">
      <thead>
        <tr style="background:#F2EEE2">
          <th onClick=${function () { sortBy('team'); }} style="position:sticky;left:0;background:#F2EEE2;text-align:left;padding:9px 10px;cursor:pointer;white-space:nowrap;border-bottom:2px solid #DCD6C2;font-weight:700">${T.teamCol}${arrow('team')}</th>
          ${cols.map(function (c) {
            return html`<th onClick=${function () { sortBy(c[0]); }} style="text-align:right;padding:9px 8px;cursor:pointer;white-space:nowrap;border-bottom:2px solid #DCD6C2;font-weight:700">${c[1]}${arrow(c[0])}</th>`;
          })}
        </tr>
      </thead>
      <tbody>
        ${rows.map(function (r, ri) {
          return html`
          <tr style=${'background:' + (ri % 2 ? '#FBFAF4' : '#FFF')}>
            <td style=${'position:sticky;left:0;background:' + (ri % 2 ? '#FBFAF4' : '#FFF') + ';padding:7px 10px;white-space:nowrap;font-weight:600;border-bottom:1px solid #F0EBDC'}>${flag(r.code)} ${shortName(r.code)}</td>
            ${cols.map(function (c) {
              var mp = res.teamStage[r.code][c[0]] || 0;
              var km = mkt[c[0]];
              var kv = km ? km[r.code] : null;
              var cell;
              if (view === 'market') {
                cell = (kv != null) ? html`<span style="color:#1D5FBF;font-weight:600">${pct(kv, 0)}</span>` : html`<span style="color:#C0BAA6">—</span>`;
              } else if (view === 'both') {
                cell = html`<span style="font-weight:600">${pct(mp, 0)}</span>${(kv != null) ? html`<span style="color:#1D5FBF;font-size:10.5px;display:block">${pct(kv, 0)}</span>` : html`<span style="color:#C9C2AA;font-size:10.5px;display:block">—</span>`}`;
              } else {
                cell = html`<span style="font-weight:600">${pct(mp, mp < 0.1 ? 1 : 0)}</span>`;
              }
              // subtle heat on the model number
              var heat = view === 'market' ? 0 : Math.min(0.5, mp);
              return html`<td style=${'text-align:right;padding:7px 8px;border-bottom:1px solid #F0EBDC;background:rgba(14,140,79,' + (heat * 0.28) + ')'}>${cell}</td>`;
            })}
          </tr>`;
        })}
      </tbody>
    </table>
  </div>
  ${view === 'both' && html`<div style="font-size:11px;color:#8B8770;margin-top:8px">${lang === 'en' ? 'Top = model · bottom (blue) = Polymarket marginal' : '上行=模型 · 下行(蓝)=Polymarket 行情'}</div>`}
</section>`;
};

/* ====================================================================== *
 * WHAT-IF PANEL (collapsible, recompute + deltas)
 * ====================================================================== */
App.prototype.renderWhatif = function (T, lang) {
  var st = this.state, self = this;
  var open = st._whatifOpen;
  var activeCount = Object.keys(st.lockGroup).length + Object.keys(st.lockMatch).length;

  // group winner picker options
  var groupOpts = [{ v: '', label: T.noGroup }];
  // match picker: knockout matches (real bracket) for locking winners is complex
  // because sides resolve dynamically; we expose the simplest, highest-value
  // lever — lock a GROUP WINNER — plus a clear-all. (Knockout result locks are
  // available via the engine but need resolved sides; group locks cover the
  // "a result came in" use-case the brief calls out.)

  // delta panel: compare current champion% vs baseline champion% for top movers.
  var deltas = [];
  if (st.results && st.baseline && activeCount) {
    var codes = Object.keys(WC.TEAMS);
    codes.forEach(function (c) {
      var now = st.results.teamStage[c] ? st.results.teamStage[c].champion : 0;
      var base = st.baseline.teamStage[c] ? st.baseline.teamStage[c].champion : 0;
      var d = now - base;
      if (Math.abs(d) > 0.002) deltas.push({ code: c, d: d, now: now });
    });
    deltas.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    deltas = deltas.slice(0, 8);
  }

  return html`
<div style="max-width:820px;margin:18px auto 0;padding:0 14px">
  <button class="presslight" onClick=${function () { self.setState({ _whatifOpen: !open }); }} style=${'width:100%;display:flex;align-items:center;gap:10px;padding:13px 15px;border:1px solid #C9D9EE;background:#E7EEF8;border-radius:' + (open ? '12px 12px 0 0' : '12px') + ';cursor:pointer;text-align:left'}>
    <span style="font-size:18px">🧪</span>
    <div style="flex:1">
      <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;color:#1D4E8C">${T.whatifTitle}</div>
      <div style="font-size:11.5px;color:#3E6196">${activeCount ? (T.activeWhatif + ': ' + activeCount) : (lang === 'en' ? 'tap to open' : '点击展开')}</div>
    </div>
    <span style="font-size:18px;color:#1D5FBF;transform:rotate(${open ? 180 : 0}deg);transition:transform .2s">⌄</span>
  </button>

  ${open && html`
  <div style="border:1px solid #C9D9EE;border-top:none;background:#F4F8FD;border-radius:0 0 12px 12px;padding:15px;animation:fadeup .2s ease">
    <div style="font-size:12.5px;color:#3E6196;margin-bottom:14px;line-height:1.6">${T.whatifIntro}</div>

    <div style="font-size:11px;letter-spacing:1px;color:#3E6196;font-weight:700;margin-bottom:8px">${T.lockGroupWinner}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:8px">
      ${Object.keys(WC.GROUPS).map(function (g) {
        var sel = st.lockGroup[g] || '';
        var opts = [{ v: '', label: g + (lang === 'en' ? ' · none' : ' · 不锁') }].concat(
          WC.GROUPS[g].map(function (c) { return { v: c, label: shortName(c) }; }));
        return html`
        <div style=${'background:#FFF;border:1px solid ' + (sel ? '#0E8C4F' : '#D8D2BE') + ';border-radius:9px;padding:6px 8px'}>
          <select value=${sel} onChange=${function (e) { self.setGroupLock(g, e.target.value); }} style="width:100%;border:none;background:none;font-size:13px;font-weight:600;color:#191D17;padding:2px">
            ${opts.map(function (o) { return html`<option value=${o.v}>${(o.v ? (flag(o.v) + ' ') : '') + o.label}</option>`; })}
          </select>
        </div>`;
      })}
    </div>

    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
      <button class="pressable" onClick=${function () { self.clearWhatif(); }} style="padding:7px 14px;border-radius:8px;border:1px solid #E3C7C2;background:#FFF;color:#A23227;font-size:12.5px;font-weight:600;cursor:pointer">${T.clearAll}</button>
      ${st.recomputing && html`<span style="font-size:12px;color:#1D5FBF;display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border:2px solid rgba(29,95,191,.3);border-top-color:#1D5FBF;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span>${T.recomputing}</span>`}
    </div>

    ${deltas.length > 0 && html`
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #D6E2F0">
      <div style="font-size:11px;letter-spacing:1px;color:#3E6196;font-weight:700;margin-bottom:9px">${T.delta} · ${T.champion}</div>
      ${deltas.map(function (x) {
        var up = x.d > 0;
        return html`
        <div style="display:flex;align-items:center;gap:9px;padding:4px 0">
          <span style="min-width:74px;flex:none;font-size:13px;font-weight:600">${flag(x.code)} ${shortName(x.code)}</span>
          <span style="flex:1;display:flex;justify-content:center">
            <span style=${'display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:' + (up ? '#0E8C4F' : '#C8332B')}>
              ${up ? '▲' : '▼'} ${(Math.abs(x.d) * 100).toFixed(1)}pp
            </span>
          </span>
          <span style="width:48px;flex:none;text-align:right;font-size:12px;color:#6B7263">${pct(x.now, 1)}</span>
        </div>`;
      })}
    </div>`}
  </div>`}
</div>`;
};

/* ---------------- mount -------------------------------------------------- */
if (!WC || !ENG) {
  document.getElementById('app').innerHTML =
    '<div style="padding:40px;font-family:sans-serif;color:#A23227">data.js / engine.js failed to load.</div>';
} else {
  try {
    render(h(App), document.getElementById('app'));
  } catch (e) {
    console.error('WCO mount error:', e && e.stack || e);
    document.getElementById('app').innerHTML =
      '<pre style="padding:20px;color:#A23227;white-space:pre-wrap;font:12px monospace">mount error: ' +
      String(e && e.stack || e) + '</pre>';
  }
}

})();

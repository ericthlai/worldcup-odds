/* Node self-check for engine.js. Run: node selfcheck.js */
'use strict';
const E = require('../engine.js');
const WC = require('../data.js');

let fail = 0;
function ok(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; }

// 1) matchProbs sanity (group)
let p = E.matchProbs(2000, 1600, 0, {});
ok('group probs sum to 1', Math.abs(p.pA + p.pD + p.pB - 1) < 1e-9);
ok('stronger team favored', p.pA > p.pB);
ok('draw in 18-40% band', p.pD > 0.12 && p.pD < 0.45);
let eq = E.matchProbs(1800, 1800, 0, {});
ok('equal teams symmetric', Math.abs(eq.pA - eq.pB) < 1e-9);
ok('equal-team draw 22-32%', eq.pD > 0.20 && eq.pD < 0.34);

// 2) knockout probs sum to 1, no draw
let k = E.matchProbs(2000, 1600, 0, { knockout: true });
ok('ko probs sum to 1', Math.abs(k.pA + k.pB - 1) < 1e-9);
ok('ko favors stronger', k.pA > k.pB);

// 3) Annex C anchors
const anx = E.verifyAnnexC();
anx.details.forEach(d => {
  ok('AnnexC row ' + d.qualify, d.ok);
  if (!d.ok) console.log('   expected', d.expected, '\n   got     ', d.got);
});
ok('AnnexC overall', anx.ok);

// 4) matcher returns a legal perfect matching for arbitrary valid 8-of-12 sets
function isLegal(assign) {
  if (!assign || Object.keys(assign).length !== 8) return false;
  const used = {};
  for (const slot of E._SLOTS) {
    const g = assign[slot.key];
    if (!g || !slot.gs.includes(g) || used[g]) return false;
    used[g] = 1;
  }
  return true;
}
let m1 = E.matchThirdsToSlots(['A','B','C','D','E','F','G','H']);
ok('matcher legal assignment (ABCDEFGH)', isLegal(m1));
let m2 = E.matchThirdsToSlots(['E','F','G','H','I','J','K','L']);
ok('matcher legal assignment (EFGHIJKL)', isLegal(m2));
// spot-check a few random 8-of-12 sets all produce legal matchings
const ALL = ['A','B','C','D','E','F','G','H','I','J','K','L'];
let allLegal = true;
for (let t = 0; t < 50; t++) {
  const sh = ALL.slice().sort(() => Math.random() - 0.5).slice(0, 8);
  if (!isLegal(E.matchThirdsToSlots(sh))) { allLegal = false; console.log('   illegal for', sh.join('')); }
}
ok('50 random 8-of-12 sets all legal', allLegal);
// setAnnexCTable drop-in override works
E.setAnnexCTable({ 'ABCDEFGH': { __test: true } });
const ov = E.matchThirdsToSlots(['A','B','C','D','E','F','G','H']);
ok('setAnnexCTable override used', ov && ov.__test === true);
E.setAnnexCTable(null); // restore greedy

// 5) Monte Carlo timing N=20000
const N = 20000;
const t0 = process.hrtime.bigint();
const res = E.simulate({ N, seed: 12345 });
const t1 = process.hrtime.bigint();
const ms = Number(t1 - t0) / 1e6;
console.log(`\nN=${N} simulate: ${ms.toFixed(0)} ms`);

// stage marginal coherence
let sumChamp = 0, sumR32 = 0, sumFinal = 0, sumSF = 0;
Object.keys(res.teamStage).forEach(c => {
  const s = res.teamStage[c];
  sumChamp += s.champion; sumR32 += s.r32; sumFinal += s.final; sumSF += s.sf;
});
console.log('sum champion (expect ~1):', sumChamp.toFixed(3));
console.log('sum r32 (expect ~32):', sumR32.toFixed(2));
console.log('sum final (expect ~2):', sumFinal.toFixed(2));
console.log('sum sf (expect ~4):', sumSF.toFixed(2));
ok('champion sums to ~1', Math.abs(sumChamp - 1) < 0.02);
ok('r32 sums to ~32', Math.abs(sumR32 - 32) < 0.5);
ok('final sums to ~2', Math.abs(sumFinal - 2) < 0.1);
ok('sf sums to ~4', Math.abs(sumSF - 4) < 0.1);

// 6) top champions look sane (Argentina/France/Spain/England/Brazil up top)
const top = Object.keys(res.teamStage)
  .map(c => ({ c, p: res.teamStage[c].champion }))
  .sort((a, b) => b.p - a.p).slice(0, 8);
console.log('\nTop 8 champions:', top.map(t => `${t.c} ${(t.p*100).toFixed(1)}%`).join(', '));

// 7) query helpers
const qm = E.queryMatchup(res, 'arg', 'bra');
console.log('\nqueryMatchup arg vs bra slots:', qm.length, qm.slice(0,3).map(x => `M${x.matchNo} ${(x.prob*100).toFixed(2)}%`).join(', '));
ok('queryMatchup returns array', Array.isArray(qm));
const qv = E.queryVenue(res, 'metlife', '2026-07-19'); // final
ok('queryVenue final has appearances', qv.appearances.length > 0);
console.log('Final (MetLife 7/19) top appearances:', qv.appearances.slice(0,4).map(a => `${a.code} ${(a.prob*100).toFixed(1)}%`).join(', '));

// 8) calibrate smoke test (tiny synthetic market)
const champMarket = {}; top.forEach(t => champMarket[t.c] = t.p);
const fit = E.calibrate(champMarket, { N: 3000, grid: [0.7, 0.85, 1.0], seed: 999 });
console.log('\ncalibrate -> s=' + fit.s + ' kl=' + fit.kl.toFixed(4));
ok('calibrate returns s in grid', [0.7,0.85,1.0].includes(fit.s));

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);

/* Adversarial verification of the Annex C best-third-placed assignment.
 * Feeds two OFFICIAL FIFA Annex C anchor scenarios and checks the engine's
 * slot->third-group mapping EXACTLY.
 *
 * SOURCE OF TRUTH: FIFA "Regulations for the FIFA World Cup 26™", Annexe C
 * ("Combinations for eight best third-placed teams"), official PDF
 * (digitalhub.fifa.com/.../FWC2026_regulations_EN.pdf). Column header order is
 * 1A 1B 1D 1E 1G 1I 1K 1L; each row's 8 values are the qualifying 3rd-place set.
 *
 * Official anchors (winner-of-group 1X -> 3rd-place group 3Y):
 *  (1) qualify {E,F,G,H,I,J,K,L}  (Annex C row 1):
 *      1A->3E, 1B->3J, 1D->3I, 1E->3F, 1G->3H, 1I->3G, 1K->3L, 1L->3K
 *  (2) qualify {A,B,C,D,E,F,G,H}  (Annex C row 495):
 *      1A->3H, 1B->3G, 1D->3B, 1E->3C, 1G->3A, 1I->3F, 1K->3D, 1L->3E
 *
 * NOTE: an earlier transcription of these anchors was garbled — it contained
 * pairings (e.g. 1I->3E for set 1, 1D->3C/1G->3B/1I->3A for set 2) that VIOLATE
 * the per-slot eligibility lists in data.js THIRD_SLOTS. Those eligibility lists
 * were independently confirmed correct against the official PDF and Wikipedia's
 * knockout-stage table (match 77 winner I faces 3 of C/D/F/G/H, etc.), so the
 * garbled rows — not the eligibility lists — were the error. These corrected
 * rows are read straight from the FIFA PDF and ARE eligibility-legal.
 */
'use strict';
var Eng = require('../engine.js');
var WC = require('../data.js');

// winner-group order matches the slot match numbers (E,I,A,L,D,G,B,K)
var SLOTS = Eng._SLOTS;

function runScenario(label, qualify, expected) {
  var assign = Eng.matchThirdsToSlots(qualify); // slotKey -> groupLetter
  var byWinner = {};
  SLOTS.forEach(function (slot) {
    byWinner[slot.winner] = assign ? assign[slot.key] : null;
  });

  console.log('\n=== ' + label + '  qualify={' + qualify.join(',') + '} ===');
  var rows = Object.keys(expected).sort();
  var allOk = true;
  rows.forEach(function (w) {
    var got = byWinner[w];
    var exp = expected[w];
    var ok = got === exp;
    if (!ok) allOk = false;
    console.log('  1' + w + ' -> 3' + (got == null ? '(none)' : got) +
      '   expected 3' + exp + '   ' + (ok ? 'OK' : 'MISMATCH'));
  });

  // also enumerate ALL legal perfect matchings to test uniqueness
  var legal = enumerateMatchings(qualify);
  console.log('  legal perfect matchings for this set: ' + legal.count +
    (legal.count > 1 ? '  (NOT UNIQUE)' : '  (unique)'));
  // check whether the official expected row is even among the legal matchings
  var expElig = matchingIsLegal(expected);
  console.log('  official expected row is eligibility-legal: ' + expElig);

  console.log('  RESULT: ' + (allOk ? 'ENGINE MATCHES OFFICIAL' : 'ENGINE DOES NOT MATCH OFFICIAL'));
  return { allOk: allOk, legalCount: legal.count, expElig: expElig, byWinner: byWinner, legal: legal.list };
}

// Is a given winner->group map legal w.r.t. eligibility lists + a permutation?
function matchingIsLegal(map) {
  var used = {};
  for (var i = 0; i < SLOTS.length; i++) {
    var slot = SLOTS[i];
    var g = map[slot.winner];
    if (g === undefined || g === null) return false;
    if (used[g]) return false;
    if (slot.gs.indexOf(g) === -1) return false;
    used[g] = true;
  }
  return true;
}

// Brute-force enumerate every legal perfect matching of the 8 groups to slots.
function enumerateMatchings(qualify) {
  var avail = qualify.slice();
  var list = [];
  function rec(idx, used, acc) {
    if (idx === SLOTS.length) { list.push(Object.assign({}, acc)); return; }
    var slot = SLOTS[idx];
    for (var i = 0; i < slot.gs.length; i++) {
      var g = slot.gs[i];
      if (avail.indexOf(g) === -1) continue;
      if (used[g]) continue;
      used[g] = true; acc[slot.winner] = g;
      rec(idx + 1, used, acc);
      used[g] = false; delete acc[slot.winner];
    }
  }
  rec(0, {}, {});
  return { count: list.length, list: list };
}

// ---- Full-table integrity check: 495 distinct rows, all eligibility-legal ---
function validateFullTable() {
  var T = WC.ANNEXC_TABLE;
  console.log('\n=== Annex C table integrity ===');
  if (!T) { console.log('  ANNEXC_TABLE MISSING in data.js'); return false; }
  var keys = Object.keys(T);
  var elig = {};
  SLOTS.forEach(function (s) { elig[s.winner] = s.gs; });
  var ok = true;
  var violations = 0;
  keys.forEach(function (key) {
    var row = T[key];
    // 1) the 8 values must equal the sorted key set (each row uses exactly the
    //    qualifying groups)
    var vals = Object.keys(row).map(function (w) { return row[w]; }).sort().join('');
    if (vals !== key) { ok = false; console.log('  KEY/VALUE MISMATCH ' + key + ' -> ' + vals); }
    // 2) every pairing must be eligibility-legal vs THIRD_SLOTS
    Object.keys(row).forEach(function (w) {
      if (elig[w].indexOf(row[w]) === -1) { violations++; ok = false; }
    });
  });
  var count495 = keys.length === 495;
  console.log('  rows: ' + keys.length + (count495 ? ' (expected 495 OK)' : ' (EXPECTED 495!)'));
  console.log('  eligibility violations: ' + violations + (violations === 0 ? ' OK' : ' FAIL'));
  if (!count495) ok = false;
  return ok;
}
var tableOk = validateFullTable();

var sc1 = runScenario('Scenario 1',
  ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
  { A: 'E', B: 'J', D: 'I', E: 'F', G: 'H', I: 'G', K: 'L', L: 'K' });

var sc2 = runScenario('Scenario 2',
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  { A: 'H', B: 'G', D: 'B', E: 'C', G: 'A', I: 'F', K: 'D', L: 'E' });

console.log('\n=== SUMMARY ===');
console.log('Full Annex C table integrity: ' + tableOk);
console.log('Scenario 1 engine matches official: ' + sc1.allOk + ' | legal matchings: ' + sc1.legalCount);
console.log('Scenario 2 engine matches official: ' + sc2.allOk + ' | legal matchings: ' + sc2.legalCount);

// Also report what the in-repo ANNEXC_ANCHORS expects vs engine (sanity)
console.log('\n=== In-repo ANNEXC_ANCHORS self-test (engine.verifyAnnexC) ===');
var anx = Eng.verifyAnnexC();
console.log('verifyAnnexC ok: ' + anx.ok);

// The official anchor rows must NOT be reproducible by eligibility alone — both
// sets admit many legal matchings, so a passing test proves the literal table
// is doing the work (not a coincidental greedy hit).
console.log('\n=== Adversarial guard (eligibility cannot fix this) ===');
console.log('  set 1 legal matchings: ' + sc1.legalCount + ' (must be > 1 to be a real test)');
console.log('  set 2 legal matchings: ' + sc2.legalCount + ' (must be > 1 to be a real test)');

var pass = tableOk && sc1.allOk && sc2.allOk && anx.ok &&
  sc1.expElig && sc2.expElig && sc1.legalCount > 1 && sc2.legalCount > 1;
console.log('\nRESULT: ' + (pass ? 'ALL ANNEX C CHECKS PASSED' : 'ANNEX C CHECKS FAILED'));
process.exit(pass ? 0 : 1);

/* Cookies Casino — Craps rules engine (pure; shared by craps.html and node tests).
   Amounts are dollars with cents. A bet's "return" is what goes back to the player when it is settled
   (stake + winnings on a win, stake on a push, 0 on a loss). Place and hardway bets stay up after a win:
   the player is paid the winnings only and the stake keeps working. */
(function(root){
'use strict';
const PTS = [4, 5, 6, 8, 9, 10];
const ODDS = {4:[2,1], 5:[3,2], 6:[6,5], 8:[6,5], 9:[3,2], 10:[2,1]};     // true odds (take)
const LAY  = {4:[1,2], 5:[2,3], 6:[5,6], 8:[5,6], 9:[2,3], 10:[1,2]};     // true odds (lay)
const PLACE= {4:[9,5], 5:[7,5], 6:[7,6], 8:[7,6], 9:[7,5], 10:[9,5]};
const HARD = {4:[7,1], 6:[9,1], 8:[9,1], 10:[7,1]};
const ODDS_MULT = {4:3, 5:4, 6:5, 8:5, 9:4, 10:3};                        // 3-4-5x odds
const LAY_MULT = 6;                                                        // lay up to 6× the flat (wins 3/4/5×)
const PROPS = { any7:{n:'Any 7', pay:4, hit:(t) => t === 7}, craps:{n:'Any Craps', pay:7, hit:(t) => t === 2 || t === 3 || t === 12},
  yo:{n:'Yo 11', pay:15, hit:(t) => t === 11}, aces:{n:'Aces (2)', pay:30, hit:(t) => t === 2}, ad:{n:'Ace-Deuce (3)', pay:15, hit:(t) => t === 3},
  box:{n:'Boxcars (12)', pay:30, hit:(t) => t === 12} };
const FIELD = {2:2, 3:1, 4:1, 9:1, 10:1, 11:1, 12:3};                      // field pays (to 1); 5,6,7,8 lose
const cents = x => Math.floor(x * 100 + 1e-6) / 100;                       // breakage: pay down to the cent
const win = (stake, [n, d]) => cents(stake * n / d);

function name(k){
  if (k === 'pass') return 'Pass Line'; if (k === 'dp') return "Don't Pass"; if (k === 'passO') return 'Pass odds'; if (k === 'dpO') return "Don't Pass odds";
  if (k === 'come') return 'Come'; if (k === 'dc') return "Don't Come"; if (k === 'field') return 'Field';
  if (PROPS[k]) return PROPS[k].n;
  const m = /^(come|comeO|dc|dcO|place|hard)_(\d+)$/.exec(k); if (!m) return k; const N = m[2];
  return {come:`Come ${N}`, comeO:`Come ${N} odds`, dc:`Don't Come ${N}`, dcO:`Don't Come ${N} odds`, place:`Place ${N}`, hard:`Hard ${N}`}[m[1]];
}

/* Settle one roll. state = {point: null|4..10, bets:{key:amount}}.
   Returns {point, bets, res:[{k, stake, ret, kind:'win'|'lose'|'push', stay}], credit, wagered, returned}.
   credit = amount to add to the bankroll now; wagered/returned are for the lifetime stats (net = returned - wagered). */
function roll(state, d1, d2){
  const t = d1 + d2, hard = d1 === d2, comeOut = state.point == null, b = Object.assign({}, state.bets), res = [];
  const settle = (k, kind, winAmt = 0, stay = false) => { const s = b[k]; if (!s) return; const ret = kind === 'win' ? s + winAmt : kind === 'push' ? s : 0;
    res.push({k, stake: s, ret: Math.round(ret * 100) / 100, kind, stay, won: kind === 'win' ? winAmt : 0}); if (!stay) delete b[k]; };
  // one-roll propositions and the field
  for (const k in PROPS) if (b[k]) settle(k, PROPS[k].hit(t) ? 'win' : 'lose', b[k] * PROPS[k].pay);
  if (b.field) settle('field', FIELD[t] ? 'win' : 'lose', b.field * (FIELD[t] || 0));
  // hardways and place bets: off on the come-out roll
  if (!comeOut){
    for (const N of [4, 6, 8, 10]){ const k = 'hard_' + N; if (!b[k]) continue;
      if (t === N && hard) settle(k, 'win', win(b[k], HARD[N]), true); else if (t === 7 || t === N) settle(k, 'lose'); }
    for (const N of PTS){ const k = 'place_' + N; if (!b[k]) continue;
      if (t === N) settle(k, 'win', win(b[k], PLACE[N]), true); else if (t === 7) settle(k, 'lose'); }
  }
  // established come / don't come bets (come odds are off on the come-out roll; lay odds always work)
  for (const N of PTS){
    if (b['come_' + N]){ if (t === N){ settle('come_' + N, 'win', b['come_' + N]); settle('comeO_' + N, comeOut ? 'push' : 'win', win(b['comeO_' + N] || 0, ODDS[N])); }
      else if (t === 7){ settle('come_' + N, 'lose'); settle('comeO_' + N, comeOut ? 'push' : 'lose'); } }
    else if (b['comeO_' + N]) settle('comeO_' + N, 'push');                                   // orphaned odds go back
    if (b['dc_' + N]){ if (t === 7){ settle('dc_' + N, 'win', b['dc_' + N]); settle('dcO_' + N, 'win', win(b['dcO_' + N] || 0, LAY[N])); }
      else if (t === N){ settle('dc_' + N, 'lose'); settle('dcO_' + N, 'lose'); } }
    else if (b['dcO_' + N]) settle('dcO_' + N, 'push');
  }
  // bets in the Come / Don't Come boxes
  if (b.come){ if (t === 7 || t === 11) settle('come', 'win', b.come); else if (t === 2 || t === 3 || t === 12) settle('come', 'lose');
    else { b['come_' + t] = (b['come_' + t] || 0) + b.come; delete b.come; } }
  if (b.dc){ if (t === 2 || t === 3) settle('dc', 'win', b.dc); else if (t === 12) settle('dc', 'push'); else if (t === 7 || t === 11) settle('dc', 'lose');
    else { b['dc_' + t] = (b['dc_' + t] || 0) + b.dc; delete b.dc; } }
  // the line
  let point = state.point;
  if (comeOut){
    if (t === 7 || t === 11){ settle('pass', 'win', b.pass || 0); settle('dp', 'lose'); }
    else if (t === 2 || t === 3){ settle('pass', 'lose'); settle('dp', 'win', b.dp || 0); }
    else if (t === 12){ settle('pass', 'lose'); settle('dp', 'push'); }
    else point = t;
    settle('passO', 'push'); settle('dpO', 'push');                                            // (never on the table without a point)
  } else if (t === point){
    settle('pass', 'win', b.pass || 0); settle('passO', 'win', win(b.passO || 0, ODDS[point])); settle('dp', 'lose'); settle('dpO', 'lose'); point = null;
  } else if (t === 7){
    settle('pass', 'lose'); settle('passO', 'lose'); settle('dp', 'win', b.dp || 0); settle('dpO', 'win', win(b.dpO || 0, LAY[point])); point = null;
  }
  const r2 = x => Math.round(x * 100) / 100;
  let credit = 0, wagered = 0, returned = 0;
  for (const r of res){ wagered += r.stake; returned += r.ret; credit += r.stay ? r.ret - r.stake : r.ret; }
  return { point, bets: b, res, credit: r2(credit), wagered: r2(wagered), returned: r2(returned), total: t, hard };
}

/* Can bet k be added (up to `amount` more) in this state? Returns an error string or null. */
const LIMITS = { flat:[5, 5000], place:[5, 5000], field:[5, 5000], prop:[1, 1000], hard:[1, 1000], odds:[1, Infinity] };
const TABLE_MAX = 25000;
function kindOf(k){ if (k === 'pass' || k === 'dp' || k === 'come' || k === 'dc' || /^(come|dc)_/.test(k)) return 'flat'; if (/O(_|$)/.test(k)) return 'odds';
  if (/^place_/.test(k)) return 'place'; if (/^hard_/.test(k)) return 'hard'; if (k === 'field') return 'field'; return 'prop'; }
function maxFor(state, k){
  const b = state.bets, m = /^(comeO|dcO)_(\d+)$/.exec(k);
  if (k === 'passO') return state.point && b.pass ? b.pass * ODDS_MULT[state.point] : 0;
  if (k === 'dpO') return state.point && b.dp ? b.dp * LAY_MULT : 0;
  if (m){ const N = +m[2]; return m[1] === 'comeO' ? (b['come_' + N] || 0) * ODDS_MULT[N] : (b['dc_' + N] || 0) * LAY_MULT; }
  return LIMITS[kindOf(k)][1];
}
function canAdd(state, k, amount){
  const b = state.bets, cur = b[k] || 0, total = Object.values(b).reduce((a, v) => a + v, 0);
  if ((k === 'pass' || k === 'dp') && state.point) return `${name(k)} bets go on before the come-out roll`;
  if ((k === 'come' || k === 'dc') && !state.point) return `Come bets need a point — use the ${k === 'come' ? 'Pass Line' : "Don't Pass"} on the come-out`;
  if (/^(come|dc)_/.test(k)) return 'Come bets move there by themselves';
  if (k === 'passO' && !(state.point && b.pass)) return 'Pass odds need a point and a Pass Line bet';
  if (k === 'dpO' && !(state.point && b.dp)) return "Lay odds need a point and a Don't Pass bet";
  const mo = /^(comeO|dcO)_(\d+)$/.exec(k); if (mo && !b[(mo[1] === 'comeO' ? 'come_' : 'dc_') + mo[2]]) return `No ${mo[1] === 'comeO' ? 'Come' : "Don't Come"} bet on ${mo[2]} to back with odds`;
  const mx = maxFor(state, k);
  if (cur + amount > mx + 1e-9) return `Maximum on ${name(k)} is $${mx.toLocaleString('en-US')}`;
  if (total + amount > TABLE_MAX) return `Table maximum is $${TABLE_MAX.toLocaleString('en-US')} on the layout`;
  return null;
}
/* May the player take bet k down now? */
function canRemove(state, k){
  if (k === 'pass') return state.point ? 'The Pass Line is a contract bet once a point is set' : null;
  if (/^come_/.test(k)) return 'Come bets are contract bets once they move to a number';
  return null;
}
function belowMin(bets){ for (const k in bets){ const mn = LIMITS[kindOf(k)][0]; if (bets[k] < mn - 1e-9) return `Minimum on ${name(k)} is $${mn}`; } return null; }

const CRAPS = { PTS, ODDS, LAY, PLACE, HARD, ODDS_MULT, LAY_MULT, PROPS, FIELD, LIMITS, TABLE_MAX, roll, canAdd, canRemove, maxFor, belowMin, name, kindOf, cents };
if (typeof module !== 'undefined' && module.exports) module.exports = CRAPS; else root.CRAPS = CRAPS;
})(typeof self !== 'undefined' ? self : this);

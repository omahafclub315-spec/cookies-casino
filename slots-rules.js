/* Cookies Casino — Cookie Slots: 3 reels × 3 rows, 5 fixed paylines, 32 stops per reel (fixed strips below).
   Each line pays independently on the line bet. RTP is computed exactly by enumerating all 32×32×32 reel stops × 5 lines. */
(function(root){
'use strict';
const STRIPS = [["cherry","blank","blank","blank","cherry","blank","donut","gold","blank","candy","blank","blank","blank","cherry","cake","cherry","candy","cake","donut","choc","blank","cake","blank","blank","choc","blank","choc","cherry","choc","cherry","candy","donut"],["blank","donut","cherry","blank","candy","blank","candy","blank","choc","blank","blank","cake","choc","cake","blank","donut","gold","choc","blank","blank","blank","blank","cake","choc","donut","blank","blank","blank","blank","candy","blank","cherry"],["cake","choc","blank","blank","donut","blank","donut","cake","choc","cherry","blank","choc","blank","cake","blank","blank","blank","choc","candy","donut","cherry","blank","candy","blank","gold","blank","blank","blank","candy","blank","blank","blank"]];
const SYM = { gold:{e:'🍪', n:'Golden Cookie'}, cake:{e:'🧁', n:'Cupcake'}, donut:{e:'🍩', n:'Donut'}, choc:{e:'🍫', n:'Chocolate'}, candy:{e:'🍬', n:'Candy'}, cherry:{e:'🍒', n:'Cherry'}, blank:{e:'', n:'Blank'} };
const PAY3 = { gold:1000, cake:150, donut:60, choc:30, candy:15, cherry:10 };
const SWEETS = new Set(['cake','donut','choc','candy']);
const LINES = [[1,1,1],[0,0,0],[2,2,2],[0,1,2],[2,1,0]];          // row index on reels 1..3 (0 = top)
const LINE_NAMES = ['Middle','Top','Bottom','Diagonal ↘','Diagonal ↗'];
function linePay(a, b, c){                                          // multiple of the line bet (0 = no win)
  if (a === b && b === c && a !== 'blank') return PAY3[a];
  const ch = (a === 'cherry') + (b === 'cherry') + (c === 'cherry');
  if (ch === 2) return 4; if (ch === 1) return 1;
  if (SWEETS.has(a) && SWEETS.has(b) && SWEETS.has(c)) return 5;      // any three mixed sweets
  return 0;
}
const L = STRIPS[0].length;
function windowAt(stops){ return stops.map((s, r) => [0, 1, 2].map(row => STRIPS[r][(s + row - 1 + L) % L])); }   // [reel][row]
function evaluate(stops){
  const w = windowAt(stops), wins = [];
  LINES.forEach((ln, i) => { const syms = ln.map((row, r) => w[r][row]), m = linePay(...syms); if (m) wins.push({line: i, mult: m, syms}); });
  return { window: w, wins, mult: wins.reduce((a, x) => a + x.mult, 0) };
}
function spin(rng){ return [rng(L), rng(L), rng(L)]; }
function exactRTP(){                                               // expected return per unit wagered (5 lines × 1)
  let tot = 0, hits = 0, maxM = 0;
  for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) for (let c = 0; c < L; c++){ const m = evaluate([a, b, c]).mult; tot += m; if (m) hits++; if (m > maxM) maxM = m; }
  const n = L * L * L; return { rtp: tot / (n * LINES.length), hitRate: hits / n, combos: n, maxMult: maxM };
}
const SLOTS = { STRIPS, SYM, PAY3, LINES, LINE_NAMES, linePay, windowAt, evaluate, spin, exactRTP, L, BETS: [1, 2, 5, 10, 25] };
if (typeof module !== 'undefined' && module.exports) module.exports = SLOTS; else root.SLOTS = SLOTS;
})(typeof self !== 'undefined' ? self : this);

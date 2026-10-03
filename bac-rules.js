/* Cookies Casino — Baccarat (punto banco) rules engine. 8 decks, standard drawing tableau, Banker pays 0.95:1 (5% commission),
   Tie 8:1 (Player/Banker push on a tie), Player Pair / Banker Pair 11:1 (first two cards of that hand are the same rank).
   Cards are ints 0..51 (rank = c % 13 + 1). */
(function(root){
'use strict';
const PAYS = { player: 1, banker: 0.95, tie: 8, ppair: 11, bpair: 11 };
const LIMITS = { player:[5,5000], banker:[5,5000], tie:[1,1000], ppair:[1,1000], bpair:[1,1000] };
const rank = c => c % 13 + 1;
const val = c => { const r = rank(c); return r >= 10 ? 0 : r; };
const total = cards => cards.reduce((t, c) => t + val(c), 0) % 10;
// does the Banker draw? bTot = banker two-card total, p3 = value of player's third card (null if the player stood)
function bankerDraws(bTot, p3){
  if (p3 === null) return bTot <= 5;
  if (bTot <= 2) return true;
  if (bTot === 3) return p3 !== 8;
  if (bTot === 4) return p3 >= 2 && p3 <= 7;
  if (bTot === 5) return p3 >= 4 && p3 <= 7;
  if (bTot === 6) return p3 === 6 || p3 === 7;
  return false;
}
function play(draw){
  const P = [draw()], B = [draw()]; P.push(draw()); B.push(draw());
  let p = total(P), b = total(B); const natural = p >= 8 || b >= 8;
  if (!natural){
    let p3 = null;
    if (p <= 5){ P.push(draw()); p3 = val(P[2]); p = total(P); }
    if (bankerDraws(b, p3)){ B.push(draw()); b = total(B); }
  }
  return { player: P, banker: B, pTot: p, bTot: b, natural, winner: p > b ? 'P' : b > p ? 'B' : 'T',
           pPair: rank(P[0]) === rank(P[1]), bPair: rank(B[0]) === rank(B[1]) };
}
function settle(bets, r){
  const out = {}; let wagered = 0, returned = 0;
  for (const k of Object.keys(PAYS)){ const a = bets[k] || 0; if (!a) continue; wagered += a; let ret = 0;
    if (k === 'player') ret = r.winner === 'P' ? a * 2 : r.winner === 'T' ? a : 0;
    else if (k === 'banker') ret = r.winner === 'B' ? a * (1 + PAYS.banker) : r.winner === 'T' ? a : 0;
    else if (k === 'tie') ret = r.winner === 'T' ? a * (1 + PAYS.tie) : 0;
    else if (k === 'ppair') ret = r.pPair ? a * (1 + PAYS.ppair) : 0;
    else if (k === 'bpair') ret = r.bPair ? a * (1 + PAYS.bpair) : 0;
    ret = Math.round(ret * 100) / 100; out[k] = ret; returned += ret; }
  return { per: out, wagered, returned: Math.round(returned * 100) / 100 };
}
class Shoe {
  constructor(rng, decks = 8){ this.rng = rng; this.decks = decks; this.shuffle(); }
  shuffle(){ const a = []; for (let d = 0; d < this.decks; d++) for (let c = 0; c < 52; c++) a.push(c);
    for (let i = a.length - 1; i > 0; i--){ const j = this.rng(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    this.cards = a; this.pos = 0; this.cut = a.length - 14;               // cut card 14 cards from the end
    const first = this.cards[this.pos++]; this.burnCard = first; this.burned = rank(first) >= 10 ? 10 : rank(first); this.pos += this.burned;   // standard burn
  }
  get remaining(){ return this.cards.length - this.pos; }
  needsShuffle(){ return this.pos >= this.cut; }
  draw(){ if (this.pos >= this.cards.length) this.shuffle(); return this.cards[this.pos++]; }
}
const BAC = { PAYS, LIMITS, rank, val, total, bankerDraws, play, settle, Shoe };
if (typeof module !== 'undefined' && module.exports) module.exports = BAC; else root.BAC = BAC;
})(typeof self !== 'undefined' ? self : this);

/* Cookies Casino — Three Card Poker. One 52-card deck per hand. Ranking: straight flush > three of a kind > straight > flush > pair > high card
   (A-2-3 is the lowest straight, A-K-Q the highest). Dealer qualifies with Queen-high or better.
   Ante/Play 1:1 · Ante bonus (paid when you play): straight 1, trips 4, straight flush 5 · Pair Plus: pair 1, flush 4, straight 6, trips 30, straight flush 40. */
(function(root){
'use strict';
const CATS = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a Kind', 'Straight Flush'];
const PAIRPLUS = {1:1, 2:4, 3:6, 4:30, 5:40};
const ANTEBONUS = {3:1, 4:4, 5:5};
const LIMITS = { ante:[5,1000], pairplus:[1,1000] };
const hr = c => { const r = c % 13 + 1; return r === 1 ? 14 : r; }, suit = c => Math.floor(c / 13);
// numeric score: higher is better; cat = floor(score / 3375)
function score(cards){
  const r = cards.map(hr).sort((a, b) => b - a);
  const flush = suit(cards[0]) === suit(cards[1]) && suit(cards[1]) === suit(cards[2]);
  let straight = false, hi = r[0];
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1) straight = true;
  else if (r[0] === 14 && r[1] === 3 && r[2] === 2){ straight = true; hi = 3; }
  let cat, k;
  if (straight && flush){ cat = 5; k = [hi, 0, 0]; }
  else if (r[0] === r[2]){ cat = 4; k = [r[0], 0, 0]; }
  else if (straight){ cat = 3; k = [hi, 0, 0]; }
  else if (flush){ cat = 2; k = r; }
  else if (r[0] === r[1] || r[1] === r[2]){ cat = 1; const p = r[1], kick = r[0] === r[1] ? r[2] : r[0]; k = [p, kick, 0]; }
  else { cat = 0; k = r; }
  return cat * 3375 + k[0] * 225 + k[1] * 15 + k[2];
}
const category = s => Math.floor(s / 3375);
const qualifies = s => s >= 12 * 225;                     // Queen-high or better (any pair+ is >= 3375)
// strategy hint: play Q-6-4 or better
const shouldPlay = cards => score(cards) >= 12 * 225 + 6 * 15 + 4;
// bets: {ante, pairplus}; played: boolean (play bet = ante)
function settle(bets, player, dealer, played){
  const ante = bets.ante || 0, pp = bets.pairplus || 0, ps = score(player), ds = score(dealer), pc = category(ps);
  const r = { ante: 0, play: 0, pairplus: 0, bonus: 0 };
  if (pp) r.pairplus = PAIRPLUS[pc] ? pp * (1 + PAIRPLUS[pc]) : 0;
  let outcome = 'none';
  if (ante){
    if (!played) outcome = 'fold';
    else {
      r.bonus = ANTEBONUS[pc] ? ante * ANTEBONUS[pc] : 0;              // bonus paid on top, regardless of the dealer
      if (!qualifies(ds)){ r.ante = ante * 2; r.play = ante; outcome = 'noqualify'; }
      else if (ps > ds){ r.ante = ante * 2; r.play = ante * 2; outcome = 'win'; }
      else if (ps === ds){ r.ante = ante; r.play = ante; outcome = 'push'; }
      else outcome = 'lose';
    }
  }
  const wagered = ante + (played && ante ? ante : 0) + pp, returned = r.ante + r.play + r.pairplus + r.bonus;
  return { per: r, wagered, returned, outcome, pCat: pc, dCat: category(ds), dealerQualifies: qualifies(ds) };
}
class Hand { constructor(rng){ const d = []; for (let c = 0; c < 52; c++) d.push(c); for (let i = 51; i > 0; i--){ const j = rng(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  this.player = d.slice(0, 3); this.dealer = d.slice(3, 6); } }
const TCP = { CATS, PAIRPLUS, ANTEBONUS, LIMITS, score, category, qualifies, shouldPlay, settle, Hand };
if (typeof module !== 'undefined' && module.exports) module.exports = TCP; else root.TCP = TCP;
})(typeof self !== 'undefined' ? self : this);

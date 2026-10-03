/* Cookies Casino — Video Poker: 9/6 Jacks or Better (full pay). One 52-card deck per hand, hold & draw from the same deck.
   Pays per coin; a 5-coin Royal Flush pays 4,000 coins (800 per coin). Cards are ints 0..51 (rank = c % 13 + 1, suit = floor(c / 13)). */
(function(root){
'use strict';
const ORDER = ['royal','sf','quads','fh','flush','straight','trips','twopair','jacks'];
const NAMES = {royal:'Royal Flush', sf:'Straight Flush', quads:'Four of a Kind', fh:'Full House', flush:'Flush', straight:'Straight', trips:'Three of a Kind', twopair:'Two Pair', jacks:'Jacks or Better'};
const PAY = {royal:250, sf:50, quads:25, fh:9, flush:6, straight:4, trips:3, twopair:2, jacks:1};
const rank = c => c % 13 + 1, suit = c => Math.floor(c / 13);
function evaluate(cards){
  const rs = cards.map(rank), cnt = {}; rs.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
  const groups = Object.entries(cnt).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]).join('');
  const flush = cards.every(c => suit(c) === suit(cards[0]));
  const u = [...new Set(rs)].sort((a, b) => a - b);
  const broadway = u.length === 5 && u.join() === '1,10,11,12,13';
  const straight = u.length === 5 && (u[4] - u[0] === 4 || broadway);
  if (straight && flush) return broadway ? 'royal' : 'sf';
  if (shape === '41') return 'quads';
  if (shape === '32') return 'fh';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (shape === '311') return 'trips';
  if (shape === '221') return 'twopair';
  if (shape === '2111'){ const p = groups[0][0]; return (p === 1 || p >= 11) ? 'jacks' : null; }
  return null;
}
const payout = (cat, coins) => !cat ? 0 : (cat === 'royal' && coins === 5) ? 4000 : PAY[cat] * coins;   // coins returned (includes the bet)
class Hand {
  constructor(rng){ const d = []; for (let c = 0; c < 52; c++) d.push(c);
    for (let i = 51; i > 0; i--){ const j = rng(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    this.deck = d; this.cards = d.slice(0, 5); this.next = 5; this.held = [false, false, false, false, false]; this.drawn = false; }
  toggle(i){ if (!this.drawn) this.held[i] = !this.held[i]; }
  draw(){ if (this.drawn) return this.cards; this.cards = this.cards.map((c, i) => this.held[i] ? c : this.deck[this.next++]); this.drawn = true; return this.cards; }
}
const VP = { ORDER, NAMES, PAY, rank, suit, evaluate, payout, Hand, RTP: 0.995439 };
if (typeof module !== 'undefined' && module.exports) module.exports = VP; else root.VP = VP;
})(typeof self !== 'undefined' ? self : this);

/* Cookies Casino — Blackjack rules engine (pure; runs in the browser and in node for tests).
   6-deck shoe, cut card at 75%, dealer stands on soft 17, blackjack pays 3:2, dealer peeks for blackjack (A or 10 up),
   insurance 2:1, late surrender, double on any two cards incl. after split, split to 4 hands, split aces get one card, no resplit aces.
   Cards are ints 0..51: rank = c % 13 + 1 (1 = Ace, 11–13 = J Q K). */
(function(root){
'use strict';
const RULES = { decks: 6, penetration: 0.75, s17: true, bjPays: 1.5, maxHands: 4, das: true, resplitAces: false, lateSurrender: true, minBet: 5, maxBet: 5000 };
const rank = c => c % 13 + 1;
const cardVal = c => Math.min(10, rank(c));                 // A = 1 here; value() promotes one ace to 11 when it helps
function value(cards){
  let t = 0, aces = 0; for (const c of cards){ const v = cardVal(c); t += v; if (v === 1) aces++; }
  const soft = aces > 0 && t + 10 <= 21; return { total: soft ? t + 10 : t, soft };
}
const isPair = cards => cards.length === 2 && cardVal(cards[0]) === cardVal(cards[1]);   // any two 10-value cards may be split

class Shoe {
  constructor(rng, decks = RULES.decks, penetration = RULES.penetration){ this.rng = rng; this.decks = decks; this.pen = penetration; this.shuffle(); }
  shuffle(){ const a = []; for (let d = 0; d < this.decks; d++) for (let c = 0; c < 52; c++) a.push(c);
    for (let i = a.length - 1; i > 0; i--){ const j = this.rng(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    this.cards = a; this.pos = 0; this.cut = Math.floor(a.length * this.pen); this.shuffles = (this.shuffles || 0) + 1; }
  get remaining(){ return this.cards.length - this.pos; }
  needsShuffle(){ return this.pos >= this.cut; }           // checked between rounds only
  draw(){ if (this.pos >= this.cards.length) this.shuffle(); return this.cards[this.pos++]; }
}

class Round {
  constructor(shoe, bet, rules = RULES){
    this.shoe = shoe; this.rules = rules; this.baseBet = bet; this.insurance = 0; this.log = [];
    this.hands = [{ cards: [], bet, doubled: false, done: false, fromSplit: false, splitAces: false, surrendered: false }];
    this.dealer = { cards: [] }; this.active = 0; this.phase = 'deal'; this.peeked = false;
  }
  get hand(){ return this.hands[this.active]; }
  get upcard(){ return this.dealer.cards[0]; }
  start(){
    const h = this.hands[0], d = this.dealer.cards;
    h.cards.push(this.shoe.draw()); d.push(this.shoe.draw()); h.cards.push(this.shoe.draw()); d.push(this.shoe.draw());
    if (cardVal(this.upcard) === 1){ this.phase = 'insurance'; return this; }
    return this._peek();
  }
  dealerHasBJ(){ return this.dealer.cards.length === 2 && value(this.dealer.cards).total === 21; }
  isNatural(h){ return !h.fromSplit && h.cards.length === 2 && value(h.cards).total === 21; }
  // insurance costs half the main bet; caller deducts it from the bankroll
  decideInsurance(take){ if (this.phase !== 'insurance') throw new Error('no insurance now'); this.insurance = take ? this.baseBet / 2 : 0; return this._peek(); }
  _peek(){
    const up = cardVal(this.upcard);
    if ((up === 1 || up === 10) && this.dealerHasBJ()){ this.peeked = true; return this._settle(); }
    this.peeked = up === 1 || up === 10;
    if (this.isNatural(this.hands[0])){ this.hands[0].done = true; return this._settle(); }
    this.phase = 'player'; return this;
  }
  canHit(){ const h = this.hand; return this.phase === 'player' && !h.done && !h.splitAces; }
  canStand(){ return this.phase === 'player' && !this.hand.done; }
  canDouble(){ const h = this.hand; return this.phase === 'player' && !h.done && h.cards.length === 2 && !h.splitAces && (!h.fromSplit || this.rules.das); }
  canSplit(){ const h = this.hand; if (this.phase !== 'player' || h.done || !isPair(h.cards) || this.hands.length >= this.rules.maxHands) return false;
    if (h.splitAces && !this.rules.resplitAces) return false; return true; }
  canSurrender(){ return this.rules.lateSurrender && this.phase === 'player' && this.hands.length === 1 && this.hand.cards.length === 2 && !this.hand.done; }
  hit(){ if (!this.canHit()) throw new Error('cannot hit'); const h = this.hand; h.cards.push(this.shoe.draw());
    const t = value(h.cards).total; if (t >= 21){ h.done = true; h.bust = t > 21; } return this._next(); }
  stand(){ if (!this.canStand()) throw new Error('cannot stand'); this.hand.done = true; return this._next(); }
  double(){ if (!this.canDouble()) throw new Error('cannot double'); const h = this.hand; h.bet *= 2; h.doubled = true; h.cards.push(this.shoe.draw());
    h.done = true; h.bust = value(h.cards).total > 21; return this._next(); }
  surrender(){ if (!this.canSurrender()) throw new Error('cannot surrender'); this.hand.surrendered = true; this.hand.done = true; return this._next(); }
  split(){
    if (!this.canSplit()) throw new Error('cannot split');
    const h = this.hand, aces = cardVal(h.cards[0]) === 1;
    const n = { cards: [h.cards.pop()], bet: h.bet, doubled: false, done: false, fromSplit: true, splitAces: aces, surrendered: false };
    h.fromSplit = true; h.splitAces = aces; this.hands.splice(this.active + 1, 0, n);
    h.cards.push(this.shoe.draw());
    if (aces){ n.cards.push(this.shoe.draw()); h.done = true; n.done = true; return this._next(); }   // one card each, no further action
    if (value(h.cards).total === 21) h.done = true;
    return this._next();
  }
  _next(){
    while (this.active < this.hands.length && this.hands[this.active].done){
      this.active++;
      const h = this.hands[this.active];
      if (h && h.cards.length === 1){ h.cards.push(this.shoe.draw()); if (value(h.cards).total === 21) h.done = true; }   // second card for a split hand
    }
    if (this.active >= this.hands.length){ this.active = this.hands.length - 1; return this._dealerPlay(); }
    return this;
  }
  _dealerPlay(){
    const live = this.hands.some(h => !h.bust && !h.surrendered);
    if (live) for (;;){                                      // S17: draw to 16, stand on all 17s (H17 would also hit soft 17)
      const v = value(this.dealer.cards);
      if (v.total < 17 || (!this.rules.s17 && v.total === 17 && v.soft)) this.dealer.cards.push(this.shoe.draw()); else break; }
    return this._settle();
  }
  _settle(){
    this.phase = 'done';
    const dv = value(this.dealer.cards).total, dbj = this.dealerHasBJ(), dbust = dv > 21;
    let wagered = this.insurance, returned = this.insurance && dbj ? this.insurance * 3 : 0;
    for (const h of this.hands){
      wagered += h.bet; const pv = value(h.cards).total; let ret = 0, res;
      if (h.surrendered){ ret = h.bet / 2; res = 'surrender'; }
      else if (this.isNatural(h) && this.hands.length === 1){ if (dbj){ ret = h.bet; res = 'push'; } else { ret = h.bet * (1 + this.rules.bjPays); res = 'blackjack'; } }
      else if (dbj){ ret = 0; res = 'lose'; }
      else if (pv > 21){ ret = 0; res = 'bust'; }
      else if (dbust || pv > dv){ ret = h.bet * 2; res = 'win'; }
      else if (pv === dv){ ret = h.bet; res = 'push'; }
      else { ret = 0; res = 'lose'; }
      h.result = res; h.returned = ret; returned += ret;
    }
    this.wagered = wagered; this.returned = returned; this.dealerBJ = dbj;
    return this;
  }
}

/* ---------- basic strategy for THESE rules: 6 decks, S17, DAS, late surrender, peek, split to 4, no resplit aces ----------
   Columns = dealer upcard 2,3,4,5,6,7,8,9,10,A.  Codes: H hit · S stand · D double else hit · Ds double else stand ·
   P split · Rh surrender else hit.  Pairs not split fall through to the hard/soft tables. */
const UP = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const row = s => s.split(' ');
const STRAT = {
  hard: { 4:row('H H H H H H H H H H'), 5:row('H H H H H H H H H H'), 6:row('H H H H H H H H H H'), 7:row('H H H H H H H H H H'), 8:row('H H H H H H H H H H'),
          9:row('H D D D D H H H H H'), 10:row('D D D D D D D D H H'), 11:row('D D D D D D D D D H'), 12:row('H H S S S H H H H H'),
          13:row('S S S S S H H H H H'), 14:row('S S S S S H H H H H'), 15:row('S S S S S H H H Rh H'), 16:row('S S S S S H H Rh Rh Rh'),
          17:row('S S S S S S S S S S'), 18:row('S S S S S S S S S S'), 19:row('S S S S S S S S S S'), 20:row('S S S S S S S S S S'), 21:row('S S S S S S S S S S') },
  soft: { 12:row('H H H H H H H H H H'), 13:row('H H H D D H H H H H'), 14:row('H H H D D H H H H H'), 15:row('H H D D D H H H H H'), 16:row('H H D D D H H H H H'),
          17:row('H D D D D H H H H H'), 18:row('S Ds Ds Ds Ds S S H H H'), 19:row('S S S S S S S S S S'), 20:row('S S S S S S S S S S'), 21:row('S S S S S S S S S S') },
  pair: { 2:row('P P P P P P H H H H'), 3:row('P P P P P P H H H H'), 4:row('H H H P P H H H H H'), 5:row('D D D D D D D D H H'),
          6:row('P P P P P H H H H H'), 7:row('P P P P P P H H H H'), 8:row('P P P P P P P P P P'), 9:row('P P P P P S P P S S'),
          10:row('S S S S S S S S S S'), 11:row('P P P P P P P P P P') }
};
const upIdx = c => { const v = cardVal(c); return UP.indexOf(v === 1 ? 11 : v); };
// best move for a hand vs the dealer upcard. allowed: {double, split, surrender} (what the player can actually do right now).
// returns { action: 'hit'|'stand'|'double'|'split'|'surrender', code, ideal } — ideal = the chart move before "not allowed" fallbacks.
function strategy(cards, upcard, allowed = {}){
  const i = upIdx(upcard), v = value(cards);
  let code = null;
  if (isPair(cards)){ const pv = cardVal(cards[0]) === 1 ? 11 : cardVal(cards[0]); const p = STRAT.pair[pv][i]; if (p === 'P') code = allowed.split ? 'P' : null; }
  const base = v.soft ? STRAT.soft[v.total][i] : STRAT.hard[Math.max(4, v.total)][i];
  const ideal = isPair(cards) && STRAT.pair[cardVal(cards[0]) === 1 ? 11 : cardVal(cards[0])][i] === 'P' ? 'P' : base;
  if (!code) code = base;
  const action = code === 'P' ? 'split' : code === 'S' ? 'stand' : code === 'H' ? 'hit'
    : code === 'D' ? (allowed.double ? 'double' : 'hit') : code === 'Ds' ? (allowed.double ? 'double' : 'stand')
    : code === 'Rh' ? (allowed.surrender ? 'surrender' : 'hit') : 'stand';
  return { action, code, ideal };
}
const BJ = { RULES, value, cardVal, rank, isPair, Shoe, Round, strategy, STRAT, UP };
if (typeof module !== 'undefined' && module.exports) module.exports = BJ; else root.BJ = BJ;
})(typeof self !== 'undefined' ? self : this);

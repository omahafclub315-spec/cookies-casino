/* Cookies Casino — shared core for the lobby and game pages.
   Uses the SAME localStorage keys as roulette (index.html): one bankroll ('cc.bankroll') and one set of lifetime
   leaderboard stats ('cc.lb.*') across every game. Only load one game page at a time (pages read storage on load). */
(function(){
'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg', TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const fmtShort = n => n < 1000 ? '$' + n : '$' + (n/1000).toFixed(1).replace(/\.0$/, '') + 'K';
const fmtPnl = n => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const pnlCls = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
function el(tag, attrs, parent){ const e = document.createElementNS(SVGNS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function seeded(seed){ let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

const LS = { get(k, d){ try { const v = localStorage.getItem('cc.' + k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
             set(k, v){ try { localStorage.setItem('cc.' + k, JSON.stringify(v)); } catch(e){} } };

/* ---------- season (identical to roulette: only ever runs on a browser's very first visit) ---------- */
const START_BANK = 300, LB_SEASON = 2;
if ((+LS.get('lb.season', 0) || 0) < LB_SEASON){
  ['id','secret','nick','peak','spins','sentPeak','sentSpins','rank','rankPeak','asked','net','wagered'].forEach(k => { try { localStorage.removeItem('cc.lb.' + k); } catch(e){} });
  LS.set('bankroll', START_BANK); LS.set('lb.season', LB_SEASON);
}

/* ---------- unbiased crypto RNG ---------- */
const RNG = {
  buf: new Uint32Array(256), i: 256,
  u32(){ if (this.i >= this.buf.length){ crypto.getRandomValues(this.buf); this.i = 0; } return this.buf[this.i++]; },
  int(n){                                   // uniform integer in [0, n) — rejection sampling, no modulo bias
    if (!(n >= 1) || n > 4294967296) throw new Error('bad range');
    const lim = 4294967296 - (4294967296 % n);
    let v; do { v = this.u32(); } while (v >= lim);
    return v % n;
  },
  shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  die(){ return this.int(6) + 1; }
};

/* ---------- bankroll ---------- */
const Bank = {
  value: (() => { const b = +LS.get('bankroll', START_BANK); return (!isFinite(b) || b < 1) ? START_BANK : b; })(),
  uncommitted: () => 0,                     // game sets this: chips sitting in bet spots that are not in play yet
  save(){ LS.set('bankroll', Math.round((this.value + (this.uncommitted() || 0)) * 100) / 100); },
  set(v){ this.value = Math.round(v * 100) / 100; this.save(); UI.meters(); },
  add(d){ this.set(this.value + d); },
  take(d){ if (d > this.value + 1e-9) return false; this.set(this.value - d); return true; },
  refill(){ this.set(START_BANK); Snd.chips(5); UI.flash("Out of chips — here's a fresh $300 on the house 🍪", 'win'); Voice.line('refill'); }
};

/* ---------- lifetime stats + leaderboard (Supabase RPC via plain fetch; same protocol as roulette) ---------- */
const LB = {
  url: 'https://goohcqtscqojwofeopxo.supabase.co/rest/v1',
  key: 'sb_publishable_3wJJwbmnlKE1X4EPSvKuNg_UHYlYssc',          // public publishable key — table is RLS-locked, writes only via submit_stats()
  id: LS.get('lb.id', null), secret: LS.get('lb.secret', null), nick: LS.get('lb.nick', null),
  net: +LS.get('lb.net', 0) || 0, wagered: +LS.get('lb.wagered', 0) || 0, spins: +LS.get('lb.spins', 0) || 0,
  peak: +LS.get('lb.peak', START_BANK) || START_BANK, sentSpins: +LS.get('lb.sentSpins', -1), sentPeak: +LS.get('lb.sentPeak', 0) || 0,
  rank: LS.get('lb.rank', null), rankPeak: LS.get('lb.rankPeak', null), sort: LS.get('lb.sort', 'pnl') === 'peak' ? 'peak' : 'pnl',
  timer: null, busy: false, retry: 0,
  save(){ ['id','secret','nick','net','wagered','spins','peak','sentSpins','sentPeak','rank','rankPeak'].forEach(k => LS.set('lb.' + k, this[k])); },
  ensureId(){
    if (this.id && this.secret) return;
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    this.id = crypto.randomUUID ? crypto.randomUUID() : `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${(8 + (b[8] & 3)).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
    crypto.getRandomValues(b); this.secret = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    this.save();
  },
  async rpc(name, body){
    const ctl = 'AbortController' in window ? new AbortController() : null, to = ctl && setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(`${this.url}/rpc/${name}`, {method:'POST', headers:{apikey:this.key, 'Content-Type':'application/json'}, body:JSON.stringify(body), signal: ctl ? ctl.signal : undefined});
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { if (to) clearTimeout(to); }
  },
  cleanNick(s){ return String(s || '').replace(/[^A-Za-z0-9 _.!?'~*-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16); },
  notePeak(){ const b = Math.floor(Bank.value); if (b > this.peak){ this.peak = b; this.save(); } UI.meters(); },
  // one finished round/hand/roll: total staked on bets that resolved, and total paid back (stake + winnings). Call AFTER crediting the bankroll.
  record(wagered, returned){
    wagered = Math.max(0, Math.round(wagered)); returned = Math.max(0, Math.round(returned));
    this.spins++; this.wagered += wagered; this.net += returned - wagered; this.save(); this.notePeak(); this.schedule();
  },
  schedule(delay = 1500){ if (!this.nick || (this.spins <= this.sentSpins && this.peak <= this.sentPeak)) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.submit(), delay); },
  async submit(nick){
    if (this.busy){ this.schedule(2500); return {ok:false, error:'busy'}; }
    this.ensureId(); const useNick = nick || this.nick; if (!useNick) return {ok:false, error:'no_nick'};
    this.busy = true;
    try {
      const res = await this.rpc('submit_stats', {p_player_id:this.id, p_secret:this.secret, p_nickname:useNick,
        p_net:Math.round(this.net), p_wagered:Math.round(this.wagered), p_spins:this.spins, p_peak:Math.floor(this.peak)});
      if (res && res.ok){ this.nick = res.nickname; this.sentSpins = +res.spins; this.sentPeak = Math.max(this.sentPeak, +res.peak || 0);
        this.rank = res.rank; this.rankPeak = res.rank_peak; this.retry = 0; this.save(); UI.meters(); }
      else if (res && res.error === 'stale' && +res.spins > this.spins){
        this.spins = this.sentSpins = +res.spins; this.wagered = +res.wagered; this.net = +res.net; this.peak = Math.max(this.peak, +res.peak || 0); this.save(); UI.meters(); }
      else if (res && res.error === 'rate_limited' && this.retry++ < 3){ this.busy = false; await wait(3300); return this.submit(nick); }
      return res || {ok:false, error:'no_response'};
    } catch(e){ return {ok:false, error:'offline'}; }
    finally { this.busy = false; }
  },
  async board(){ return this.rpc('get_leaderboard', {p_player_id: this.id || null, p_sort: this.sort}); }
};
window.addEventListener('online', () => LB.schedule(500));

/* ---------- sound (Web Audio synth, no files) ---------- */
let muted = !!LS.get('muted', false), voiceOn = !!LS.get('voiceOn', true);
const Snd = {
  ctx:null, master:null, noise:null,
  ensure(){
    if (!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = muted ? 0 : 0.85;
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  },
  setMuted(m){ if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.03); },
  burst(t, {vol=.3, f=3000, q=4, dur=.03, type='bandpass'} = {}){
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5, dur + 0.02);
  },
  ping(t, {vol=.1, f=2000, dur=.06, type='sine'} = {}){
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  chip(vol=1){ if (!this.ctx) return; const t = this.ctx.currentTime, p = .9 + Math.random()*.2;
    this.burst(t, {vol:.30*vol, f:2900*p, q:1.6, dur:.025}); this.ping(t, {vol:.07*vol, f:1850*p, dur:.045, type:'triangle'});
    this.burst(t+.032, {vol:.17*vol, f:3300*p, q:1.6, dur:.02}); this.ping(t+.032, {vol:.04*vol, f:2150*p, dur:.035, type:'triangle'}); },
  chips(n){ for (let i = 0; i < n; i++) setTimeout(() => this.chip(.6 + Math.random()*.3), i * (55 + Math.random()*30)); },
  card(){ if (!this.ctx) return; const t = this.ctx.currentTime;                     // card slide + snap
    this.burst(t, {vol:.16, f:1800, q:.8, dur:.09}); this.burst(t+.07, {vol:.22, f:4200, q:2.5, dur:.02}); },
  flip(){ if (!this.ctx) return; const t = this.ctx.currentTime; this.burst(t, {vol:.2, f:3000, q:1.4, dur:.035}); },
  shuffle(){ if (!this.ctx) return; for (let i = 0; i < 14; i++) setTimeout(() => this.burst(this.ctx.currentTime, {vol:.12, f:2500 + Math.random()*1500, q:1.5, dur:.025}), i*35); },
  dice(){ if (!this.ctx) return; for (let i = 0; i < 7; i++) setTimeout(() => { const t = this.ctx.currentTime, f = 1500 + Math.random()*1500;
    this.burst(t, {vol:.25 - i*.025, f, q:3, dur:.03}); this.ping(t, {vol:.05, f:f*.7, dur:.04, type:'triangle'}); }, i * (70 + Math.random()*50)); },
  reel(){ if (!this.ctx) return; const t = this.ctx.currentTime; this.burst(t, {vol:.1, f:1200, q:3, dur:.02}); },
  stop(){ if (!this.ctx) return; const t = this.ctx.currentTime; this.burst(t, {vol:.3, f:600, q:1.2, dur:.06}); this.ping(t, {vol:.08, f:180, dur:.12}); },
  win(big){ if (!this.ctx) return; const t = this.ctx.currentTime, notes = big ? [523,659,784,1047,1319,1568] : [659,784,1047];
    notes.forEach((f, i) => { this.ping(t + i*.09, {vol:.09, f, dur:.22, type:'triangle'}); this.ping(t + i*.09, {vol:.03, f:f*2, dur:.15}); }); },
  lose(){ if (!this.ctx) return; const t = this.ctx.currentTime; this.ping(t, {vol:.07, f:330, dur:.18, type:'triangle'}); this.ping(t+.16, {vol:.06, f:247, dur:.3, type:'triangle'}); },
  click(){ if (!this.ctx) return; this.ping(this.ctx.currentTime, {vol:.05, f:1400, dur:.03, type:'square'}); }
};

/* ---------- dealer voice (Web Speech; same preferences as roulette) ---------- */
const BASE_LINES = { hello:[['Welcome to Cookies Casino!']], refill:[['More cookies, on the house!']], on:[["Hi! I'm your dealer."]],
  win:[['You win!'], ['Winner!'], ['Yatta!', 'You win!']], bigwin:[['Sugoi!', 'Big win!'], ['Wow! Big win!']], lose:[['The house wins.'], ['So close!'], ['Aww.', 'Next time.']], push:[['Push.']] };
const Voice = {
  ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window, v:null, kind:'en', opts:[], primed:false, lastAt:0, lines: BASE_LINES,
  options(){
    if (!this.ok) return [];
    const vs = speechSynthesis.getVoices() || [];
    const isEn = v => /^en([-_]|$)/i.test(v.lang), isJa = v => /^ja([-_]|$)/i.test(v.lang);
    const FEM = ['samantha','ava','allison','susan','karen','moira','tessa','serena','kate','victoria','fiona','zoe','nicky','martha','aria','jenny','libby','sonia','zira','female','google us english','google uk english female'];
    const MALE = /\b(daniel|alex|fred|tom|oliver|arthur|aaron|gordon|rishi|reed|ralph|albert|bruce|junior|lee|guy|david|mark|george|ryan|eddy|grandpa|rocko|male)\b/i;
    const score = v => { const n = v.name.toLowerCase(); const i = FEM.findIndex(f => n.includes(f)); if (i < 0) return -1;
      return 1000 - i*10 + (/enhanced|premium|natural|neural/i.test(v.name) ? 5 : 0) + (/^en[-_](us|gb)/i.test(v.lang) ? 2 : 0); };
    const short = v => v.name.replace(/\s*\(.*$/, '').replace(/^(Microsoft|Google|Apple)\s+/, '').replace(/\s+(Online|Desktop)$/i, '').split(/\s+-\s+/)[0];
    const seen = new Set(), out = [], add = (v, label, kind) => { const k = v.name + '|' + v.lang; if (seen.has(k)) return; seen.add(k); out.push({v, label, kind}); };
    vs.filter(v => isEn(v) && score(v) >= 0).sort((a, b) => score(b) - score(a)).forEach(v => add(v, short(v), 'en'));
    if (!out.length){ const en = vs.filter(isEn); en.filter(v => !MALE.test(v.name)).concat(en).forEach(v => add(v, short(v), 'en')); }
    const ja = vs.filter(isJa), jv = ja.find(v => /kyoko/i.test(v.name)) || ja.find(v => /o-?ren/i.test(v.name));
    if (jv) add(jv, 'Anime (' + short(jv) + ')', 'ja');
    if (!out.length && vs.length) add(vs.find(v => v.default) || vs[0], short(vs[0]), 'en');
    return out;
  },
  pick(){ if (!this.ok) return; const opts = this.options(); if (!opts.length) return; this.opts = opts;
    const saved = LS.get('voiceName', null), o = (saved && opts.find(o => o.v.name === saved)) || opts[0]; this.v = o.v; this.kind = o.kind; },
  say(parts){
    if (!this.ok || !voiceOn || muted) return;
    if (!this.v) this.pick();
    const list = Array.isArray(parts) ? parts : [parts], now = performance.now();
    try {
      if (speechSynthesis.pending && now - this.lastAt > 3500) speechSynthesis.cancel();
      if (speechSynthesis.paused) speechSynthesis.resume();
      for (const t of list) if (t){ const u = new SpeechSynthesisUtterance(t); if (this.v){ u.voice = this.v; u.lang = this.v.lang; }
        u.pitch = this.kind === 'ja' ? 1.4 : 1.25; u.rate = .95; u.volume = 1; speechSynthesis.speak(u); }
      this.lastAt = now;
    } catch(e){}
  },
  line(key){ const L = this.lines[key] || BASE_LINES[key]; if (L) this.say(L[RNG.int(L.length)]); },
  prime(){ if (!this.ok || this.primed) return; this.primed = true; if (!this.v) this.pick();
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch(e){} }
};
if (Voice.ok){ Voice.pick(); try { speechSynthesis.addEventListener('voiceschanged', () => Voice.pick()); } catch(e){} }
const unlock = () => { Snd.ensure(); Voice.prime(); };
document.addEventListener('pointerdown', unlock, {capture:true}); document.addEventListener('keydown', unlock, {capture:true});

/* ---------- cookie chips (same artwork as roulette) ---------- */
const DENOMS = [1,5,25,100,500,1000];
const COOKIE = {
  1:    {dough:['#fff2d4','#f3d49a','#d2a35c'], ring:'#3d7be0', text:'#17408f', bits:'sprinkles'},
  5:    {dough:['#f5c983','#dc9c4f','#a4672a'], ring:'#e0213f', text:'#a20d26', bits:'choc'},
  25:   {dough:['#93603d','#653a21','#3a1c0d'], ring:'#2fbf71', text:'#0f6136', bits:'white'},
  100:  {dough:['#d9465a','#a8182d','#6a0918'], ring:'#1d1d1d', text:'#1d1d1d', bits:'white'},
  500:  {dough:['#f7deaa','#e0b76f','#b4823b'], ring:'#8a3fc7', text:'#55247f', bits:'nuts'},
  1000: {dough:['#fff1ad','#efbd45','#b07e0c'], ring:'#7a1f1f', text:'#7a1f1f', bits:'gold'}
};
function cookiePath(rnd){
  const N = 44, pts = [], p1 = rnd()*TAU, p2 = rnd()*TAU;
  for (let i = 0; i < N; i++){ const a = i/N*TAU, r = 18.75 + .55*Math.sin(7*a + p1) + .35*Math.sin(12*a + p2) + (rnd() - .5)*.55; pts.push([Math.cos(a)*r, Math.sin(a)*r]); }
  const f = n => n.toFixed(2); let d = '';
  for (let i = 0; i < N; i++){ const p = pts[i], q = pts[(i+1) % N]; if (i === 0){ const m = pts[N-1]; d += `M${f((m[0]+p[0])/2)},${f((m[1]+p[1])/2)}`; }
    d += `Q${f(p[0])},${f(p[1])} ${f((p[0]+q[0])/2)},${f((p[1]+q[1])/2)}`; }
  return d + 'Z';
}
function blobPath(rnd, cx, cy, r){ const n = 6 + Math.floor(rnd()*2), pts = [], rot = rnd()*TAU;
  for (let i = 0; i < n; i++){ const a = rot + i/n*TAU, rr = r*(.7 + rnd()*.5); pts.push([cx + Math.cos(a)*rr, cy + Math.sin(a)*rr]); }
  let d = ''; for (let i = 0; i < n; i++){ const p = pts[i], q = pts[(i+1) % n]; if (i === 0){ const m = pts[n-1]; d += `M${((m[0]+p[0])/2).toFixed(2)},${((m[1]+p[1])/2).toFixed(2)}`; }
    d += `Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${((p[0]+q[0])/2).toFixed(2)},${((p[1]+q[1])/2).toFixed(2)}`; } return d + 'Z'; }
function scatter(rnd, n, r0, r1, minD){ const out = []; let guard = 0;
  while (out.length < n && guard++ < 600){ const a = rnd()*TAU, r = Math.sqrt(r0*r0 + rnd()*(r1*r1 - r0*r0)), p = [Math.cos(a)*r, Math.sin(a)*r];
    if (out.every(q => Math.hypot(q[0]-p[0], q[1]-p[1]) >= minD)) out.push(p); } return out; }
function buildChipDefs(){
  const svg = el('svg', {width:0, height:0, 'aria-hidden':'true', style:'position:absolute;width:0;height:0;overflow:hidden'}); document.body.prepend(svg);
  const d = el('defs', {}, svg);
  const shine = el('radialGradient', {id:'cookieShine', cx:'34%', cy:'28%', r:'78%'}, d);
  el('stop', {offset:'0%', 'stop-color':'#fff', 'stop-opacity':'.34'}, shine); el('stop', {offset:'45%', 'stop-color':'#fff', 'stop-opacity':'0'}, shine); el('stop', {offset:'100%', 'stop-color':'#2a1205', 'stop-opacity':'.35'}, shine);
  const gold = el('linearGradient', {id:'goldDust', x1:0, y1:0, x2:1, y2:1}, d);
  [['0%','#fff6c0',0],['40%','#fff6c0',.55],['55%','#ffffff',0],['75%','#ffe27a',.45],['100%','#ffe27a',0]].forEach(([o,c,a]) => el('stop', {offset:o, 'stop-color':c, 'stop-opacity':a}, gold));
  for (const v of DENOMS){
    const c = COOKIE[v], rnd = seeded(v*7919 + 13), s = el('symbol', {id:'chip-'+v, viewBox:'-20 -20 40 40'}, d), path = cookiePath(rnd);
    const dg = el('radialGradient', {id:'dough'+v, cx:'42%', cy:'38%', r:'68%'}, d);
    el('stop', {offset:'0%', 'stop-color':c.dough[0]}, dg); el('stop', {offset:'62%', 'stop-color':c.dough[1]}, dg); el('stop', {offset:'100%', 'stop-color':c.dough[2]}, dg);
    el('path', {d:path, fill:`url(#dough${v})`, stroke:'rgba(60,25,6,.6)', 'stroke-width':.9}, s);
    el('path', {d:path, fill:'none', stroke:c.dough[2], 'stroke-width':2.6, 'stroke-opacity':.55, transform:'scale(.93)'}, s);
    for (let i = 0; i < 26; i++){ const [x, y] = scatter(rnd, 1, 3, 18, 0)[0];
      el('circle', {cx:x.toFixed(2), cy:y.toFixed(2), r:(.25 + rnd()*.55).toFixed(2), fill: rnd() < .55 ? 'rgba(80,35,8,.28)' : 'rgba(255,245,215,.32)'}, s); }
    el('circle', {r:14.3, fill:'none', stroke:'rgba(40,15,5,.35)', 'stroke-width':3.2}, s);
    el('circle', {r:14.3, fill:'none', stroke:c.ring, 'stroke-width':2.6}, s);
    el('circle', {r:14.3, fill:'none', stroke:'#fff', 'stroke-opacity':.55, 'stroke-width':.7, 'stroke-dasharray':'2.4 2.2', 'stroke-linecap':'round'}, s);
    if (c.bits === 'choc' || c.bits === 'white'){
      const col = c.bits === 'choc' ? ['#3b1e0c','#1f0e04'] : ['#f8efdc','#b88d5c'];
      for (const [x, y] of scatter(rnd, 9, 10.8, 17.4, 3.9)){ const r = 1.55 + rnd()*.7;
        el('path', {d:blobPath(rnd, x, y, r), fill:col[0], stroke:col[1], 'stroke-width':.45}, s);
        el('ellipse', {cx:(x - r*.3).toFixed(2), cy:(y - r*.35).toFixed(2), rx:(r*.38).toFixed(2), ry:(r*.22).toFixed(2), fill:'#fff', 'fill-opacity': c.bits === 'choc' ? .3 : .7}, s); }
    } else if (c.bits === 'sprinkles'){
      const cols = ['#ff5fa2','#4fc3f7','#ffd54f','#81c784','#ba68c8','#ff8a65'];
      for (const [x, y] of scatter(rnd, 16, 10.6, 17.6, 2.6))
        el('rect', {x:(x-1.4).toFixed(2), y:(y-.45).toFixed(2), width:2.8, height:.9, rx:.45, fill:cols[Math.floor(rnd()*cols.length)], transform:`rotate(${Math.floor(rnd()*180)} ${x.toFixed(2)} ${y.toFixed(2)})`}, s);
    } else if (c.bits === 'nuts'){
      scatter(rnd, 9, 10.8, 17.4, 3.9).forEach(([x, y], i) => { if (i % 3 === 2){ el('path', {d:blobPath(rnd, x, y, 1.6), fill:'#f8efdc', stroke:'#b88d5c', 'stroke-width':.4}, s); return; }
        el('ellipse', {cx:x.toFixed(2), cy:y.toFixed(2), rx:2.1, ry:1.75, fill:'#f3e1bd', stroke:'#b78d52', 'stroke-width':.55}, s);
        el('ellipse', {cx:(x-.6).toFixed(2), cy:(y-.6).toFixed(2), rx:.8, ry:.5, fill:'#fffaf0', 'fill-opacity':.8}, s); });
    } else if (c.bits === 'gold'){
      el('path', {d:path, fill:'url(#goldDust)'}, s);
      for (const [x, y] of scatter(rnd, 14, 10.4, 17.8, 2.4)){ const r = .7 + rnd()*.9;
        el('path', {d:`M${x},${y-r*1.6} L${x+r*.35},${y-r*.35} L${x+r*1.6},${y} L${x+r*.35},${y+r*.35} L${x},${y+r*1.6} L${x-r*.35},${y+r*.35} L${x-r*1.6},${y} L${x-r*.35},${y-r*.35} Z`, fill:'#fffbe0', 'fill-opacity':.95}, s); }
    }
    el('circle', {r:10, fill:'#fffaf0', stroke:c.ring, 'stroke-width':1.1}, s);
    el('circle', {r:8.6, fill:'none', stroke:c.ring, 'stroke-opacity':.4, 'stroke-width':.5, 'stroke-dasharray':'1 1.1'}, s);
    el('path', {d:path, fill:'url(#cookieShine)'}, s);
  }
}
const labelSize = (str, scale = 1) => { const n = str.length; return (n <= 2 ? 10.5 : n === 3 ? 9.4 : n === 4 ? 7.8 : n === 5 ? 6.6 : 5.6) * scale; };
const chipText = (v, str, y = 0.6, scale = 1) => `<text x="0" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="&quot;Arial Rounded MT Bold&quot;,&quot;Helvetica Neue&quot;,Arial,sans-serif" font-weight="800" font-size="${labelSize(str, scale).toFixed(1)}" letter-spacing="-.2" fill="${COOKIE[v].text}">${str}</text>`;
function chipSVG(v){ return `<svg viewBox="-20 -20 40 40"><use href="#chip-${v}" x="-20" y="-20" width="40" height="40"/>${chipText(v, fmtShort(v))}</svg>`; }
function breakdown(a){ const out = []; for (const v of [...DENOMS].reverse()) while (a >= v && out.length < 60){ out.push(v); a -= v; } return out; }
// a small stack of cookie chips showing a total (for bet spots)
function stackSVG(amount){
  if (!(amount > 0)) return '';
  const shown = breakdown(Math.floor(amount)).slice(0, 7); if (!shown.length) shown.push(1);
  const top = shown[shown.length - 1], h = (shown.length - 1) * 3;
  let s = `<svg viewBox="-20 ${-20 - h} 40 ${44 + h}"><ellipse cx="1.5" cy="17" rx="17" ry="6" fill="rgba(40,0,15,.4)"/>`;
  shown.forEach((v, i) => { s += `<use href="#chip-${v}" x="-18" y="${-18 - i*3}" width="36" height="36"/>`; });
  return s + chipText(top, fmtShort(Math.floor(amount)), (-h + .5).toFixed(1), .85) + '</svg>';
}

/* ---------- cards: int 0..51, rank = c%13 + 1 (1=A … 13=K), suit = floor(c/13) (♠ ♥ ♦ ♣) ---------- */
const SUITS = ['♠','♥','♦','♣'], RANKS = ['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const cRank = c => c % 13 + 1, cSuit = c => Math.floor(c / 13);
function cardHTML(c, {down = false, cls = '', delay = 0} = {}){
  const st = delay ? ` style="animation-delay:${delay}ms"` : '';
  if (down || c == null) return `<div class="card back ${cls}"${st}></div>`;
  const r = RANKS[cRank(c)], s = SUITS[cSuit(c)], red = cSuit(c) === 1 || cSuit(c) === 2, face = cRank(c) > 10;
  return `<div class="card ${red ? 'red' : ''} ${cls}"${st} data-c="${c}" aria-label="${r}${s}"><span class="ix">${r}<i>${s}</i></span><span class="pip${face ? ' face' : ''}">${face ? r + s : s}</span><span class="ix b">${r}<i>${s}</i></span></div>`;
}
const cardName = c => { const r = cRank(c); return (r === 1 ? 'Ace' : r === 11 ? 'Jack' : r === 12 ? 'Queen' : r === 13 ? 'King' : String(r)); };

/* ---------- page chrome: header, status, meters, chip rack, leaderboard modal ---------- */
const UI = {
  flashT: null,
  flash(msg, kind = 'info'){ const s = $('#ccStatus'); if (!s) return; s.textContent = msg; s.className = 'status' + (kind === 'warn' ? ' warn' : kind === 'win' ? ' win' : ''); },
  meters(){
    const b = $('#ccBank'); if (b) b.textContent = fmt(Bank.value);
    const p = $('#ccPnl'); if (p){ p.textContent = fmtPnl(LB.net); p.className = 'v ' + pnlCls(LB.net); }
    const r = $('#ccRank'); if (r) r.textContent = LB.nick ? (LB.rank ? '#' + LB.rank : '—') : 'Join';
  },
  header({game = '', sub = 'Salon Privé', lobby = true} = {}){
    const h = document.createElement('header'); h.className = 'cc-hd';
    h.innerHTML = `${lobby ? '<a class="icon-btn cc-lobby" href="lobby.html" title="All games">‹ Lobby</a>' : ''}
      <a class="cc-brand" href="lobby.html"><span class="cc-logo">CC</span><span class="cc-title"><h1>Cookies Casino</h1><span class="sub">${esc(game || sub)}</span></span></a>
      <div class="cc-tools"><button class="icon-btn" id="ccLbBtn" title="Leaderboard">🏆 <span id="ccRank">—</span></button>
        <button class="icon-btn" id="ccVoiceBtn" title="Dealer voice on/off"></button><button class="icon-btn" id="ccMuteBtn" title="Sound on/off"></button></div>`;
    document.body.prepend(h);
    const bar = document.createElement('div'); bar.className = 'cc-bar';
    bar.innerHTML = `<div class="status" id="ccStatus">Place your bets</div><div class="meter"><div class="l">Bankroll</div><div class="v" id="ccBank"></div></div>
      <div class="meter"><div class="l">Lifetime P&amp;L</div><div class="v" id="ccPnl"></div></div>`;
    h.after(bar);
    const vb = $('#ccVoiceBtn'), mb = $('#ccMuteBtn');
    const paint = () => { vb.textContent = 'Dealer: ' + (voiceOn ? 'On' : 'Off'); vb.classList.toggle('off', !voiceOn); mb.textContent = muted ? '🔇 Muted' : '🔊 Sound'; mb.classList.toggle('off', muted); };
    vb.onclick = () => { voiceOn = !voiceOn; LS.set('voiceOn', voiceOn); paint(); if (voiceOn) Voice.line('on'); else try { speechSynthesis.cancel(); } catch(e){} };
    mb.onclick = () => { Snd.ensure(); muted = !muted; LS.set('muted', muted); Snd.setMuted(muted); paint(); if (muted) try { speechSynthesis.cancel(); } catch(e){} };
    $('#ccLbBtn').onclick = () => LBUI.open();
    paint(); this.meters();
  },
  chipRack(container, {denoms = DENOMS, onPick} = {}){
    let value = LS.get('chip', 5); if (!denoms.includes(value)) value = denoms[Math.min(1, denoms.length - 1)];
    const wrap = document.createElement('div'); wrap.className = 'chips';
    denoms.forEach(v => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chipbtn'; b.dataset.v = v; b.title = fmt(v) + ' chip'; b.setAttribute('aria-label', fmt(v) + ' chip');
      b.innerHTML = chipSVG(v); b.onclick = () => { rack.value = v; LS.set('chip', v); paint(); Snd.chip(.7); onPick && onPick(v); }; wrap.appendChild(b); });
    container.prepend(wrap);
    const paint = () => $$('.chipbtn', wrap).forEach(b => b.classList.toggle('sel', +b.dataset.v === rack.value));
    const rack = { get value(){ return value; }, set value(v){ value = v; } }; paint();
    return rack;
  }
};

const LBUI = {
  built: false,
  build(){
    if (this.built) return; this.built = true;
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'lbModal'; m.hidden = true; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="sheet"><div class="sheet-hd"><h2>Leaderboard</h2><p>Lifetime profit &amp; loss · highest bankroll · all games</p><button class="x" id="lbClose" aria-label="Close">×</button></div>
      <div class="sheet-bd"><form id="lbForm" autocomplete="off"><div id="lbFormTitle"></div>
        <input id="lbNick" maxlength="16" minlength="2" placeholder="e.g. CookieMonster" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <div id="lbErr"></div><div class="lb-form-actions"><button type="button" class="btn" id="lbLater">Maybe later</button><button type="submit" class="btn gold" id="lbJoin" style="padding:10px 22px;font-size:13px">Save</button></div></form>
        <div id="lbMe" hidden><span>You: <b id="lbMeName"></b> · P&amp;L <b id="lbMePnl"></b> · best <b id="lbMePeak"></b> · <b id="lbMeRank">—</b></span><button type="button" class="btn" id="lbRename" style="min-height:34px;padding:7px 11px">Rename</button></div>
        <div class="lb-tabs" role="tablist"><button type="button" role="tab" data-sort="pnl">Profit &amp; Loss</button><button type="button" role="tab" data-sort="peak">Highest Bankroll</button></div>
        <div class="lb-list" id="lbList"></div></div><div class="sheet-ft" id="lbFoot"></div></div>`;
    document.body.appendChild(m);
    $('#lbClose').onclick = () => this.close();
    m.addEventListener('click', e => { if (e.target === m) this.close(); });
    $('#lbLater').onclick = () => { if (LB.nick) this.showForm(false); else this.close(); };
    $('#lbRename').onclick = () => this.showForm(true);
    $('#lbForm').addEventListener('submit', e => { e.preventDefault(); this.join(); });
    $('#lbNick').addEventListener('input', e => { const c = e.target.value.replace(/[^A-Za-z0-9 _.!?'~*-]/g, ''); if (c !== e.target.value) e.target.value = c; });
    $$('.lb-tabs button').forEach(b => b.onclick = () => { if (LB.sort === b.dataset.sort) return; LB.sort = b.dataset.sort; LS.set('lb.sort', LB.sort); this.refresh(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) this.close(); });
  },
  get isOpen(){ const m = $('#lbModal'); return !!m && !m.hidden; },
  open(focusName){ this.build(); const m = $('#lbModal'); m.hidden = false; requestAnimationFrame(() => m.classList.add('show'));
    LS.set('lb.asked', true); this.showForm(!LB.nick || focusName); this.refresh(); },
  close(){ const m = $('#lbModal'); if (!m) return; m.classList.remove('show'); setTimeout(() => { m.hidden = true; }, 200); },
  me(){ if (!LB.nick) return; $('#lbMeName').textContent = LB.nick; const pe = $('#lbMePnl'); pe.textContent = fmtPnl(LB.net); pe.className = pnlCls(LB.net); $('#lbMePeak').textContent = fmt(LB.peak); },
  showForm(on){
    $('#lbForm').hidden = !on; $('#lbMe').hidden = on || !LB.nick; $('#lbErr').textContent = '';
    $('#lbFormTitle').textContent = LB.nick ? 'Change your nickname' : 'Choose a nickname to join the leaderboard';
    $('#lbLater').textContent = LB.nick ? 'Cancel' : 'Maybe later';
    if (on){ const i = $('#lbNick'); i.value = LB.nick || ''; setTimeout(() => { try { i.focus(); } catch(e){} }, 60); }
    this.me();
  },
  async join(){
    const nick = LB.cleanNick($('#lbNick').value), err = $('#lbErr'), btn = $('#lbJoin');
    if (nick.length < 2){ err.textContent = 'Nickname must be 2–16 letters, numbers or spaces.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
    LB.notePeak(); const res = await LB.submit(nick);
    btn.disabled = false; btn.textContent = 'Save';
    if (res.ok){ Snd.chips(3); UI.flash(`Welcome to the leaderboard, ${LB.nick}!`, 'win'); this.showForm(false); this.refresh(); }
    else err.textContent = ({nickname_taken:'That nickname is taken — try another.', bad_nickname:'Nickname must be 2–16 letters, numbers or spaces.',
      offline:'Can’t reach the leaderboard right now — check your connection and try again.', rate_limited:'Too fast — try again in a few seconds.'})[res.error] || 'Couldn’t save — please try again.';
  },
  async refresh(){
    const list = $('#lbList'), foot = $('#lbFoot'), sort = LB.sort; foot.textContent = 'Loading…';
    $$('.lb-tabs button').forEach(b => { const on = b.dataset.sort === sort; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    this.me();
    try {
      const d = await LB.board(); if (sort !== LB.sort) return;
      list.innerHTML = '';
      const row = (r, me) => { const e = document.createElement('div'); e.className = 'lb-row' + (me ? ' me' : '') + (r.rank <= 3 ? ' top' + r.rank : '');
        e.innerHTML = '<span class="rk"></span><span class="nm"></span><span class="pl"></span><span class="pk"></span><span class="sp"></span>';
        const c = e.children; c[0].textContent = r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank-1] : '#' + r.rank; c[1].textContent = r.nickname;
        c[2].textContent = fmtPnl(+r.net); if (pnlCls(+r.net)) c[2].classList.add(pnlCls(+r.net)); c[3].textContent = fmt(+r.peak);
        c[4].textContent = (+r.spins).toLocaleString('en-US'); e.title = `${r.nickname}: P&L ${fmtPnl(+r.net)} · highest bankroll ${fmt(+r.peak)} · ${r.spins} rounds`; return e; };
      if ((d.top || []).length){ const h = document.createElement('div'); h.className = 'lb-row lb-head';
        h.innerHTML = `<span>#</span><span>Player</span><span class="${sort === 'pnl' ? 'on' : ''}">P&amp;L</span><span class="${sort === 'peak' ? 'on' : ''}">Highest</span><span>Rounds</span>`; list.appendChild(h); }
      (d.top || []).forEach(r => list.appendChild(row(r, r.me)));
      if (d.me && !(d.top || []).some(r => r.me)){ const g = document.createElement('div'); g.className = 'lb-gap'; g.textContent = '···'; list.appendChild(g); list.appendChild(row(d.me, true)); }
      if (!(d.top || []).length) list.innerHTML = '<div class="lb-empty">No scores yet — be the first cookie on the board!</div>';
      if (d.me){ if (sort === 'peak') LB.rankPeak = d.me.rank; else LB.rank = d.me.rank; LB.save(); UI.meters(); $('#lbMeRank').textContent = '#' + d.me.rank; }
      foot.textContent = `${d.total} player${d.total === 1 ? '' : 's'} · ranked by ${sort === 'peak' ? 'highest bankroll ever reached' : 'lifetime profit & loss'} · rounds = spins + hands + rolls across all games · updated ${new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`;
    } catch(e){ foot.textContent = 'Leaderboard unavailable — you may be offline.'; }
  }
};

function boot(opts){ buildChipDefs(); UI.header(opts); LB.schedule(2500); }

window.CC = { $, $$, el, clamp, wait, fmt, fmtShort, fmtPnl, pnlCls, esc, LS, RNG, Bank, LB, LBUI, UI, Snd, Voice, START_BANK, DENOMS, COOKIE,
  chipSVG, stackSVG, breakdown, cardHTML, cardName, cRank, cSuit, SUITS, RANKS, boot, get muted(){ return muted; }, get voiceOn(){ return voiceOn; } };
})();

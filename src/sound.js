// ---------------------------------------------------------------- sound (off by default): noise shaped into surf
const audio = { ctx: null, out: null, noise: null, lastWave: -1 };
function pcgJS(v) {
  v >>>= 0;
  const st = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
// the shader's hash21, so the sounds line up with the waves on screen
function hash21JS(x, y) {
  const ix = (Math.floor(x) + (1 << 20)) >>> 0, iy = (Math.floor(y) + (1 << 20)) >>> 0;
  return pcgJS((ix + pcgJS(iy)) >>> 0) * 2.3283064e-10;
}
function audioStart() {
  if (!audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = audio.ctx = new AC();
    audio.out = ctx.createGain();
    audio.out.gain.value = 0;
    audio.out.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    audio.noise = white;
    // a low, distant surf that never stops
    const brown = ctx.createBuffer(1, len, ctx.sampleRate), bd = brown.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = b * 3.5; }
    const src = ctx.createBufferSource();
    src.buffer = brown; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(audio.out);
    src.start();
  }
  if (audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
}
function audioLevel() {
  if (audio.ctx) audio.out.gain.setTargetAtTime(S.sound ? S.volume : 0, audio.ctx.currentTime, 0.4);
}
function hiss(at, type, freq, q, attack, decay, gain) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.noise; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  src.connect(f).connect(g).connect(audio.out);
  src.start(at, Math.random() * 3);
  src.stop(at + attack + decay + 0.1);
}
function plop() {
  if (audio.ctx.state !== 'running') return;
  const ctx = audio.ctx, at = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(520, at);
  o.frequency.exponentialRampToValueAtTime(140, at + 0.12);
  g.gain.setValueAtTime(0.25, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
  o.connect(g).connect(audio.out);
  o.start(at); o.stop(at + 0.25);
  hiss(at, 'highpass', 3000, 0.7, 0.01, 0.25, 0.08);
}
// each wave: a crash where it breaks, a rush up the sand, a fizz as it drains back
function waveSounds() {
  if (!S.sound || !audio.ctx || audio.ctx.state !== 'running' || S.shore >= 6) return;
  const T = time % 36000, n0 = Math.floor(T / 9);
  if (n0 < audio.lastWave - 3) audio.lastWave = n0 - 2;
  for (let n = n0 - 1; n <= n0 + 1; n++) {
    if (n <= audio.lastWave) continue;
    const A = Math.min(1, Math.max(0.2, 0.55 + 0.28 * Math.sin(n * 0.85 + 1.3) + 0.4 * (hash21JS(n, 1) - 0.5)));
    const start = (n + 0.42 * (hash21JS(n, 2) - 0.5)) * 9;
    const tb = (0.72 - Math.sqrt(0.035 + 0.075 * A)) / 0.45, tUp = 0.9 + 1.3 * A;
    const lead = start + tb - T;
    if (lead > 1.5) continue;
    audio.lastWave = n;
    if (lead < -0.5) continue;
    const at = audio.ctx.currentTime + Math.max(0, lead);
    hiss(at, 'lowpass', 700 + 700 * A, 0.7, 0.06, 1.0 + 1.4 * A, 0.5 * A);
    const run = at + (1.6 - tb);
    hiss(run, 'bandpass', 1600, 0.6, 0.25, tUp, 0.22 * A);
    hiss(run + tUp, 'highpass', 2800, 0.7, 0.6, 2.6 * tUp, 0.08 * A);
  }
}


// ---------------------------------------------------------------- dolphins: a pod passes through the deep water now and then
let dolphins = [];
let podTimer = rand(40, 90), podAge = 0, podLeaps = 0, lastLeap = -99;
let sprays = [];
function addSpray(x, y, r, str, life) {
  if (sprays.length < MAX_SPRAY && depthAt(x, y) > 0.02) sprays.push({ x, y, r, str, life, age: 0, seed: Math.random() });
}
function splashSound(big) {
  if (!S.sound || !audio.ctx || audio.ctx.state !== 'running') return;
  const ctx = audio.ctx, at = ctx.currentTime;
  if (big) {
    // the crash back in: a deep thump under a burst of water
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, at);
    o.frequency.exponentialRampToValueAtTime(50, at + 0.25);
    g.gain.setValueAtTime(0.3, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(audio.out);
    o.start(at); o.stop(at + 0.35);
    hiss(at, 'lowpass', 1600, 0.5, 0.01, 0.8, 0.22);
    hiss(at + 0.03, 'highpass', 2800, 0.7, 0.02, 0.6, 0.09);
  } else {
    hiss(at, 'bandpass', 900, 0.7, 0.02, 0.35, 0.08);
  }
}
// launch a dolphin out of the water: a short arc a body length or so high, carried a couple of body lengths forward
function startLeap(d) {
  d.leap = { t: 0, dur: rand(1.0, 1.25), H: d.len * rand(1.15, 1.4), v: d.len * 1.6, entered: false, draw: null };
  d.leap.v /= d.leap.dur;
  lastLeap = time;
  const hx = d.x + Math.cos(d.ang) * d.len * 0.45, hy = d.y + Math.sin(d.ang) * d.len * 0.45;
  addDrop(hx, hy, hx, hy, 0.02, -0.5 * S.ripple);
  addSpray(hx, hy, d.len * 0.3, 0.75, 0.9);
  splashSound(false);
}
function updateLeap(d, dt) {
  const lp = d.leap, L = d.len, c = Math.cos(d.ang), s = Math.sin(d.ang);
  lp.t = Math.min(1, lp.t + dt / lp.dur);
  d.vx = c * lp.v; d.vy = s * lp.v;
  d.x += d.vx * dt; d.y += d.vy * dt;
  d.angVel = 0; d.bend = 0; d.depth = 0;
  // pitch goes from nose-up to nose-down; the body's centre rises and falls so the beak breaks the water first
  // and the flukes leave it last
  const u = lp.t, pitch = 0.85 - 1.8 * u, sp = Math.sin(pitch);
  const zc = lp.H * 4 * u * (1 - u) - L * (0.375 + 0.072 * u);
  let mode = 2, cut = -9;
  if (sp > 0.03) cut = -zc / (L * sp);
  else if (sp < -0.03) { mode = 3; cut = zc / (L * -sp); }
  const fs = Math.max(Math.cos(pitch), 0.35), sc = 1 + 0.6 * Math.max(zc, 0);
  lp.draw = { mode, cut, fs, sc };
  if (mode === 3 && cut < 0.5 && !lp.entered) {
    // head first back into the water: the big splash
    lp.entered = true;
    const k = cut * L * fs * sc, ex = d.x + c * k, ey = d.y + s * k;
    addDrop(ex, ey, ex, ey, 0.035, -1.3 * S.ripple);
    addSpray(ex, ey, L * 0.55, 1, 1.6);
    splashSound(true);
    for (const f of fish) {
      const dx = f.x - ex, dy = f.y - ey, dd = Math.hypot(dx, dy) + 1e-4;
      if (dd < 0.35) { const k2 = 1 - dd / 0.35; f.fear = Math.max(f.fear, 0.5 + 0.5 * k2); f.vx += dx / dd * 0.3 * k2; f.vy += dy / dd * 0.3 * k2; }
    }
  }
  if (lp.t >= 1) {
    // the flukes slap down as it disappears
    const tx = d.x - c * L * 0.5, ty = d.y - s * L * 0.5;
    addDrop(tx, ty, tx, ty, 0.02, -0.5 * S.ripple);
    addSpray(tx, ty, L * 0.3, 0.7, 1.0);
    d.leap = null;
    d.vx = c * 0.2; d.vy = s * 0.2;
    d.breath = 0.55; d.blown = true;
  }
}
function updateSprays(dt) {
  for (const p of sprays) p.age += dt / p.life;
  sprays = sprays.filter(p => p.age < 1);
}
function spawnPod() {
  const [sx, sy] = offscreenSeaPoint(0.6, 0.45);
  // head for the far side of the deep water, so the pod crosses the long way
  let ex = aspect - sx, ey = 1 - sy, best = 0;
  for (let i = 0; i < 24; i++) {
    const [x, y] = offscreenSeaPoint(0.6, 0.6), dd = Math.hypot(x - sx, y - sy);
    if (dd > best) { best = dd; ex = x; ey = y; }
  }
  const ang = Math.atan2(ey - sy, ex - sx), n = 3 + Math.floor(rand(0, 4));
  dolphins = [];
  const lr = Math.random();
  podLeaps = lr < 0.3 ? 0 : lr < 0.75 ? 1 : 2;      // most pods put on a show at least once
  for (let i = 0; i < n; i++) {
    const calf = i > 1 && Math.random() < 0.3;
    const ox = -0.12 * Math.ceil(i / 2) - rand(0, 0.05), oy = i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.08 + 0.04 * Math.ceil(i / 2)) + rand(-0.02, 0.02);
    const c = Math.cos(ang), s = Math.sin(ang), g = rand(-0.03, 0.03);
    dolphins.push({ lead: i === 0, ox, oy, tx: ex, ty: ey, x: sx + c * ox - s * oy, y: sy + s * ox + c * oy, ang,
                    vx: c * 0.11, vy: s * 0.11, angVel: 0, bend: 0, len: calf ? rand(0.13, 0.15) : rand(0.2, 0.24),
                    phase: rand(0, TAU), beat: rand(0.9, 1.2), breath: rand(0, 1), breathRate: rand(1 / 9, 1 / 6),
                    blown: false, depth: 0.2, fear: 0, leap: null, col: [0.18 + g, 0.2 + g, 0.23 + g] });
  }
  podAge = 0;
}
function updateDolphins(dt) {
  updateSprays(dt);
  if (!S.dolphins) { dolphins = []; return; }
  if (!dolphins.length) {
    podTimer -= dt;
    if (podTimer <= 0) { spawnPod(); podTimer = rand(120, 240); }
    return;
  }
  podAge += dt;
  const lead = dolphins[0];
  for (const d of dolphins) {
    if (d.leap) { updateLeap(d, dt); continue; }
    let ax, ay;
    const onScreen = d.x > 0 && d.x < aspect && d.y > 0 && d.y < 1;
    if (d.lead) {
      const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy) + 1e-4, cruise = 0.11 * (1 + d.fear);
      ax = (dx / dist * cruise - d.vx) * 0.6; ay = (dy / dist * cruise - d.vy) * 0.6;
      if (onScreen && depthAt(d.x + Math.cos(d.ang) * 0.25, d.y + Math.sin(d.ang) * 0.25) < 0.55) {
        const [gx, gy] = deeperDir(d.x, d.y);
        ax += gx * 0.25; ay += gy * 0.25;
      }
    } else {
      // keep station beside and behind the leader
      const c = Math.cos(lead.ang), s = Math.sin(lead.ang);
      const px = lead.x + c * d.ox - s * d.oy, py = lead.y + s * d.ox + c * d.oy;
      ax = (px - d.x) * 1.5 + (lead.vx - d.vx) * 1.2; ay = (py - d.y) * 1.5 + (lead.vy - d.vy) * 1.2;
    }
    d.vx += ax * dt; d.vy += ay * dt;
    if (!d.lead) {
      // one that ended up ahead (after a leap) eases off and lets the pod catch up rather than turning back
      const c = Math.cos(lead.ang), s = Math.sin(lead.ang), along = d.vx * c + d.vy * s;
      if (along < 0.05) { d.vx += (0.05 - along) * c; d.vy += (0.05 - along) * s; }
    }
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > 0.45) { d.vx *= 0.45 / sp; d.vy *= 0.45 / sp; }
    d.x += d.vx * dt; d.y += d.vy * dt;
    steerHeading(d, dt, 1.6);
    d.bend += (Math.max(-0.5, Math.min(0.5, d.angVel * 0.25)) - d.bend) * Math.min(1, dt * 6);
    d.phase += dt * TAU * d.beat * (1 + d.fear);
    d.fear = Math.max(0, d.fear - dt * 0.3);
    // every 6–9 seconds each one rises to breathe: a quick arc up to the surface and back down
    d.breath = (d.breath + dt * d.breathRate) % 1;
    const rise = Math.pow(Math.max(0, Math.sin(d.breath * TAU)), 6);
    d.depth = 0.2 - 0.19 * rise;
    const hx = d.x + Math.cos(d.ang) * d.len * 0.45, hy = d.y + Math.sin(d.ang) * d.len * 0.45;
    if (rise > 0.5 && onScreen && Math.random() < dt * 25) addDrop(hx, hy, hx, hy, 0.012, -0.08 * S.ripple);
    if (rise > 0.9 && !d.blown) {
      d.blown = true;
      // now and then, instead of a breath, one leaps clear of the water
      const m = 0.15, wellIn = d.x > m && d.x < aspect - m && d.y > m && d.y < 1 - m;
      if (!d.lead && podLeaps > 0 && wellIn && time - lastLeap > 4 && depthAt(d.x, d.y) > 0.4 && Math.random() < 0.45) {
        podLeaps--;
        startLeap(d);
        continue;
      }
      if (onScreen) {
        addDrop(hx, hy, hx, hy, 0.022, -0.35 * S.ripple);
        const bx = d.x + Math.cos(d.ang) * d.len * 0.3, by = d.y + Math.sin(d.ang) * d.len * 0.3;
        addSpray(bx, by, d.len * 0.11, 0.45, 0.7);
        if (S.sound && audio.ctx && audio.ctx.state === 'running') hiss(audio.ctx.currentTime, 'bandpass', 1300, 0.8, 0.02, 0.35, 0.07);
      }
    }
    if (rise < 0.2) d.blown = false;
  }
  // the pod is gone once the leader has reached the far side and the rest have followed it off screen
  const off = d => d.x < -d.len || d.x > aspect + d.len || d.y < -d.len || d.y > 1 + d.len;
  if ((Math.hypot(lead.tx - lead.x, lead.ty - lead.y) < 0.3 && dolphins.every(off)) || podAge > 90) dolphins = [];
}


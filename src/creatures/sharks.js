// ---------------------------------------------------------------- reef sharks: one, now and then two, patrol the reef edge
let sharks = [];
let sharkTimer = rand(50, 110), sharkAge = 0;
function spawnSharks() {
  const [sx, sy] = offscreenSeaPoint(0.35, 0.45);
  let ex = aspect - sx, ey = 1 - sy, best = 0;
  for (let i = 0; i < 24; i++) {
    const [x, y] = offscreenSeaPoint(0.35, 0.6), dd = Math.hypot(x - sx, y - sy);
    if (dd > best) { best = dd; ex = x; ey = y; }
  }
  const n = Math.random() < 0.3 ? 2 : 1, ang = Math.atan2(ey - sy, ex - sx);
  sharks = [];
  for (let i = 0; i < n; i++) {
    const g = rand(-0.03, 0.03), back = i * rand(0.25, 0.4);
    sharks.push({ x: sx - Math.cos(ang) * back, y: sy - Math.sin(ang) * back, ang, tx: ex, ty: ey,
                  vx: Math.cos(ang) * 0.07, vy: Math.sin(ang) * 0.07, angVel: 0, bend: 0, len: rand(0.15, 0.19),
                  phase: rand(0, TAU), beat: rand(0.75, 0.95), depth: rand(0.18, 0.26), wander: rand(0, TAU),
                  shy: 0, col: [0.21 + g, 0.205 + g, 0.19 + g] });
  }
  sharkAge = 0;
}
// a shark cruises slowly toward the far side, keeping to the reef edge: away from the shallow sand and out of
// the open deep, weaving a little as it goes; it turns away from a splash or a fast sweep of the cursor
function updateSharks(dt) {
  if (!S.sharks) { sharks = []; return; }
  if (!sharks.length) {
    sharkTimer -= dt;
    if (sharkTimer <= 0) { spawnSharks(); sharkTimer = rand(90, 200); }
    return;
  }
  sharkAge += dt;
  for (const k of sharks) {
    const onScreen = k.x > 0 && k.x < aspect && k.y > 0 && k.y < 1;
    const dx = k.tx - k.x, dy = k.ty - k.y, dist = Math.hypot(dx, dy) + 1e-4, cruise = 0.07 * (1 + 1.5 * k.shy);
    k.wander += dt * rand(-0.6, 0.6);
    const wx = Math.cos(k.wander) * 0.35, wy = Math.sin(k.wander) * 0.35;
    let ax = ((dx / dist + wx * 0.5) * cruise - k.vx) * 0.5, ay = ((dy / dist + wy * 0.5) * cruise - k.vy) * 0.5;
    if (onScreen) {
      const hx = k.x + Math.cos(k.ang) * 0.18, hy = k.y + Math.sin(k.ang) * 0.18, D = depthAt(hx, hy);
      const [gx, gy] = deeperDir(k.x, k.y);
      if (D < 0.3) { ax += gx * 0.12; ay += gy * 0.12; }
      else if (D > 1.4) { ax -= gx * 0.06; ay -= gy * 0.06; }
    }
    if (mouse.inside && mouse.speed > 0.3 && onScreen) {
      const mx = k.x - mouse.x, my = k.y - mouse.y, md = Math.hypot(mx, my) + 1e-4;
      if (md < 0.2) { ax += mx / md * 0.3; ay += my / md * 0.3; k.shy = 1; }
    }
    k.vx += ax * dt; k.vy += ay * dt;
    const sp = Math.hypot(k.vx, k.vy);
    if (sp > 0.25) { k.vx *= 0.25 / sp; k.vy *= 0.25 / sp; }
    k.x += k.vx * dt; k.y += k.vy * dt;
    steerHeading(k, dt, 1.0);
    k.bend += (Math.max(-0.5, Math.min(0.5, k.angVel * 0.3)) - k.bend) * Math.min(1, dt * 4);
    k.phase += dt * TAU * k.beat * (1 + k.shy);
    k.shy = Math.max(0, k.shy - dt * 0.4);
  }
  const off = k => k.x < -k.len || k.x > aspect + k.len || k.y < -k.len || k.y > 1 + k.len;
  const lead = sharks[0];
  if ((Math.hypot(lead.tx - lead.x, lead.ty - lead.y) < 0.3 && sharks.every(off)) || sharkAge > 110) sharks = [];
}

let gullTimer = rand(6, 20);
function updateGulls(dt) {
  if (!S.beachLife) { gulls.length = 0; return; }
  gullTimer -= dt;
  if (gullTimer <= 0) {
    gullTimer = rand(30, 80);
    const a = rand(0, TAU), dx = Math.cos(a), dy = Math.sin(a), side = rand(-0.35, 0.35);
    const cx = aspect / 2 - dx * (aspect * 0.6 + 0.4) - dy * side, cy = 0.5 - dy * (aspect * 0.6 + 0.4) + dx * side;
    const n = Math.random() < 0.4 ? 1 + Math.floor(rand(1, 3)) : 1;
    for (let i = 0; i < n; i++) {
      gulls.push({ x: cx - dx * i * 0.09 + dy * rand(-0.08, 0.08), y: cy - dy * i * 0.09 - dx * rand(-0.08, 0.08),
                   ang: a + rand(-0.06, 0.06), len: rand(0.055, 0.07), phase: rand(0, TAU), glide: rand(0, 2), speed: rand(0.2, 0.26) });
    }
  }
  for (const g of gulls) {
    g.x += Math.cos(g.ang) * g.speed * dt; g.y += Math.sin(g.ang) * g.speed * dt;
    g.glide -= dt;
    if (g.glide < -1.2) g.glide = rand(1, 3);
    if (g.glide < 0) g.phase += dt * TAU * 2.6;
    g.ang += Math.sin(g.phase * 0.05) * 0.02 * dt;
  }
  gulls = gulls.filter(g => g.x > -1 && g.x < aspect + 1 && g.y > -1 && g.y < 2);
}

function updateJellies(dt) {
  const cur = world.current;
  for (const j of jellies) {
    j.phase += dt * j.rate;
    // a push with every contraction of the bell, then a glide
    const thrust = Math.max(0, -Math.cos(j.phase));
    j.turn += rand(-1, 1) * dt * 0.2;
    j.turn *= Math.exp(-dt * 0.3);
    j.ang = wrapAngle(j.ang + j.turn * dt);
    if (depthAt(j.x + Math.cos(j.ang) * 0.08, j.y + Math.sin(j.ang) * 0.08) < 0.3) {
      const [gx, gy] = deeperDir(j.x, j.y);
      j.ang = wrapAngle(j.ang + Math.max(-0.8 * dt, Math.min(0.8 * dt, wrapAngle(Math.atan2(gy, gx) - j.ang))));
    }
    const swim = 0.004 + 0.022 * thrust;
    const kd = 1 - Math.exp(-dt * 1.5);
    j.vx += (Math.cos(j.ang) * swim + cur[0] * 0.6 - j.vx) * kd;
    j.vy += (Math.sin(j.ang) * swim + cur[1] * 0.6 - j.vy) * kd;
    if (mouse.inside && mouse.speed > 0.15) {
      const dx = j.x - mouse.x, dy = j.y - mouse.y, d = Math.hypot(dx, dy) + 1e-4;
      if (d < 0.12) { const k = (1 - d / 0.12) * Math.min(1, dt * 4); j.vx += mouse.vx * 0.25 * k; j.vy += mouse.vy * 0.25 * k; }
    }
    j.x += j.vx * dt; j.y += j.vy * dt;
    const m = 0.15;
    if (j.x < -m || j.x > aspect + m || j.y < -m || j.y > 1 + m) {
      [j.x, j.y] = offscreenSeaPoint(0.4, 0.1);
      j.ang = Math.atan2(0.5 - j.y, aspect / 2 - j.x) + rand(-0.6, 0.6);
    }
  }
}

function updateFloats(dt) {
  const cur = world.current;
  for (const f of floats) {
    const k = Math.min(1, dt * 0.25);
    f.vx += (cur[0] - f.vx) * k; f.vy += (cur[1] - f.vy) * k;
    f.va *= Math.exp(-dt * 0.8);
    if (mouse.inside && mouse.speed > 0.02) {
      const dx = f.x - mouse.x, dy = f.y - mouse.y, d = Math.hypot(dx, dy) + 1e-4, R = f.len * 0.45 + 0.022;
      if (d < R) {
        const kk = (1 - d / R) * Math.min(1, dt * 10);
        f.vx += (mouse.vx * 0.8 - f.vx) * kk + dx / d * 0.02 * kk;
        f.vy += (mouse.vy * 0.8 - f.vy) * kk + dy / d * 0.02 * kk;
        f.va += (dx * mouse.vy - dy * mouse.vx) / (d * d + 1e-3) * 0.08 * kk;
      }
    }
    for (const g of floats) {
      if (g === f) continue;
      const dx = f.x - g.x, dy = f.y - g.y, d = Math.hypot(dx, dy) + 1e-4, sd = (f.len + g.len) * 0.42;
      if (d < sd) { f.vx += dx / d * (sd - d) * dt * 6; f.vy += dy / d * (sd - d) * dt * 6; }
    }
    if (depthAt(f.x, f.y) < 0.06) {
      const [gx, gy] = deeperDir(f.x, f.y);
      f.vx += gx * 0.12 * dt; f.vy += gy * 0.12 * dt;
    }
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.ang += f.va * dt;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > 0.05 && Math.random() < dt * 8) addDrop(f.x, f.y, f.x, f.y, 0.012, -0.08 * S.ripple * Math.min(1, sp * 4));
    const m = 0.08;
    if (f.x < -m) f.x += aspect + 2 * m; else if (f.x > aspect + m) f.x -= aspect + 2 * m;
    if (f.y < -m) f.y += 1 + 2 * m; else if (f.y > 1 + m) f.y -= 1 + 2 * m;
    if (depthAt(f.x, f.y) < 0.02) [f.x, f.y] = offscreenSeaPoint(0.15, 0.07);
  }
}

let rainAcc = 0;
function updateRain(dt) {
  rainAcc += S.rain * 22 * dt;
  while (rainAcc >= 1) {
    rainAcc -= 1;
    const x = rand(0, aspect), y = rand(0, 1);
    addDrop(x, y, x, y, rand(0.006, 0.011), -rand(0.25, 0.45));
  }
}


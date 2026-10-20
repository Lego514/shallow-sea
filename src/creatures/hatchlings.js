// ---------------------------------------------------------------- turtle hatchlings: on some nights a nest hatches on the beach
let hatchlings = [], nest = null, nestTimer = rand(20, 50), nightLevel = 0;
function spawnNest() {
  if (S.shore >= 6) return false;
  // dry sand above the reach of the waves
  for (let i = 0; i < 80; i++) {
    const x = rand(0.08, aspect - 0.08), y = rand(0.08, 0.92), d = depthAt(x, y);
    if (d < -0.12 && d > -0.32) {
      nest = { x, y, t: 0, total: 7 + Math.floor(rand(0, 6)), out: 0, next: 3, churn: 0 };
      return true;
    }
  }
  return false;
}
function updateHatchlings(dt) {
  if (!S.hatchlings || S.shore >= 6) { hatchlings = []; nest = null; return; }
  if (!nest && !hatchlings.length) {
    if (nightLevel > 0.5) {
      nestTimer -= dt;
      if (nestTimer <= 0) { spawnNest(); nestTimer = rand(150, 300); }
    } else if (nestTimer < 20) nestTimer = rand(20, 50);
  }
  if (nest) {
    const n = nest;
    n.t += dt;
    // first the sand over the nest stirs and sinks into a hollow, then they pop out one after another
    n.churn -= dt;
    if (n.churn <= 0) {
      n.churn = 0.18;
      const a = rand(0, TAU), r = rand(0, 0.011) * Math.min(1, n.t / 2);
      addPrint(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r, rand(0.003, 0.0055), 0.5);
    }
    if (n.t >= n.next && hatchlings.length < MAX_HATCH) {
      n.out++; n.next = n.t + rand(0.3, 1.1);
      const [gx, gy] = deeperDir(n.x, n.y);
      hatchlings.push({ x: n.x + rand(-0.006, 0.006), y: n.y + rand(-0.006, 0.006), ang: Math.atan2(gy, gx) + rand(-1.2, 1.2),
                        len: rand(0.019, 0.023), phase: rand(0, TAU), rate: rand(1.8, 2.4), bias: rand(-0.35, 0.35),
                        wob: rand(0, TAU), wobRate: rand(0.6, 1.3), grow: 0, swim: false, rest: 0, restT: rand(2, 5),
                        freeze: 0, side: 1, lastS: 0, step: 0, life: 0,
                        col: [0.12 + rand(0, 0.04), 0.11 + rand(0, 0.03), 0.1] });
    }
    if (n.out >= n.total) nest = null;
  }
  for (const h of hatchlings) {
    h.life += dt;
    h.grow = Math.min(1, h.grow + dt * 2);
    if (mouse.inside && Math.hypot(h.x - mouse.x, h.y - mouse.y) < 0.06 && (mouse.speed > 0.05 || mouse.down)) h.freeze = rand(0.8, 2);
    if (h.freeze > 0) { h.freeze -= dt; continue; }
    if (!h.swim && depthAt(h.x, h.y) > 0) h.swim = true;
    // head for the open sea, each one wavering in its own way
    h.wob += dt * h.wobRate;
    const [gx, gy] = deeperDir(h.x, h.y);
    const want = Math.atan2(gy, gx) + h.bias * (h.swim ? 0.5 : 1) + 0.4 * Math.sin(h.wob);
    h.ang = wrapAngle(h.ang + Math.max(-2 * dt, Math.min(2 * dt, wrapAngle(want - h.ang))));
    const c = Math.cos(h.ang), sn = Math.sin(h.ang);
    if (!h.swim) {
      // a lurching crawl, with a rest now and then
      h.restT -= dt;
      if (h.restT <= 0) { h.rest = rand(0.4, 1.2); h.restT = rand(2, 5); }
      if (h.rest > 0) { h.rest -= dt; continue; }
      h.phase += dt * h.rate * TAU;
      const s = Math.sin(h.phase), v = 0.022 * (0.25 + 0.75 * Math.abs(s));
      h.x += c * v * dt; h.y += sn * v * dt;
      // a flipper print each time one side pushes off, and a faint drag mark from the belly
      if ((s > 0) !== (h.lastS > 0)) {
        h.side = -h.side;
        const k = h.len * 0.5;
        addPrint(h.x + c * h.len * 0.1 - sn * h.side * k, h.y + sn * h.len * 0.1 + c * h.side * k, 0.0012, 0.4);
      }
      h.lastS = s;
      h.step += dt;
      if (h.step > 0.12) { h.step = 0; addPrint(h.x - c * h.len * 0.2, h.y - sn * h.len * 0.2, 0.0013, 0.15); }
    } else {
      // in the water: both front flippers together, quick strokes out through the surf; each one stirs the water
      h.phase += dt * 2.6 * TAU;
      const s = Math.sin(h.phase), v = 0.05 * (0.5 + 0.5 * Math.max(0, s));
      h.x += c * v * dt; h.y += sn * v * dt;
      if (s > 0.9 && h.lastS <= 0.9) addDrop(h.x, h.y, h.x, h.y, 0.004, -0.05 * S.ripple);
      h.lastS = s;
    }
  }
  hatchlings = hatchlings.filter(h => h.life < 240 && !(h.swim && (depthAt(h.x, h.y) > 0.6 ||
    h.x < -0.05 || h.x > aspect + 0.05 || h.y < -0.05 || h.y > 1.05)));
}


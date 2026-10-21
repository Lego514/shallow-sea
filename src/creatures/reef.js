// ---------------------------------------------------------------- the reef's residents: anemones and their clownfish, an octopus
// Anemones stay put in the shallows. Two or three clownfish live in each and never stray far: they dive in among the
// tentacles when something startles them, sleep there at night and dart out for food that drifts close. The octopus
// creeps over the seabed taking on the colours of whatever it sits on. Come close slowly and it presses itself flat
// and all but vanishes; startle it and it flashes dark, squirts ink and jets away mantle first.
let anemones = [];
let clowns = [];
let octopus = null;
let inks = [];
const CLOWN_COL = [0.98, 0.46, 0.08];

// anemones settle on open sand or rock in the shallows, where they stand out, not in the middle of a coral garden
function newAnemone() {
  let best = null, busy = 9;
  for (let i = 0, found = 0; i < 60 && found < 12; i++) {
    const [x, y] = randomWaterPoint(0.15, 0.35);
    if (x < 0.12 || x > aspect - 0.12 || y < 0.12 || y > 0.88 || anemones.some(a => Math.hypot(a.x - x, a.y - y) < 0.4)) continue;
    found++;
    const b = seabedBusy(x, y);
    if (b < busy) { busy = b; best = [x, y]; }
  }
  if (!best) return null;
  return { x: best[0], y: best[1], len: rand(0.13, 0.16), phase: rand(0, 100), pull: 0, pullT: 0, look: Math.random() < 0.5 ? 0 : 1 };
}
function newClown(a, i) {
  const r = rand(0, a.len * 0.4), t = rand(0, TAU);
  return { home: a, x: a.x + Math.cos(t) * r, y: a.y + Math.sin(t) * r, tx: a.x, ty: a.y, ang: rand(0, TAU), angVel: 0,
           vx: 0, vy: 0, len: i === 0 ? rand(0.046, 0.05) : rand(0.034, 0.04), phase: rand(0, TAU), bend: 0, timer: 0,
           hide: 0, hideT: 0, nest: i * 2.1 + rand(0, 1) };
}
function placeAnemones() {
  anemones = [];
  clowns = [];
  if (!S.anemones) return;
  for (let k = 0; k < 2; k++) {
    const a = newAnemone();
    if (!a) break;
    anemones.push(a);
    const n = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) clowns.push(newClown(a, i));
  }
}

function newOctopus() {
  const [x, y] = randomWaterPoint(0.06, 0.4);
  return { x, y, tx: x, ty: y, ang: rand(0, TAU), len: rand(0.12, 0.14), phase: rand(0, 100), state: 'rest',
           timer: rand(2, 6), vx: 0, vy: 0, camo: 0.3, flash: 0, flat: 0, spread: 1, seed: Math.random() };
}
// somewhere new to creep to: not far, not dry, not too deep, on the screen
function octopusTarget(o) {
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU), r = rand(0.08, 0.25), x = o.x + Math.cos(a) * r, y = o.y + Math.sin(a) * r;
    const d = depthAt(x, y);
    if (d > 0.06 && d < 0.45 && x > 0.06 && x < aspect - 0.06 && y > 0.06 && y < 0.94) return [x, y];
  }
  return randomWaterPoint(0.06, 0.4);
}

function syncReef() {
  if (!S.anemones) { anemones = []; clowns = []; } else if (!anemones.length) placeAnemones();
  if (!S.octopus) octopus = null; else if (!octopus) octopus = newOctopus();
  if (!S.octopus) inks = [];
}
// a new seabed: anemones grow somewhere else, and the octopus moves if it is now on dry land
function placeReef() {
  placeAnemones();
  if (octopus) {
    const d = depthAt(octopus.x, octopus.y);
    if (d < 0.05 || d > 0.6) Object.assign(octopus, newOctopus(), { seed: octopus.seed });
  }
  inks = [];
}

// a splash at (x, y): the anemones pull in, their clownfish dive for cover, the octopus jets away if it is close
function startleReef(x, y) {
  for (const a of anemones) {
    if (Math.hypot(a.x - x, a.y - y) > a.len + 0.12) continue;
    a.pullT = rand(2.5, 3.5);
    for (const c of clowns) if (c.home === a) c.hideT = Math.max(c.hideT, rand(2, 4));
  }
  const o = octopus;
  if (o && o.state !== 'jet' && Math.hypot(o.x - x, o.y - y) < 0.2) jetAway(o, x, y);
}

function jetAway(o, fx, fy) {
  // away from the fright, turning a little if needed to land somewhere it can settle
  const away = Math.atan2(o.y - fy, o.x - fx);
  let best = away, score = -9;
  for (let k = -4; k <= 4; k++) {
    const a = away + k * 0.3, ex = o.x + Math.cos(a) * 0.3, ey = o.y + Math.sin(a) * 0.3, d = depthAt(ex, ey);
    const ok = d > 0.05 && d < 0.6 && ex > 0.04 && ex < aspect - 0.04 && ey > 0.04 && ey < 0.96;
    const s = (ok ? 1 : 0) - Math.abs(k) * 0.05;
    if (s > score) { score = s; best = a; }
  }
  if (inks.length < 4) inks.push({ x: o.x, y: o.y, age: 0, len: o.len * 1.5, seed: Math.random() });
  o.vx = Math.cos(best) * 0.3;
  o.vy = Math.sin(best) * 0.3;
  o.ang = best + Math.PI;                     // mantle first, the arms trailing behind
  o.state = 'jet';
  o.flash = 1;
  addDrop(o.x, o.y, o.x, o.y, 0.012, -0.05 * S.ripple);
}

function updateAnemones(dt) {
  for (const a of anemones) {
    a.phase += dt;
    if (mouse.inside && Math.hypot(mouse.x - a.x, mouse.y - a.y) < a.len * 0.6 && (mouse.down || mouse.speed > 0.05)) a.pullT = 2.5;
    a.pullT = Math.max(0, a.pullT - dt);
    a.pull += ((a.pullT > 0 ? 1 : 0) - a.pull) * Math.min(1, dt * (a.pullT > 0 ? 5 : 0.7));
  }
}

function updateClowns(dt) {
  const asleep = nightLevel > 0.6;
  for (const c of clowns) {
    const a = c.home;
    if (mouse.inside && Math.hypot(mouse.x - a.x, mouse.y - a.y) < a.len * 1.3 && (mouse.speed > 0.12 || mouse.down))
      c.hideT = Math.max(c.hideT, rand(1.5, 3));
    for (const k of sharks) if (Math.hypot(k.x - a.x, k.y - a.y) < 0.3) c.hideT = Math.max(c.hideT, 1);
    c.hideT = Math.max(0, c.hideT - dt);
    const hiding = c.hideT > 0 || asleep;
    // food drifting close is worth a quick dash
    let food = null, fd = a.len * 1.6;
    if (!hiding) for (const p of pellets) {
      if (p.eaten) continue;
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < fd) { fd = d; food = p; }
    }
    c.timer -= dt;
    if (food) {
      [c.tx, c.ty] = [food.x, food.y];
      if (Math.hypot(food.x - c.x, food.y - c.y) < c.len * 0.5) { food.eaten = true; c.timer = 0; }
    } else if (hiding) {
      const r = a.len * 0.2;                      // tucked in among the tentacles, a stripe or two showing
      [c.tx, c.ty] = [a.x + Math.cos(c.nest) * r, a.y + Math.sin(c.nest) * r];
    } else if (c.timer <= 0) {
      // hover over the anemone, darting from spot to spot
      const r = a.len * rand(0.1, 0.5), t = rand(0, TAU);
      [c.tx, c.ty] = [a.x + Math.cos(t) * r, a.y + Math.sin(t) * r];
      c.timer = rand(0.5, 1.6);
    }
    const max = food ? 0.09 : hiding ? 0.08 : 0.035;
    let wx = (c.tx - c.x) * 4, wy = (c.ty - c.y) * 4;
    const wl = Math.hypot(wx, wy);
    if (wl > max) { wx *= max / wl; wy *= max / wl; }
    const k = Math.min(1, dt * 5);
    c.vx += (wx - c.vx) * k; c.vy += (wy - c.vy) * k;
    c.x += c.vx * dt; c.y += c.vy * dt;
    const sp = steerHeading(c, dt, 7);
    if (sp < 0.006) c.angVel *= Math.exp(-dt * 4);
    c.bend += (Math.max(-0.9, Math.min(0.9, c.angVel * 0.22)) - c.bend) * Math.min(1, dt * 10);
    c.phase += dt * (9 + sp * 150);
    c.hide += ((hiding ? 1 : 0) - c.hide) * Math.min(1, dt * 4);
  }
}

function updateOctopus(dt) {
  const o = octopus;
  if (!o) return;
  o.phase += dt;
  if (o.state !== 'jet') {
    const md = mouse.inside ? Math.hypot(mouse.x - o.x, mouse.y - o.y) : 9;
    let fright = null;
    if (md < 0.13 && (mouse.speed > 0.15 || mouse.down)) fright = [mouse.x, mouse.y];
    for (const k of sharks) if (Math.hypot(k.x - o.x, k.y - o.y) < 0.25) fright = [k.x, k.y];
    if (fright) jetAway(o, ...fright);
    else if (md < 0.2 && o.state !== 'hide') { o.state = 'hide'; o.timer = rand(4, 7); }   // something looming: freeze, vanish
  }
  if (o.state === 'jet') {
    const k = Math.exp(-dt * 2.2);
    o.vx *= k; o.vy *= k;
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (Math.hypot(o.vx, o.vy) < 0.02) { o.state = 'hide'; o.timer = rand(6, 10); }
  } else if (o.state === 'crawl') {
    const dx = o.tx - o.x, dy = o.ty - o.y;
    if (Math.hypot(dx, dy) < 0.012) { o.state = 'rest'; o.timer = rand(5, 12) * (nightLevel > 0.5 ? 0.5 : 1); }
    else {
      o.ang = wrapAngle(o.ang + wrapAngle(Math.atan2(dy, dx) - o.ang) * Math.min(1, dt * 1.5));
      const sp = 0.016 * (0.4 + 0.6 * Math.sin(o.phase * 1.6) ** 2);   // its arms pull it along in surges
      o.x += Math.cos(o.ang) * sp * dt; o.y += Math.sin(o.ang) * sp * dt;
    }
  } else {
    o.timer -= dt;
    if (o.timer <= 0) { [o.tx, o.ty] = octopusTarget(o); o.state = 'crawl'; }
  }
  o.x = Math.max(0.03, Math.min(aspect - 0.03, o.x));
  o.y = Math.max(0.03, Math.min(0.97, o.y));
  const camo = { jet: 0, crawl: 0.15, rest: 0.7, hide: 0.96 }[o.state];
  o.camo += (camo - o.camo) * Math.min(1, dt * (o.state === 'hide' ? 2.5 : 0.6));
  o.flat += ((o.state === 'hide' ? 1 : o.state === 'rest' ? 0.4 : 0) - o.flat) * Math.min(1, dt * 3);
  o.spread += ((o.state === 'jet' ? 0 : 1) - o.spread) * Math.min(1, dt * (o.state === 'jet' ? 10 : 2));
  o.flash = Math.max(0, o.flash - dt * 0.7);
}

function updateReef(dt) {
  updateAnemones(dt);
  updateClowns(dt);
  updateOctopus(dt);
  const cur = world.current;
  for (const k of inks) { k.age += dt; k.x += cur[0] * 3 * dt; k.y += cur[1] * 3 * dt; }
  inks = inks.filter(k => k.age < 5);
}

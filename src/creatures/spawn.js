// ---------------------------------------------------------------- creatures
let fish = [];
let rays = [];
let jellies = [];
let crabs = [];
let gulls = [];

// species 2 rests on the seabed; 5 and 6 fly through mid-water
const RAY_KINDS = {
  2: { len: 0.13, cruise: 0.032, minD: 0.14, maxD: 0.5, depth: 0.93, col: [0.76, 0.56, 0.25], beat: 0 },   // blue-spotted stingray
  5: { len: 0.11, cruise: 0.05, minD: 0.3, depth: 0.5, col: [0.10, 0.14, 0.22], beat: 2.4 },     // spotted eagle ray
  6: { len: 0.16, cruise: 0.04, minD: 0.6, depth: 0.55, col: [0.05, 0.06, 0.08], beat: 3.2 },    // manta
  9: { len: 0.15, cruise: 0.035, minD: 0.35, depth: 0.55, col: [0.42, 0.33, 0.18], beat: 3.6 },   // green sea turtle
};
let floats = [];

const BIG_LOOKS = [
  { col: [0.96, 0.80, 0.20], id: 1 },     // yellow tang
  { col: [0.60, 0.62, 0.44], id: 2 },     // sergeant major
  { col: [0.22, 0.38, 0.44], id: 3 },     // bluefin trevally
];

function newFish(kind, x, y) {
  if (x === undefined || depthAt(x, y) < 0.15) [x, y] = randomWaterPoint(0.3);
  const f = {
    kind, x, y, ang: rand(0, TAU), vx: 0, vy: 0,
    phase: rand(0, TAU), bend: 0, angVel: 0, fear: 0, wander: rand(0, TAU), curious: Math.random() < 0.65,
  };
  if (kind === 0) {
    f.len = rand(0.032, 0.046);
    f.cruise = rand(0.06, 0.085);
    f.depth = rand(0.42, 0.62);
    const v = rand(-0.05, 0.05);
    f.col = [0.2 + v, 0.3 + v, 0.34 + v];
    f.extra = 0;
  } else {
    const look = BIG_LOOKS[fish.filter(g => g.kind === 1).length % BIG_LOOKS.length];
    f.len = rand(0.085, 0.11);
    f.cruise = rand(0.045, 0.06);
    f.depth = rand(0.5, 0.65);
    f.col = look.col;
    f.extra = look.id;
  }
  f.vx = Math.cos(f.ang) * f.cruise;
  f.vy = Math.sin(f.ang) * f.cruise;
  return f;
}

function syncFish() {
  const small = fish.filter(f => f.kind === 0);
  let big = fish.filter(f => f.kind === 1);
  const nSmall = Math.max(0, Math.min(MAX_FISH - 3, S.fish | 0));
  const [cx, cy] = small.length ? [small[0].x, small[0].y] : randomWaterPoint(0.4);
  while (small.length < nSmall) small.push(newFish(0, cx + rand(-0.12, 0.12), cy + rand(-0.12, 0.12)));
  small.length = nSmall;
  const nBig = S.bigFish ? 3 : 0;
  fish = big.slice(0, nBig);
  while (fish.length < nBig) fish.push(newFish(1));
  fish.push(...small);
}

// sea turtles: green, hawksbill (tortoiseshell, serrated shell, hooked beak), olive ridley (small, round, plain olive)
const TURTLE_SPECIES = [
  { sp: 0, w: 0.45, len: [0.14, 0.16], col: [0.42, 0.33, 0.18] },
  { sp: 1, w: 0.3, len: [0.12, 0.135], col: [0.6, 0.33, 0.12] },
  { sp: 2, w: 0.25, len: [0.105, 0.12], col: [0.32, 0.34, 0.22] },
];
function pickTurtle(r) {
  let u = Math.random(), t = TURTLE_SPECIES[0];
  for (const c of TURTLE_SPECIES) { if (u < c.w) { t = c; break; } u -= c.w; }
  r.sp = t.sp; r.len = rand(t.len[0], t.len[1]); r.col = t.col; r.extra = Math.random();
}
function newRay(kind) {
  const k = RAY_KINDS[kind];
  const [x, y] = randomWaterPoint(k.minD + 0.05, k.maxD), [tx, ty] = randomWaterPoint(k.minD + 0.1, k.maxD);
  const r = { kind, x, y, tx, ty, ang: Math.atan2(ty - y, tx - x), vx: 0, vy: 0, len: k.len, phase: rand(0, TAU),
              fear: 0, away: 0, col: k.col, extra: Math.random() };
  if (kind === 9) pickTurtle(r);
  return r;
}
function syncRays() {
  const want = [...(S.rays ? [2, 5, 6] : []), ...(S.turtle ? [9, 9] : [])];
  const pool = rays.slice(), had = pool.filter(r => r.kind === 9).length;
  rays = want.map(kind => { const i = pool.findIndex(r => r.kind === kind); return i >= 0 ? pool.splice(i, 1)[0] : newRay(kind); });
  // a second turtle turns up a while after the first
  const turtles = rays.filter(r => r.kind === 9);
  if (turtles.length === 2 && had < 2) turtles[1].away = rand(15, 45);
}

// hermit crabs wander the dry sand; gulls cross now and then
function newCrab() {
  for (let i = 0; i < 80; i++) {
    const x = rand(0.05, aspect - 0.05), y = rand(0.05, 0.95), d = depthAt(x, y);
    if (d < -0.05 && d > -0.5) {
      const tint = Math.random();
      return { x, y, ang: rand(0, TAU), len: rand(0.018, 0.026), phase: 0, walking: false, timer: rand(0.5, 3),
               hide: 0, hideT: 0, step: 0, side: 1, extra: Math.random(),
               col: tint < 0.4 ? [0.86, 0.74, 0.58] : tint < 0.7 ? [0.66, 0.50, 0.40] : [0.92, 0.86, 0.80] };
    }
  }
  return null;
}
function syncCrabs() {
  if (!S.beachLife || S.shore >= 6) { crabs = []; return; }
  for (let i = crabs.length; i < 3; i++) { const c = newCrab(); if (c) crabs.push(c); }
}

function newJelly(x, y) {
  const kind = Math.random() < 0.6 ? 7 : 8;
  if (x === undefined) [x, y] = randomWaterPoint(0.45);
  return {
    kind, x, y, ang: rand(0, TAU), turn: rand(-0.15, 0.15), vx: 0, vy: 0,
    len: kind === 7 ? rand(0.08, 0.11) : rand(0.085, 0.105),
    phase: rand(0, TAU), rate: rand(0.55, 0.85) * TAU, depth: rand(0.22, 0.45), extra: Math.random(),
  };
}
function syncJellies() {
  const n = Math.max(0, Math.min(24, S.jellies | 0));
  while (jellies.length < n) jellies.push(newJelly());
  jellies.length = n;
}

function newFloat(x, y) {
  const leafy = Math.random() < 0.35;
  if (x === undefined) [x, y] = randomWaterPoint(0.2);
  return {
    x, y, vx: 0, vy: 0, ang: rand(0, TAU), va: rand(-0.1, 0.1),
    kind: leafy ? 4 : 3,
    len: leafy ? rand(0.06, 0.08) : rand(0.055, 0.07),
    col: leafy ? (Math.random() < 0.5 ? [0.36, 0.56, 0.20] : [0.80, 0.62, 0.24]) : (Math.random() < 0.3 ? [0.98, 0.70, 0.75] : [0.99, 0.97, 0.93]),
    extra: Math.random(),
  };
}
function syncFloats() {
  const n = Math.max(0, Math.min(MAX_FLOATS, S.floats | 0));
  while (floats.length < n) floats.push(newFloat());
  floats.length = n;
}


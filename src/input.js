// ---------------------------------------------------------------- input
const mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0, down: false, inside: false, has: false, lastMove: -99,
                downAt: 0, downX: 0, downY: 0, dragged: false, feeding: false };
let time = 0;
const drops = [];
const strokes = [];   // finger lines in the sand

function addDrop(ax, ay, bx, by, r, s) {
  if (drops.length < MAX_DROPS && s !== 0) drops.push([ax, ay, r, s, bx, by]);
}
function addStroke(ax, ay, bx, by, r) {
  if (strokes.length < MAX_DROPS && S.shore < 6) strokes.push([ax, ay, r, 1, bx, by]);
}
function addPrint(x, y, r, depth) {
  if (strokes.length < MAX_DROPS && S.shore < 6) strokes.push([x, y, r, depth, x, y]);
}
function toWorld(e) { return [e.clientX / innerWidth * aspect, 1 - e.clientY / innerHeight]; }

// plain mouse events: this is what Lively forwards from the desktop to the wallpaper
addEventListener('mousemove', e => {
  const [x, y] = toWorld(e);
  if (!mouse.has || !mouse.inside) { mouse.px = x; mouse.py = y; }
  mouse.x = x; mouse.y = y; mouse.has = true; mouse.inside = true; mouse.lastMove = time;
});
addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const [x, y] = toWorld(e);
  mouse.x = mouse.px = x; mouse.y = mouse.py = y; mouse.has = true; mouse.inside = true; mouse.down = true; mouse.lastMove = time;
  mouse.downAt = time; mouse.downX = x; mouse.downY = y; mouse.dragged = false;
  splash(x, y, 1);
  addStroke(x, y, x, y, 0.006);
  if (S.sound) audioStart();
});
addEventListener('mouseup', () => { mouse.down = false; });
document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; mouse.down = false; });
addEventListener('blur', () => { mouse.down = false; });

// touch screens (the page in a phone or tablet browser): a finger works like a held mouse button
const touchAt = e => toWorld(e.touches[0] || e.changedTouches[0]);
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const [x, y] = touchAt(e);
  mouse.x = mouse.px = x; mouse.y = mouse.py = y; mouse.has = true; mouse.inside = true; mouse.down = true; mouse.lastMove = time;
  mouse.downAt = time; mouse.downX = x; mouse.downY = y; mouse.dragged = false;
  splash(x, y, 1);
  addStroke(x, y, x, y, 0.006);
  if (S.sound) audioStart();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  [mouse.x, mouse.y] = touchAt(e);
  mouse.lastMove = time;
}, { passive: false });
canvas.addEventListener('touchend', e => { e.preventDefault(); mouse.down = false; mouse.inside = false; }, { passive: false });

function splash(x, y, power) {
  addDrop(x, y, x, y, 0.028, -1.6 * S.ripple * power);
  for (const f of fish) {
    const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy) + 1e-4;
    if (d < 0.42) {
      const k = 1 - d / 0.42;
      f.fear = Math.max(f.fear, 0.4 + 0.6 * k);
      f.vx += dx / d * 0.35 * k; f.vy += dy / d * 0.35 * k;
    }
  }
  for (const k of sharks) {
    const dx = k.x - x, dy = k.y - y, d = Math.hypot(dx, dy) + 1e-4;
    if (d < 0.4) { k.shy = 1; k.vx += dx / d * 0.08; k.vy += dy / d * 0.08; }
  }
  for (const r of rays) {
    if (r.away > 0) continue;
    const dx = r.x - x, dy = r.y - y, d = Math.hypot(dx, dy) + 1e-4;
    if (d < 0.4) { r.fear = 1; r.vx += dx / d * 0.05; r.vy += dy / d * 0.05; }
  }
  for (const j of jellies) {
    const dx = j.x - x, dy = j.y - y, d = Math.hypot(dx, dy) + 1e-4;
    if (d < 0.3) { const k = 1 - d / 0.3; j.vx += dx / d * 0.06 * k; j.vy += dy / d * 0.06 * k; }
  }
  for (const c of crabs) if (Math.hypot(c.x - x, c.y - y) < 0.15) c.hideT = rand(3, 6);
  startleReef(x, y);
  for (const h of hatchlings) if (Math.hypot(h.x - x, h.y - y) < 0.12) h.freeze = rand(1, 2);
  let startled = null, sd = 0.3;
  for (const d of dolphins) {
    if (d.leap) continue;
    const dx = d.x - x, dy = d.y - y, dd = Math.hypot(dx, dy) + 1e-4;
    if (dd < 0.4) { d.fear = 1; d.vx += dx / dd * 0.12; d.vy += dy / dd * 0.12; }
    if (dd < sd && depthAt(d.x, d.y) > 0.3) { sd = dd; startled = d; }
  }
  if (startled && time - lastLeap > 4) startLeap(startled);
  if (S.sound && audio.ctx && depthAt(x, y) > 0) plop();
  for (const f of floats) {
    const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy) + 1e-4;
    if (d < 0.25) { const k = 1 - d / 0.25; f.vx += dx / d * 0.09 * k; f.vy += dy / d * 0.09 * k; f.va += rand(-1, 1) * k; }
  }
}

function updateInput(dt) {
  if (!mouse.has) return;
  const dx = mouse.x - mouse.px, dy = mouse.y - mouse.py, dist = Math.hypot(dx, dy);
  if (dist > 0.2) {
    // a jump, not a swipe (e.g. the cursor came back from another window)
    mouse.vx = mouse.vy = mouse.speed = 0;
    mouse.px = mouse.x; mouse.py = mouse.y;
    return;
  }
  if (dt <= 0) return;                       // a test frame that does not move the clock
  const k = 1 - Math.exp(-dt * 12);
  mouse.vx += (dx / dt - mouse.vx) * k;
  mouse.vy += (dy / dt - mouse.vy) * k;
  mouse.speed = Math.hypot(mouse.vx, mouse.vy);
  if (mouse.inside && dist > 0.0004) {
    const s = Math.min(dist * 8, 0.22) * S.ripple * (mouse.down ? 2.2 : 1);
    addDrop(mouse.px, mouse.py, mouse.x, mouse.y, mouse.down ? 0.022 : 0.015, -s);
    if (mouse.down) addStroke(mouse.px, mouse.py, mouse.x, mouse.y, 0.0045);
  }
  mouse.px = mouse.x; mouse.py = mouse.y;

  // holding still on the water sprinkles fish food; moving away turns it back into a drag
  if (mouse.down && Math.hypot(mouse.x - mouse.downX, mouse.y - mouse.downY) > 0.02) mouse.dragged = true;
  const feeding = S.feed && mouse.down && !mouse.dragged && time - mouse.downAt > 0.35 && depthAt(mouse.x, mouse.y) > 0.03;
  if (feeding && !mouse.feeding) {
    // the splash from pressing scared them; food is worth coming back for
    for (const f of fish) if (Math.hypot(f.x - mouse.x, f.y - mouse.y) < 0.7) f.fear = Math.min(f.fear, 0.1);
  }
  mouse.feeding = feeding;
  if (feeding) {
    feedAcc += dt;
    while (feedAcc > 0.11) { feedAcc -= 0.11; dropFood(mouse.x, mouse.y); }
  } else feedAcc = 0;
}


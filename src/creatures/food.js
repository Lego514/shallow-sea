// ---------------------------------------------------------------- fish food
let pellets = [];
let feedAcc = 0;
function dropFood(x, y) {
  if (pellets.length >= MAX_PELLETS) return;
  const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 0.018;
  const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
  const t = Math.random();
  pellets.push({ x: px, y: py, depth: 0, float: rand(0.6, 1.6), sink: rand(0.06, 0.1), rest: 0, len: rand(0.0075, 0.0095),
                 ang: rand(0, TAU), vx: 0, vy: 0, col: t < 0.6 ? [0.64, 0.42, 0.20] : t < 0.85 ? [0.72, 0.34, 0.18] : [0.80, 0.62, 0.30] });
  addDrop(px, py, px, py, 0.006, -0.05 * S.ripple);
  if (S.sound && audio.ctx && audio.ctx.state === 'running' && Math.random() < 0.35)
    hiss(audio.ctx.currentTime + Math.random() * 0.05, 'highpass', 3600, 0.7, 0.005, 0.08, 0.03);
}
function updatePellets(dt) {
  const cur = world.current;
  for (const p of pellets) {
    if (p.float > 0) {
      // floats a moment, drifting with the water, then soaks up and sinks
      p.float -= dt;
      p.vx += (cur[0] * 0.8 - p.vx) * Math.min(1, dt * 0.5); p.vy += (cur[1] * 0.8 - p.vy) * Math.min(1, dt * 0.5);
    } else if (p.depth < 0.95) {
      p.depth = Math.min(0.95, p.depth + p.sink * dt);
      p.vx *= Math.exp(-dt * 0.8); p.vy *= Math.exp(-dt * 0.8);
      p.vx += Math.sin(time * 1.3 + p.ang) * 0.002 * dt;      // a slow wobble on the way down
    } else {
      p.rest += dt;                                            // on the seabed: left for a while, then gone
      p.vx = p.vy = 0;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ang += dt * 0.3;
  }
  pellets = pellets.filter(p => !p.eaten && p.rest < 25);
}


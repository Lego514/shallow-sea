// ---------------------------------------------------------------- behaviour
function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

function steerHeading(f, dt, maxTurn) {
  const sp = Math.hypot(f.vx, f.vy);
  if (sp > 1e-4) {
    const da = wrapAngle(Math.atan2(f.vy, f.vx) - f.ang);
    const step = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, da));
    f.ang = wrapAngle(f.ang + step);
    if (dt > 0) f.angVel += (step / dt - f.angVel) * Math.min(1, dt * 8);
  }
  return sp;
}

function updateFish(dt) {
  const idle = mouse.inside && time - mouse.lastMove > 2.5;
  const fastMouse = mouse.inside && mouse.speed > 0.3;
  for (const f of fish) {
    let ax = 0, ay = 0, calm = false;
    if (f.kind === 0) {
      let n = 0, cx = 0, cy = 0, avx = 0, avy = 0, sx = 0, sy = 0;
      for (const g of fish) {
        if (g === f || g.kind !== 0) continue;
        const dx = g.x - f.x, dy = g.y - f.y, d2 = dx * dx + dy * dy;
        if (d2 > 0.0225) continue;
        n++; cx += dx; cy += dy; avx += g.vx; avy += g.vy;
        const sd = f.len * 1.7;
        if (d2 < sd * sd) { const d = Math.sqrt(d2) + 1e-5, k = (sd - d) / sd; sx -= dx / d * k; sy -= dy / d * k; }
      }
      if (n) {
        ax += cx / n * 0.9 + (avx / n - f.vx) * 1.1;
        ay += cy / n * 0.9 + (avy / n - f.vy) * 1.1;
      }
      ax += sx * 0.9; ay += sy * 0.9;
    } else {
      for (const g of fish) {
        if (g === f) continue;
        const dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy) + 1e-5, sd = (f.len + g.len) * 0.8;
        if (d < sd) { ax -= dx / d * (sd - d) * 3; ay -= dy / d * (sd - d) * 3; }
      }
    }
    // wander
    f.wander += rand(-1, 1) * dt * 3;
    const hx = Math.cos(f.ang), hy = Math.sin(f.ang);
    const wn = Math.sin(f.wander) * (f.kind === 0 ? 0.05 : 0.035);
    ax += -hy * wn; ay += hx * wn;
    // stay roughly on screen
    const m = 0.06;
    if (f.x < m) ax += (m - f.x) * 3; else if (f.x > aspect - m) ax -= (f.x - aspect + m) * 3;
    if (f.y < m) ay += (m - f.y) * 3; else if (f.y > 1 - m) ay -= (f.y - 1 + m) * 3;
    // and out of water too shallow to swim in
    const minD = f.kind === 0 ? 0.1 : 0.2, look = 0.05 + f.len;
    const dLow = Math.min(depthAt(f.x + Math.cos(f.ang) * look, f.y + Math.sin(f.ang) * look), depthAt(f.x, f.y));
    if (dLow < minD) {
      const [gx, gy] = deeperDir(f.x, f.y), k = 0.4 + (minD - dLow) * 8;
      ax += gx * k; ay += gy * k;
    }
    // the cursor: dart away from quick movements, drift closer to a still one
    if (mouse.inside) {
      const dx = f.x - mouse.x, dy = f.y - mouse.y, d = Math.hypot(dx, dy) + 1e-4;
      const R = f.kind === 0 ? 0.2 : 0.24;
      if (fastMouse && d < R) {
        const k = 1 - d / R;
        ax += dx / d * 2.2 * k; ay += dy / d * 2.2 * k;
        f.fear = Math.max(f.fear, k);
      } else if (idle && f.curious && f.fear < 0.05 && d < 0.6) {
        const ring = f.kind === 0 ? 0.07 : 0.12;
        const pull = Math.max(-0.2, Math.min(0.3, (d - ring) * 1.4));
        ax += -dx / d * pull - dy / d * 0.04;
        ay += -dy / d * pull + dx / d * 0.04;
        calm = d < ring * 2.5;
      }
    }
    // fish keep well clear of a cruising shark, and bolt when it comes close
    for (const k of sharks) {
      const dx = f.x - k.x, dy = f.y - k.y, dd = Math.hypot(dx, dy) + 1e-4;
      if (dd < 0.3) { const kk = 1 - dd / 0.3; ax += dx / dd * 1.6 * kk; ay += dy / dd * 1.6 * kk; f.fear = Math.max(f.fear, 0.7 * kk); }
    }
    // dolphins hunt fish: the school scatters when one comes close
    for (const d of dolphins) {
      const dx = f.x - d.x, dy = f.y - d.y, dd = Math.hypot(dx, dy) + 1e-4;
      if (dd < 0.25) { const k = 1 - dd / 0.25; ax += dx / dd * 1.4 * k; ay += dy / dd * 1.4 * k; f.fear = Math.max(f.fear, 0.6 * k); }
    }
    // food in the water: dart to the nearest crumb and snap it up
    let chase = false;
    if (f.chew > 0) f.chew -= dt;
    if (f.fullT > 0) { f.fullT -= dt; if (f.fullT <= 0) f.appetite = rand(3, 7); }
    if (f.appetite === undefined) f.appetite = rand(3, 7);
    if (pellets.length && f.fear < 0.3 && !(f.chew > 0) && !(f.fullT > 0)) {
      let best = null, bd = f.kind === 0 ? 0.45 : 0.6;
      for (const p of pellets) {
        if (p.eaten) continue;
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        const dx = best.x - f.x, dy = best.y - f.y, d = bd + 1e-5;
        const want = f.cruise * (f.kind === 0 ? 3 : 2.2);
        ax += (dx / d * want - f.vx) * 3; ay += (dy / d * want - f.vy) * 3;
        chase = true;
        if (d < f.len * 0.5) {
          best.eaten = true;
          if (best.depth < 0.25) addDrop(best.x, best.y, best.x, best.y, 0.007, -0.06 * S.ripple);
          f.chew = rand(0.6, 1.4);                              // a moment to swallow
          if (--f.appetite <= 0) f.fullT = rand(25, 45);       // had enough for now
        }
      }
    }
    f.vx += ax * dt; f.vy += ay * dt;
    let sp = Math.hypot(f.vx, f.vy) + 1e-6;
    const target = f.cruise * (1 + 3.5 * f.fear) * (calm ? 0.55 : 1) * (chase ? 2.4 : 1);
    const ns = sp + (target - sp) * Math.min(1, dt * (f.fear > 0.1 ? 3 : 0.9));
    f.vx *= ns / sp; f.vy *= ns / sp;
    f.x += f.vx * dt; f.y += f.vy * dt;
    sp = steerHeading(f, dt, 3.2 + 6 * f.fear);
    f.bend += (Math.max(-0.9, Math.min(0.9, f.angVel * 0.22)) - f.bend) * Math.min(1, dt * 10);
    f.phase += dt * (6 + 7 * sp / f.len);
    f.fear = Math.max(0, f.fear - dt * 0.5);
    if (sp > 0.2 && Math.random() < dt * 5) addDrop(f.x, f.y, f.x, f.y, 0.009, -0.05 * S.ripple);
  }

  for (const r of rays) updateRay(r, dt);
}

function updateRay(r, dt) {
  const k = RAY_KINDS[r.kind];
  if (r.away > 0) {
    r.away -= dt;
    if (r.away <= 0) {
      [r.x, r.y] = offscreenSeaPoint(k.minD, 0.35);
      [r.tx, r.ty] = randomWaterPoint(k.minD + 0.1, k.maxD);
      if (r.kind === 9) pickTurtle(r);               // whoever swims in next may be a different turtle
    }
    return;
  }
  if (r.kind === 2) {
    for (const p of pellets) {
      if (p.eaten || p.depth < 0.9) continue;
      const pd = Math.hypot(p.x - r.x, p.y - r.y);
      if (pd < 0.35) { r.tx = p.x; r.ty = p.y; }
      if (pd < r.len * 0.3) p.eaten = true;
    }
  }
  const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy) + 1e-4;
  const cruise = k.cruise * (1 + 2.5 * r.fear);
  let ax = (dx / d * cruise - r.vx) * 0.35, ay = (dy / d * cruise - r.vy) * 0.35;
  const onScreen = r.x > 0 && r.x < aspect && r.y > 0 && r.y < 1;
  if (onScreen && depthAt(r.x + Math.cos(r.ang) * 0.15, r.y + Math.sin(r.ang) * 0.15) < k.minD) {
    const [gx, gy] = deeperDir(r.x, r.y);
    ax += gx * 0.06; ay += gy * 0.06;
  }
  r.vx += ax * dt; r.vy += ay * dt;
  r.x += r.vx * dt; r.y += r.vy * dt;
  const sp = Math.hypot(r.vx, r.vy);
  const da = wrapAngle(Math.atan2(r.vy, r.vx) - r.ang);
  r.ang = wrapAngle(r.ang + Math.max(-0.6 * dt, Math.min(0.6 * dt, da)));
  // the stingray ripples the edge of its disc; the others beat their wings, faster when startled
  r.phase += k.beat ? dt * TAU / k.beat * (1 + 1.5 * r.fear) : dt * (2.0 + sp * 30);
  r.fear = Math.max(0, r.fear - dt * 0.3);
  if (r.kind === 9) {
    // the turtle comes up to breathe every so often, ringing the surface as it does
    r.breathT = (r.breathT ?? rand(8, 20)) - dt;
    if (r.breathT <= 0) { r.surfacing = 7; r.breathT = rand(30, 60); }
    if (r.surfacing > 0) {
      r.surfacing -= dt;
      if (r.depth < 0.15 && Math.random() < dt * 1.2) {
        const hx = r.x + Math.cos(r.ang) * r.len * 0.55, hy = r.y + Math.sin(r.ang) * r.len * 0.55;
        addDrop(hx, hy, hx, hy, 0.012, -0.14 * S.ripple);
      }
    }
    r.depth = (r.depth ?? k.depth) + ((r.surfacing > 0 ? 0.08 : k.depth) - (r.depth ?? k.depth)) * Math.min(1, dt * 0.6);
  }
  if (d < 0.06) {
    const offscreen = r.x < -0.3 || r.x > aspect + 0.3 || r.y < -0.3 || r.y > 1.3;
    if (offscreen) r.away = r.kind === 9 ? rand(20, 60) : rand(5, 15);
    else if (Math.random() < 0.2) [r.tx, r.ty] = offscreenSeaPoint(k.minD, 0.45);
    else [r.tx, r.ty] = randomWaterPoint(k.minD + 0.1, k.maxD);
  }
}

function updateCrabs(dt) {
  for (const c of crabs) {
    if (mouse.inside && Math.hypot(c.x - mouse.x, c.y - mouse.y) < 0.07 && (mouse.speed > 0.05 || mouse.down)) c.hideT = rand(3, 6);
    if (c.hideT > 0) { c.hideT -= dt; c.walking = false; }
    c.hide += ((c.hideT > 0 ? 1 : 0) - c.hide) * Math.min(1, dt * 6);
    c.timer -= dt;
    if (c.timer <= 0 && c.hideT <= 0) {
      c.walking = !c.walking;
      c.timer = c.walking ? rand(1, 3) : rand(1.5, 5);
      if (c.walking) c.ang += rand(-1.5, 1.5);
    }
    if (!c.walking) continue;
    const ax = c.x + Math.cos(c.ang) * 0.03, ay = c.y + Math.sin(c.ang) * 0.03;
    if (depthAt(ax, ay) > -0.035 || ax < 0.02 || ax > aspect - 0.02 || ay < 0.02 || ay > 0.98) { c.ang += Math.PI * rand(0.6, 1.0); continue; }
    c.x += Math.cos(c.ang) * 0.013 * dt; c.y += Math.sin(c.ang) * 0.013 * dt;
    c.phase += dt * 14;
    // little footprints, which the next big wave smooths away
    c.step += dt;
    if (c.step > 0.11) {
      c.step = 0; c.side = -c.side;
      const px = c.x - Math.cos(c.ang) * c.len * 0.1 - Math.sin(c.ang) * c.side * c.len * 0.38;
      const py = c.y - Math.sin(c.ang) * c.len * 0.1 + Math.cos(c.ang) * c.side * c.len * 0.38;
      addPrint(px, py, 0.0016, 0.45);
    }
  }
}


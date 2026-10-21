// ---------------------------------------------------------------- render targets
let W = 0, H = 0, aspect = 16 / 9;
// Building the seabed is the slow part of starting up. Lively sends every saved setting one by one right
// after the page loads, and several of them would rebuild it, so requests are gathered and served once.
const startedAt = performance.now();
let floorDirty = true, floorDueAt = 0, floorReady = false, floorBuilds = 0;
function requestFloor() {
  floorDirty = true;
  const booting = performance.now() - startedAt < 4000;
  floorDueAt = performance.now() + (booting ? 250 : 0);
}
let floorT, coastT, shadowT, deepT, fishT, floatT, simA, simB, sandA, sandB, simW = 0, simH = 0;

function resize(force) {
  const q = QUALITY[S.quality] || QUALITY[0];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(16, Math.round(innerWidth * dpr * q.scale));
  const h = Math.max(16, Math.round(innerHeight * dpr * q.scale));
  if (!force && w === W && h === H) return;
  W = w; H = h; aspect = W / H;
  canvas.width = W; canvas.height = H;
  for (const t of [floorT, coastT, shadowT, deepT, fishT, floatT, simA, simB, sandA, sandB]) freeTarget(t);
  floorT = rgba16f(W, H);
  coastT = rgba16f(Math.ceil(W / 2), Math.ceil(H / 2));
  sandA = rgba8(Math.ceil(W / 2), Math.ceil(H / 2));
  sandB = rgba8(Math.ceil(W / 2), Math.ceil(H / 2));
  shadowT = rgba8(Math.ceil(W / 2), Math.ceil(H / 2));
  deepT = rgba8(W, H);
  fishT = rgba8(W, H);
  floatT = rgba8(W, H);
  simH = q.sim; simW = Math.round(simH * aspect);
  simA = rgba16f(simW, simH);
  simB = rgba16f(simW, simH);
  floorReady = false;
  requestFloor();
}

function renderFloor() {
  floorDirty = false;
  floorReady = true;
  floorBuilds++;
  // the seabed's passes, handing on their work in float32 targets that are only needed while it is built
  const tA = makeTarget(W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
  const tB = makeTarget(W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
  const tC = makeTarget(W, H, gl.RG32F, gl.RG, gl.FLOAT, gl.NEAREST);
  const tD = makeTarget(W, H, gl.RG32F, gl.RG, gl.FLOAT, gl.NEAREST);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  const s = world.s;
  const pass = (P, inputs, target, out = 0, dir = [0, 0]) => {
    const u = P.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.useProgram(P.p);
    gl.uniform1f(u.u_aspect, aspect);
    gl.uniform1f(u.u_px, 1 / H);
    gl.uniform2f(u.u_s0, s[0], s[1]);
    gl.uniform2f(u.u_s1, s[2], s[3]);
    gl.uniform2f(u.u_s2, s[4], s[5]);
    gl.uniform2f(u.u_s3, s[6], s[7]);
    gl.uniform1f(u.u_ang, world.ang);
    gl.uniform2f(u.u_slope, world.slope[0], world.slope[1]);
    gl.uniform3fv(u.u_shore, shoreParams());
    gl.uniform1f(u.u_coral, S.corals ? 1 : 0);
    gl.uniform1i(u.u_out, out);
    gl.uniform2f(u.u_dir, dir[0], dir[1]);
    Object.entries(inputs).forEach(([name, t], i) => { bindTex(i, t.tex); gl.uniform1i(u[name], i); });
    drawTri();
  };
  // the relief: here, a pixel and a half to the right, and as far above, one channel each
  [[0, 0], [1, 0], [0, 1]].forEach((dir, i) => {
    gl.colorMask(i === 0, i === 1, i === 2, false);
    pass(floorHeightP, {}, tA, 0, dir);
  });
  gl.colorMask(true, true, true, true);
  pass(floorBaseP, { u_relief: tA }, tB);
  pass(floorRocksP, { u_prev: tB }, tA, 0);
  pass(floorRocksP, { u_prev: tB }, tC, 1);
  pass(floorReefP, { u_prev: tA, u_aux: tC }, tB, 0);
  pass(floorReefP, { u_prev: tA, u_aux: tC }, tD, 1);
  pass(floorGardenP, { u_prev: tB, u_aux: tD }, floorT, 1);
  pass(floorGardenP, { u_prev: tB, u_aux: tD }, tA, 0);
  gl.colorMask(true, true, true, false);   // keep the depth the garden pass wrote
  pass(floorDetailP, { u_prev: tA }, floorT);
  gl.colorMask(true, true, true, true);
  for (const t of [tA, tB, tC, tD]) freeTarget(t);

  gl.bindFramebuffer(gl.FRAMEBUFFER, coastT.fbo);
  gl.viewport(0, 0, coastT.w, coastT.h);
  gl.useProgram(coastP.p);
  gl.uniform1f(coastP.u.u_aspect, aspect);
  gl.uniform2f(coastP.u.u_s1, s[2], s[3]);
  gl.uniform2f(coastP.u.u_s3, s[6], s[7]);
  gl.uniform3fv(coastP.u.u_shore, shoreParams());
  drawTri();
  buildWavePhase();
  readDepthMap();
  relocateCreatures();
}

// the wind waves' phase across the shallows (see waveHere in the composite shader): for each wave, against the
// distance from the shore (denser near it) and the angle around the coast's centre, ∫ k_n ds from the outer edge of
// the shallows in. Must follow the shader's waveDepth and dispersion exactly
const WAVE_G = 6.1, WAVE_S1 = 1.0, WAVE_HS = 0.05, WP_NS = 64, WP_NT = 32;
const waveDepth = s => Math.max((s * 1.1 + Math.max(s - 0.28, 0) * 1.5 + Math.max(s - 0.75, 0) * 0.9) * WAVE_HS, 0.002);
let wavePhaseT = null, waveCoast = [1, 0, 0, 1];
function buildWavePhase() {
  if (!wavePhaseT) {
    wavePhaseT = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, wavePhaseT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  const data = new Float32Array(WP_NS * WP_NT * NW);
  const [cx, cy, R] = shoreParams();
  if (R > 0) {
    const rx = 0.5 * aspect - cx, ry = 0.5 - cy, rl = Math.hypot(rx, ry), ex = rx / rl, ey = ry / rl;
    let t0 = Infinity, t1 = -Infinity;
    for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
      const dx = fx * aspect - cx, dy = fy - cy, t = Math.atan2(ex * dy - ey * dx, ex * dx + ey * dy);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const pad = (t1 - t0) * 0.05 + 1e-4;
    t0 -= pad; t1 += pad;
    waveCoast = [ex, ey, t0, t1];
    const r1 = R + WAVE_S1, sAt = m => WAVE_S1 * (m / (WP_NS - 1)) ** 2;
    world.waves.forEach((w, i) => {
      const om2 = WAVE_G * w.k;
      for (let j = 0; j < WP_NT; j++) {
        const t = t0 + (t1 - t0) * j / (WP_NT - 1), c = Math.cos(t), sn = Math.sin(t);
        const nx = ex * c - ey * sn, ny = ex * sn + ey * c, kt1 = -w.kx * ny + w.ky * nx;
        const row = (i * WP_NT + j) * WP_NS;
        let acc = 0;
        for (let m = WP_NS - 1; m > 0; m--) {
          const sa = sAt(m), sb = sAt(m - 1);
          for (let q = 0; q < 6; q++) {
            const sm = sa + (sb - sa) * (q + 0.5) / 6, h = waveDepth(sm);
            const kl = Math.min(om2 / (WAVE_G * Math.sqrt(Math.tanh(om2 * h / WAVE_G))), 3 * w.k), kt = kt1 * r1 / (R + sm);
            acc += Math.sqrt(Math.max(kl * kl - kt * kt, 0)) * (sa - sb) / 6;
          }
          data[row + m - 1] = acc;
        }
      }
    });
  }
  gl.bindTexture(gl.TEXTURE_2D, wavePhaseT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, WP_NS, WP_NT * NW, 0, gl.RED, gl.FLOAT, data);
}

// where the beach is: centre and radius of the coastline circle (a huge circle is a straight beach)
function shoreParams() {
  const A = aspect;
  switch (S.shore) {
    case 0: return [-0.06, 1.06, 0.55];     // top-left corner
    case 1: return [A / 2, 41, 40.22];      // along the top
    case 2: return [A + 0.06, 1.06, 0.55];  // top-right corner
    case 3: return [-40, 0.5, 40.26];       // along the left
    case 4: return [A + 40, 0.5, 40.26];    // along the right
    case 5: return [A / 2, -40, 40.22];     // along the bottom
    default: return [0, 0, -1];             // open water
  }
}

// a small CPU copy of the depth map so fish keep off the sand, and of the seabed's colours
let depthMap = null, floorCol = null, dmW = 0, dmH = 0;
function readDepthMap() {
  dmW = 160; dmH = Math.max(2, Math.round(dmW / aspect));
  const small = rgba16f(dmW, dmH);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, floorT.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, small.fbo);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, dmW, dmH, gl.COLOR_BUFFER_BIT, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, small.fbo);
  const px = new Float32Array(dmW * dmH * 4);
  gl.readPixels(0, 0, dmW, dmH, gl.RGBA, gl.FLOAT, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  freeTarget(small);
  depthMap = new Float32Array(dmW * dmH);
  for (let i = 0; i < depthMap.length; i++) depthMap[i] = px[i * 4 + 3];
  floorCol = px;
}
// how busy the seabed looks around (x, y): the spread of its colours, low on plain sand or rock, high among corals
function seabedBusy(x, y) {
  if (!floorCol) return 0;
  const cx = Math.round(x / aspect * dmW), cy = Math.round(y * dmH);
  let n = 0;
  const s = [0, 0, 0], s2 = [0, 0, 0];
  for (let j = cy - 3; j <= cy + 3; j++) for (let i = cx - 3; i <= cx + 3; i++) {
    if (i < 0 || j < 0 || i >= dmW || j >= dmH) continue;
    for (let c = 0; c < 3; c++) { const v = floorCol[(j * dmW + i) * 4 + c]; s[c] += v; s2[c] += v * v; }
    n++;
  }
  return n ? Math.sqrt([0, 1, 2].reduce((a, c) => a + s2[c] / n - (s[c] / n) ** 2, 0)) : 0;
}
function depthAt(x, y) {
  if (!depthMap) return 1;
  return rawDepthAt(x, y) + tideNow * 1.1;
}
function rawDepthAt(x, y) {
  const fx = Math.min(dmW - 1, Math.max(0, x / aspect * dmW - 0.5)), fy = Math.min(dmH - 1, Math.max(0, y * dmH - 0.5));
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const ix1 = Math.min(dmW - 1, ix + 1), iy1 = Math.min(dmH - 1, iy + 1);
  const m = depthMap;
  return (m[iy * dmW + ix] * (1 - tx) + m[iy * dmW + ix1] * tx) * (1 - ty) + (m[iy1 * dmW + ix] * (1 - tx) + m[iy1 * dmW + ix1] * tx) * ty;
}
function deeperDir(x, y) {
  const e = 0.02;
  const gx = depthAt(x + e, y) - depthAt(x - e, y), gy = depthAt(x, y + e) - depthAt(x, y - e);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}
function randomWaterPoint(minD, maxD = 99) {
  for (let i = 0; i < 80; i++) {
    const x = rand(0.04, aspect - 0.04), y = rand(0.04, 0.96), d = depthAt(x, y);
    if (d > minD && d < maxD) return [x, y];
  }
  for (let i = 0; i < 60; i++) {
    const x = rand(0.04, aspect - 0.04), y = rand(0.04, 0.96);
    if (depthAt(x, y) > minD) return [x, y];
  }
  return [aspect * 0.75, 0.3];
}
// a point just off-screen where the sea carries on, for creatures coming and going
function offscreenSeaPoint(minD, out) {
  for (let i = 0; i < 60; i++) {
    const side = Math.floor(rand(0, 4)), t = rand(0.08, 0.92);
    const ix = side === 0 ? 0.02 : side === 1 ? aspect - 0.02 : t * aspect;
    const iy = side === 2 ? 0.02 : side === 3 ? 0.98 : t;
    if (depthAt(ix, iy) > minD) {
      return side === 0 ? [-out, iy] : side === 1 ? [aspect + out, iy] : side === 2 ? [ix, -out] : [ix, 1 + out];
    }
  }
  return [aspect + out, 0.3];
}
// the moon's reflection lies out over the deepest water and its path runs seaward, away from the beach
let moonA = [0.8, 0.5], moonDir = [1, 0];
function placeMoonPath() {
  let sx = 0, sy = 0, sn = 0, dx = 0, dy = 0, dw = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 15; j++) {
    const x = (i + 0.5) / 24 * aspect, y = (j + 0.5) / 15, d = depthAt(x, y);
    if (d > 0) { const w = d * d; dx += x * w; dy += y * w; dw += w; } else { sx += x; sy += y; sn++; }
  }
  const cx = dw ? dx / dw : aspect / 2, cy = dw ? dy / dw : 0.5;
  let [vx, vy] = sn ? [cx - sx / sn, cy - sy / sn] : deeperDir(cx, cy);
  const l = Math.hypot(vx, vy) || 1;
  moonA = [cx, cy]; moonDir = [vx / l, vy / l];
}
function relocateCreatures() {
  placeMoonPath();
  for (const f of fish) {
    if (depthAt(f.x, f.y) < (f.kind === 0 ? 0.1 : 0.2)) [f.x, f.y] = randomWaterPoint(0.3);
  }
  for (const f of floats) if (depthAt(f.x, f.y) < 0.05) [f.x, f.y] = randomWaterPoint(0.2);
  for (const r of rays) {
    const k = RAY_KINDS[r.kind];
    if (r.away <= 0 && depthAt(r.x, r.y) < k.minD * 0.7) [r.x, r.y] = randomWaterPoint(k.minD + 0.1);
    if (depthAt(r.tx, r.ty) < k.minD) [r.tx, r.ty] = randomWaterPoint(k.minD + 0.1, k.maxD);
  }
  for (const j of jellies) if (depthAt(j.x, j.y) < 0.3) [j.x, j.y] = randomWaterPoint(0.45);
  crabs = crabs.filter(c => { const d = depthAt(c.x, c.y); return d < -0.03 && d > -0.6; });
  hatchlings = hatchlings.filter(h => h.swim || depthAt(h.x, h.y) < 0.02);
  if (nest && depthAt(nest.x, nest.y) > -0.05) nest = null;
  syncCrabs();
  placeReef();
}


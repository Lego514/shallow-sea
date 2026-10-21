// ---------------------------------------------------------------- frame
const waveData = new Float32Array(NW * 4);
const dropA = new Float32Array(MAX_DROPS * 4);
const dropB = new Float32Array(MAX_DROPS * 2);
let simAcc = 0;
let snapshotCb = null;
let cloudX = 0, cloudY = 0;
let last = performance.now(), lastDraw = 0, fpsT = 0, fpsN = 0, fpsShown = 0;

function packInstances() {
  let n = 0;
  let d = deepBatch.data;
  const put = (x, y, a, len, sp, ph, bend, depth, col, extra) => {
    const o = n++ * 12;
    d[o] = x; d[o + 1] = y; d[o + 2] = a; d[o + 3] = len;
    d[o + 4] = sp; d[o + 5] = ph; d[o + 6] = bend; d[o + 7] = depth;
    d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2]; d[o + 11] = extra;
  };
  for (const r of rays) if (r.kind === 2 && r.away <= 0) put(r.x, r.y, r.ang, r.len, 2, r.phase, 0, RAY_KINDS[2].depth, r.col, r.extra);
  // clownfish deep in their anemone go under its tentacles
  for (const c of clowns) if (c.hide > 0.5) put(c.x, c.y, c.ang, c.len, 1, c.phase, c.bend, 1, CLOWN_COL, 4);
  const down = Math.atan2(world.current[1], world.current[0]);
  for (const a of anemones) put(a.x, a.y, down, a.len, 17, a.phase, a.pull, 1, [0, 0, 0], a.look);
  const o = octopus;
  if (o && o.state !== 'jet') put(o.x, o.y, o.ang, o.len, 18, o.phase, o.spread, 1, [o.camo, o.flash, o.flat], o.seed);
  // ink hangs low over the seabed: drawn as part of it, it darkens the sand (in mid-water the water's own glow hid it)
  for (const k of inks) put(k.x, k.y, 0, k.len, 19, k.age, 0, 0.95, [0, 0, 0], k.seed);
  deepBatch.count = n;
  n = 0;
  d = fishBatch.data;
  for (const kind of [6, 9, 5]) for (const r of rays) if (r.kind === kind && r.away <= 0) put(r.x, r.y, r.ang, r.len, kind, r.phase, r.sp || 0, r.depth ?? RAY_KINDS[kind].depth, r.col, r.extra);
  for (const j of jellies) put(j.x, j.y, j.ang, j.len, j.kind, j.phase, 0, j.depth, [1, 1, 1], j.extra);
  // food still floating belongs to the surface layer (no water in front of it); once it sinks, to the fish layer
  for (const p of pellets) if (p.depth > 0) put(p.x, p.y, p.ang, p.len, 12, 0, 0, p.depth, p.col, 0);
  for (const d of dolphins) {
    const l = d.leap && d.leap.draw;
    if (l) put(d.x, d.y, d.ang, d.len * l.sc, 13, l.cut, l.fs, 0.05, d.col, l.mode + 2);   // what is still under water
    else put(d.x, d.y, d.ang, d.len, 13, d.phase, d.bend, d.depth, d.col, 0);
  }
  for (const k of sharks) put(k.x, k.y, k.ang, k.len, 16, k.phase, k.bend, k.depth, k.col, 0);
  for (const f of fish) if (f.kind === 1) put(f.x, f.y, f.ang, f.len, 1, f.phase, f.bend, f.depth, f.col, f.extra);
  for (const c of clowns) if (c.hide <= 0.5) put(c.x, c.y, c.ang, c.len, 1, c.phase, c.bend, 0.85 + 0.15 * c.hide, CLOWN_COL, 4);
  if (o && o.state === 'jet') put(o.x, o.y, o.ang, o.len, 18, o.phase, o.spread, 0.8, [o.camo, o.flash, o.flat], o.seed);
  for (const f of fish) if (f.kind === 0) put(f.x, f.y, f.ang, f.len, 0, f.phase, f.bend, f.depth, f.col, f.extra);
  fishBatch.count = n;

  const e = floatBatch.data;
  floats.forEach((f, i) => {
    const o = i * 12;
    e[o] = f.x; e[o + 1] = f.y; e[o + 2] = f.ang; e[o + 3] = f.len;
    e[o + 4] = f.kind; e[o + 5] = 0; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = f.col[0]; e[o + 9] = f.col[1]; e[o + 10] = f.col[2]; e[o + 11] = f.extra;
  });
  n = floats.length;
  d = floatBatch.data;
  for (const c of crabs) put(c.x, c.y, c.ang, c.len, 10, c.phase, c.hide, 1, c.col, c.extra);
  for (const h of hatchlings) put(h.x, h.y, h.ang, h.len * (0.6 + 0.4 * h.grow), 15, h.phase, h.swim ? 1 : 0, h.swim ? 0 : 1, h.col, h.grow);
  for (const p of pellets) if (p.depth === 0) put(p.x, p.y, p.ang, p.len, 12, 0, 0, 0, p.col, 0);
  for (const p of sprays) put(p.x, p.y, p.seed * TAU, p.r, 14, p.age, 0, 0, [p.seed, p.str, 0], 0);
  for (const d of dolphins) {
    const l = d.leap && d.leap.draw;
    if (l) put(d.x, d.y, d.ang, d.len * l.sc, 13, l.cut, l.fs, 0, d.col, l.mode);
    else if (d.depth < 0.06) {
      const roll = Math.max(-1, Math.min(1, (d.breath - 0.25) / 0.05));
      put(d.x, d.y, d.ang, d.len, 13, 0.16 - 0.24 * roll, d.bend, 0, d.col, Math.min(1, (0.06 - d.depth) / 0.04));
    }
  }
  floatBatch.count = n;
  n = 0;
  d = skyBatch.data;
  for (const g of gulls) put(g.x, g.y, g.ang, g.len, 11, g.phase, 0, 0, [0, 0, 0], 0);
  skyBatch.count = n;

  for (const b of [deepBatch, fishBatch, floatBatch, skyBatch]) {
    b.runs = [];
    for (let i = 0; i < b.count; i++) {
      const g = SPRITE_GROUP[b.data[i * 12 + 4] | 0] ?? 0, last = b.runs[b.runs.length - 1];
      if (last && last[2] === g) last[1]++;
      else b.runs.push([i, 1, g]);
    }
    if (!b.count) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data, 0, b.count * 12);
  }
}

function simulate(dt) {
  if (drops.length) {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      dropA.set([d[0], d[1], d[2], d[3]], i * 4);
      dropB.set([d[4], d[5]], i * 2);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
    gl.viewport(0, 0, simW, simH);
    gl.useProgram(dropP.p);
    bindTex(0, simA.tex);
    gl.uniform1i(dropP.u.u_state, 0);
    gl.uniform1f(dropP.u.u_aspect, aspect);
    gl.uniform4fv(dropP.u.u_dA, dropA);
    gl.uniform2fv(dropP.u.u_dB, dropB);
    gl.uniform1i(dropP.u.u_count, drops.length);
    drawTri();
    [simA, simB] = [simB, simA];
    drops.length = 0;
  }
  // ripples travel ~0.22 screen-heights per second whatever the grid size
  const stepsPerSec = 0.22 * simH / 0.7071;
  simAcc += dt * stepsPerSec;
  let n = Math.min(6, Math.floor(simAcc));
  simAcc -= Math.floor(simAcc);
  if (!n) return;
  gl.useProgram(stepP.p);
  gl.uniform1i(stepP.u.u_state, 0);
  gl.uniform2f(stepP.u.u_texel, 1 / simW, 1 / simH);
  gl.uniform1f(stepP.u.u_aspect, aspect);
  gl.uniform1f(stepP.u.u_damp, Math.pow(0.55, 1 / stepsPerSec));
  bindTex(1, floorT.tex);
  gl.uniform1i(stepP.u.u_floor, 1);
  gl.uniform1f(stepP.u.u_tide, tideNow);
  gl.viewport(0, 0, simW, simH);
  while (n--) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
    bindTex(0, simA.tex);
    drawTri();
    [simA, simB] = [simB, simA];
  }
}

function updateSand(dt) {
  if (S.shore >= 6) { strokes.length = 0; return; }
  strokes.forEach((d, i) => { dropA.set([d[0], d[1], d[2], d[3]], i * 4); dropB.set([d[4], d[5]], i * 2); });
  gl.bindFramebuffer(gl.FRAMEBUFFER, sandB.fbo);
  gl.viewport(0, 0, sandB.w, sandB.h);
  gl.useProgram(sandP.p);
  const u = sandP.u;
  bindTex(0, sandA.tex);
  bindTex(1, coastT.tex);
  gl.uniform1i(u.u_state, 0);
  gl.uniform1i(u.u_coast, 1);
  gl.uniform1f(u.u_aspect, aspect);
  gl.uniform1f(u.u_dt, dt);
  gl.uniform1f(u.u_tide, tideNow);
  gl.uniform1f(u.u_swashT, time % 36000);
  gl.uniform4fv(u.u_dA, dropA);
  gl.uniform2fv(u.u_dB, dropB);
  gl.uniform1i(u.u_count, strokes.length);
  drawTri();
  [sandA, sandB] = [sandB, sandA];
  strokes.length = 0;
}

// sim heights → world slopes; tuned so a click makes a bright caustic ring
const SIM_AMP = 0.0035;

// draw a batch run by run, each with its own program, pointing the instance attributes at the run's first instance
function drawBatch(b, shadow, only) {
  gl.bindVertexArray(b.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
  for (const [start, count, g] of b.runs) {
    if (only !== undefined && g !== only) continue;
    gl.useProgram(spriteP[g].p);
    gl.uniform1i(spriteP[g].u.u_shadow, shadow);
    for (let i = 0; i < 3; i++) gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, start * 48 + i * 16);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }
}

function renderSprites(L) {
  bindTex(0, floorT.tex);
  bindTex(1, simA.tex);
  for (const P of spriteP) {
    const u = P.u;
    gl.useProgram(P.p);
    gl.uniform1i(u.u_floor, 0);
    gl.uniform1i(u.u_sim, 1);
    gl.uniform1f(u.u_aspect, aspect);
    gl.uniform2f(u.u_sunShift, L.sunShift[0], L.sunShift[1]);
    gl.uniform2f(u.u_simTexel, 1 / simW, 1 / simH);
    gl.uniform1f(u.u_simScale, SIM_AMP * simH);
  }
  gl.enable(gl.BLEND);

  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowT.fbo);
  gl.viewport(0, 0, shadowT.w, shadowT.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.blendEquation(gl.MAX);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (const b of [deepBatch, fishBatch, floatBatch, skyBatch]) if (b.count) drawBatch(b, 1);
  if (L.bio > 0.01 && fishBatch.count) {
    // at night the jellyfish glow: their halo goes into the shadow map's green channel
    gl.colorMask(false, true, false, false);
    drawBatch(fishBatch, 2, SPRITE_GROUP[7]);
    gl.colorMask(true, true, true, true);
  }

  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const [t, b] of [[deepT, deepBatch], [fishT, fishBatch], [floatT, floatBatch]]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (b.count) drawBatch(b, 0);
  }
  gl.disable(gl.BLEND);
}

function composite(L, dt) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.useProgram(compP.p);
  const u = compP.u;
  bindTex(0, floorT.tex); gl.uniform1i(u.u_floor, 0);
  bindTex(1, simA.tex); gl.uniform1i(u.u_sim, 1);
  bindTex(2, shadowT.tex); gl.uniform1i(u.u_shadow, 2);
  bindTex(3, fishT.tex); gl.uniform1i(u.u_fish, 3);
  bindTex(4, floatT.tex); gl.uniform1i(u.u_float, 4);
  bindTex(5, deepT.tex); gl.uniform1i(u.u_deep, 5);
  bindTex(6, sandA.tex); gl.uniform1i(u.u_sand, 6);
  bindTex(7, coastT.tex); gl.uniform1i(u.u_coast, 7);
  bindTex(8, wavePhaseT); gl.uniform1i(u.u_wphase, 8);
  gl.uniform4fv(u.u_wcoast, waveCoast);
  gl.uniform1f(u.u_aspect, aspect);
  gl.uniform3fv(u.u_shore, shoreParams());
  gl.uniform1f(u.u_swashT, time % 36000);
  gl.uniform1f(u.u_time, time % 1000);
  gl.uniform2f(u.u_simTexel, 1 / simW, 1 / simH);
  gl.uniform1f(u.u_simScale, SIM_AMP * simH);
  gl.uniform1f(u.u_simHScale, SIM_AMP * simH * simH);

  const speed = 0.08 + S.speed * 0.55;
  world.waves.forEach((w, i) => {
    w.ph = (w.ph - w.omega * speed * dt) % TAU;
    waveData[i * 4] = w.kx; waveData[i * 4 + 1] = w.ky; waveData[i * 4 + 2] = w.amp; waveData[i * 4 + 3] = w.ph;
  });
  gl.uniform4fv(u.u_wave, waveData);
  gl.uniform1f(u.u_waveAmp, S.waves * 10);

  const sig = S.water.map(c => -Math.log(Math.max(0.02, Math.min(0.995, c))));
  gl.uniform3fv(u.u_sigma, sig);
  // the deep water takes on the colour of the light, except at golden hour, when it stays a deep blue
  const lf = [0, 1, 2].map(i => L.sunCol[i] * 0.55 + L.amb[i] * 1.6), lm = (lf[0] + lf[1] + lf[2]) / 3;
  gl.uniform3f(u.u_deepCol, ...[0, 1, 2].map(i => Math.pow(S.deep[i], 2.2) * lerp(lf[i], lm, 0.6 * L.warm) / 1.1));
  gl.uniform3fv(u.u_sunDir, L.sunDir);
  gl.uniform2f(u.u_sunShift, L.sunShift[0], L.sunShift[1]);
  gl.uniform1f(u.u_pathK, L.pathK);
  gl.uniform3fv(u.u_sunCol, L.sunCol);
  gl.uniform3fv(u.u_ambCol, L.amb);
  gl.uniform3fv(u.u_skyCol, L.sky);
  gl.uniform3f(u.u_bioCol, 0.18, 0.75, 1.0);
  gl.uniform3fv(u.u_glintH, L.glintH);
  gl.uniform1f(u.u_caustic, S.caustic);
  gl.uniform1f(u.u_glint, S.glint * L.glint);
  gl.uniform1f(u.u_refl, L.refl);
  gl.uniform1f(u.u_warm, L.warm);
  gl.uniform1f(u.u_bio, L.bio);
  gl.uniform1f(u.u_cloud, S.clouds);
  cloudX += world.cloudVel[0] * dt; cloudY += world.cloudVel[1] * dt;
  gl.uniform2f(u.u_cloudOff, cloudX, cloudY);
  gl.uniform1f(u.u_exposure, S.exposure);
  gl.uniform1i(u.u_view, S.view);
  gl.uniform1f(u.u_tide, tideNow);
  gl.uniform1f(u.u_moon, L.bio);
  gl.uniform2f(u.u_moonA, moonA[0], moonA[1]);
  gl.uniform2f(u.u_moonDir, moonDir[0], moonDir[1]);
  drawTri();
}


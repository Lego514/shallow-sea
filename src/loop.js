// ---------------------------------------------------------------- the frame loop
let stepping = false;               // test hook: the clock only moves when a frame is asked for (recording)
let paused = false;                 // Wallpaper Engine tells us when it pauses the wallpaper
const IDLE_AFTER = 45;              // seconds without the mouse before the wallpaper slows to 30 FPS

// whether the loop should draw at this timestamp: up to 60 FPS, or 30 when locked or idle
function wantsFrame(now) {
  if (stepping || paused) return false;
  const idle = S.idleSave && time - mouse.lastMove > IDLE_AFTER && !mouse.down;
  let cap = S.fpsLimit > 0 ? S.fpsLimit : MAX_FPS;         // or Wallpaper Engine's own frame-rate setting
  if (S.fps30 || idle) cap = Math.min(cap, 30);
  return now - lastDraw >= 1000 / cap - 3;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (floorDirty && now >= floorDueAt) renderFloor();
  if (!floorReady) { last = now; return; }        // nothing to show until the seabed exists
  if (!wantsFrame(now)) { if (stepping || paused) last = now; return; }
  lastDraw = now;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  step(dt);
}

function step(dt) {
  time += dt;

  updateTide();
  updateInput(dt);
  updateFish(dt);
  updateJellies(dt);
  updateCrabs(dt);
  updateHatchlings(dt);
  updatePellets(dt);
  updateGulls(dt);
  updateDolphins(dt);
  updateSharks(dt);
  waveSounds();
  updateFloats(dt);
  updateRain(dt);
  simulate(dt);
  updateSand(dt);
  const L = lighting();
  nightLevel = L.bio;
  packInstances();
  renderSprites(L);
  composite(L, dt);
  if (snapshotCb) { const cb = snapshotCb; snapshotCb = null; canvas.toBlob(cb, 'image/jpeg', 0.9); }

  if (DEBUG) {
    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { fpsShown = fpsN / fpsT; fpsN = 0; fpsT = 0; }
    statsEl.style.display = 'block';
    statsEl.textContent = `${fpsShown.toFixed(0)} fps · ${W}×${H} · sim ${simW}×${simH} · seed ${seed}`;
  }
}


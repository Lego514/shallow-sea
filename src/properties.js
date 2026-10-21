// ---------------------------------------------------------------- Lively Wallpaper properties
const bootAt = performance.now();
let seedInputTimer = 0;
const PROPS = {
  timeOfDay: v => { S.timeMode = v | 0; },
  waterColor: v => { S.water = hexToRgb(v); },
  deepColor: v => { S.deep = hexToRgb(v); },
  shore: v => { if ((v | 0) === S.shore) return; S.shore = v | 0; requestFloor(); },
  corals: v => { const on = v === true || v === 'true'; if (on === S.corals) return; S.corals = on; requestFloor(); },
  causticStrength: v => { S.caustic = v / 100; },
  waveStrength: v => { S.waves = v / 100; },
  waveSpeed: v => { S.speed = v / 100; },
  rippleStrength: v => { S.ripple = v / 100; },
  fishCount: v => { S.fish = v | 0; syncFish(); },
  bigFish: v => { S.bigFish = v === true || v === 'true'; syncFish(); },
  rays: v => { S.rays = v === true || v === 'true'; syncRays(); },
  jellyCount: v => { S.jellies = v | 0; syncJellies(); },
  floatCount: v => { S.floats = v | 0; syncFloats(); },
  rain: v => { S.rain = v / 100; },
  clouds: v => { S.clouds = v / 100; },
  quality: v => { if ((v | 0) === S.quality) return; S.quality = v | 0; resize(true); },
  fps30: v => { S.fps30 = v === true || v === 'true'; },
  idleSave: v => { S.idleSave = v === true || v === 'true'; },
  newSeabed: () => { if (performance.now() - bootAt > 3000) regenerate(); },
  showSeabed: () => { if (performance.now() - bootAt > 3000) showSeed(); },
  seabedNumber: v => {
    const use = () => {
      const m = /^\s*(\d{1,10})\s*$/.exec(String(v ?? ''));
      if (!m || (+m[1] | 0) === seed) return;
      seed = +m[1] | 0;
      makeWorld();
      requestFloor();
      if (performance.now() - bootAt > 3000) showSeed();
    };
    // a saved number arrives once at startup: use it straight away, before the first seabed is built;
    // later Lively sends every keypress, so wait until the typing stops
    clearTimeout(seedInputTimer);
    if (!floorReady) use(); else seedInputTimer = setTimeout(use, 700);
  },
  tide: v => { S.tide = v === true || v === 'true'; },
  turtle: v => { S.turtle = v === true || v === 'true'; syncRays(); },
  beachLife: v => { S.beachLife = v === true || v === 'true'; syncCrabs(); },
  hatchlings: v => { S.hatchlings = v === true || v === 'true'; if (!S.hatchlings) { hatchlings = []; nest = null; } },
  feedFish: v => { S.feed = v === true || v === 'true'; },
  dolphins: v => { S.dolphins = v === true || v === 'true'; if (!S.dolphins) dolphins = []; },
  sharks: v => { S.sharks = v === true || v === 'true'; if (!S.sharks) sharks = []; },
  anemones: v => { S.anemones = v === true || v === 'true'; syncReef(); },
  octopus: v => { S.octopus = v === true || v === 'true'; syncReef(); },
  sound: v => { S.sound = v === true || v === 'true'; if (S.sound) audioStart(); audioLevel(); },
  volume: v => { S.volume = v / 100 * 0.8; audioLevel(); },
};
window.livelyPropertyListener = (name, val) => {
  const f = PROPS[name];
  if (f) try { f(val); } catch (e) { console.error(e); }
};

// Wallpaper Engine: the same settings arrive here. Its keys are the names above in lower case (it allows only
// letters and digits), colours come as "r g b" from 0 to 1, and dropdown values as strings. It has no buttons,
// so "new seabed" and "show seabed number" are switches that act each time they are flipped.
const PROP_BY_KEY = Object.fromEntries(Object.keys(PROPS).map(k => [k.toLowerCase(), k]));
const RGB_FLOATS = /^\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*$/;
const toHex = v => '#' + String(v).trim().split(/\s+/).slice(0, 3)
  .map(c => Math.round(Math.min(1, Math.max(0, +c)) * 255).toString(16).padStart(2, '0')).join('');
window.wallpaperPropertyListener = {
  applyUserProperties(props) {
    for (const [key, p] of Object.entries(props || {})) {
      const name = PROP_BY_KEY[key.toLowerCase()];
      if (!name || !p || !('value' in p)) continue;
      const v = (p.type === 'color' || (name.endsWith('Color') && RGB_FLOATS.test(String(p.value)))) ? toHex(p.value) : p.value;
      window.livelyPropertyListener(name, v);
    }
  },
  applyGeneralProperties(props) {
    if (props && props.fps) S.fpsLimit = +props.fps.value || 0;
  },
  setPaused(isPaused) { paused = !!isPaused; },
};

// hooks for testing from the console
window.sea = { splash: (x, y) => splash(x * aspect, 1 - y, 1), regenerate, settings: S, get seed() { return seed; }, get rays() { return rays; }, get jellies() { return jellies; }, get crabs() { return crabs; }, get gulls() { return gulls; },
  spawnGulls: () => { gullTimer = 0; }, audio,
  setSeedWord: w => { seedWord = w; },
  depthAt: (x, y) => depthAt(x, y),
  // render one frame of exactly dt seconds right now, without waiting for the browser (works in a hidden tab)
  stepFrame: dt => { stepping = true; if (floorDirty) renderFloor(); step(dt); return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9)); },
  get floorBuilds() { return floorBuilds; },
  get paused() { return paused; },
  get pellets() { return pellets; },
  get dolphins() { return dolphins; },
  get sharks() { return sharks; },
  get anemones() { return anemones; },
  get clowns() { return clowns; },
  get octopus() { return octopus; },
  get inks() { return inks; },
  spawnSharks: () => { spawnSharks(); },
  spawnDolphins: () => { spawnPod(); },
  leapDolphin: i => { const d = dolphins[i ?? 1] || dolphins[0]; if (d && !d.leap) startLeap(d); return !!d; },
  get sprays() { return sprays; },
  get moonPath() { return { at: moonA, dir: moonDir }; },
  spawnNest: () => spawnNest(),
  get hatchlings() { return hatchlings; },
  get nest() { return nest; },
  resetAppetite: () => { for (const f of fish) { f.appetite = rand(3, 7); f.fullT = 0; f.chew = 0; } },
  stopStepping: () => { stepping = false; },
  // drive the real loop with a made-up timestamp; true if it drew (lets the frame-rate cap be tested in a hidden tab)
  driveFrame: now => { const t0 = time; frame(now); return time !== t0; }, get fish() { return fish; }, mouse,
  get time() { return time; }, set time(v) { time = v; },
  snapshot: () => new Promise(r => { snapshotCb = r; }) };

// a GPU reset (driver update, sleep/resume) loses every texture: start over cleanly
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => resize(false), 150); });

resize(true);
updateTide();
syncFish();
syncRays();
syncJellies();
syncFloats();
syncCrabs();
syncReef();
requestAnimationFrame(frame);

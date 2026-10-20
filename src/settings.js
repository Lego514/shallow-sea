// ---------------------------------------------------------------- settings
const S = {
  timeMode: 0,                 // 0 auto (system clock), 1 morning, 2 noon, 3 sunset, 4 night
  water: hexToRgb('#1f9ebd'),  // shallow water: transmittance through one screen-height of water
  deep: hexToRgb('#114a82'),   // what very deep water turns into
  shore: Q.has('shore') ? +Q.get('shore') : 0,   // index into shoreParams(); 6 = no beach
  caustic: 0.9,
  waves: 0.5,
  speed: 0.4,
  ripple: 0.6,
  fish: 26,
  bigFish: true,
  rays: true,
  jellies: 6,
  turtle: true,
  corals: true,                // coral reefs on the seabed
  beachLife: true,
  hatchlings: true,            // on some nights a nest of sea turtles hatches on the beach
  feed: true,                  // hold still on the water to sprinkle fish food
  dolphins: true,              // a pod passes through the deep water every few minutes
  sharks: true,                // a blacktip reef shark patrols the reef edge now and then
  tide: true,
  sound: false,
  volume: 0.48,
  floats: 4,
  rain: 0,
  clouds: 0.3,
  quality: 0,
  fps30: false,
  idleSave: true,              // drop to 30 FPS when nobody has touched the wallpaper for a while
  fpsLimit: 0,                 // Wallpaper Engine's frame-rate limit (0 = none)
  glint: 0.16,
  exposure: 0.85,
  view: +(Q.get('view') || 0),
};
const QUALITY = [
  { scale: 1.0, sim: 320 },
  { scale: 0.75, sim: 256 },
  { scale: 0.5, sim: 192 },
];
const MAX_FPS = 60;            // nothing here needs more, and a 240 Hz screen would otherwise get 240
if (Q.has('hour')) { S.timeMode = -1; }
if (Q.has('fish')) S.fish = +Q.get('fish');
if (Q.has('rain')) S.rain = +Q.get('rain');
if (Q.has('q')) S.quality = +Q.get('q');
// phones and small tablets: render at 75% to keep it smooth
else if (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820) S.quality = 1;

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) return [0.4, 0.8, 0.8];
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}


// Shallow Sea (淺海) — interactive tropical-shore wallpaper (WebGL2, Lively Wallpaper compatible)
//
// Built by tools/build.py from the files in src/: edit those, then run `python tools/build.py`.
//
// Layers, bottom to top:
//   seabed   procedural beach / sand / seagrass / rocks / pebbles / starfish, baked once into a texture
//            (rgb = albedo, a = water depth, negative on the beach); a second baked map holds the
//            coastline coordinate that drives the waves washing up the sand
//   sand     what you write on the beach, smoothed away whenever a wave runs over it
//   shadows  fish + floating flowers projected onto the seabed along the refracted sun ray
//   fish     boids rendered as SDF sprites, seen through the refracting surface
//   surface  analytic wind waves + a GPU height-field simulation for the ripples you make;
//            caustics come from the Jacobian of the refraction map (1 / |det J|)
//   floats   flowers and leaves riding on the surface
(() => {
'use strict';

const TAU = Math.PI * 2;
const NW = 10;          // analytic wind waves
const MAX_DROPS = 16;   // ripple impulses per frame
const MAX_FISH = 64;
const MAX_FLOATS = 12;
const MAX_PELLETS = 60;
const MAX_DOLPHINS = 6;
const MAX_SPRAY = 8;
const MAX_HATCH = 12;
const MAX_SHARKS = 2;

const canvas = document.getElementById('sea');
const msgEl = document.getElementById('msg');
const statsEl = document.getElementById('stats');
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');

function fail(text) { msgEl.textContent = text; msgEl.style.display = 'flex'; }

const gl = canvas.getContext('webgl2', {
  alpha: false, antialias: false, depth: false, stencil: false,
  premultipliedAlpha: false, powerPreference: 'high-performance',
});
if (!gl) { fail('This wallpaper needs WebGL2, which this browser or graphics driver doesn’t provide.\n這個桌布需要 WebGL2，但這個瀏覽器或顯示卡驅動不支援。'); return; }
if (!gl.getExtension('EXT_color_buffer_float')) { fail('Your graphics card can’t render to floating-point textures (EXT_color_buffer_float).\n顯示卡不支援浮點渲染（EXT_color_buffer_float）。'); return; }

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

// ---------------------------------------------------------------- shaders
const NOISE = /* glsl */`
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uint ihash(vec2 p) { ivec2 i = ivec2(floor(p)) + ivec2(1 << 20); return pcg(uint(i.x) + pcg(uint(i.y))); }
float hash21(vec2 p) { return float(ihash(p)) * 2.3283064e-10; }
vec2 hash22(vec2 p) { uint h = ihash(p); return vec2(float(h), float(pcg(h))) * 2.3283064e-10; }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i) * 6.2831853, b = hash21(i + vec2(1.0, 0.0)) * 6.2831853;
  float c = hash21(i + vec2(0.0, 1.0)) * 6.2831853, d = hash21(i + 1.0) * 6.2831853;
  float va = dot(vec2(cos(a), sin(a)), f);
  float vb = dot(vec2(cos(b), sin(b)), f - vec2(1.0, 0.0));
  float vc = dot(vec2(cos(c), sin(c)), f - vec2(0.0, 1.0));
  float vd = dot(vec2(cos(d), sin(d)), f - 1.0);
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.4;
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * gnoise(p); p = m * p + 3.1; a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { s += a * gnoise(p); p = m * p + 3.1; a *= 0.5; }
  return s;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`;

// The coast is a (wobbly) circle: shoreS < 0 on the beach, 0 at the resting waterline, growing out to sea.
// A huge radius gives a straight beach along one screen edge. Needs u_s1, u_s3 declared by the host shader.
const SHORE = /* glsl */`
uniform vec3 u_shore;   // centre xy, radius; radius <= 0: open water, no beach
float shoreS(vec2 p) {
  return length(p - u_shore.xy) - u_shore.z + 0.09 * fbm3(p * 1.3 + u_s3) + 0.018 * gnoise(p * 7.0 + u_s1);
}
`;

// Waves washing up the beach. They come in irregular sets and at a slight angle. Each one is a swell that
// slows and steepens in the shallows, breaks a little way out, rolls in as a thin band of whitewater, runs up
// the sand (slowing down) and drains back (speeding up). Up to four overlapping waves are tracked per pixel.
// c is a texel of the baked coast map: x = shoreS, y = distance along the coast, z = timing offset.
const SWASH = /* glsl */`
uniform float u_swashT;
const float WAVE_T = 9.0;          // average seconds between waves
struct Swash {
  float edge;    // how far up the sand the water reaches now (shoreS units, <= 0)
  float churn;   // fresh whitewater
  float lace;    // older foam thinning into a web
  float line;    // bubble line along a running sheet, or foam stranded at the top of the run-up
  float wet;     // 1 while under water, then drying
  float drift;   // how far the water here has carried its foam
  float back;    // > 0 while water drains back down: foam stretches into streaks
  float bump;    // slope of the water surface across the coast (swells, bores, sheet fronts)
  float curv;    // its curvature: a swell is a lens that draws a bright band on the sand
  float turb;    // sand stirred up into the water
};
// an unbroken swell (x > 0 is seaward of its crest), its shoreward face sharpening before it breaks
float swellH(float x, float w, float steep) {
  float k = x < 0.0 ? w * mix(1.0, 0.3, steep) : w;
  return exp(-x * x / (k * k));
}
// a bore: a step in the water, highest just behind its front
float boreH(float x, float w) { return smoothstep(-0.005, 0.008, x) * exp(-max(x, 0.0) / w); }

Swash swash(vec3 c) {
  Swash r = Swash(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  float s = c.x, al = c.y;
  // even between waves the waterline never quite rests: it laps gently back and forth
  float lap = -0.007 * (0.5 + 0.5 * sin(u_swashT * 1.9 + al * 9.0 + 2.0 * sin(u_swashT * 0.7 + al * 3.0)));
  r.edge = lap;
  r.line = 0.3 * exp(-(s - lap) * (s - lap) / 0.00001);
  float n0 = floor(u_swashT / WAVE_T);
  for (int k = -1; k < 3; k++) {
    float n = n0 - float(k);
    // sets: a few bigger waves, then a lull
    float A = clamp(0.55 + 0.28 * sin(n * 0.85 + 1.3) + 0.4 * (hash21(vec2(n, 1.0)) - 0.5), 0.2, 1.0);
    float start = (n + 0.42 * (hash21(vec2(n, 2.0)) - 0.5)) * WAVE_T;
    float obl = (hash21(vec2(n, 3.0)) - 0.5) * 1.4;     // arrives along the beach at an angle
    float tau = u_swashT - start - al * obl - c.z * 8.0 - 0.3 * gnoise(vec2(al * 2.2, n * 1.7));
    if (tau < 0.0 || tau > 16.0) continue;

    float sb = 0.035 + 0.075 * A + 0.02 * gnoise(vec2(al * 3.0, n * 2.3));   // where it breaks
    const float T0 = 1.6;                                                     // when it reaches the waterline
    float Tup = 0.9 + 1.3 * A, Tdn = 2.3 * Tup;
    float R = (0.03 + 0.11 * A) * (1.0 + 0.25 * gnoise(vec2(al * 4.0, n * 1.3)) + 0.08 * sin(al * 34.0));

    // the crest slows down as the water gets shallower (speed ~ sqrt(depth))
    float sq = 0.72 - 0.45 * tau;
    float sc = sq > 0.0 ? sq * sq : 0.0;
    if (tau < T0) {
      float x = s - sc;
      float broken = smoothstep(sb + 0.008, sb - 0.012, sc);
      float steep = smoothstep(sb + 0.12, sb, sc);
      float w = 0.03 + 0.03 * sc;
      float a0 = swellH(x, w, steep), a1 = swellH(x + 0.003, w, steep), a2 = swellH(x - 0.003, w, steep);
      float b0 = boreH(x, 0.05), b1 = boreH(x + 0.003, 0.05), b2 = boreH(x - 0.003, 0.05);
      float hs = 0.004 * A * smoothstep(0.55, 0.4, sc), hb = 0.0022 * A;
      r.bump += mix(hs * (a1 - a2), hb * (b1 - b2), broken) / 0.006;
      r.curv += mix(hs * (a1 + a2 - 2.0 * a0), hb * (b1 + b2 - 2.0 * b0), broken) / 0.000009;
    }

    // the water's edge on the sand
    float e = 0.0;
    if (tau > T0 && tau < T0 + Tup) { float u = (tau - T0) / Tup; e = -R * (1.0 - (1.0 - u) * (1.0 - u)); }
    else if (tau >= T0 + Tup && tau < T0 + Tup + Tdn) e = -R * (1.0 - pow((tau - T0 - Tup) / Tdn, 1.6));
    r.edge = min(r.edge, e);
    if (tau > T0 && tau < T0 + Tup + Tdn) {
      // a small step at the front of the running sheet, with a fizzing line of bubbles along it
      float x = s - e;
      bool rising = tau < T0 + Tup;
      r.bump += A * (rising ? 0.0018 : 0.0006) * (boreH(x + 0.002, 0.025) - boreH(x - 0.002, 0.025)) / 0.004;
      float fade = rising ? 1.0 : 0.6 * (1.0 - (tau - T0 - Tup) / Tdn);
      r.line = max(r.line, (0.45 + 0.55 * A) * fade * exp(-x * x / 0.000018));
      r.back = max(r.back, smoothstep(T0 + Tup, T0 + Tup + 0.3 * Tdn, tau) * (1.0 - smoothstep(T0 + Tup + 0.8 * Tdn, T0 + Tup + Tdn, tau)));
    }
    // foam stranded where the wave stopped
    if (tau > T0 + Tup) {
      float d = s + R;
      r.line = max(r.line, 0.75 * A * exp(-d * d / 0.000012) * exp(-(tau - T0 - Tup) / 4.0));
    }

    // when the broken wave, then the sheet of water, passed this spot
    float tp = -1.0;
    if (s >= 0.0 && s < sb) tp = (0.72 - sqrt(s)) / 0.45;
    else if (s < 0.0 && -s < R) tp = T0 + Tup * (1.0 - sqrt(max(1.0 + s / R, 0.0)));
    if (tp >= 0.0 && tau > tp) {
      float a = tau - tp;
      float grow = smoothstep(sb, sb - 0.03, s);   // a breaking crest takes a moment to turn white
      r.churn = max(r.churn, A * grow * exp(-a / 0.4) * (s < 0.0 ? 0.45 : 1.0));
      r.lace = max(r.lace, (0.35 + 0.5 * A) * grow * exp(-a / 2.6));
      r.turb = max(r.turb, A * exp(-a / 3.5) * smoothstep(sb + 0.02, sb - 0.05, s));
      if (s < 0.0) {
        float tu = T0 + Tup + Tdn * pow(max(1.0 + s / R, 0.0), 1.0 / 1.6);   // when the water left again
        r.wet = max(r.wet, tau < tu ? 1.0 : exp(-(tau - tu) / 6.0));
      }
    }
  }
  r.drift = 0.7 * r.edge;   // the foam rides up and down with the water
  return r;
}
`;

// ---- coast map, baked with the seabed: shoreS, distance along the coast, swash timing offset
const COAST_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform float u_aspect;
uniform vec2 u_s1, u_s3;
${NOISE}${SHORE}
void main() {
  if (u_shore.z <= 0.0) { o = vec4(9.0, 0.0, 0.0, 1.0); return; }
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec2 d = p - u_shore.xy;
  vec2 ref = normalize(vec2(0.5 * u_aspect, 0.5) - u_shore.xy);
  float along = atan(ref.x * d.y - ref.y * d.x, dot(ref, d)) * u_shore.z;
  o = vec4(shoreS(p), along, 0.07 * gnoise(vec2(along * 1.6, 3.7)), 1.0);
}`;

const FULLSCREEN_VS = /* glsl */`#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// ---- seabed (rendered once per resize / regenerate), in six passes. As one shader it took Direct3D's shader
// compiler (under ANGLE, on Windows) half a minute or more to build on a cold start, since its cost grows much
// faster than the code does; as six small programs built side by side it takes a few seconds. They hand on what
// they have worked out so far in float32 textures, so the seabed comes out just as one pass drew it, and the last
// two write it into floorT: rgb = albedo, a = water depth.
const FLOOR_LIB = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform float u_aspect;
uniform float u_px;
uniform vec2 u_s0, u_s1, u_s2, u_s3;
uniform float u_ang;
uniform vec2 u_slope;
${NOISE}${SHORE}
const vec3 LDIR = vec3(-0.42, 0.50, 0.76);

float ripplePhase(vec2 p) {
  float a = u_ang + 0.55 * gnoise(p * 0.6 + u_s1);
  float f = 88.0 * (1.0 + 0.16 * gnoise(p * 0.9 + u_s3));
  return dot(p, vec2(cos(a), sin(a))) * f + 2.3 * fbm(p * 2.3 + u_s2);
}
float rippleProf(float ph) { float s = 0.5 + 0.5 * sin(ph + 0.6 * sin(ph)); return s * s; }
float rockField(vec2 p) { return fbm(p * 1.15 + u_s3) + 0.16 * gnoise(p * 8.0 + u_s0); }
float ripAmount(vec2 p) { return smoothstep(-0.30, 0.20, fbm(p * 0.8 + u_s0)); }
// water depth in screen heights, negative on the beach; s is the coast coordinate
float depthAt(vec2 p, out float s) {
  if (u_shore.z <= 0.0) {
    s = 9.0;
    return clamp(0.40 + 0.45 * fbm(p * 0.65 + u_s1.yx) + dot(p - vec2(0.5 * u_aspect, 0.5), u_slope), 0.17, 1.0);
  }
  s = shoreS(p);
  float shelf = s * 1.1 + max(s - 0.28, 0.0) * 1.5 + max(s - 0.75, 0.0) * 0.9;
  float D = shelf + 0.3 * fbm(p * 0.65 + u_s1.yx) * smoothstep(0.12, 0.6, s);
  return s > 0.0 ? clamp(D, s * 0.5, 2.8) : max(D, -0.6);
}

// seagrass meadows, preferring deeper water: how thickly they grow here, and the pattern of their blades
float grassDens(vec2 p, float D, float rf, out float blades) {
  float gm = fbm(p * 1.25 + u_s2.yx + 7.0) + 0.15 * (clamp(D, 0.0, 1.3) - 0.55);
  float zone = smoothstep(0.17, 0.25, gm) * (1.0 - smoothstep(0.05, 0.15, rf)) * smoothstep(0.18, 0.35, D);
  vec2 gq = rot(u_ang + 1.3 + 0.35 * gnoise(p * 2.0)) * p;
  blades = 0.6 * gnoise(vec2(gq.x * 22.0, gq.y * 170.0)) + 0.4 * gnoise(vec2(gq.x * 55.0, gq.y * 420.0));
  return smoothstep(-0.2, 0.25, blades + (zone - 0.55) * 1.3) * zone;
}
`;

// 1. the relief here (u_dir 0), or a pixel and a half to the right or above: drawn three times, into one channel each
const FLOOR_HEIGHT_FS = /* glsl */`${FLOOR_LIB}
uniform vec2 u_dir;
out vec4 o;
float heightAt(vec2 p) {
  float s;
  float D = depthAt(p, s);
  float rp = rippleProf(ripplePhase(p)) * ripAmount(p) * (1.0 - smoothstep(0.1, 0.25, rockField(p))) * smoothstep(0.02, 0.15, D);
  float bumps = 0.35 * fbm(p * 10.0 + u_s0.yx) + 0.06 * gnoise(p * 70.0);
  // small wind ripples on the dry beach
  vec2 wd = vec2(cos(u_ang + 0.8), sin(u_ang + 0.8));
  float wind = rippleProf(dot(p, wd) * 150.0 + 3.5 * fbm3(p * 3.5 + u_s2)) * smoothstep(-0.06, -0.2, s);
  return rp * 0.6 + bumps * 0.25 + wind * 0.12;
}

void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  o = vec4(heightAt(p + u_dir * (u_px * 1.5)));
}`;

// 2. sand, the beach and seagrass, lit by the relief
const FLOOR_BASE_FS = /* glsl */`${FLOOR_LIB}
uniform sampler2D u_relief;   // heights here, to the right and above
out vec4 o;                   // rgb colour, a = the baked light
vec3 sandColor(vec2 p) {
  float cn = fbm(p * 1.6 + u_s2);
  vec3 c = mix(vec3(0.86, 0.80, 0.67), vec3(0.95, 0.92, 0.82), smoothstep(-0.35, 0.35, cn));
  c = mix(c, vec3(0.93, 0.84, 0.70), 0.45 * smoothstep(0.05, 0.45, fbm(p * 0.5 + u_s3.yx)));
  return c;
}

void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);

  // relief + baked light from the upper left
  float e = u_px * 1.5;
  vec3 h = texelFetch(u_relief, ivec2(gl_FragCoord.xy), 0).rgb;
  vec2 grad = vec2(h.y - h.x, h.z - h.x) / e;
  vec3 n = normalize(vec3(-grad * 0.0045, 1.0));
  vec3 L = normalize(LDIR);
  float lam = clamp(dot(n, L) / L.z, 0.35, 1.6);

  float rf = rockField(p);
  float s;
  float D = depthAt(p, s);
  float rip = ripAmount(p) * smoothstep(0.02, 0.15, D);
  float prof = rippleProf(ripplePhase(p));

  // sand
  vec3 sand = sandColor(p);
  sand *= 1.0 - 0.09 * rip * (1.0 - prof);
  float debris = rip * smoothstep(0.5, 0.0, prof) * smoothstep(0.0, 0.45, fbm(p * 6.0 + u_s1));
  sand = mix(sand, vec3(0.60, 0.55, 0.46), 0.35 * debris);
  sand *= 0.96 + 0.08 * hash21(floor(p / u_px) + 17.0);
  float sp = hash21(floor(p * 700.0) + 3.0);
  sand = mix(sand, vec3(0.36, 0.33, 0.30), step(0.993, sp) * 0.55);
  sand = mix(sand, vec3(1.0, 0.90, 0.88), step(sp, 0.004) * 0.6);

  // the beach: sun-bleached higher up, and a line of washed-up seaweed and shell grit where the waves stop
  float up = smoothstep(0.0, -0.3, s);
  sand = mix(sand, vec3(0.95, 0.88, 0.75) * (0.95 + 0.08 * fbm(p * 2.0 + u_s0)), up * 0.75);
  float wl = s + 0.17 + 0.025 * gnoise(p * 3.0 + u_s2);
  float wrack = exp(-wl * wl / 0.0004);
  float bits = smoothstep(0.35, 0.6, gnoise(p * 70.0 + u_s1)) * smoothstep(-0.1, 0.4, gnoise(p * 9.0 + u_s3));
  sand = mix(sand, vec3(0.30, 0.27, 0.18), wrack * bits * 0.75);
  sand = mix(sand, vec3(0.98, 0.95, 0.90), wrack * step(0.985, hash21(floor(p * 500.0) + 9.0)) * 0.8);

  float blades;
  float dens = grassDens(p, D, rf, blades);
  vec3 grass = mix(vec3(0.09, 0.14, 0.07), vec3(0.30, 0.35, 0.15), smoothstep(-0.35, 0.55, blades));
  grass = mix(grass, vec3(0.30, 0.30, 0.14), 0.3 * smoothstep(0.0, 0.4, fbm(p * 3.0 + u_s0)));

  vec3 col = mix(sand, grass, dens);
  col *= mix(1.0, lam, 0.9);
  // coarser, darker rubble around the rocky patches
  col = mix(col, col * vec3(0.82, 0.80, 0.76), 0.6 * smoothstep(0.0, 0.2, rf));
  o = vec4(col, lam);
}`;

// 3. boulders. This pass and the next are drawn twice, once for each of their outputs: ANGLE rebuilds a program
// that writes two targets at its first draw, on the spot and slowly, so each draw writes a single target.
const FLOOR_ROCKS_FS = /* glsl */`${FLOOR_LIB}
uniform sampler2D u_prev;   // rgb colour, a = the baked light
uniform int u_out;
out vec4 o;                 // 0: rgb colour, a = how much of it the rocks cover; 1: r = the baked light, g = rock height
void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0);
  vec3 col = prev.rgb;
  vec3 L = normalize(LDIR);
  vec2 sdir = -normalize(LDIR.xy);
  float rock = 0.0, rockH = 0.0;

  // boulders, clustered where the rock field is high
  {
    const float cs = 0.11;
    vec2 ci = floor(p / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j));
      vec2 h = hash22(c + u_s2 * 3.0);
      float zoneR = rockField((c + 0.5) * cs);
      if (h.x > smoothstep(0.04, 0.26, zoneR) * 0.9) continue;
      float sC;
      if (depthAt((c + 0.5) * cs, sC) < 0.15) continue;
      vec2 h2 = hash22(c + 41.3), h3 = hash22(c + 7.9);
      vec2 center = (c + 0.2 + 0.6 * h2) * cs;
      float r = 0.016 + 0.034 * h3.x * h3.x;
      mat2 R = rot(h3.y * 6.2831853);
      vec2 rad = vec2(r, r * (0.6 + 0.3 * h2.y));
      vec2 d = R * (p - center);
      vec2 dn = d / rad;
      float wob = 0.16 * gnoise(dn * 1.4 + c * 3.1) + 0.05 * gnoise(dn * 5.0 + c);
      float ed = length(dn) + wob;
      vec2 dsn = (R * (p - sdir * r * 0.55 - center)) / rad;
      float eds = length(dsn) + 0.16 * gnoise(dsn * 1.4 + c * 3.1);
      float outside = smoothstep(0.98, 1.02, ed);
      col *= 1.0 - (0.42 * smoothstep(1.2, 0.85, eds) + 0.2 * smoothstep(1.45, 1.0, ed)) * outside;
      float a = smoothstep(1.0, 1.0 - u_px / r * 2.0, ed);
      if (a <= 0.0) continue;
      float dome = sqrt(max(1.0 - min(ed, 1.0) * min(ed, 1.0), 0.0));
      float tex = fbm(d / r * 2.2 + c * 7.0);
      vec3 rn = normalize(vec3(dn * 0.9 + 0.5 * vec2(gnoise(dn * 4.0 + c), gnoise(dn * 4.0 + c + 9.0)), dome + 0.15));
      vec3 lp = vec3(R * L.xy, L.z);
      vec3 rc = mix(vec3(0.46, 0.44, 0.40), vec3(0.74, 0.70, 0.62), smoothstep(-0.3, 0.35, tex));
      rc = mix(rc, vec3(0.40, 0.47, 0.25), 0.65 * smoothstep(0.05, 0.4, fbm(d / r * 1.3 + c * 2.0 + 30.0)) * dome);
      rc = mix(rc, vec3(0.86, 0.60, 0.62), 0.55 * smoothstep(0.15, 0.45, fbm(d / r * 1.8 + c * 5.0 + 60.0)));
      rc *= 1.0 - 0.4 * smoothstep(0.0, -0.3, fbm(d / r * 7.0 + c));
      rc *= 0.42 + 0.75 * max(dot(rn, lp), 0.0);
      col = mix(col, rc, a);
      rock = max(rock, a);
      rockH = max(rockH, dome * min(r / 0.04, 1.0));
    }
  }
  o = u_out == 0 ? vec4(col, rock) : vec4(prev.a, rockH, 0.0, 0.0);
}`;

// 4. coral reefs: a bed of rubble crowded with colonies. Also drawn twice: 0 the colour and how much rocks or corals
// cover, 1 the baked light handed on and the height of rocks or corals. Split from the coral gardens because one
// program with both was the slowest of all to compile
const FLOOR_REEF_FS = /* glsl */`${FLOOR_LIB}
uniform sampler2D u_prev;   // rgb colour, a = rock cover
uniform sampler2D u_aux;    // r = the baked light, g = rock height
uniform float u_coral;
uniform int u_out;
out vec4 o;
// where the reefs grow: a cheap two-octave field (it is looked up for every nearby coral cell)
float reefField(vec2 p) { return 0.65 * gnoise(p * 1.1 + u_s1 * 1.7 + 4.0) + 0.3 * gnoise(p * 2.6 - u_s3 * 1.3); }

void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0), aux = texelFetch(u_aux, ivec2(gl_FragCoord.xy), 0);
  vec3 col = prev.rgb;
  float lam = aux.r;
  vec3 L = normalize(LDIR);
  vec2 sdir = -normalize(LDIR.xy);
  float s;
  float D = depthAt(p, s);

  float coral = 0.0, coralH = 0.0;
  // coral reefs: in patches at the clear middle depths a bed of coral rubble, crowded with colonies of every shape
  if (u_coral > 0.5) {
    float depthOK = smoothstep(0.2, 0.34, D) * smoothstep(1.7, 1.2, D);
    float reefZ = smoothstep(-0.05, 0.3, reefField(p)) * depthOK;
    // the rubble bed: broken coral and rock, crusted with algae
    float rn1 = gnoise(p * 70.0 + u_s0), rn2 = gnoise(p * 23.0 - u_s2);
    vec3 rub = mix(vec3(0.64, 0.6, 0.5), vec3(0.47, 0.46, 0.34), smoothstep(-0.3, 0.5, rn2));
    rub *= 0.82 + 0.25 * smoothstep(-0.5, 0.6, rn1);
    rub = mix(rub, vec3(0.36, 0.42, 0.26), smoothstep(0.25, 0.6, gnoise(p * 9.0 + u_s3)) * 0.5);
    col = mix(col, rub * mix(1.0, lam, 0.9), smoothstep(0.15, 0.5, reefZ) * 0.85);

    const float cs = 0.048;
    vec2 ci = floor(p / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j));
      vec2 h = hash22(c + u_s3 * 4.0 + 11.0), h2 = hash22(c + 23.1), h3 = hash22(c + 51.7);
      vec2 center = (c + 0.15 + 0.7 * h2) * cs;
      float kind = floor(fract(h.y * 9.13) * 5.0);   // 0 brain, 1 table, 2 staghorn, 3 boulder, 4 cauliflower
      float r = (0.012 + 0.024 * h3.x) * (kind == 1.0 ? 1.4 : 1.0);
      if (length(p - center) > r * 2.0) continue;     // too far away to touch this pixel or its shadow
      if (h.x > smoothstep(-0.05, 0.3, reefField(center)) * 0.97) continue;
      mat2 R = rot(h3.y * 6.2831853);
      vec2 d = R * (p - center), dn = d / r;
      float sd = c.x * 1.7 + c.y * 3.1, pal = fract(h2.x * 7.7);
      // the few noise lookups every kind shares: an uneven outline, a rough edge, and two texture scales
      float wob = gnoise(dn * 1.8 + sd), rough = gnoise(dn * 9.0 + sd);
      float f1 = kind < 0.5 ? 5.0 : kind < 1.5 ? 3.0 : kind < 3.5 ? 34.0 : 16.0;
      float t1 = gnoise(dn * f1 + sd), t2 = gnoise(dn * f1 * 2.0 - sd);
      float ed = length(dn * vec2(1.0, kind < 0.5 ? 1.15 : 1.0)) + 0.13 * wob + 0.06 * rough;
      float hgt = sqrt(max(1.0 - ed * ed, 0.0));
      vec3 rnm = normalize(vec3(dn * 0.9 + 0.35 * vec2(t1, t2) * step(2.5, kind), hgt + 0.2));
      float shOff = 0.55, shStr = 0.4;
      vec3 cc;
      if (kind < 0.5) {
        // brain coral: a dome covered in meandering ridges and grooves
        vec3 base = pal < 0.4 ? vec3(0.70, 0.60, 0.40) : pal < 0.75 ? vec3(0.55, 0.57, 0.36) : vec3(0.56, 0.44, 0.30);
        cc = base * (1.08 - 0.5 * smoothstep(0.12, 0.0, abs(t1 + 0.35 * t2)));
      } else if (kind < 1.5) {
        // table coral: a flat plate on a short stalk, fine branchlets radiating out to a rim of paler tips
        hgt = 0.35 * smoothstep(1.0, 0.85, ed);
        rnm = vec3(0.0, 0.0, 1.0);
        vec3 base = pal < 0.5 ? vec3(0.76, 0.70, 0.56) : pal < 0.8 ? vec3(0.60, 0.52, 0.38) : vec3(0.58, 0.64, 0.50);
        cc = base * (0.82 + 0.22 * (0.5 + 0.5 * sin(atan(dn.y, dn.x) * 60.0 + 5.0 * t1))) * (0.9 + 0.12 * ed);
        cc = mix(cc, pal < 0.3 ? vec3(0.66, 0.62, 0.80) : vec3(0.88, 0.84, 0.74), smoothstep(0.75, 0.95, ed) * step(0.3, rough) * 0.6);
        shOff = 1.0; shStr = 0.5;
      } else if (kind < 2.5) {
        // staghorn coral: antler branches; only the one nearest this pixel (and its side shoot) needs drawing
        float th = atan(dn.y, dn.x), sec = floor(th / 0.8976 + 0.5);
        float an = sec * 0.8976 + 0.5 * (hash21(c + sec) - 0.5), ln = 0.65 + 0.4 * hash21(c + sec + 9.0);
        vec2 dir = vec2(cos(an), sin(an));
        float t = clamp(dot(dn, dir) / ln, 0.0, 1.0);
        float best = length(dn - dir * ln * t) - mix(0.14, 0.08, t), tipT = t;
        float an2 = an + (hash21(c + sec + 3.0) > 0.5 ? 0.6 : -0.6);
        vec2 o2 = dir * ln * 0.5, dir2 = vec2(cos(an2), sin(an2));
        float t2b = clamp(dot(dn - o2, dir2) / (ln * 0.45), 0.0, 1.0);
        float dd2 = length(dn - o2 - dir2 * ln * 0.45 * t2b) - mix(0.1, 0.07, t2b);
        if (dd2 < best) { best = dd2; tipT = mix(0.5, 1.0, t2b); }
        ed = 1.0 + best * 4.0;
        hgt = 0.6 * smoothstep(0.05, -0.05, best);
        rnm = vec3(0.0, 0.0, 1.0);
        vec3 base = pal < 0.6 ? vec3(0.64, 0.50, 0.34) : vec3(0.55, 0.47, 0.38);
        vec3 tipC = pal < 0.3 ? vec3(0.62, 0.68, 0.88) : vec3(0.90, 0.87, 0.78);
        cc = mix(base, tipC, smoothstep(0.7, 1.0, tipT)) * (0.78 + 0.3 * smoothstep(0.0, -0.06, best));
        shStr = 0.3;
      } else if (kind < 3.5) {
        // boulder coral: a lumpy mound with a fine skin of polyps
        vec3 base = pal < 0.45 ? vec3(0.76, 0.66, 0.42) : pal < 0.8 ? vec3(0.56, 0.50, 0.34) : vec3(0.56, 0.47, 0.54);
        cc = base * (0.86 + 0.2 * smoothstep(0.1, 0.5, t1));
      } else {
        // cauliflower coral: a rounded clump of knobbly branches
        hgt *= 0.8;
        vec3 base = pal < 0.4 ? vec3(0.78, 0.56, 0.54) : pal < 0.75 ? vec3(0.62, 0.47, 0.36) : vec3(0.84, 0.80, 0.68);
        cc = base * (0.7 + 0.4 * smoothstep(-0.2, 0.6, t1));
      }
      // its shadow on the ground, then the colony itself
      float a = smoothstep(1.0, 1.0 - u_px / r * 2.0, ed) * depthOK;
      vec2 ds = (d - R * sdir * r * shOff * 0.6) / r;
      col *= 1.0 - smoothstep(1.25, 0.75, length(ds)) * shStr * depthOK * (1.0 - a);
      if (a <= 0.0) continue;
      col = mix(col, cc * (0.6 + 0.5 * max(dot(rnm, vec3(R * L.xy, L.z)), 0.0)), a);
      coral = max(coral, a);
      coralH = max(coralH, hgt * min(r / 0.03, 1.0) * a);
    }
  }
  o = u_out == 0 ? vec4(col, max(prev.a, coral)) : vec4(lam, max(aux.g, coralH * 0.9), 0.0, 0.0);
}`;

// 4b. now and then a coral garden out in the deeper water, and the water depth: shallower over the rocks and corals,
// and close to the surface over a garden's mound. Drawn twice: 0 the colour and cover, 1 the depth
const FLOOR_GARDEN_FS = /* glsl */`${FLOOR_LIB}
uniform sampler2D u_prev;   // rgb colour, a = rock or coral cover
uniform sampler2D u_aux;    // r = the baked light, g = the height of rocks or corals
uniform float u_coral;
uniform int u_out;
out vec4 o;
// a branching coral colony seen from above, in units of its radius: n0 branches fork in two at each of lv levels,
// out to an outline that swells and dips around it; spread 2 folds them into a half-round fan. Returns the distance
// to the nearest branch; t is how far out along it, lat the offset across it (in half-widths), dir its heading
float coralBranches(vec2 q, float n0, float lv, float w0, float w1, float spread, float sd,
                    out float t, out float lat, out vec2 dir) {
  float r = length(q), th = atan(q.y, q.x) * spread;
  float k = min(floor(r * lv), lv - 1.0), nk = n0 * exp2(k);
  float u = (th + 3.14159265) / 6.2831853 * nk, j0 = floor(u);
  float best = 9.0;
  t = 0.0; lat = 0.0; dir = vec2(1.0, 0.0);
  for (int c = 0; c < 2; c++) {                       // the branch in this sector and the nearer neighbour
    float j = j0 + (c == 0 ? 0.0 : fract(u) < 0.5 ? -1.0 : 1.0);
    j = spread > 1.5 ? clamp(j, 0.0, nk - 1.0) : mod(j, nk);
    float ang = (j + 0.5 + 0.7 * (hash21(vec2(j, k) + sd) - 0.5)) * 6.2831853 / nk - 3.14159265;
    if (k > 0.5) {                                    // it forks off its parent's line early in this level
      float pj = floor(j * 0.5);
      float pang = (pj + 0.5 + 0.7 * (hash21(vec2(pj, k - 1.0) + sd) - 0.5)) * 12.566371 / nk - 3.14159265;
      ang = mix(pang, ang, smoothstep(k / lv, (k + 0.7) / lv, r));
    }
    ang += 0.17 * sin(r * 7.0 + ang * 3.0 + sd);
    float rm = 0.74 + 0.15 * sin(ang * 3.0 + sd) + 0.11 * sin(ang * 5.0 - sd * 1.7);
    float da = th - ang;
    if (spread < 1.5) da = mod(da + 3.14159265, 6.2831853) - 3.14159265;
    float l = r * da / spread, w = mix(w0, w1, min(r, 1.0));
    float dd = length(vec2(l, max(r - rm, 0.0))) - w;   // rounded growing tips
    if (dd < best) { best = dd; t = min(r / rm, 1.0); lat = l / w; ang /= spread; dir = vec2(cos(ang), sin(ang)); }
  }
  return best;
}

void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0), aux = texelFetch(u_aux, ivec2(gl_FragCoord.xy), 0);
  vec3 col = prev.rgb;
  float lam = aux.r;
  vec3 L = normalize(LDIR);
  vec2 sdir = -normalize(LDIR.xy);
  float s;
  float D = depthAt(p, s);
  float coral = 0.0, bigTop = 0.0;
  if (u_coral > 0.5) {
    // now and then a coral garden crowds a mound out in the deeper water: antler-branched staghorns, fine bushy
    // colonies and lacy sea fans in orange, pink, lilac and white, packed together and lifted close to the light
    {
      const float bs = 0.55;
      vec2 bc = floor(p / bs);
      vec2 hb = hash22(bc + u_s2 * 2.3 + 5.0), hb2 = hash22(bc + 71.3);
      float Rg = 0.12 + 0.05 * hb2.x;
      vec2 cen = (bc + 0.33 + 0.34 * hb) * bs;           // kept inside its cell, so only this cell can reach p
      float sB;
      float Db = depthAt(cen, sB);
      if (hb2.y < 0.6 && Db > 0.7 && Db < 2.6) {
        vec2 gq = (p - cen) / Rg;
        float gw = 0.25 * gnoise(gq * 1.6 + bc * 3.0);
        float gm = length(gq) + gw, gA = smoothstep(1.1, 0.7, gm);
        // the mound itself, a rise of coral rubble crusted with algae
        vec3 rubG = mix(vec3(0.56, 0.53, 0.43), vec3(0.40, 0.42, 0.30), smoothstep(-0.3, 0.5, gnoise(p * 23.0 + bc)));
        col = mix(col, rubG * (0.75 + 0.3 * smoothstep(-0.5, 0.6, gnoise(p * 70.0 + bc))) * mix(1.0, lam, 0.9), gA * 0.9);
        coral = max(coral, gA);
        bigTop = smoothstep(1.15, 0.45, gm);                 // rising gently out of the deep
        const float gs = 0.042;
        vec2 gi = floor(p / gs);
        float zb = 0.0;                                    // the height of what is drawn so far: taller branches win
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = gi + vec2(float(i), float(j));
          vec2 hc = hash22(c + 31.7), hk = hash22(c + 63.1);
          vec2 bcen = (c + 0.2 + 0.6 * hc) * gs, bg = (bcen - cen) / Rg;
          if (length(bg) + 0.25 * gnoise(bg * 1.6 + bc * 3.0) > 0.85 || hk.x > 0.97) continue;
          float Rk = gs * (0.9 + 0.3 * fract(hk.x * 7.3));
          mat2 Rq = rot(hc.x * 6.2831853);
          vec2 q = Rq * (p - bcen) / Rk;
          if (zb == 0.0) col *= 1.0 - 0.35 * smoothstep(1.0, 0.25, length(q - Rq * sdir * 0.35));   // its shade below
          if (dot(q, q) > 1.1) continue;
          float pal = fract(hc.y * 5.7), sd = hk.x * 37.0 + hc.y * 11.0;
          bool fan = hk.y > 0.8, antler = hk.y < 0.3, fluffy = hk.y > 0.55 && !fan;
          float t, lat;
          vec2 dir;
          float dist = coralBranches(q, antler || fluffy ? 5.0 : fan ? 4.0 : 6.0, antler ? 3.0 : fluffy ? 5.0 : 4.0,
                                     antler ? 0.1 : fan ? 0.04 : fluffy ? 0.055 : 0.07,
                                     antler ? 0.055 : fan ? 0.02 : fluffy ? 0.03 : 0.038,
                                     fan ? 2.0 : 1.0, sd, t, lat, dir);
          float a = smoothstep(u_px / Rk, -u_px / Rk, dist);
          if (fan) {                                       // the fine mesh strung between a sea fan's ribs, a pale veil
            float veil = 0.3 * step(0.0, q.x) * smoothstep(0.99, 0.9, t);
            if (veil > a) { a = veil; lat = 0.0; }
          }
          if (a <= 0.0) continue;
          float cz = sqrt(max(1.0 - lat * lat, 0.0));
          float hgt = (0.3 + 0.7 * t) * (fan ? 0.7 : 1.0) * (0.8 + 0.4 * hc.x) + 0.05 * cz;
          if (hgt < zb) continue;
          vec3 baseC = antler ? (pal < 0.35 ? vec3(0.95, 0.56, 0.38) : pal < 0.7 ? vec3(0.66, 0.54, 0.80) : vec3(0.86, 0.82, 0.72))
                     : fan ? (pal < 0.6 ? vec3(0.90, 0.90, 0.93) : vec3(0.82, 0.76, 0.92))
                     : fluffy ? (pal < 0.4 ? vec3(0.98, 0.58, 0.32) : pal < 0.75 ? vec3(0.95, 0.55, 0.70) : vec3(0.90, 0.40, 0.42))
                     : (pal < 0.35 ? vec3(0.95, 0.52, 0.30) : pal < 0.7 ? vec3(0.90, 0.46, 0.62) : vec3(0.72, 0.40, 0.66));
          vec3 tipC = antler ? (pal < 0.35 ? vec3(1.0, 0.82, 0.70) : pal < 0.7 ? vec3(0.80, 0.78, 1.0) : vec3(0.70, 0.84, 1.0))
                    : fan ? vec3(1.0)
                    : fluffy ? (pal < 0.4 ? vec3(1.0, 0.80, 0.60) : pal < 0.75 ? vec3(1.0, 0.78, 0.88) : vec3(1.0, 0.70, 0.66))
                    : (pal < 0.35 ? vec3(1.0, 0.75, 0.55) : pal < 0.7 ? vec3(1.0, 0.70, 0.82) : vec3(0.92, 0.66, 0.90));
          vec3 nb = normalize(vec3(vec2(-dir.y, dir.x) * lat * 0.8, cz + 0.25));
          vec3 cc = mix(baseC, tipC, smoothstep(0.6, 1.0, t)) * (0.6 + 0.4 * t);   // paler growing tips, shaded depths
          cc *= 0.85 + 0.25 * gnoise(p * 480.0 + c);                              // the fuzz of polyps
          cc *= 0.55 + 0.6 * max(dot(nb, vec3(Rq * L.xy, L.z)), 0.0);
          col = mix(col, cc, a);
          zb = max(zb, hgt * step(0.5, a));
          coral = max(coral, a);
          bigTop = max(bigTop, a);
        }
      }
    }
  }
  float rockH = aux.g;
  if (u_shore.z <= 0.0) D = clamp(D - rockH * 0.16, 0.12, 1.0);
  else if (s > 0.0) D = max(D - rockH * 0.16, 0.01);
  D = mix(D, min(D, 0.16), bigTop);                // a big coral head comes up close to the surface
  o = u_out == 0 ? vec4(col, max(prev.a, coral)) : vec4(0.0, 0.0, 0.0, D);
}`;

// 5. pebbles, shells and starfish on the open sand
const FLOOR_DETAIL_FS = /* glsl */`${FLOOR_LIB}
uniform sampler2D u_prev;   // rgb colour, a = rock or coral cover
out vec4 o;                 // rgb colour (the depth the coral pass wrote is kept)
void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0);
  vec3 col = prev.rgb;
  float cover = prev.a;
  vec3 L = normalize(LDIR);
  vec2 sdir = -normalize(LDIR.xy);
  float s;
  float D = depthAt(p, s);
  float blades;
  float dens = grassDens(p, D, rockField(p), blades);
  float open = (1.0 - cover) * (1.0 - dens * 0.9);

  // pebbles and shells
  {
    const float cs = 0.05;
    vec2 ci = floor(p / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j));
      vec2 h = hash22(c + u_s0 * 10.0);
      float cluster = smoothstep(-0.05, 0.3, fbm(c * cs * 1.4 + u_s3 * 0.7));
      if (h.x > 0.05 + 0.32 * cluster) continue;
      vec2 h2 = hash22(c + 91.7);
      vec2 h3 = hash22(c + 13.1);
      vec2 center = (c + 0.15 + 0.7 * h2) * cs;
      float r = 0.0035 + 0.009 * h3.y * h3.y;
      mat2 R = rot(-h3.x * 6.2831853);
      vec2 d = R * (p - center);
      float kind = fract(h.y * 7.31);
      if (kind < 0.3) {
        // scallop-like shell: ribbed fan
        float rr = r * 1.5;
        vec2 sd = d + vec2(0.55 * rr, 0.0);
        vec2 ssd = sd - R * sdir * rr * 0.25;
        float ang = atan(sd.y, sd.x);
        float rim = rr * (0.93 + 0.07 * cos(ang * 16.0));
        float inside = smoothstep(u_px, -u_px, length(sd) - rim) * smoothstep(1.25, 1.15, abs(ang));
        float shadow = smoothstep(rr * 0.2, -rr * 0.2, length(ssd) - rim) * smoothstep(1.4, 1.1, abs(atan(ssd.y, ssd.x)));
        col *= 1.0 - 0.28 * shadow * open;
        vec3 sc = mix(vec3(0.95, 0.88, 0.78), vec3(0.92, 0.70, 0.62), fract(h2.x * 5.3));
        sc *= 0.82 + 0.18 * cos(ang * 16.0);
        sc *= 0.85 + 0.15 * sin(length(sd) / rr * 18.0);
        col = mix(col, sc * (0.8 + 0.3 * (1.0 - length(sd) / rr)), inside * open);
      } else {
        vec2 rad = vec2(r, r * (0.6 + 0.35 * h2.x));
        float ed = length(d / rad);
        float sd2 = length((d - R * sdir * r * 0.45) / rad);
        col *= 1.0 - 0.35 * smoothstep(1.35, 0.75, sd2) * open;
        if (ed < 1.0) {
          vec3 pn = normalize(vec3(d / rad * 0.9, sqrt(max(1.0 - ed * ed, 0.0))));
          vec3 lp = vec3(R * L.xy, L.z);
          float k = fract(h.y * 3.77);
          vec3 pc = k < 0.3 ? vec3(0.56, 0.55, 0.53) : k < 0.5 ? vec3(0.92, 0.90, 0.86)
                  : k < 0.7 ? vec3(0.30, 0.29, 0.29) : k < 0.88 ? vec3(0.58, 0.45, 0.33) : vec3(0.88, 0.62, 0.64);
          pc *= 0.9 + 0.2 * gnoise(d * 600.0 + c);
          float sh = 0.45 + 0.75 * max(dot(pn, lp), 0.0);
          float a = smoothstep(1.0, 1.0 - u_px / r * 1.5, ed);
          col = mix(col, pc * sh, a * open);
        }
      }
    }
  }

  // starfish
  {
    const float cs = 0.42;
    vec2 ci = floor(p / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j));
      vec2 h = hash22(c + u_s1 * 5.0);
      if (h.x > 0.2) continue;
      vec2 center = (c + 0.2 + 0.6 * hash22(c + 5.3)) * cs;
      vec2 h3 = hash22(c + 77.7);
      float Rr = 0.026 + 0.018 * h3.x;
      vec2 d = p - center;
      if (length(d) > Rr * 1.6) continue;
      float a0 = h3.y * 6.2831853;
      float th = atan(d.y, d.x) + a0;
      float rr = length(d);
      th += 0.12 * sin(rr / Rr * 4.0 + h.y * 6.0);     // a little curl in the arms
      float arm = pow(0.5 + 0.5 * cos(5.0 * th), 2.2);
      float edge = Rr * (0.30 + 0.70 * arm);
      vec2 ds = d - sdir * Rr * 0.18;
      float ths = atan(ds.y, ds.x) + a0;
      float edgeS = Rr * (0.30 + 0.70 * pow(0.5 + 0.5 * cos(5.0 * ths), 2.2));
      float shadow = smoothstep(Rr * 0.12, -Rr * 0.12, length(ds) - edgeS);
      float m = (1.0 - cover) * smoothstep(0.03, 0.1, D);
      col *= 1.0 - 0.35 * shadow * m;
      float a = smoothstep(u_px, -u_px, rr - edge) * m;
      float k = fract(h.y * 4.7);
      vec3 sc = k < 0.45 ? vec3(0.90, 0.38, 0.16) : k < 0.75 ? vec3(0.72, 0.16, 0.12) : vec3(0.20, 0.38, 0.78);
      float thick = clamp(1.0 - rr / max(edge, 1e-4), 0.0, 1.0);
      float dots = smoothstep(0.35, 0.7, gnoise(d * 900.0 + c));
      sc *= 0.62 + 0.5 * sqrt(thick);
      sc = mix(sc, sc * 1.35 + 0.08, dots * 0.6);
      col = mix(col, sc, a);
    }
  }
  o = vec4(col, 1.0);
}`;

// ---- ripple simulation
const SIM_STEP_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_aspect;
uniform float u_damp;
uniform sampler2D u_floor;
uniform float u_tide;
// how fast ripples run here, as a share of their speed in deep water (squared). Water waves obey
// c² = (g/k)·tanh(kh): in shallow water that is g·h, so c = √(gh), and it levels off once the water is deeper
// than the ripples are long. Never quite zero, so the very edge of the water still moves
float speed2(vec2 uv) { return max(tanh(max(texture(u_floor, uv).a + u_tide * 1.1, 0.0) / 0.45), 0.04); }
void main() {
  vec4 s = texture(u_state, v_uv);
  // the shallow-water wave equation, d²h/dt² = div(c² grad h), with c² taken between each pair of cells: ripples
  // slow down, bunch up and grow taller as the water shoals, bend around the shallows and partly reflect off them
  vec2 ex = vec2(u_texel.x, 0.0), ey = vec2(0.0, u_texel.y);
  float k0 = speed2(v_uv);
  float flow = (k0 + speed2(v_uv + ex)) * (texture(u_state, v_uv + ex).r - s.r)
             + (k0 + speed2(v_uv - ex)) * (texture(u_state, v_uv - ex).r - s.r)
             + (k0 + speed2(v_uv + ey)) * (texture(u_state, v_uv + ey).r - s.r)
             + (k0 + speed2(v_uv - ey)) * (texture(u_state, v_uv - ey).r - s.r);
  s.g += flow * 0.25;                               // in deep water exactly the old 2 * (average - h)
  s.g *= u_damp;
  s.r += s.g;
  s.r *= 0.9993;
  // absorb at the screen edges: the sea goes on beyond them
  float edge = min(min(v_uv.x, 1.0 - v_uv.x) * u_aspect, min(v_uv.y, 1.0 - v_uv.y));
  s.rg *= mix(0.88, 1.0, smoothstep(0.0, 0.05, edge));
  // and die out on the beach
  s.rg *= mix(0.6, 1.0, smoothstep(-0.005, 0.04, texture(u_floor, v_uv).a + u_tide * 1.1));
  o = s;
}`;

const SIM_DROP_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform float u_aspect;
uniform vec4 u_dA[${MAX_DROPS}];
uniform vec2 u_dB[${MAX_DROPS}];
uniform int u_count;
void main() {
  vec4 s = texture(u_state, v_uv);
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    vec2 a = u_dA[i].xy, ba = u_dB[i] - a, pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    float x = max(0.0, 1.0 - length(pa - ba * h) / u_dA[i].z);
    s.r += (0.5 - 0.5 * cos(x * 3.14159265)) * u_dA[i].w;
  }
  o = s;
}`;

// ---- fish, rays, flowers, leaves (instanced SDF sprites)
const SPRITE_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_a;   // x, y, heading, length
layout(location = 2) in vec4 i_b;   // species, phase, bend, depth fraction (0 surface .. 1 seabed)
layout(location = 3) in vec4 i_c;   // rgb, extra
uniform float u_aspect;
uniform int u_shadow;
uniform sampler2D u_floor;
uniform sampler2D u_sim;
uniform vec2 u_sunShift;
uniform vec2 u_simTexel;
uniform float u_simScale;
out vec2 v_q;
out vec4 v_b;
out vec4 v_c;
out float v_blur;
void main() {
  float sp = i_b.x, len = i_a.w;
  // half size of the quad and where its centre sits, in body lengths (x points the way the creature faces)
  vec2 ext, off = vec2(0.0);
  if (sp < 1.5) ext = vec2(0.62, 0.36);                                  // fish
  else if (sp < 2.5) { ext = vec2(0.86, 0.45); off = vec2(-0.39, 0.0); } // stingray, tail behind
  else if (sp < 3.5) ext = vec2(0.6, 0.6);                               // flower
  else if (sp < 4.5) ext = vec2(0.68, 0.32);                             // leaf
  else if (sp < 5.5) { ext = vec2(1.5, 1.0); off = vec2(-1.0, 0.0); }    // eagle ray, long tail behind
  else if (sp < 6.5) { ext = vec2(0.56, 1.18); off = vec2(-0.08, 0.0); } // manta
  else if (sp < 7.5) ext = vec2(0.62, 0.62);                             // moon jelly
  else if (sp < 8.5) { ext = vec2(0.72, 0.62); off = vec2(-0.2, 0.0); }  // spotted lagoon jelly, arms trailing
  else if (sp < 9.5) { ext = vec2(0.74, 0.88); off = vec2(0.06, 0.0); } // sea turtle
  else if (sp < 10.5) ext = vec2(0.62, 0.62);                            // hermit crab
  else if (sp < 11.5) { ext = vec2(0.66, 1.0); off = vec2(-0.08, 0.0); } // gull (only its shadow is drawn)
  else if (sp < 12.5) ext = vec2(0.62, 0.62);                            // a crumb of fish food
  else if (sp < 13.5) { ext = vec2(0.6, 0.3); off = vec2(-0.03, 0.0); } // dolphin
  else if (sp < 14.5) ext = vec2(1.0, 1.0);                              // whitewater from a leap
  else if (sp < 15.5) ext = vec2(0.62, 0.62);                            // turtle hatchling
  else { ext = vec2(0.58, 0.3); off = vec2(-0.02, 0.0); }               // reef shark
  vec2 pos = i_a.xy;
  vec2 uv = clamp(vec2(pos.x / u_aspect, pos.y), 0.0, 1.0);
  float blur = 0.0;
  if (u_shadow == 1 && sp > 10.5 && sp < 11.5) {
    blur = 0.006;                                   // a gull high overhead: a soft shadow, already placed
  } else if (u_shadow == 1) {
    float D = max(textureLod(u_floor, uv, 0.0).a, 0.0);
    float above = min(D * (1.0 - i_b.w), 0.6);
    pos += u_sunShift * above;
    blur = 0.0025 + above * 0.02;
  } else if (u_shadow == 2) {
    blur = 0.012;                                   // glow halo around jellyfish at night
  }
  if (i_b.w < 0.01) {
    // floating things ride the ripples
    vec2 t = u_simTexel;
    vec2 g = vec2(textureLod(u_sim, uv + vec2(t.x, 0.0), 0.0).r - textureLod(u_sim, uv - vec2(t.x, 0.0), 0.0).r,
                  textureLod(u_sim, uv + vec2(0.0, t.y), 0.0).r - textureLod(u_sim, uv - vec2(0.0, t.y), 0.0).r);
    pos -= g * 0.5 * u_simScale * 0.03;
  }
  vec2 local = (a_corner * ext + off) * len + a_corner * blur * 1.5;
  float c = cos(i_a.z), s = sin(i_a.z);
  vec2 w = pos + mat2(c, s, -s, c) * local;
  v_q = local / len;
  v_b = i_b;
  v_c = i_c;
  v_blur = blur / len;
  gl_Position = vec4(w.x / u_aspect * 2.0 - 1.0, w.y * 2.0 - 1.0, 0.0, 1.0);
}`;

// the fragment shader's start, shared by the four sprite programs: inputs, noise, compositing, the glow flag
const SPRITE_HEAD = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_q;
in vec4 v_b;
in vec4 v_c;
in float v_blur;
uniform int u_shadow;
out vec4 o;
${NOISE}

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
float g_glow = -1.0;                                          // a sprite's own night glow, when it sets one

`;

// sprites: reef fish, small and big
const SPRITE_FISH = /* glsl */`#if defined(G_SMALL)
// reef fish seen from above, head along +x, in body lengths: snout at x = 0.5, tail tips at -0.5.
// x of v_b: 0 a little schooling fish, 1 a big fish; w of v_c says which big fish: 1 yellow tang, 2 sergeant major,
// 3 bluefin trevally
vec4 fish(vec2 q, out float sha) {
  float phase = v_b.y, bend = v_b.z, look = v_c.w;
  float bigF = step(0.5, v_b.x);
  float isTang = bigF * step(0.5, look) * step(look, 1.5), isSgt = bigF * step(1.5, look) * step(look, 2.5);
  float isTrev = bigF * step(2.5, look), isSmall = 1.0 - bigF;
  float aa = fwidth(q.x) + v_blur;
  float t = q.x + 0.5;                       // 0 tail tip .. 1 snout
  float tl = clamp(1.0 - t, 0.0, 1.0);
  q.y -= bend * (q.x - 0.25) * (q.x - 0.25);
  q.y -= 0.075 * tl * tl * sin(t * 6.0 - phase);
  float ay = abs(q.y);
  float mw = isSmall * 0.075 + isTang * 0.11 + isSgt * 0.135 + isTrev * 0.11;

  // body: a rounded head (a pointed snout on the tang), widest a third of the way back, narrowing into the tail stock
  float sb = (t - 0.18) / 0.82, w;
  if (sb > 0.58) {
    float e = clamp((sb - 0.58) / 0.42, 0.0, 1.0);
    w = mw * pow(max(1.0 - pow(e, mix(2.0, 1.7, isTang)), 0.0), mix(0.5, 0.62, isTang));
  } else {
    float e = clamp(sb / 0.58, 0.0, 1.0);
    w = mw * mix(mix(0.2, 0.15, isTrev), 1.0, sin(e * 1.5707963));
  }
  float body = smoothstep(aa, -aa, max(ay - w, max(-sb, sb - 1.0) * 0.85));
  // tail: forked on most, nearly square on the tang, a deep crescent on the trevally
  float u = t / 0.2;
  float fork = isSmall * 0.6 + isSgt * 0.5 + isTrev * 0.85 + isTang * 0.08;
  float outer = mw * mix(mix(1.25, 1.5, isTrev), 0.2, clamp(u, 0.0, 1.0));
  float notch = mw * 1.1 * clamp(1.0 - u / max(fork, 0.05), 0.0, 1.0) * step(0.1, fork);
  float tail = smoothstep(aa, -aa, max(max(ay - outer, notch - ay), max(-t, t - 0.21)));
  // pectoral fins flicking at the sides; long sickles on the trevally
  float flap = sin(phase * 0.5 + 1.0);
  vec2 fd = normalize(vec2(-0.75, 0.62 + 0.25 * flap));
  float fL = mix(0.07, 0.11, isTrev), fW = mix(0.026, 0.02, isTrev);
  vec2 fq = vec2(q.x - 0.13, ay - mw * 0.8) - fd * fL * 0.6;
  float fin = smoothstep(aa, -aa, (length(vec2(dot(fq, fd) / fL, dot(fq, vec2(-fd.y, fd.x)) / fW)) - 1.0) * fW);
  // the dorsal fin, seen edge-on as a thin strip along the back
  float dors = smoothstep(0.012, 0.004, ay) * smoothstep(-0.2, -0.1, q.x) * smoothstep(0.3, 0.2, q.x) * body;

  float cy = clamp(ay / max(w, 1e-3), 0.0, 1.0), nz = sqrt(max(1.0 - cy * cy, 0.0));
  vec3 back = v_c.rgb;
  // schooling fish: a dark back and a silver flank that flashes as they turn
  vec3 cSmall = mix(back, vec3(0.78, 0.85, 0.88), smoothstep(0.45, 0.9, cy));
  cSmall = mix(cSmall, vec3(0.95, 0.98, 1.0), smoothstep(0.55, 0.95, cy) * clamp(abs(bend) * 3.0, 0.0, 0.7));
  // yellow tang: yellow all over, a white scalpel on the tail stock
  vec3 cTang = back * (0.9 + 0.1 * nz);
  cTang = mix(cTang, vec3(0.97), smoothstep(0.016, 0.009, length(vec2((q.x + 0.27) / 1.6, ay - w * 0.55))));
  // sergeant major: a yellow-olive back, silvery sides, five dark bars
  vec3 cSgt = mix(back * vec3(1.15, 1.1, 0.75), vec3(0.82, 0.86, 0.85), smoothstep(0.35, 0.9, cy));
  float bars = smoothstep(0.35, 0.75, sin((q.x + 0.06 * cy * cy) * 52.0 + 1.0)) * smoothstep(-0.3, -0.26, q.x) * smoothstep(0.24, 0.2, q.x);
  cSgt = mix(cSgt, vec3(0.1, 0.11, 0.12), bars * 0.7);
  // bluefin trevally: a blue-green back flecked with black, silver-blue flanks
  vec3 cTrev = mix(back, vec3(0.7, 0.8, 0.88), smoothstep(0.45, 0.95, cy));
  cTrev *= 1.0 - 0.35 * step(0.82, hash21(floor(q * 70.0))) * smoothstep(0.7, 0.2, cy);
  vec3 bc = cSmall * isSmall + cTang * isTang + cSgt * isSgt + cTrev * isTrev;
  bc *= 0.8 + 0.25 * nz;                                                                   // rounded
  bc = mix(bc, back * 0.6, dors * (1.0 - isTang) * 0.6);
  // eyes on the sides of the head
  float er = mix(0.016, 0.022, bigF);
  vec2 eq = vec2(q.x - 0.37 + 0.07 * isTang, ay - w * 0.72);
  bc = mix(bc, vec3(0.75, 0.78, 0.8), smoothstep(er * 1.6, er * 1.15, length(eq)) * isSmall * 0.6);
  bc = mix(bc, vec3(0.04), smoothstep(er + aa, er - aa, length(eq)));
  // fins: see-through, tinted to the fish; electric blue on the trevally, dark-edged tail on the sergeant major
  vec3 finCol = isSmall * vec3(0.75, 0.82, 0.86) + isTang * back + isSgt * vec3(0.7, 0.72, 0.6) + isTrev * vec3(0.2, 0.55, 0.95);
  finCol = mix(finCol, vec3(0.12), isSgt * smoothstep(0.6, 1.0, ay / max(outer, 1e-3)) * tail);
  vec4 col = vec4(finCol, 1.0) * max(tail, fin) * mix(0.45, 0.75, bigF);
  col = over(vec4(bc, 1.0) * body * 0.96, col);
  sha = max(body * 0.85, max(tail, fin) * 0.45);
  return col;
}

#endif
`;

// sprites: the stingray, the eagle ray and the manta
const SPRITE_RAYS = /* glsl */`#if defined(G_RAY)
float sminR(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// blue-spotted ribbontail ray resting on the sand, in body lengths: an oval disc from x = -0.38 to 0.46, raised eyes
// with spiracles behind them, electric-blue spots, and a stout tail with a blue stripe down each side.
// Its margin ripples as it glides (y.phase)
vec4 stingray(vec2 q, out float sha) {
  float phase = v_b.y, aa = fwidth(q.x) + v_blur, seed = v_c.w * 31.0;
  float ay = abs(q.y);
  vec2 qa = vec2(q.x, ay);
  // disc: slightly longer than wide, blunt at the snout, widest just ahead of the middle
  float u = (q.x - 0.04) / 0.42;
  float hw = 0.38 * pow(max(1.0 - u * u, 0.0), 0.55);
  float u2 = (q.x + 0.004 - 0.04) / 0.42, u1 = (q.x - 0.004 - 0.04) / 0.42;
  float slope = 0.38 * (pow(max(1.0 - u2 * u2, 0.0), 0.55) - pow(max(1.0 - u1 * u1, 0.0), 0.55)) / 0.008;
  float ripple = 0.012 * sin(atan(ay, q.x - 0.04) * 6.0 - phase * 1.5) * smoothstep(0.15, 0.3, ay);
  float dDisc = max((ay - hw - ripple) / sqrt(1.0 + slope * slope), max(-0.38 - q.x, q.x - 0.46));
  float dPel = (length(vec2((q.x + 0.33) / 0.075, (ay - 0.085) / 0.05)) - 1.0) * 0.05;
  float tx = -q.x - 0.34, ty = q.y - 0.025 * sin(tx * 4.0 - phase * 0.6) * tx;
  float tw = mix(0.045, 0.006, pow(clamp(tx / 0.9, 0.0, 1.0), 0.7));
  float dTail = max(abs(ty) - tw, max(-tx, tx - 0.9));
  float d = sminR(sminR(dDisc, dPel, 0.02), dTail, 0.03);
  float a = smoothstep(aa, -aa, d);
  float disc = smoothstep(aa, -aa, dDisc);

  vec3 base = v_c.rgb;
  float nz = sqrt(max(1.0 - pow(ay / max(hw, 0.05), 2.0), 0.0));
  vec3 col = base * (0.8 + 0.28 * nz) * (1.0 - 0.18 * smoothstep(0.2, 0.6, gnoise(q * 6.0 + seed)));
  col = mix(col, base * 1.25, smoothstep(-0.03, 0.0, dDisc) * 0.45 * disc);                   // thin, paler margin
  // electric-blue spots of all sizes, right out to the margin
  vec2 cq = q / 0.085 + seed, cf = fract(cq) - 0.5, hr = hash22(floor(cq));
  float sd = length(cf - (hr - 0.5) * 0.5), sr = mix(0.1, 0.28, hr.y * hr.y);
  float spot = smoothstep(sr, sr * 0.7, sd) * step(0.18, hr.x) * smoothstep(0.0, -0.02, dDisc);
  vec3 blue = mix(vec3(0.08, 0.45, 0.98), vec3(0.45, 0.78, 1.0), smoothstep(sr * 0.7, 0.0, sd) * 0.6);
  // eyes: raised domes, gold ring round a dark pupil; spiracles just behind
  float eD = length(qa - vec2(0.2, 0.075));
  float eye = smoothstep(0.034, 0.027, eD);
  spot *= 1.0 - smoothstep(0.05, 0.035, eD);
  col = mix(col, blue, spot * 0.95);
  vec3 eyeC = mix(base * 1.1, vec3(0.78, 0.62, 0.26), smoothstep(0.024, 0.019, eD));
  eyeC = mix(eyeC, vec3(0.05, 0.04, 0.03), smoothstep(0.011, 0.007, length(vec2((q.x - 0.2) * 1.8, ay - 0.075))));
  eyeC += vec3(0.45) * smoothstep(0.006, 0.002, length(qa - vec2(0.208, 0.069)));               // wet glint
  col *= 1.0 - 0.25 * smoothstep(0.045, 0.03, length(qa - vec2(0.19, 0.078)));                  // the dome's shadow
  col = mix(col, eyeC, eye);
  col = mix(col, base * 0.25, smoothstep(0.012, 0.007, length(vec2((q.x - 0.13) / 1.6, ay - 0.082))));
  // tail: olive with a bright blue stripe down each side
  float tailM = smoothstep(aa, -aa, dTail) * (1.0 - disc);
  float ts = smoothstep(0.3, 0.45, abs(ty) / tw) * smoothstep(0.85, 0.7, abs(ty) / tw) * smoothstep(0.7, 0.5, tx) * step(0.02, tx);
  col = mix(col, mix(base * 0.85, vec3(0.1, 0.5, 1.0), ts), tailM);
  sha = a * 0.9;
  return vec4(col * a, a);
}

// spotted eagle ray: a distinct duck-bill head out ahead of long, swept, pointed wings; a whip of a tail three times
// the body length. Navy-black above, covered in white spots and rings. Slow wingbeats (y.phase)
vec4 eagleRay(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur, seed = v_c.w * 17.0;
  float flap = cos(ph), ay = abs(q.y);
  float W = 0.95 * (0.86 + 0.14 * flap);                    // wings look shorter at the top and bottom of a stroke
  float t = clamp(ay / W, 0.0, 1.0);
  float lag = 0.04 * flap * t * t;                           // the tips trail as the wing bends
  float xle = 0.2 - 0.48 * pow(t, 1.4) + 0.08 * sin(3.14159 * t) + lag;
  float xte = -0.3 + 0.13 * sin(3.14159 * pow(t, 0.7)) * (1.0 - t * t * t) + 0.02 * t + lag;
  float dWing = max(max(q.x - xle, xte - q.x), (ay - W) * 0.5);
  float hx = clamp(q.x, 0.12, 0.43);
  float dHead = length(vec2(q.x - hx, q.y)) - mix(0.085, 0.05, (hx - 0.12) / 0.31);
  float dBody = (length(vec2((q.x + 0.06) / 0.27, q.y / 0.11)) - 1.0) * 0.11;
  float dPel = (length(vec2((q.x + 0.3) / 0.045, (ay - 0.05) / 0.026)) - 1.0) * 0.026;
  float tx = -q.x - 0.32, ty = q.y - 0.025 * sin(tx * 3.0 - ph * 0.5) * tx;
  float dTail = max(abs(ty) - mix(0.013, 0.002, clamp(tx / 2.1, 0.0, 1.0)), max(-tx, tx - 2.1));
  float dDisc = sminR(sminR(dWing, dHead, 0.03), dBody, 0.03);
  float d = min(min(dDisc, dPel), dTail);
  float a = smoothstep(aa, -aa, d);
  float disc = smoothstep(aa, -aa, min(dDisc, dPel));

  vec3 base = v_c.rgb;
  float ridge = smoothstep(0.16, 0.0, ay) * smoothstep(-0.36, -0.1, q.x);
  vec3 col = base * (0.85 + 0.35 * ridge);                                                       // the raised body
  col *= 1.0 - 0.25 * smoothstep(0.55, 1.0, t);                                                  // darker wing tips
  col *= 1.0 - 0.18 * flap * smoothstep(0.2, 0.9, t);
  // white spots and rings, smaller toward the tips and on the head
  vec2 sq = q / 0.075 + seed, cf = fract(sq) - 0.5, hr = hash22(floor(sq));
  float dd = length(cf - (hr - 0.5) * 0.5), rS = mix(0.12, 0.22, hr.y) * mix(1.0, 0.55, t) * mix(1.0, 0.6, step(0.15, q.x) * step(ay, 0.09));
  float dotS = smoothstep(rS, rS * 0.72, dd), ring = smoothstep(rS * 1.25, rS, dd) * smoothstep(rS * 0.45, rS * 0.68, dd);
  float sp = mix(dotS, ring, step(0.72, hr.y)) * step(0.28, hr.x) * smoothstep(0.0, -0.02, dDisc);
  col = mix(col, vec3(0.9, 0.93, 0.95), sp * 0.9 * disc);
  // eyes bulge from the sides of the head
  col = mix(col, vec3(0.03), smoothstep(0.018, 0.011, length(vec2(q.x - 0.24, ay - 0.072))) * disc);
  col = mix(col, base * 0.8, (1.0 - disc));                                                      // tail
  sha = a * 0.85;
  return vec4(col * a, a);
}

// reef manta: broad triangular wings with falcate tips, a wide mouth between two rolled cephalic fins, black above
// with pale shoulder patches either side of a dark spine, a short tail. Slow, deep wingbeats (y.phase)
vec4 manta(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur, seed = v_c.w * 9.0;
  float flap = cos(ph), ay = abs(q.y);
  float W = 1.1 * (0.86 + 0.14 * flap);
  float t = clamp(ay / W, 0.0, 1.0);
  float tip = 0.06 * flap * t * t - 0.05 * smoothstep(0.85, 1.0, t);
  float xle = 0.3 - 0.55 * pow(t, 1.1) + 0.05 * sin(3.14159 * t) + tip;
  float xte = -0.26 + 0.17 * sin(3.14159 * pow(t, 0.75)) * (1.0 - pow(t, 4.0)) + 0.01 * t + tip;
  float dWing = max(max(q.x - xle, xte - q.x), (ay - W) * 0.5);
  float dCeph = (length(vec2((q.x - 0.355) / 0.075, (ay - 0.11) / 0.03)) - 1.0) * 0.03;
  float tx = -q.x - 0.24;
  float dTail = max(ay - mix(0.016, 0.003, clamp(tx / 0.38, 0.0, 1.0)), max(-tx, tx - 0.38));
  float dDors = (length(vec2((q.x + 0.25) / 0.04, q.y / 0.015)) - 1.0) * 0.015;
  float d = min(sminR(dWing, dCeph, 0.015), min(dTail, dDors));
  float a = smoothstep(aa, -aa, d);

  vec3 base = v_c.rgb;
  float ridge = smoothstep(0.2, 0.0, ay) * smoothstep(-0.3, 0.0, q.x);
  vec3 col = base * (0.9 + 0.5 * ridge);
  // pale shoulder patches: from just behind the head out along the leading edge, the spine between them dark
  vec2 pa = vec2(0.25, 0.1), pb = vec2(0.17, 0.44), pc = vec2(-0.02, 0.15);
  vec2 pp = vec2(q.x, ay) + 0.02 * vec2(gnoise(q * 9.0 + seed), gnoise(q * 9.0 - seed));
  vec2 e0 = pb - pa, e1 = pc - pb, e2 = pa - pc, v0 = pp - pa, v1 = pp - pb, v2 = pp - pc;
  vec2 w0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 w1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 w2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float sg = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 dm = min(min(vec2(dot(w0, w0), sg * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(w1, w1), sg * (v1.x * e1.y - v1.y * e1.x))),
                vec2(dot(w2, w2), sg * (v2.x * e2.y - v2.y * e2.x)));
  float dTri = -sqrt(dm.x) * sign(dm.y);
  float sh = smoothstep(0.035, -0.03, dTri) * mix(0.55, 1.0, smoothstep(0.0, 0.2, q.x));       // brightest up front
  col = mix(col, vec3(0.8, 0.83, 0.85), sh * 0.8);
  col *= 1.0 - 0.18 * flap * smoothstep(0.3, 0.95, t);
  col = mix(col, base * 1.6, smoothstep(0.0, -0.02, dCeph) * smoothstep(0.1, 0.13, ay) * 0.5);  // inner face of the horns
  sha = a * 0.9;
  return vec4(col * a, a);
}

#endif
`;

// sprites: moon jellies and spotted lagoon jellies
const SPRITE_JELLIES = /* glsl */`#if defined(G_BIG)
// moon jelly: a clear, milky bell with a fringe of fine tentacles, four lilac horseshoe gonads, radial canals and
// four frilly oral arms showing through the middle. It pulses (y.phase)
vec4 moonJelly(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur;
  float pulse = 0.5 + 0.5 * sin(ph);                          // 1 relaxed, 0 contracted
  float R = 0.5 * (0.86 + 0.14 * pulse);
  vec2 d = vec2(q.x * (1.0 + 0.06 * (1.0 - pulse)), q.y);
  float r = length(d), ang = atan(d.y, d.x);
  float edge = R * (1.0 + 0.02 * sin(ang * 16.0));
  float bell = smoothstep(aa, -aa, r - edge);
  float rim = smoothstep(R * 0.1, 0.0, abs(r - edge * 0.95)) * bell;
  float fringe = smoothstep(R * 0.12, 0.0, r - edge) * (1.0 - bell) * (0.5 + 0.5 * sin(ang * 90.0 + ph));
  float canal = smoothstep(0.92, 1.0, cos(ang * 16.0 + v_c.w * 6.28)) * smoothstep(R * 0.35, R * 0.6, r) * smoothstep(R * 0.98, R * 0.85, r) * bell;
  float gon = 0.0, arms = 0.0;
  for (int k = 0; k < 4; k++) {
    float a0 = float(k) * 1.5708 + v_c.w * 6.2831853 + 0.785;
    vec2 dir = vec2(cos(a0), sin(a0));
    vec2 g = d - dir * R * 0.3;
    float open = dot(normalize(g + 1e-5), dir);               // each horseshoe opens toward the middle
    gon = max(gon, smoothstep(R * 0.055, R * 0.025, abs(length(g) - R * 0.16)) * smoothstep(-0.8, -0.45, open));
    vec2 ad = vec2(cos(a0 + 0.785), sin(a0 + 0.785));         // the arms run between the gonads
    float along = dot(d, ad), across = dot(d, vec2(-ad.y, ad.x)) + 0.012 * sin(along * 70.0 + ph);
    arms = max(arms, smoothstep(R * 0.07, R * 0.035, abs(across)) * smoothstep(0.0, R * 0.08, along) * smoothstep(R * 0.6, R * 0.3, along));
  }
  float a = bell * 0.27 + rim * 0.5 + canal * 0.18 + fringe * 0.36 + arms * 0.22 * bell;
  vec4 c = vec4(vec3(0.88, 0.94, 1.0) * a, a);
  c.rgb += vec3(0.2) * bell * smoothstep(0.7, 0.0, length(d / R - vec2(0.25, 0.3))) * 0.35;     // sheen on the dome
  c = over(vec4(0.92, 0.55, 0.86, 1.0) * gon * bell * 0.95, c);
  sha = c.a * 0.35;
  return c;
}

// spotted lagoon jelly (Mastigias papua) from above: a plump, see-through dome, golden-olive or blue, dusted with
// white spots that grow bigger toward the top and a softly scalloped rim. Through it show eight stubby oral arms that
// trail a little way behind as it swims, each ending in a pale club; no long stinging tentacles. It pulses (y.phase)
vec4 lagoonJelly(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur, seed = v_c.w * 6.2831853;
  float pulse = 0.5 + 0.5 * sin(ph);                          // 1 relaxed, 0 contracted
  float R = 0.5 * (0.86 + 0.14 * pulse);
  vec2 d = vec2(q.x * (1.0 + 0.08 * (1.0 - pulse)), q.y);
  float r = length(d), ang = atan(d.y, d.x);
  float edge = R * (1.0 - 0.03 * abs(sin(ang * 8.0 + seed)));
  float bell = smoothstep(aa, -aa, r - edge);
  float dome = sqrt(max(1.0 - (r / edge) * (r / edge), 0.0));
  bool blue = v_c.w < 0.35;
  vec3 base = blue ? vec3(0.42, 0.62, 0.88) : vec3(0.90, 0.62, 0.30);

  // the oral arms hang below the bell and drift back as it swims: eight short ribbons ending in pale clubs
  float arms = 0.0, club = 0.0;
  for (int k = 0; k < 8; k++) {
    float fk = float(k), side = (fk + 0.5) / 8.0 - 0.5;
    vec2 a0 = vec2(R * 0.05, side * R * 0.7);
    vec2 a1 = vec2(-R * (1.25 + 0.15 * sin(fk * 2.3 + seed)), side * R * 1.25) + vec2(0.0, 0.05 * sin(ph * 0.7 + fk * 1.9));
    vec2 ab = a1 - a0, ap = q - a0;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    vec2 off = ap - ab * t;
    float w = R * mix(0.09, 0.06, t) * (1.0 + 0.25 * sin(t * 18.0 + fk));    // frilled along its length
    arms = max(arms, smoothstep(w + aa, w - aa, length(off)));
    club = max(club, smoothstep(R * 0.1 + aa, R * 0.1 - aa, length(q - a1)));
  }
  vec4 c = vec4(base * 0.62, 1.0) * arms * 0.8;
  c = over(vec4(vec3(0.95, 0.92, 0.84), 1.0) * club * 0.85, c);

  // the dome: deeper in colour toward the top, its edge clearer, and over it the white spots
  vec3 bc = base * (0.7 + 0.4 * dome);
  // scattered, not in rows: a turned grid, each spot jittered well off its cell's centre, some cells left bare
  vec2 g = rot(0.6 + seed) * d / R * 5.0 + seed * 3.0, ci = floor(g);
  vec2 h = hash22(ci);
  float rs = (0.1 + 0.13 * dome) * (0.55 + 0.9 * h.y) * step(0.18, fract(h.x * 7.3));
  float spot = smoothstep(rs + 0.05, rs - 0.05, length(g - ci - 0.5 - (h - 0.5) * 0.62));
  spot *= smoothstep(R * 0.97, R * 0.8, r);
  bc = mix(bc, vec3(0.98, 0.96, 0.9), spot);
  float rim = smoothstep(R * 0.12, 0.0, abs(r - edge * 0.96)) * bell;
  bc = mix(bc, base * 1.25 + 0.08, rim * 0.5);
  bc += vec3(0.25) * smoothstep(0.55, 0.0, length(d / R - vec2(0.3, 0.32))) * dome;   // sheen on the dome
  vec4 bellC = vec4(bc, 1.0) * bell * mix(0.55, 0.85, max(dome, spot));
  c = over(bellC, c);
  // at night the spots, the rim and the clubs glow; the clear dome between them barely does
  g_glow = clamp(spot * bell * 0.9 + rim * 0.6 + club * 0.8 + bell * 0.12, 0.0, 1.0);
  sha = c.a * 0.4;
  return c;
}

#endif
`;

// sprites: flowers and leaves floating on the surface
const SPRITE_FLOATS = /* glsl */`#if defined(G_SMALL)
vec4 flower(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  vec4 col = vec4(0.0);
  float r0 = v_c.w * 6.2831853;
  for (int k = 0; k < 5; k++) {
    float ang = r0 + float(k) * 1.2566371;
    vec2 d = rot(-ang) * q;
    d.y += 0.35 * d.x * d.x;                 // pinwheel twist
    d.x -= 0.21;
    float e = (length(vec2(d.x / 0.23, d.y / 0.14)) - 1.0) * 0.14;
    float pa = smoothstep(aa, -aa, e);
    float shade = 0.84 + 0.16 * smoothstep(-0.14, 0.14, d.y);
    vec3 pc = mix(vec3(0.99, 0.78, 0.28), vec3(0.99, 0.98, 0.95), smoothstep(-0.2, 0.02, d.x));
    pc = mix(pc, v_c.rgb, smoothstep(0.0, 0.2, d.x) * 0.5);
    col = over(vec4(pc * shade, 1.0) * pa, col);
  }
  sha = col.a * 0.9;
  return col;
}

vec4 leaf(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  float t = q.x + 0.5;
  float y = q.y - 0.06 * sin(t * 3.14159) * (v_c.w - 0.5);
  float w = 0.2 * pow(max(sin(3.14159 * clamp(t, 0.0, 1.0)), 0.0), 0.75) * (1.0 + 0.3 * (0.5 - t));
  float lf = smoothstep(aa, -aa, max(abs(y) - w, max(-t, t - 1.0) * 0.5));
  float stem = smoothstep(aa, -aa, max(abs(q.y) - 0.012, max(q.x + 0.62, -q.x - 0.48)));
  float a = max(lf, stem);
  vec3 base = v_c.rgb;
  float ry = abs(y) / max(w, 1e-3);
  vec3 col = base * (0.85 + 0.25 * ry);
  float vein = smoothstep(0.016, 0.0, abs(y)) + 0.6 * smoothstep(0.08, 0.0, abs(fract((t - abs(y) * 1.3) * 7.0) - 0.5)) * step(0.1, ry);
  col = mix(col, base * 1.3 + 0.05, clamp(vein, 0.0, 1.0) * 0.5);
  col = mix(col, base * 0.7, stem * (1.0 - lf));
  sha = a * 0.85;
  return vec4(col * a, a);
}

// sea turtles seen from above, in body lengths: the carapace runs from x = -0.46 to 0.42, the head to about 0.68.
// z.bend picks the species: 0 green, 1 hawksbill, 2 olive ridley.
// Carapace outline: sh = (half width, how far forward the widest point sits, bluntness)
#endif
`;

// sprites: green, hawksbill and olive ridley turtles
const SPRITE_TURTLE = /* glsl */`#if defined(G_TURTLE)
float turtleShellW(float x, vec3 sh) {
  float t = clamp((x + 0.46) / 0.88, 0.0, 1.0);
  return sh.x * pow(max(sin(3.14159265 * pow(t, sh.y)), 0.0), sh.z);
}
// distance to the nearest border in a field of irregular scales, in cell units
float scaleEdge(vec2 p) {
  vec2 i = floor(p), f = p - i;
  float f1 = 9.0, f2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    float d = length(g + hash22(i + g) * 0.8 + 0.1 - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}
const vec2 HEADSC[7] = vec2[7](vec2(0.645, 0.0), vec2(0.605, 0.035), vec2(0.56, 0.0), vec2(0.52, 0.042),
                               vec2(0.48, 0.0), vec2(0.475, 0.066), vec2(0.565, 0.072));
vec4 turtle(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur, seed = v_c.w * 37.0;
  float ay = abs(q.y);
  vec2 qa = vec2(q.x, ay);
  float hawk = step(0.5, v_b.z) * step(v_b.z, 1.5), ridley = step(1.5, v_b.z), green = 1.0 - hawk - ridley;

  // ---- skin: front flippers (long curved paddles rowing together), rear flippers, neck, head, a stub of tail
  float fa = mix(0.45, 1.7, 0.5 + 0.5 * sin(ph));
  vec2 fd = vec2(-cos(fa), sin(fa)), fn = vec2(sin(fa), cos(fa));
  vec2 rel = qa - vec2(0.2, 0.24);
  float fl = dot(rel, fd), fc = dot(rel, fn) + 0.4 * fl * max(fl, 0.0);
  float ft = clamp(fl / 0.55, 0.0, 1.0);
  float pw = pow(max(sin(3.14159265 * min(1.0, 0.25 + 0.75 * ft)), 0.0), 0.7);
  float wLead = 0.075 * pw + 0.004, wTrail = 0.048 * pw + 0.003;
  float dF = max(fc > 0.0 ? fc - wLead : -fc - wTrail, max(-fl - 0.05, fl - 0.55));
  float ra = 0.55 + 0.15 * sin(ph * 2.0 + 1.0);
  vec2 rd = vec2(-cos(ra), sin(ra)), rn = vec2(sin(ra), cos(ra));
  vec2 rr = qa - vec2(-0.36, 0.17);
  float rl = dot(rr, rd), rc = dot(rr, rn), rt = clamp(rl / 0.24, 0.0, 1.0);
  float dR = max(abs(rc + 0.01) - (0.06 * sqrt(max(1.0 - rt * rt, 0.0)) + 0.01 * (1.0 - rt)), max(-rl - 0.04, rl - 0.24));
  float ry = green * 0.085 * (1.0 - 0.3 * smoothstep(0.52, 0.68, q.x))
           + hawk * 0.072 * (1.0 - 0.6 * smoothstep(0.5, 0.72, q.x))
           + ridley * 0.1 * (1.0 - 0.4 * smoothstep(0.48, 0.68, q.x));
  float hc = 0.55 + 0.03 * hawk, hrx = 0.125 + 0.03 * hawk + 0.005 * ridley;
  float dH = (length(vec2((q.x - hc) / hrx, q.y / ry)) - 1.0) * ry;
  float dN = length(vec2(q.x - clamp(q.x, 0.34, 0.48), q.y)) - 0.065;
  float dT = max(ay - 0.03 * clamp((q.x + 0.56) / 0.12, 0.0, 1.0), max(q.x + 0.4, -0.56 - q.x));
  float dSkin = min(min(dF, dR), min(min(dH, dN), dT));
  float skin = smoothstep(aa, -aa, dSkin);
  // dark scales with pale borders: big ones on the flippers, a symmetric set of plates on the head, small on the neck
  vec2 pF = vec2(fl, fc) / 0.045 + seed, pG = qa / 0.028 + seed;
  float eF = scaleEdge(pF), eG = scaleEdge(pG);
  float h1 = 9.0, h2 = 9.0;
  for (int k = 0; k < 7; k++) {
    float d = length(qa - HEADSC[k]);
    if (d < h1) { h2 = h1; h1 = d; } else if (d < h2) h2 = d;
  }
  float eH = (h2 - h1) / 0.035;
  float fwF = fwidth(pF.x), fwG = fwidth(pG.x), fwH = fwidth(q.x / 0.035);
  float onHead = step(dH, 0.0), onFlip = step(dF, 0.0) * (1.0 - onHead);
  float e = mix(mix(eG, eF, onFlip), eH, onHead), fw = mix(mix(fwG, fwF, onFlip), fwH, onHead);
  float border = mix(1.0 - smoothstep(0.02, 0.09, e), 0.25, smoothstep(0.25, 0.6, fw));     // blur out when tiny
  vec3 kDark = green * vec3(0.3, 0.25, 0.17) + hawk * vec3(0.24, 0.14, 0.07) + ridley * vec3(0.27, 0.28, 0.21);
  vec3 kPale = green * vec3(0.66, 0.6, 0.43) + hawk * vec3(0.78, 0.62, 0.34) + ridley * vec3(0.48, 0.49, 0.4);
  vec3 kc = mix(kDark, kPale, border);
  kc = mix(kc, kPale * 0.95, smoothstep(-0.55, -0.95, fc / wTrail) * onFlip * 0.6);
  kc *= 0.8 + 0.2 * smoothstep(0.0, -0.025, dSkin);                                           // rounded edges
  kc = mix(kc, vec3(0.12, 0.1, 0.08), smoothstep(0.013, 0.007, length(vec2(fl - 0.17, fc - 0.05))) * onFlip);  // claw
  kc = mix(kc, vec3(0.12, 0.1, 0.08), smoothstep(0.012, 0.006, length(vec2(fl - 0.25, fc - 0.045))) * onFlip * hawk);  // hawksbill: a second
  kc = mix(kc, vec3(0.06), smoothstep(0.016, 0.009, length(vec2((q.x - 0.565) / 1.4, ay - 0.074))) * smoothstep(0.02, -0.01, dH));  // eyes

  // ---- carapace
  vec3 shp = green * vec3(0.37, 1.357, 0.5) + hawk * vec3(0.33, 1.2, 0.62) + ridley * vec3(0.41, 1.05, 0.42);
  float ang = atan(q.y / shp.x, (q.x + 0.02) / 0.44), seg = ang * 24.0 / 6.2831853;
  float hw = turtleShellW(q.x, shp);
  float slope = (turtleShellW(q.x + 0.005, shp) - turtleShellW(q.x - 0.005, shp)) / 0.01;
  hw -= hawk * 0.016 * abs(fract(seg) - 0.5) * 2.0 * smoothstep(-0.1, -0.25, q.x);              // saw-toothed back edge
  float dS = max((ay - hw) / sqrt(1.0 + slope * slope), max(q.x - 0.42, -0.46 - q.x));
  float shell = smoothstep(aa, -aa, dS);
  float rim = smoothstep(-0.058, -0.052, dS);                       // the ring of small marginal plates
  float dMs = (0.5 - abs(fract(seg) - 0.5)) * 6.2831853 / 24.0 * 0.4;
  float dMi = abs(dS + 0.055);
  // five vertebral plates down the spine (six-sided), four costal plates either side, their seams slanting back
  float nV = 5.0 + ridley, vsp = 0.76 / nV;
  float vu = (0.33 - q.x) / vsp, vk = floor(vu), vf = vu - vk;
  float inRow = step(0.0, vu) * step(vu, nV);
  float vb = 0.085 + 0.04 * (1.0 - abs(2.0 * vf - 1.0));
  float inV = step(ay, vb) * inRow;
  float dVb = mix(9.0, abs(ay - vb), inRow), dVs = (0.5 - abs(fract(vu + 0.5) - 0.5)) * vsp;
  float cpos = q.x + 0.3 * (ay - 0.1) - ridley * 0.025 * sign(q.y);
  float dCs = 9.0;
  for (int k = 0; k < 5; k++) {
    float cs = ridley > 0.5 ? 0.2 - 0.12 * float(k) : (k < 3 ? 0.16 - 0.18 * float(k) : 99.0);
    dCs = min(dCs, abs(cpos - cs));
  }
  dCs /= 1.044;
  float dSeam = mix(mix(min(dVb, dCs), min(dVb, dVs), inV), min(dMs, dMi), rim);
  float sw = max(0.0035, aa * 0.8);
  float seam = smoothstep(sw * 1.6, sw * 0.5, min(dSeam, dMi));
  // each plate grows outward from a point near its back edge, leaving a sunburst of light and dark streaks
  float ck = cpos > 0.16 ? 0.27 : cpos > -0.02 ? 0.07 : cpos > -0.2 ? -0.11 : -0.31;
  if (ridley > 0.5) ck = 0.26 - 0.12 * clamp(floor((0.2 - cpos) / 0.12) + 1.0, 0.0, 5.0);
  vec2 gc = inV > 0.5 ? vec2(0.33 - (vk + 0.72) * vsp, 0.0) : vec2(ck - 0.063, 0.21);
  vec2 rg = qa - gc;
  float burst = sin(atan(rg.y, rg.x) * 5.0 + 3.5 * gnoise(qa * 5.0 + seed) + length(rg) * 8.0) + 0.5 * gnoise(qa * 11.0 - seed);
  burst = mix(burst, sin(seg * 6.2831853 * 2.0 + 2.5 * gnoise(qa * 8.0 + seed)), rim * 0.7);
  float lightS = smoothstep(-0.4, 1.0, burst) * mix(smoothstep(0.0, 0.05, length(rg)), 1.0, rim);
  vec3 base = v_c.rgb;
  vec3 scG = mix(base * vec3(0.72, 0.7, 0.66), base * vec3(1.3, 1.28, 1.15) + vec3(0.05, 0.04, 0.0), lightS * 0.6);
  scG = mix(scG, base * 0.5, smoothstep(0.1, 0.6, gnoise(qa * 3.5 + seed * 1.3)) * 0.4);      // darker blotches
  // tortoiseshell: each plate fans out from its growth point in rays of amber and dark brown over warm brown
  float hb = 0.7 * sin(atan(rg.y, rg.x) * 4.0 + 3.5 * gnoise(qa * 4.0 + seed) + length(rg) * 5.0) + 0.8 * gnoise(qa * 6.0 - seed);
  hb = mix(hb, 0.9 * sin(seg * 6.2831853 * 1.5 + 3.0 * gnoise(qa * 6.0 + seed)), rim * 0.6);
  vec3 scH = mix(vec3(0.28, 0.14, 0.06), base, smoothstep(-0.9, 0.3, hb));                        // dark brown into warm brown
  scH = mix(scH, vec3(0.86, 0.58, 0.24), smoothstep(0.45, 1.2, hb) * 0.85 * mix(smoothstep(0.0, 0.06, length(rg)), 1.0, rim));  // amber fans
  scH = mix(scH, vec3(0.14, 0.07, 0.03), smoothstep(-0.9, -1.4, hb) * 0.6);                     // darkest streaks
  // plates overlap like roof tiles: a shadow just behind each seam, the overlapping edge catching the light
  float cfr = fract((0.16 - cpos) / 0.18), inC = (1.0 - inV) * (1.0 - rim) * step(-0.38, cpos) * step(cpos, 0.34);
  float tile = smoothstep(0.2, 0.0, vf) * inV + smoothstep(0.18, 0.0, cfr) * inC;
  float edge = smoothstep(0.93, 1.0, vf) * inV + smoothstep(0.94, 1.0, cfr) * inC;
  scH = scH * (1.0 - 0.35 * tile) + vec3(0.22, 0.15, 0.06) * edge;
  vec3 scR = base * (0.8 + 0.3 * gnoise(qa * 5.0 + seed)) * (0.85 + 0.25 * lightS);
  vec3 sc = green * scG + hawk * scH + ridley * scR;
  float nzS = sqrt(max(1.0 - pow(ay / max(hw, 0.05), 2.0), 0.0));
  sc *= mix(0.7 + 0.4 * nzS, 0.82 + 0.25 * nzS, ridley);                                       // domed (the ridley flatter)
  vec3 seamC = mix(vec3(0.6, 0.56, 0.44), vec3(0.16, 0.08, 0.04), hawk) * (0.7 + 0.4 * nzS);       // pale seams; dark on the hawksbill
  sc = mix(sc, seamC, seam * mix(0.4, 0.7, hawk) * smoothstep(0.014, 0.005, aa));
  sc += vec3(0.25) * smoothstep(0.15, 0.03, v_b.w) * pow(nzS, 6.0) * 0.5;                     // wet sheen near the surface

  vec4 c = over(vec4(sc, 1.0) * shell, vec4(kc, 1.0) * skin);
  sha = max(shell, skin) * 0.9;
  return c;
}

// hermit crab: a borrowed spiral shell, red legs and claws that vanish when it hides
#endif
`;

// sprites: hermit crabs and crumbs of fish food
const SPRITE_BEACH = /* glsl */`#if defined(G_SMALL)
vec4 hermitCrab(vec2 q, out float sha) {
  float ph = v_b.y, hide = v_b.z, aa = fwidth(q.x) + v_blur;
  vec2 sq = q + vec2(0.08, 0.0);
  float shell = smoothstep(aa, -aa, (length(vec2(sq.x / 0.36, sq.y / 0.27)) - 1.0) * 0.27);
  vec2 sc = sq - vec2(-0.12, 0.05);
  float band = 0.5 + 0.5 * sin(length(sc) * 42.0 - atan(sc.y, sc.x) * 2.0);
  vec3 shc = v_c.rgb * (0.75 + 0.3 * band) * (0.8 + 0.3 * smoothstep(0.3, -0.1, length(sq - vec2(0.05, 0.08))));
  vec2 bq = q + vec2(hide * 0.2, 0.0);
  float body = smoothstep(aa, -aa, (length(vec2((bq.x - 0.28) / 0.10, bq.y / 0.12)) - 1.0) * 0.10);
  float claws = max(smoothstep(aa, -aa, (length(vec2((bq.x - 0.40) / 0.09, (bq.y - 0.07) / 0.06)) - 1.0) * 0.06),
                    smoothstep(aa, -aa, (length(vec2((bq.x - 0.38) / 0.06, (bq.y + 0.08) / 0.04)) - 1.0) * 0.04));
  float legs = 0.0;
  for (int k = 0; k < 3; k++) for (int sd = 0; sd < 2; sd++) {
    float side = sd == 0 ? 1.0 : -1.0;
    vec2 base = vec2(0.22 - 0.07 * float(k), 0.10 * side);
    float ang = side * (1.25 + 0.3 * float(k) + 0.35 * sin(ph + float(k) * 2.1 + side));
    vec2 dir = vec2(cos(ang), sin(ang)), lq = bq - base;
    float t = clamp(dot(lq, dir), 0.0, 0.24);
    legs = max(legs, smoothstep(0.022 + aa, 0.022 - aa, length(lq - dir * t)));
  }
  float eyes = smoothstep(0.02 + aa, 0.02 - aa, length(vec2(bq.x - 0.47, abs(bq.y) - 0.035)));
  float crab = max(max(body, claws), legs) * (1.0 - hide);
  vec4 c = vec4(vec3(0.80, 0.33, 0.18), 1.0) * crab;
  c = over(vec4(0.05, 0.03, 0.03, 1.0) * eyes * (1.0 - hide), c);
  c = over(vec4(shc, 1.0) * shell, c);
  sha = c.a * 0.8;
  return c;
}

// a crumb of fish food: a little rounded flake, lit on one side
vec4 pellet(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  float a = smoothstep(0.5 + aa, 0.5 - aa, length(q * vec2(1.0, 1.2)));
  vec3 c = v_c.rgb * (0.75 + 0.45 * smoothstep(0.55, -0.1, length(q - vec2(-0.12, 0.16))));
  sha = a * 0.7;
  return vec4(c * a, a);
}

#endif
`;

// sprites: the reef shark and the bottlenose dolphin
const SPRITE_BIG = /* glsl */`#if defined(G_BIG)
// blacktip reef shark seen from above, in body lengths: snout at x = 0.5, tail tip at x = -0.5. A slim torpedo
// in warm grey with a rounded snout, broad sickle-shaped pectoral fins, and black tips on its fins; it swims by
// sweeping its body from side to side, the sweep growing toward the tail (y.phase), and curves into turns (z.bend)
float sharkW(float x) {
  float t = clamp((x + 0.36) / 0.86, 0.0, 1.0);                // 0 at the tail stock, 1 at the snout
  float sn = max(sin(3.14159265 * pow(t, 1.15)), 0.0);
  return 0.01 + 0.062 * pow(sn, 0.72);
}
// a fin from a root on the body out to a pointed tip, swept back along a gentle curve; returns distance, out the
// share of the way out to the tip
float sharkFin(vec2 p, vec2 root, vec2 dir, float len, float w0, float curve, out float t) {
  vec2 rel = p - root;
  float al = dot(rel, dir), ac = dot(rel, vec2(dir.y, -dir.x)) + curve * al * max(al, 0.0);
  t = clamp(al / len, 0.0, 1.0);
  float w = w0 * pow(max(1.0 - al / len, 0.0), 0.6);
  return max(abs(ac) - w, max(-al - 0.01, al - len));
}
float sminK(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
vec4 shark(vec2 q, out float sha) {
  float ph = v_b.y, bend = v_b.z, aa = fwidth(q.x) + v_blur;
  float sweep = smoothstep(0.3, -0.5, q.x);
  q.y -= bend * 0.35 * (q.x - 0.25) * (q.x - 0.25) + 0.045 * sweep * sweep * sin(ph + q.x * 6.0);
  float ay = abs(q.y);
  float w = sharkW(q.x);
  float dBody = max(ay - w, max(q.x - 0.5, -0.37 - q.x));
  vec2 qa = vec2(q.x, ay);
  float tP, tV, tC;
  float dPec = sharkFin(qa, vec2(0.16, 0.045), normalize(vec2(-0.55, 0.84)), 0.25, 0.06, 1.5, tP);
  float dPel = sharkFin(qa, vec2(-0.16, 0.02), normalize(vec2(-0.7, 0.71)), 0.08, 0.022, 1.0, tV);
  // the tail fin stands upright, so from above it is a narrow, slightly curved blade trailing from the tail stock
  float dCaud = sharkFin(vec2(q.x, q.y), vec2(-0.34, 0.0), vec2(-1.0, 0.0), 0.17, 0.02, 0.6, tC);
  float d = sminK(sminK(dBody, dPec, 0.012), min(dPel, dCaud), 0.008);
  float a = smoothstep(aa, -aa, d);
  float trunk = smoothstep(aa, -aa, dBody);
  vec3 back = v_c.rgb, flank = back * 1.35 + vec3(0.04, 0.04, 0.035);
  float wx = max(sharkW(clamp(q.x, -0.37, 0.45)), 0.012);
  float yw = clamp(q.y / wx, -1.0, 1.0), nz = sqrt(max(1.0 - yw * yw, 0.0));
  vec3 c = mix(back, flank, smoothstep(0.45, 0.95, abs(yw)) * trunk);
  c *= mix(0.85, 0.66 + 0.42 * nz, trunk);
  // fins: a shade darker, with the black tips that give the shark its name
  float fins = (1.0 - trunk) * a;
  c = mix(c, back * 0.9, fins);
  float tip = max(smoothstep(0.72, 0.9, tP) * step(dPec, 0.0), smoothstep(0.6, 0.85, tC) * step(dCaud, 0.0));
  c = mix(c, vec3(0.06, 0.06, 0.07), tip * 0.9);
  // the first dorsal fin, upright and seen edge-on: a thin ridge down the spine, black at its tip, with a soft
  // shadow at its foot; the small second dorsal near the tail
  float fd = clamp((q.x + 0.1) / 0.17, 0.0, 1.0), inFin = smoothstep(-0.115, -0.09, q.x) * smoothstep(0.08, 0.055, q.x);
  float fwid = 0.0015 + 0.0032 * smoothstep(0.0, 0.6, fd) * (1.0 - smoothstep(0.85, 1.0, fd));
  c *= 1.0 - 0.1 * smoothstep(0.014, 0.0, ay - fwid) * inFin;
  c = mix(c, mix(vec3(0.07), back * 0.72, smoothstep(0.0, 0.3, fd)), smoothstep(aa, -aa, ay - fwid) * inFin);
  c = mix(c, back * 0.55, smoothstep(aa, -aa, ay - 0.004) * smoothstep(-0.3, -0.285, q.x) * smoothstep(-0.25, -0.265, q.x));
  // eyes, and the faint gill slits on the flanks
  c = mix(c, vec3(0.05), smoothstep(0.008, 0.005, length(qa - vec2(0.37, sharkW(0.37) * 0.82))));
  float gill = smoothstep(0.004, 0.0, abs(fract((q.x - 0.24) / 0.022) - 0.5) * 0.022) * step(0.24, q.x) * step(q.x, 0.33);
  c *= 1.0 - 0.18 * gill * smoothstep(0.55, 0.85, abs(yw)) * trunk;
  // the sheen of light along the back
  c += vec3(0.75, 0.8, 0.85) * 0.07 * exp(-pow((yw - 0.3) / 0.15, 2.0)) * trunk * smoothstep(-0.3, 0.0, q.x);
  sha = a * 0.85;
  return vec4(c * a, a);
}

// bottlenose dolphin seen from above, in body lengths: beak tip at x = 0.5, fluke tips near x = -0.52.
// Half-width of the body: a blunt rounded head, widest just behind the flippers, a long taper into the tail stock
float dolphinW(float x) {
  float t = clamp((x + 0.42) / 0.85, 0.0, 1.0);
  float sn = max(sin(3.14159265 * pow(t, 1.413)), 0.0);
  return 0.022 + 0.078 * pow(sn, mix(0.9, 0.6, smoothstep(0.3, 0.7, t)));
}
float sminD(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
vec4 dolphin(vec2 q, out float sha) {
  float ph = v_b.y, bend = v_b.z, mode = v_c.w, aa = fwidth(q.x) + v_blur, cut = 0.0, roll = 0.0;
  if (mode > 1.5) {
    // leaping: pitched nose-up then nose-down, so from above the body looks shorter; y.phase holds the waterline
    // (in body lengths along the body) and z.bend how much the length is foreshortened
    cut = ph; q.x /= bend; aa /= bend; ph = 0.0; bend = 0.0;
  } else if (mode > 0.0) {
    roll = ph; ph = 0.0;          // breathing: y.phase says which stretch of the back is out of the water
  }
  q.y -= bend * 0.4 * (q.x - 0.2) * (q.x - 0.2);
  float ay = abs(q.y);
  // body and beak, blended so the melon flows into the short stout rostrum
  float w = dolphinW(q.x);
  float dBody = max(ay - w, max(q.x - 0.43, -0.42 - q.x));
  float bx = clamp(q.x, 0.39, 0.488);
  float dBeak = length(vec2(q.x - bx, q.y)) - mix(0.026, 0.017, (bx - 0.39) / 0.098);
  float dTrunk = sminD(dBody, dBeak, 0.012);
  // flippers: swept back from just behind the head, curving to a point
  vec2 rel = vec2(q.x, ay) - vec2(0.21, 0.065);
  float al = dot(rel, vec2(-0.83, 0.56)), ac = dot(rel, vec2(0.56, 0.83)) + 0.8 * al * max(al, 0.0);
  float fw = 0.028 * pow(clamp(1.0 - al / 0.125, 0.0, 1.0), 0.45);
  float dFlip = max(abs(ac) - fw, -al - 0.02);
  // flukes: two swept, pointed lobes with a notch between; they look shorter as they beat up and down
  float sp = ay / 0.135;
  float xle = -0.405 - 0.095 * pow(min(sp, 1.0), 1.7);
  float ch = (0.072 * pow(max(1.0 - sp * sp, 0.0), 0.65) + 0.004) * (0.65 + 0.35 * abs(cos(ph))) - 0.014 * max(1.0 - sp / 0.1, 0.0);
  float dFluke = max(max(q.x - xle, xle - ch - q.x), (sp - 1.0) * 0.135);
  float d = sminD(sminD(dTrunk, dFlip, 0.012), dFluke, 0.018);
  float a = smoothstep(aa, -aa, d);
  float trunk = smoothstep(aa, -aa, dTrunk);
  // colour: a dark grey cape along the spine, paler flanks, rounded by the light falling on a cylinder
  vec3 back = v_c.rgb, flank = back * 1.6 + vec3(0.05, 0.055, 0.06);
  float wx = max(dolphinW(clamp(q.x, -0.42, 0.43)), 0.02);
  float yw = clamp(q.y / wx, -1.0, 1.0), nz = sqrt(max(1.0 - yw * yw, 0.0));
  vec3 c = mix(back, flank, smoothstep(0.4, 0.95, abs(yw)) * trunk);
  float cape = smoothstep(0.7, 0.2, abs(yw)) * smoothstep(-0.32, -0.05, q.x) * smoothstep(0.43, 0.3, q.x);
  c *= (1.0 - 0.2 * cape) * mix(0.82, 0.68 + 0.4 * nz, trunk);
  c = mix(c, back * 0.92, (1.0 - trunk) * a);                                                          // fins a shade darker
  // dorsal fin: a thin sickle seen edge-on, leaning back over the body, with a soft shadow at its foot
  float ft = clamp((q.x + 0.07) / 0.18, 0.0, 1.0), inFin = smoothstep(-0.085, -0.06, q.x) * smoothstep(0.125, 0.1, q.x);
  float fwid = 0.0025 + 0.006 * smoothstep(0.0, 0.7, ft) * (1.0 - smoothstep(0.85, 1.0, ft));
  c *= 1.0 - 0.12 * smoothstep(0.016, 0.0, ay - fwid) * inFin;
  c = mix(c, back * 0.6, smoothstep(aa, -aa, ay - fwid) * inFin);
  // blowhole, and the crease where the melon meets the beak
  c *= 1.0 - 0.45 * smoothstep(0.0035, 0.0, abs(length(q - vec2(0.322, 0.0)) - 0.012)) * step(q.x, 0.322) * step(ay, 0.011);
  c *= 1.0 - 0.22 * smoothstep(0.007, 0.0, abs(q.x - 0.418 + 10.0 * q.y * q.y)) * step(ay, 0.034);
  // wet skin catches the light along the spine, strongly when it breaks the surface
  float wet = mix(0.06, 0.3, smoothstep(0.12, 0.02, v_b.w));
  c += vec3(0.85, 0.9, 0.95) * wet * exp(-pow((yw - 0.3) / 0.12, 2.0)) * trunk * smoothstep(-0.35, 0.0, q.x) * smoothstep(0.42, 0.3, q.x);
  if (mode > 1.5) {
    // 2 and 3: the part above the water while it leaves (head first) and comes back (head first again);
    // 4 and 5: the part still under water, drawn in the fish layer
    float keep = (mode < 2.5 || mode > 4.5) ? q.x - cut : cut - q.x;
    a *= smoothstep(-0.008, 0.008, keep);
    if (mode < 3.5) c = mix(c, vec3(0.80, 0.88, 0.92), smoothstep(0.06, 0.0, keep) * 0.5);         // water pouring off at the surface
  } else if (mode > 0.0) {
    // breathing: the head, then the back and dorsal fin, then the tail stock roll up through the surface;
    // only the top of the back is clear of the water, with a film of water along the waterline
    // a hump of back rolls through the surface: head first, then the back and fin, then the tail stock.
    // Where the skin is higher than the water it is out, crisp and wet; a thin sheet of water runs off around it
    float hump = 0.55 * exp(-pow((q.x - roll) / 0.22, 2.0)) - 0.12;
    float up = smoothstep(-0.06, 0.12, hump - 1.6 * yw * yw) * trunk;
    up = max(up, smoothstep(aa, -aa, ay - fwid) * inFin * smoothstep(-0.2, -0.05, hump));      // the fin stands clear
    a = up * mode;
  }
  sha = a * 0.9;
  return vec4(c * a, a);
}

#endif
`;

// sprites: whitewater from a leap, turtle hatchlings and the gull's shadow
const SPRITE_SURFACE = /* glsl */`#if defined(G_SMALL)
// whitewater where a dolphin leaves the water or crashes back in: a churned patch that breaks into a web of foam,
// a ring pushed outward, and droplets thrown clear in the first moments. y.phase = age 0..1, rgb = seed, strength
vec4 spray(vec2 q, out float sha) {
  float age = v_b.y, seed = v_c.r * 97.0, str = v_c.g;
  float r = length(q);
  // a lumpy patch of churned water that spreads as the splash falls back
  vec2 dir = q / max(r, 1e-4);
  float lump = gnoise(dir * 1.7 + seed) * 0.5 + gnoise(q * 4.0 + seed * 0.7) * 0.4;
  float R = (0.3 + 0.35 * sqrt(age)) * (1.0 + 0.4 * lump);
  float area = smoothstep(0.0, 0.16, R - r);
  // bright, bubbly white at first, quickly tearing into blobs and lace as the bubbles rise and burst
  float t1 = gnoise(q * 8.0 + seed * 1.3) * 0.55 + gnoise(q * 18.0 - seed) * 0.3;
  float th = mix(-0.4, 0.5, sqrt(age));
  float churn = smoothstep(th - 0.12, th + 0.12, t1);
  float lace = smoothstep(0.07, 0.0, abs(t1 - th + 0.25)) * smoothstep(0.15, 0.5, age);
  float foam = area * max(churn, lace * 0.7);
  // a broken ring pushed out ahead of it
  float Rr = R + 0.1 + 0.3 * age;
  float ring = smoothstep(0.05, 0.0, abs(r - Rr)) * smoothstep(0.0, 0.5, gnoise(q * 6.0 - seed) + 0.1) * (1.0 - age) * 0.5;
  // a few droplets raining back down around it in the first moments
  vec2 cq = q * 10.0 + seed, cf = fract(cq) - 0.5, hr = hash22(floor(cq));
  float front = R + age * (0.3 + 1.0 * hr.y);
  float drop = smoothstep(0.15, 0.07, length(cf - (hr - 0.5) * 0.6)) * step(0.7, hr.x)
             * smoothstep(0.2, 0.0, abs(r - front)) * (1.0 - smoothstep(0.05, 0.35, age)) * 0.8;
  float fade = str * (1.0 - smoothstep(0.6, 1.0, age)) * smoothstep(1.0, 0.85, r);
  float fa = clamp(max(max(foam, ring), drop) * fade, 0.0, 1.0) * 0.9;
  vec3 fc = mix(vec3(0.78, 0.89, 0.94), vec3(0.97, 0.99, 1.0), smoothstep(th, th + 0.5, t1));
  // bubbles still under the surface turn the water around it pale turquoise
  float ha = smoothstep(R + 0.3, R - 0.05, r) * (1.0 - age) * 0.3 * fade;
  vec4 o = vec4(fc * fa, fa);
  o += vec4(vec3(0.55, 0.86, 0.88) * ha, ha) * (1.0 - o.a);
  sha = fa * 0.35;
  return o;
}

// a sea turtle hatchling, a few centimetres long: a dark domed shell with a pale rim, a big head and long front
// flippers. On the sand the flippers go alternately; in the water both stroke together (z.bend = 1). w = fade in
vec4 hatchling(vec2 q, out float sha) {
  float ph = v_b.y, swim = v_b.z, aa = fwidth(q.x) + v_blur;
  float ay = abs(q.y), right = step(q.y, 0.0);
  float fa = mix(0.4, 1.9, 0.5 + 0.5 * sin(ph + right * 3.14159265 * (1.0 - swim)));
  vec2 fd = vec2(-cos(fa), sin(fa));
  vec2 fq = vec2(q.x, ay) - vec2(0.12, 0.13);
  float fl = dot(fq, fd), fc = dot(fq, vec2(fd.y, -fd.x)) + 0.35 * fl * fl;
  float ft = clamp(fl / 0.4, 0.0, 1.0);
  float wF = 0.075 * (1.0 - 0.55 * pow(ft, 1.5)) * sqrt(max(1.0 - pow(ft, 6.0), 0.0)) + 0.004;   // a paddle, rounded at the tip
  float flipF = smoothstep(aa, -aa, max(abs(fc) - wF, max(-fl, fl - 0.4)));
  vec2 rq = vec2(q.x + 0.27, ay - 0.11 - 0.015 * sin(ph * 2.0));
  float flipR = smoothstep(aa, -aa, (length(vec2(rq.x / 0.09, rq.y / 0.05)) - 1.0) * 0.05);
  float head = smoothstep(aa, -aa, (length(vec2((q.x - 0.31) / 0.12, q.y / 0.1)) - 1.0) * 0.1);
  float hw = 0.2 - 0.05 * max(-q.x - 0.03, 0.0);
  float dS = (length(vec2((q.x + 0.03) / 0.27, q.y / hw)) - 1.0) * hw;
  float shell = smoothstep(aa, -aa, dS);
  float skin = max(max(flipF, flipR), head);
  vec3 body = v_c.rgb, rim = vec3(0.62, 0.6, 0.54);
  vec3 shc = body * (1.0 + 0.45 * smoothstep(0.0, -0.18, dS));                                  // domed
  shc *= 1.0 + 0.25 * smoothstep(0.035, 0.0, ay) * smoothstep(0.22, 0.12, q.x);                  // keel along the back
  shc = mix(shc, rim, smoothstep(-0.04, -0.015, dS) * 0.75);                                     // pale rim
  vec3 skc = mix(body * 1.2, rim, smoothstep(0.5, 1.0, abs(fc) / max(wF, 1e-3)) * flipF * 0.6);  // pale flipper edges
  vec4 c = over(vec4(shc, 1.0) * shell, vec4(skc, 1.0) * skin);
  sha = max(shell, skin) * 0.8 * v_c.w;
  return c * v_c.w;
}

// a gull gliding overhead: never seen itself, only its shadow sweeping over sand and water
vec4 gull(vec2 q, out float sha) {
  float ph = v_b.y, aa = fwidth(q.x) + v_blur;
  float ay = abs(q.y);
  float span = 0.95 * (0.8 + 0.2 * cos(ph));
  float body = smoothstep(aa, -aa, (length(vec2(q.x / 0.45, q.y / 0.08)) - 1.0) * 0.08);
  float t = clamp(ay / span, 0.0, 1.0);
  float wing = smoothstep(aa, -aa, max(abs(q.x - (0.06 + 0.10 * t - 0.30 * t * t)) - 0.12 * (1.0 - 0.6 * t), ay - span));
  float tail = smoothstep(aa, -aa, max(ay - 0.07 - 0.1 * (-q.x - 0.35), max(q.x + 0.35, -q.x - 0.6)));
  sha = max(max(body, wing), tail) * 0.45;
  return vec4(0.0);
}

#endif
`;

// the fragment shader's main, then the whole fragment shader put together
const SPRITE_MAIN = /* glsl */`void main() {
  // each program holds one group of species (see SPRITE_GROUP), so it only tells those apart
  float sp = v_b.x, sha = 0.0;
  vec4 c = vec4(0.0);
#if defined(G_SMALL)
  if (sp < 1.5) c = fish(v_q, sha);
  else if (sp < 3.5) c = flower(v_q, sha);
  else if (sp < 4.5) c = leaf(v_q, sha);
  else if (sp < 10.5) c = hermitCrab(v_q, sha);
  else if (sp < 11.5) c = gull(v_q, sha);
  else if (sp < 12.5) c = pellet(v_q, sha);
  else if (sp < 14.5) c = spray(v_q, sha);
  else c = hatchling(v_q, sha);
#elif defined(G_RAY)
  if (sp < 2.5) c = stingray(v_q, sha);
  else if (sp < 5.5) c = eagleRay(v_q, sha);
  else c = manta(v_q, sha);
#elif defined(G_TURTLE)
  c = turtle(v_q, sha);
#else
  if (sp < 7.5) c = moonJelly(v_q, sha);
  else if (sp < 8.5) c = lagoonJelly(v_q, sha);
  else if (sp < 13.5) c = dolphin(v_q, sha);
  else c = shark(v_q, sha);
#endif
  if (u_shadow == 1) o = vec4(sha, 0.0, 0.0, sha);
  else if (u_shadow == 2) o = vec4(0.0, sp > 6.5 && sp < 8.5 ? (g_glow >= 0.0 ? g_glow : min(c.a * 1.8, 1.0)) : 0.0, 0.0, 0.0);   // jellyfish glow
  else o = c;
}`;
const SPRITE_FS = [SPRITE_HEAD, SPRITE_FISH, SPRITE_RAYS, SPRITE_JELLIES, SPRITE_FLOATS, SPRITE_TURTLE, SPRITE_BEACH, SPRITE_BIG, SPRITE_SURFACE, SPRITE_MAIN].join('');

// ---- final image
const COMPOSITE_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
#define NW ${NW}
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_floor, u_sim, u_shadow, u_fish, u_float, u_deep, u_sand, u_coast;
uniform float u_aspect, u_time;
uniform vec2 u_s1, u_s3;
uniform vec2 u_simTexel;
uniform float u_simScale, u_simHScale;
uniform vec4 u_wave[NW];
uniform float u_waveAmp;
uniform sampler2D u_wphase;   // per wave: the phase gathered crossing the shallows (see buildWavePhase)
uniform vec4 u_wcoast;        // the direction from the coast's centre to the screen's, and the span of angles shown
uniform vec2 u_sunShift;
uniform float u_pathK;
uniform vec3 u_sunDir, u_sunCol, u_ambCol, u_skyCol, u_deepCol, u_sigma, u_bioCol, u_glintH;
uniform float u_caustic, u_glint, u_bio, u_cloud, u_exposure, u_refl, u_warm;
uniform int u_view;
uniform vec2 u_cloudOff;
uniform float u_tide, u_moon;
uniform vec2 u_moonA, u_moonDir;
${NOISE}${SHORE}${SWASH}
const float CR = 0.25;   // 1 - 1/n for water: how far a surface slope bends a near-vertical ray

vec2 toUV(vec2 p) { return vec2(p.x / u_aspect, p.y); }

// Wind waves feeling the bottom. Out in deep water each one is a plane wave. Within WAVE_S1 of the shore it keeps its
// frequency but its wavenumber follows ω² = g·k·tanh(k·h) (Eckart's form): it slows down and shortens as the water
// shoals. Its wavenumber along the coast is kept (Snell's law; around the round coast, k_t·r is kept), so the rest
// turns across the shore and the crests swing round to face the beach. Its phase is the deep-water phase where it
// crossed into the shallows plus ∫ k_n ds from there in, which is tabulated per wave, and it grows taller as it
// slows (shoaling, from its group speed)
const float WAVE_G = 6.1, WAVE_S1 = 1.0, WAVE_HS = 0.05;
float waveDepth(float s) { return max((s * 1.1 + max(s - 0.28, 0.0) * 1.5 + max(s - 0.75, 0.0) * 0.9) * WAVE_HS, 0.002); }
struct Coast { bool on; vec2 n, t, q; float r, s, h, u, v; };
Coast coastAt(vec2 p) {
  Coast c;
  vec2 d = p - u_shore.xy;
  c.r = length(d);
  c.s = c.r - u_shore.z;
  c.on = u_shore.z > 0.0 && c.s < WAVE_S1;
  c.n = d / max(c.r, 1e-5);
  c.t = vec2(-c.n.y, c.n.x);
  c.q = u_shore.xy + c.n * (u_shore.z + WAVE_S1);       // where the wave crossed into the shallows
  float sc = clamp(c.s, 0.0, WAVE_S1);
  c.h = waveDepth(sc);
  c.u = sqrt(sc / WAVE_S1);                                // the table is denser near the shore
  float th = atan(u_wcoast.x * d.y - u_wcoast.y * d.x, dot(u_wcoast.xy, d));
  c.v = clamp((th - u_wcoast.z) / (u_wcoast.w - u_wcoast.z), 0.0, 1.0);
  return c;
}
// wave i here: its phase, its local wavenumber vector and its height
void waveHere(int i, vec2 p, Coast c, out float ph, out vec2 k, out float amp) {
  vec4 w = u_wave[i];
  ph = dot(w.xy, p) + w.w; k = w.xy; amp = w.z;
  if (!c.on) return;
  float k0 = length(w.xy), om2 = WAVE_G * k0;
  float kl = min(om2 / (WAVE_G * sqrt(tanh(om2 * c.h / WAVE_G))), 3.0 * k0);
  float kt = dot(w.xy, c.t) * (u_shore.z + WAVE_S1) / max(c.r, 1e-4);
  float sg = dot(w.xy, c.n) >= 0.0 ? 1.0 : -1.0;
  float kn = sg * sqrt(max(kl * kl - kt * kt, 0.0));
  // a wave coming in too steeply along the coast turns back before it reaches the shallowest water (a turning
  // point): past it, it dies away instead of running on along the shore
  float kn0 = max(k0 * k0 - dot(w.xy, c.t) * dot(w.xy, c.t), 0.02 * k0 * k0);
  amp *= smoothstep(0.0, 0.4, (kl * kl - kt * kt) / kn0);
  const float NS = 64.0, NT = 32.0;
  float I = texture(u_wphase, vec2((c.u * (NS - 1.0) + 0.5) / NS, (float(i) * NT + c.v * (NT - 1.0) + 0.5) / (NT * float(NW)))).r;
  ph = dot(w.xy, c.q) + w.w - sg * I;
  k = kt * c.t + kn * c.n;
  float x = min(2.0 * kl * c.h, 20.0), nG = 0.5 * (1.0 + x / sinh(max(x, 1e-4)));
  amp *= min(sqrt(0.5 * kl / (nG * k0)), 1.8);
}
// worked out once per pixel: each wave's local wavenumber, its phase here and its height. The few lookups a little
// way off (where the sunlight that lands here came through the surface) treat it as a plane wave from here
vec4 g_wave[NW];
vec2 g_p0;
void prepareWaves(vec2 p) {
  Coast c = coastAt(p);
  g_p0 = p;
  for (int i = 0; i < NW; i++) { float ph, a; vec2 k; waveHere(i, p, c, ph, k, a); g_wave[i] = vec4(k, ph, a); }
}
vec2 ambGrad(vec2 p) {
  vec2 g = vec2(0.0), d = p - g_p0;
  for (int i = 0; i < NW; i++) { vec4 w = g_wave[i]; g += w.w * cos(w.z + dot(w.xy, d)) * w.xy; }
  return g * u_waveAmp;
}
vec3 ambHess(vec2 p) {
  vec3 H = vec3(0.0);
  vec2 d = p - g_p0;
  for (int i = 0; i < NW; i++) { vec4 w = g_wave[i]; H -= w.w * sin(w.z + dot(w.xy, d)) * vec3(w.x * w.x, w.y * w.y, w.x * w.y); }
  return H * u_waveAmp;
}
float sh(vec2 uv) { return texture(u_sim, uv).r; }
vec2 simGrad(vec2 uv) {
  vec2 t = u_simTexel;
  return vec2(sh(uv + vec2(t.x, 0.0)) - sh(uv - vec2(t.x, 0.0)),
              sh(uv + vec2(0.0, t.y)) - sh(uv - vec2(0.0, t.y))) * (0.5 * u_simScale);
}
vec3 simHess(vec2 uv) {
  vec2 t = u_simTexel;
  float c = sh(uv);
  float l = sh(uv - vec2(t.x, 0.0)), r = sh(uv + vec2(t.x, 0.0));
  float d = sh(uv - vec2(0.0, t.y)), u = sh(uv + vec2(0.0, t.y));
  float a = sh(uv + t), b = sh(uv - t), e = sh(uv + vec2(t.x, -t.y)), f = sh(uv + vec2(-t.x, t.y));
  return vec3(r + l - 2.0 * c, u + d - 2.0 * c, 0.25 * (a + b - e - f)) * u_simHScale;
}
// a web of foam: bright along the zero crossings of a noise field
float lace(vec2 q) {
  float n = gnoise(q) * 0.6 + gnoise(q * 2.03 + 7.1) * 0.28 + gnoise(q * 4.1 + 3.3) * 0.12;
  float r = 1.0 - min(abs(n) * 1.6, 1.0);
  return r * r;
}

// sparkles: light caught by the tiny facets of the capillary ripples riding on the waves. Every few pixels of
// water hold one facet, which takes a new tilt every half second or so; if that tilt, on top of the slope nxy of
// the wave it rides, mirrors the light toward us (the slope target), it flashes up and fades as a sharp point,
// with a small cross of glare when it is bright
float glitter(vec2 nxy, vec2 target, float spread, float seed) {
  const float CELL = 7.0;
  vec2 fc = gl_FragCoord.xy / CELL, ci = floor(fc - 0.5);   // the four nearest cells: a facet stays inside its own
  float sum = 0.0;
  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
    vec2 c = ci + vec2(float(i), float(j));
    vec2 h1 = hash22(c + seed);
    float ph = u_time / (0.35 + 0.4 * h1.x) + h1.y, ep = floor(ph);
    vec2 h2 = hash22(c + vec2(ep * 13.0, seed)), h3 = hash22(c - vec2(seed, ep * 7.0));
    vec2 sl = nxy + (h2 + h3 - 1.0) * spread - target;
    float m = exp(-dot(sl, sl) * 800.0);
    if (m < 0.02) continue;
    float k = fract(h2.x * 7.0 + h3.y);                    // most facets are tiny, a few catch a lot of light
    float b = m * pow(sin(3.14159265 * fract(ph)), 2.0) * (0.15 + 0.85 * k * k * k);
    vec2 d = (fc - c - 0.2 - 0.6 * h3) * CELL;            // in pixels from the facet
    float core = exp(-dot(d, d) / (0.45 + 1.4 * b));
    float glare = exp(-abs(d.x) * 1.0 - d.y * d.y * 3.0) + exp(-abs(d.y) * 1.0 - d.x * d.x * 3.0);
    sum += b * (core + 0.45 * glare * smoothstep(0.4, 1.0, b));
  }
  return sum;
}

void main() {
  vec2 uv = v_uv;
  vec2 p = vec2(uv.x * u_aspect, uv.y);
  float D0 = texture(u_floor, uv).a + u_tide * 1.1;     // the tide raises the whole sea a little

  // ---- the coast: where is the edge of the water right now?
  bool coast = u_shore.z > 0.0;
  vec3 cst = texture(u_coast, uv).xyz;
  float s = cst.x + u_tide, along = cst.y;
  Swash sw = Swash(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  if (coast && s < 0.6) sw = swash(vec3(s, cst.yz));
  float edge = sw.edge;
  float cover = smoothstep(edge - 0.0015, edge + 0.0015, s);   // 1 = under water (the sea, or a wave washing up)
  float onBeach = 1.0 - smoothstep(-0.003, 0.003, s);          // the part of the coast that is sand when the water is out
  float Dw = mix(max(D0, 0.0), max(s - edge, 0.0) * 0.08, onBeach) * cover;

  vec2 gS = simGrad(uv) * cover;
  prepareWaves(p);
  vec2 g = ambGrad(p) * smoothstep(0.0, 0.05, Dw) + gS;

  // swells, bores and running sheets bend the light; broken water and thin sheets are choppy
  vec2 nrm = coast ? normalize(p - u_shore.xy) : vec2(0.0, 1.0), tng = vec2(-nrm.y, nrm.x);
  if (coast && s < 0.6) {
    g += nrm * sw.bump * cover;
    float chop = clamp(sw.churn * 1.5 + sw.lace * 0.6 + onBeach * cover, 0.0, 1.0);
    if (chop > 0.02) {
      vec2 q = vec2(along, s - sw.drift) * 70.0 + vec2(0.0, u_time * 0.8);
      float c0 = gnoise(q), cx = gnoise(q + vec2(0.25, 0.0)), cy = gnoise(q + vec2(0.0, 0.25));
      vec2 gq = vec2(cx - c0, cy - c0) / 0.25 * 70.0 * 0.0004 * chop;
      g += (tng * gq.x + nrm * gq.y) * cover;
    }
  }

  // what the eye sees: the seabed displaced by refraction
  vec2 pf = p + g * (CR * min(Dw, 1.0));
  vec2 uvf = toUV(pf);
  vec4 fl = texture(u_floor, uvf);
  float D = mix(max(fl.a + u_tide * 1.1, 0.0), Dw, onBeach);
  vec3 alb = pow(fl.rgb, vec3(2.2));

  // things written in the sand, and how wet the sand is
  vec3 sn = vec3(0.0, 0.0, 1.0);
  float gr = 0.0, wet = 0.0;
  if (coast && s < 0.02) {
    vec2 st = 1.0 / vec2(textureSize(u_sand, 0));
    gr = texture(u_sand, uvf).r * onBeach;
    vec2 gg = vec2(texture(u_sand, uvf + vec2(st.x, 0.0)).r - texture(u_sand, uvf - vec2(st.x, 0.0)).r,
                   texture(u_sand, uvf + vec2(0.0, st.y)).r - texture(u_sand, uvf - vec2(0.0, st.y)).r);
    sn = normalize(vec3(gg * 2.5 * onBeach, 1.0));
    wet = max(0.38 * smoothstep(-0.2, -0.01, s), sw.wet);   // damp near the water, soaked where a wave just was
    wet = max(wet, cover) * onBeach;
    alb = mix(alb, pow(alb, vec3(1.25)) * 0.62, wet);         // wet sand: darker, a bit richer
    alb *= 1.0 - 0.22 * gr;
  }

  float shd = texture(u_shadow, uvf).r;
  // rays resting near the bottom: part of the seabed, so they get caustics too
  vec4 dp = texture(u_deep, uvf);
  if (dp.a > 0.002) { alb = mix(alb, pow(dp.rgb / dp.a, vec3(2.2)), dp.a); shd *= 1.0 - dp.a; }

  // caustics: find the surface point whose refracted sun ray lands here,
  // brightness = 1 / |det| of the refraction map Jacobian at that point; they blur out in deep water
  float cd = CR * min(D, 0.9);
  vec2 x0 = pf - u_sunShift * D;
  vec2 xs = x0;
  for (int i = 0; i < 2; i++) xs = x0 - cd * (ambGrad(xs) + simGrad(toUV(xs)));
  vec3 Hm = ambHess(xs) + simHess(toUV(xs)) + vec3(nrm.x * nrm.x, nrm.y * nrm.y, nrm.x * nrm.y) * sw.curv * cover;
  float det = (1.0 + cd * Hm.x) * (1.0 + cd * Hm.y) - cd * cd * Hm.z * Hm.z;
  float cf = u_caustic * exp(-max(D - 0.6, 0.0) * 0.8) * smoothstep(0.0, 0.04, D);
  float I = mix(1.0, inversesqrt(det * det + 0.025), cf);

  float cl = u_cloud > 0.001 ? 1.0 - u_cloud * 0.6 * smoothstep(-0.05, 0.4, fbm3(p * 0.45 + u_cloudOff)) : 1.0;
  float gsh = clamp(dot(sn, u_sunDir) / max(u_sunDir.z, 0.15), 0.25, 1.8);

  // light travels down to the seabed and back up; the water swallows red first, then green.
  // Deep water turns into the colour of the light it scatters back.
  vec3 Tdown = exp(-u_sigma * D * u_pathK);
  vec3 Tup = exp(-u_sigma * D);
  vec3 light = u_sunCol * Tdown * (I * cl * gsh * (1.0 - 0.82 * shd)) + u_ambCol * Tup * (1.0 - 0.25 * shd);
  vec3 col = alb * light * Tup;
  vec3 scat = u_deepCol * mix(0.6, 1.0, cl);
  col += scat * (1.0 - exp(-D * 1.4));

  // fish swim around mid-depth, so they are refracted (and tinted) less
  float Df = min(max(D0, 0.0), 1.2) * 0.5;
  vec4 fi = texture(u_fish, toUV(p + g * (CR * Df)));
  if (fi.a > 0.002) {
    vec3 fa = pow(fi.rgb / fi.a, vec3(2.2));
    vec3 fl2 = fa * (u_sunCol * exp(-u_sigma * Df * u_pathK) * cl * mix(1.0, I, 0.3) + u_ambCol) * exp(-u_sigma * Df);
    fl2 += scat * (1.0 - exp(-Df * 1.4));
    col = mix(col, fl2, fi.a);
  }

  // sand churned up by breaking waves clouds the water for a moment
  if (sw.turb > 0.001) {
    vec3 milky = vec3(0.72, 0.80, 0.74) * (u_sunCol * cl * 0.75 + u_ambCol * 1.3);
    col = mix(col, milky, sw.turb * 0.22 * cover);
  }

  // bioluminescent plankton lights up wherever the water is disturbed
  if (u_bio > 0.001) {
    col += u_bioCol * u_bio * texture(u_shadow, uv).g * vec3(0.9, 0.75, 1.0) * 0.55;   // jellyfish glowing
    float energy = length(gS) * 7.0 + abs(texture(u_sim, uv).g) * 25.0 * cover;
    float glow = smoothstep(0.05, 0.9, energy);
    float tw = hash21(floor(gl_FragCoord.xy / 3.0) + floor(u_time * 7.0) * 17.0);
    float spark = step(0.92, tw) * smoothstep(0.1, 0.6, energy);
    col += u_bioCol * u_bio * (glow * 0.25 + spark * 2.2);
  }

  // surface: sky reflection, and sun glints off tiny capillary ripples riding on the waves
  vec3 n = normalize(vec3(-g, 1.0));
  float fres = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
  col = mix(col, u_skyCol * cl, clamp(fres * u_refl, 0.0, 1.0) * cover);
  col += u_skyCol * cl * 0.05 * wet * (1.0 - cover);           // sheen on wet sand
  // the slope that mirrors the sun to the eye changes a little across the view, so the sparkles gather toward the sun
  vec2 tgt = u_glintH.xy / u_glintH.z - (p - vec2(0.5 * u_aspect, 0.5)) * 0.08, gd = -g - tgt;
  if (u_glint > 0.001 && dot(gd, gd) < 0.035) col += u_sunCol * glitter(-g, tgt, 0.08, 0.0) * u_glint * 30.0 * cl * cover;
  // night: a path of moonlight glittering on the ripples out over the deep water. Seen from a little way up, each
  // point of the water mirrors the moon only where its slope is just right; that slope changes slowly along the
  // path and quickly across it, so the glints gather into a long, narrow, twinkling band. Sparkles only, no haze
  if (u_moon > 0.01 && cover > 0.01) {
    vec2 dm = p - u_moonA, side = vec2(-u_moonDir.y, u_moonDir.x);
    float al = dot(dm, u_moonDir), ac = dot(dm, side);
    vec2 tilt = u_moonDir * al * 0.05 + side * ac * 0.8;
    float env = exp(-ac * ac * 28.0);                               // thickest down the middle of the path
    vec2 md = -g - tilt;
    if (dot(tilt, tilt) < 0.03 && env > 0.02 && dot(md, md) < 0.015) {
      float m = glitter(-g, tilt, 0.04, 91.0);
      col += vec3(0.8, 0.86, 1.0) * m * env * u_moon * 6.0 * cover * smoothstep(0.08, 0.5, D0);
    }
  }

  // surf: thick churned whitewater right behind a breaking wave, thinning into a web of foam as it ages;
  // the foam rides up and down with the water and stretches into streaks as it drains back
  if (coast && s < 0.4) {
    float stretch = mix(1.0, 0.45, sw.back);
    vec2 fq = vec2(along * 44.0, (s - sw.drift) * 44.0 * stretch);
    float lc = lace(fq);
    float fine = gnoise(fq * 3.1 + 17.0);
    float dens = min(sw.churn + sw.lace, 0.82);
    float foam = smoothstep(1.0 - dens, 1.2 - dens, lc + 0.15 * fine) * min(1.0, dens * 2.5);
    foam = max(foam, sw.churn * smoothstep(0.0, 0.5, 0.8 * fine + lc - 0.25));
    foam *= cover;
    foam = clamp(max(foam, sw.line * (0.5 + 0.5 * smoothstep(0.2, 0.7, lc + 0.35 * fine))), 0.0, 1.0);
    vec3 foamCol = vec3(0.94, 0.97, 0.98) * (0.8 + 0.2 * lc) * (u_sunCol * cl * 0.9 + u_ambCol * 1.4);
    col = mix(col, foamCol, foam * 0.85);
    // at night the surf glows
    col += u_bioCol * u_bio * foam * (0.5 + 2.0 * step(0.9, hash21(floor(gl_FragCoord.xy / 2.0) + floor(u_time * 9.0) * 13.0)));
  }

  if (u_view == 1) { o = vec4(vec3(I * 0.25), 1.0); return; }
  if (u_view == 2) { o = vec4(fl.rgb, 1.0); return; }
  if (u_view == 3) { o = vec4(D0 < 0.0 ? vec3(0.8, 0.5, 0.2) * (-D0 * 3.0) : vec3(D0 / 2.8), 1.0); return; }

  vec4 fo = texture(u_float, uv);
  if (fo.a > 0.002) {
    vec3 fa = pow(fo.rgb / fo.a, vec3(2.2));
    col = mix(col, fa * (u_sunCol * cl * 0.85 + u_ambCol * 1.3), fo.a);
  }

  vec2 vq = (uv - 0.5) * vec2(1.0, 0.85);
  col *= 1.0 - 0.22 * pow(clamp(length(vq) * 1.35, 0.0, 1.0), 2.5);

  // golden hour: the lit, bright things turn golden while the deep water stays blue
  col *= u_exposure * mix(vec3(1.0), vec3(1.14, 0.98, 0.82), u_warm * smoothstep(0.02, 0.35, dot(col, vec3(0.3, 0.5, 0.2))));
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (hash21(gl_FragCoord.xy + fract(u_time * 7.3) * 640.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

// ---- writing in the sand; the swash smooths it away again
const SAND_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform float u_aspect, u_dt;
uniform vec2 u_s1, u_s3;
uniform vec4 u_dA[${MAX_DROPS}];
uniform vec2 u_dB[${MAX_DROPS}];
uniform int u_count;
uniform sampler2D u_coast;
uniform float u_tide;
${NOISE}${SWASH}
void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec3 cst = texture(u_coast, v_uv).xyz;
  float s = cst.x + u_tide;
  if (s > 0.05) { o = vec4(0.0); return; }
  float g = texture(u_state, v_uv).r;
  if (s > swash(vec3(s, cst.yz)).edge - 0.004) {
    g *= exp(-u_dt * 2.5);
  } else {
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      if (i >= u_count) break;
      vec2 a = u_dA[i].xy, ba = u_dB[i] - a, pa = p - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
      float r = u_dA[i].z;
      g = max(g, smoothstep(r, r * 0.3, length(pa - ba * h)) * u_dA[i].w);
    }
  }
  o = vec4(g, 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- GL plumbing
// The browser compiles and links in the background, several programs side by side where it can
// (KHR_parallel_shader_compile), so every program is started before any is asked whether it worked.
function startProgram(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  return p;
}
function finishProgram(p) {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    for (const s of gl.getAttachedShaders(p)) {
      if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) continue;
      const log = gl.getShaderInfoLog(s);
      console.error(log + '\n' + gl.getShaderSource(s).split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error(log);
    }
    throw new Error(gl.getProgramInfoLog(p));
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}
function makeTarget(w, h, ifmt, fmt, type, filter = gl.LINEAR) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
const rgba8 = (w, h) => makeTarget(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
const rgba16f = (w, h) => makeTarget(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

gl.getExtension('KHR_parallel_shader_compile');
// species → which sprite program draws it. One program for every species took the longest of all to compile;
// four smaller ones compile side by side
const SPRITE_GROUPS = ['G_SMALL', 'G_RAY', 'G_TURTLE', 'G_BIG'];
const SPRITE_GROUP = [0, 0, 1, 0, 0, 1, 1, 3, 3, 2, 0, 0, 0, 3, 0, 0, 3];
const spriteFS = g => SPRITE_FS.replace('#version 300 es\n', '#version 300 es\n#define ' + g + '\n');
let floorHeightP, floorBaseP, floorRocksP, floorReefP, floorGardenP, floorDetailP, stepP, dropP, spriteP, compP, sandP, coastP;
try {
  [floorHeightP, floorBaseP, floorRocksP, floorReefP, floorGardenP, floorDetailP, stepP, dropP, ...spriteP] = [
    [FULLSCREEN_VS, FLOOR_HEIGHT_FS], [FULLSCREEN_VS, FLOOR_BASE_FS], [FULLSCREEN_VS, FLOOR_ROCKS_FS],
    [FULLSCREEN_VS, FLOOR_REEF_FS], [FULLSCREEN_VS, FLOOR_GARDEN_FS], [FULLSCREEN_VS, FLOOR_DETAIL_FS], [FULLSCREEN_VS, SIM_STEP_FS],
    [FULLSCREEN_VS, SIM_DROP_FS], ...SPRITE_GROUPS.map(g => [SPRITE_VS, spriteFS(g)]), [FULLSCREEN_VS, COMPOSITE_FS],
    [FULLSCREEN_VS, SAND_FS], [FULLSCREEN_VS, COAST_FS],
  ].map(([vs, fs]) => startProgram(vs, fs)).map(finishProgram);
  [compP, sandP, coastP] = spriteP.splice(SPRITE_GROUPS.length);
} catch (e) {
  fail('A shader failed to compile: ' + e.message + '\n著色器編譯失敗。');
  return;
}

const triVAO = gl.createVertexArray();
gl.bindVertexArray(triVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

function makeBatch(max) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, max * 48, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }
  gl.bindVertexArray(null);
  return { vao, buf, data: new Float32Array(max * 12), count: 0 };
}
const deepBatch = makeBatch(4);
const fishBatch = makeBatch(MAX_FISH + 32 + MAX_PELLETS + MAX_DOLPHINS + MAX_SHARKS);
const floatBatch = makeBatch(MAX_FLOATS + 6 + MAX_PELLETS + MAX_DOLPHINS + MAX_SPRAY + MAX_HATCH);
const skyBatch = makeBatch(6);

function drawTri() { gl.bindVertexArray(triVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

// ---------------------------------------------------------------- world
function mulberry32(a) {
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

let seed = Q.has('seed') ? (+Q.get('seed') | 0) : (Math.random() * 2 ** 31) | 0;
let world;

function makeWorld() {
  const r = mulberry32(seed);
  const s = () => r() * 80 + 10;
  const wind = r() * TAU;
  const waves = [];
  for (let i = 0; i < NW; i++) {
    const lam = 0.05 * Math.pow(5, i / (NW - 1)) * (0.85 + 0.3 * r());
    const k = TAU / lam;
    const dir = wind + (r() - 0.5) * 2.6;
    waves.push({ kx: k * Math.cos(dir), ky: k * Math.sin(dir), k, amp: Math.pow(lam, 1.6), omega: Math.sqrt(6.1 * k), ph: r() * TAU });
  }
  // normalise so the rms surface curvature is 1 (u_waveAmp scales it)
  let c2 = 0;
  for (const w of waves) c2 += (w.amp * w.k * w.k) ** 2 * 0.5;
  for (const w of waves) w.amp /= Math.sqrt(c2);
  const sa = r() * TAU, sm = 0.05 + r() * 0.1;
  const ca = wind + (r() - 0.5);
  world = {
    s: [s(), s(), s(), s(), s(), s(), s(), s()],
    ang: r() * TAU,
    slope: [Math.cos(sa) * sm, Math.sin(sa) * sm],
    waves,
    current: [Math.cos(ca) * 0.0065, Math.sin(ca) * 0.0065],
    cloudVel: [Math.cos(wind) * 0.012, Math.sin(wind) * 0.012],
  };
}
makeWorld();

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

// a small CPU copy of the depth map so fish keep off the sand
let depthMap = null, dmW = 0, dmH = 0;
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
}

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

// ---------------------------------------------------------------- turtle hatchlings: on some nights a nest hatches on the beach
let hatchlings = [], nest = null, nestTimer = rand(20, 50), nightLevel = 0;
function spawnNest() {
  if (S.shore >= 6) return false;
  // dry sand above the reach of the waves
  for (let i = 0; i < 80; i++) {
    const x = rand(0.08, aspect - 0.08), y = rand(0.08, 0.92), d = depthAt(x, y);
    if (d < -0.12 && d > -0.32) {
      nest = { x, y, t: 0, total: 7 + Math.floor(rand(0, 6)), out: 0, next: 3, churn: 0 };
      return true;
    }
  }
  return false;
}
function updateHatchlings(dt) {
  if (!S.hatchlings || S.shore >= 6) { hatchlings = []; nest = null; return; }
  if (!nest && !hatchlings.length) {
    if (nightLevel > 0.5) {
      nestTimer -= dt;
      if (nestTimer <= 0) { spawnNest(); nestTimer = rand(150, 300); }
    } else if (nestTimer < 20) nestTimer = rand(20, 50);
  }
  if (nest) {
    const n = nest;
    n.t += dt;
    // first the sand over the nest stirs and sinks into a hollow, then they pop out one after another
    n.churn -= dt;
    if (n.churn <= 0) {
      n.churn = 0.18;
      const a = rand(0, TAU), r = rand(0, 0.011) * Math.min(1, n.t / 2);
      addPrint(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r, rand(0.003, 0.0055), 0.5);
    }
    if (n.t >= n.next && hatchlings.length < MAX_HATCH) {
      n.out++; n.next = n.t + rand(0.3, 1.1);
      const [gx, gy] = deeperDir(n.x, n.y);
      hatchlings.push({ x: n.x + rand(-0.006, 0.006), y: n.y + rand(-0.006, 0.006), ang: Math.atan2(gy, gx) + rand(-1.2, 1.2),
                        len: rand(0.019, 0.023), phase: rand(0, TAU), rate: rand(1.8, 2.4), bias: rand(-0.35, 0.35),
                        wob: rand(0, TAU), wobRate: rand(0.6, 1.3), grow: 0, swim: false, rest: 0, restT: rand(2, 5),
                        freeze: 0, side: 1, lastS: 0, step: 0, life: 0,
                        col: [0.12 + rand(0, 0.04), 0.11 + rand(0, 0.03), 0.1] });
    }
    if (n.out >= n.total) nest = null;
  }
  for (const h of hatchlings) {
    h.life += dt;
    h.grow = Math.min(1, h.grow + dt * 2);
    if (mouse.inside && Math.hypot(h.x - mouse.x, h.y - mouse.y) < 0.06 && (mouse.speed > 0.05 || mouse.down)) h.freeze = rand(0.8, 2);
    if (h.freeze > 0) { h.freeze -= dt; continue; }
    if (!h.swim && depthAt(h.x, h.y) > 0) h.swim = true;
    // head for the open sea, each one wavering in its own way
    h.wob += dt * h.wobRate;
    const [gx, gy] = deeperDir(h.x, h.y);
    const want = Math.atan2(gy, gx) + h.bias * (h.swim ? 0.5 : 1) + 0.4 * Math.sin(h.wob);
    h.ang = wrapAngle(h.ang + Math.max(-2 * dt, Math.min(2 * dt, wrapAngle(want - h.ang))));
    const c = Math.cos(h.ang), sn = Math.sin(h.ang);
    if (!h.swim) {
      // a lurching crawl, with a rest now and then
      h.restT -= dt;
      if (h.restT <= 0) { h.rest = rand(0.4, 1.2); h.restT = rand(2, 5); }
      if (h.rest > 0) { h.rest -= dt; continue; }
      h.phase += dt * h.rate * TAU;
      const s = Math.sin(h.phase), v = 0.022 * (0.25 + 0.75 * Math.abs(s));
      h.x += c * v * dt; h.y += sn * v * dt;
      // a flipper print each time one side pushes off, and a faint drag mark from the belly
      if ((s > 0) !== (h.lastS > 0)) {
        h.side = -h.side;
        const k = h.len * 0.5;
        addPrint(h.x + c * h.len * 0.1 - sn * h.side * k, h.y + sn * h.len * 0.1 + c * h.side * k, 0.0012, 0.4);
      }
      h.lastS = s;
      h.step += dt;
      if (h.step > 0.12) { h.step = 0; addPrint(h.x - c * h.len * 0.2, h.y - sn * h.len * 0.2, 0.0013, 0.15); }
    } else {
      // in the water: both front flippers together, quick strokes out through the surf; each one stirs the water
      h.phase += dt * 2.6 * TAU;
      const s = Math.sin(h.phase), v = 0.05 * (0.5 + 0.5 * Math.max(0, s));
      h.x += c * v * dt; h.y += sn * v * dt;
      if (s > 0.9 && h.lastS <= 0.9) addDrop(h.x, h.y, h.x, h.y, 0.004, -0.05 * S.ripple);
      h.lastS = s;
    }
  }
  hatchlings = hatchlings.filter(h => h.life < 240 && !(h.swim && (depthAt(h.x, h.y) > 0.6 ||
    h.x < -0.05 || h.x > aspect + 0.05 || h.y < -0.05 || h.y > 1.05)));
}

// ---------------------------------------------------------------- dolphins: a pod passes through the deep water now and then
let dolphins = [];
let podTimer = rand(40, 90), podAge = 0, podLeaps = 0, lastLeap = -99;
let sprays = [];
function addSpray(x, y, r, str, life) {
  if (sprays.length < MAX_SPRAY && depthAt(x, y) > 0.02) sprays.push({ x, y, r, str, life, age: 0, seed: Math.random() });
}
function splashSound(big) {
  if (!S.sound || !audio.ctx || audio.ctx.state !== 'running') return;
  const ctx = audio.ctx, at = ctx.currentTime;
  if (big) {
    // the crash back in: a deep thump under a burst of water
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, at);
    o.frequency.exponentialRampToValueAtTime(50, at + 0.25);
    g.gain.setValueAtTime(0.3, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(audio.out);
    o.start(at); o.stop(at + 0.35);
    hiss(at, 'lowpass', 1600, 0.5, 0.01, 0.8, 0.22);
    hiss(at + 0.03, 'highpass', 2800, 0.7, 0.02, 0.6, 0.09);
  } else {
    hiss(at, 'bandpass', 900, 0.7, 0.02, 0.35, 0.08);
  }
}
// launch a dolphin out of the water: a short arc a body length or so high, carried a couple of body lengths forward
function startLeap(d) {
  d.leap = { t: 0, dur: rand(1.0, 1.25), H: d.len * rand(1.15, 1.4), v: d.len * 1.6, entered: false, draw: null };
  d.leap.v /= d.leap.dur;
  lastLeap = time;
  const hx = d.x + Math.cos(d.ang) * d.len * 0.45, hy = d.y + Math.sin(d.ang) * d.len * 0.45;
  addDrop(hx, hy, hx, hy, 0.02, -0.5 * S.ripple);
  addSpray(hx, hy, d.len * 0.3, 0.75, 0.9);
  splashSound(false);
}
function updateLeap(d, dt) {
  const lp = d.leap, L = d.len, c = Math.cos(d.ang), s = Math.sin(d.ang);
  lp.t = Math.min(1, lp.t + dt / lp.dur);
  d.vx = c * lp.v; d.vy = s * lp.v;
  d.x += d.vx * dt; d.y += d.vy * dt;
  d.angVel = 0; d.bend = 0; d.depth = 0;
  // pitch goes from nose-up to nose-down; the body's centre rises and falls so the beak breaks the water first
  // and the flukes leave it last
  const u = lp.t, pitch = 0.85 - 1.8 * u, sp = Math.sin(pitch);
  const zc = lp.H * 4 * u * (1 - u) - L * (0.375 + 0.072 * u);
  let mode = 2, cut = -9;
  if (sp > 0.03) cut = -zc / (L * sp);
  else if (sp < -0.03) { mode = 3; cut = zc / (L * -sp); }
  const fs = Math.max(Math.cos(pitch), 0.35), sc = 1 + 0.6 * Math.max(zc, 0);
  lp.draw = { mode, cut, fs, sc };
  if (mode === 3 && cut < 0.5 && !lp.entered) {
    // head first back into the water: the big splash
    lp.entered = true;
    const k = cut * L * fs * sc, ex = d.x + c * k, ey = d.y + s * k;
    addDrop(ex, ey, ex, ey, 0.035, -1.3 * S.ripple);
    addSpray(ex, ey, L * 0.55, 1, 1.6);
    splashSound(true);
    for (const f of fish) {
      const dx = f.x - ex, dy = f.y - ey, dd = Math.hypot(dx, dy) + 1e-4;
      if (dd < 0.35) { const k2 = 1 - dd / 0.35; f.fear = Math.max(f.fear, 0.5 + 0.5 * k2); f.vx += dx / dd * 0.3 * k2; f.vy += dy / dd * 0.3 * k2; }
    }
  }
  if (lp.t >= 1) {
    // the flukes slap down as it disappears
    const tx = d.x - c * L * 0.5, ty = d.y - s * L * 0.5;
    addDrop(tx, ty, tx, ty, 0.02, -0.5 * S.ripple);
    addSpray(tx, ty, L * 0.3, 0.7, 1.0);
    d.leap = null;
    d.vx = c * 0.2; d.vy = s * 0.2;
    d.breath = 0.55; d.blown = true;
  }
}
function updateSprays(dt) {
  for (const p of sprays) p.age += dt / p.life;
  sprays = sprays.filter(p => p.age < 1);
}
function spawnPod() {
  const [sx, sy] = offscreenSeaPoint(0.6, 0.45);
  // head for the far side of the deep water, so the pod crosses the long way
  let ex = aspect - sx, ey = 1 - sy, best = 0;
  for (let i = 0; i < 24; i++) {
    const [x, y] = offscreenSeaPoint(0.6, 0.6), dd = Math.hypot(x - sx, y - sy);
    if (dd > best) { best = dd; ex = x; ey = y; }
  }
  const ang = Math.atan2(ey - sy, ex - sx), n = 3 + Math.floor(rand(0, 4));
  dolphins = [];
  const lr = Math.random();
  podLeaps = lr < 0.3 ? 0 : lr < 0.75 ? 1 : 2;      // most pods put on a show at least once
  for (let i = 0; i < n; i++) {
    const calf = i > 1 && Math.random() < 0.3;
    const ox = -0.12 * Math.ceil(i / 2) - rand(0, 0.05), oy = i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.08 + 0.04 * Math.ceil(i / 2)) + rand(-0.02, 0.02);
    const c = Math.cos(ang), s = Math.sin(ang), g = rand(-0.03, 0.03);
    dolphins.push({ lead: i === 0, ox, oy, tx: ex, ty: ey, x: sx + c * ox - s * oy, y: sy + s * ox + c * oy, ang,
                    vx: c * 0.11, vy: s * 0.11, angVel: 0, bend: 0, len: calf ? rand(0.13, 0.15) : rand(0.2, 0.24),
                    phase: rand(0, TAU), beat: rand(0.9, 1.2), breath: rand(0, 1), breathRate: rand(1 / 9, 1 / 6),
                    blown: false, depth: 0.2, fear: 0, leap: null, col: [0.18 + g, 0.2 + g, 0.23 + g] });
  }
  podAge = 0;
}
function updateDolphins(dt) {
  updateSprays(dt);
  if (!S.dolphins) { dolphins = []; return; }
  if (!dolphins.length) {
    podTimer -= dt;
    if (podTimer <= 0) { spawnPod(); podTimer = rand(120, 240); }
    return;
  }
  podAge += dt;
  const lead = dolphins[0];
  for (const d of dolphins) {
    if (d.leap) { updateLeap(d, dt); continue; }
    let ax, ay;
    const onScreen = d.x > 0 && d.x < aspect && d.y > 0 && d.y < 1;
    if (d.lead) {
      const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy) + 1e-4, cruise = 0.11 * (1 + d.fear);
      ax = (dx / dist * cruise - d.vx) * 0.6; ay = (dy / dist * cruise - d.vy) * 0.6;
      if (onScreen && depthAt(d.x + Math.cos(d.ang) * 0.25, d.y + Math.sin(d.ang) * 0.25) < 0.55) {
        const [gx, gy] = deeperDir(d.x, d.y);
        ax += gx * 0.25; ay += gy * 0.25;
      }
    } else {
      // keep station beside and behind the leader
      const c = Math.cos(lead.ang), s = Math.sin(lead.ang);
      const px = lead.x + c * d.ox - s * d.oy, py = lead.y + s * d.ox + c * d.oy;
      ax = (px - d.x) * 1.5 + (lead.vx - d.vx) * 1.2; ay = (py - d.y) * 1.5 + (lead.vy - d.vy) * 1.2;
    }
    d.vx += ax * dt; d.vy += ay * dt;
    if (!d.lead) {
      // one that ended up ahead (after a leap) eases off and lets the pod catch up rather than turning back
      const c = Math.cos(lead.ang), s = Math.sin(lead.ang), along = d.vx * c + d.vy * s;
      if (along < 0.05) { d.vx += (0.05 - along) * c; d.vy += (0.05 - along) * s; }
    }
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > 0.45) { d.vx *= 0.45 / sp; d.vy *= 0.45 / sp; }
    d.x += d.vx * dt; d.y += d.vy * dt;
    steerHeading(d, dt, 1.6);
    d.bend += (Math.max(-0.5, Math.min(0.5, d.angVel * 0.25)) - d.bend) * Math.min(1, dt * 6);
    d.phase += dt * TAU * d.beat * (1 + d.fear);
    d.fear = Math.max(0, d.fear - dt * 0.3);
    // every 6–9 seconds each one rises to breathe: a quick arc up to the surface and back down
    d.breath = (d.breath + dt * d.breathRate) % 1;
    const rise = Math.pow(Math.max(0, Math.sin(d.breath * TAU)), 6);
    d.depth = 0.2 - 0.19 * rise;
    const hx = d.x + Math.cos(d.ang) * d.len * 0.45, hy = d.y + Math.sin(d.ang) * d.len * 0.45;
    if (rise > 0.5 && onScreen && Math.random() < dt * 25) addDrop(hx, hy, hx, hy, 0.012, -0.08 * S.ripple);
    if (rise > 0.9 && !d.blown) {
      d.blown = true;
      // now and then, instead of a breath, one leaps clear of the water
      const m = 0.15, wellIn = d.x > m && d.x < aspect - m && d.y > m && d.y < 1 - m;
      if (!d.lead && podLeaps > 0 && wellIn && time - lastLeap > 4 && depthAt(d.x, d.y) > 0.4 && Math.random() < 0.45) {
        podLeaps--;
        startLeap(d);
        continue;
      }
      if (onScreen) {
        addDrop(hx, hy, hx, hy, 0.022, -0.35 * S.ripple);
        const bx = d.x + Math.cos(d.ang) * d.len * 0.3, by = d.y + Math.sin(d.ang) * d.len * 0.3;
        addSpray(bx, by, d.len * 0.11, 0.45, 0.7);
        if (S.sound && audio.ctx && audio.ctx.state === 'running') hiss(audio.ctx.currentTime, 'bandpass', 1300, 0.8, 0.02, 0.35, 0.07);
      }
    }
    if (rise < 0.2) d.blown = false;
  }
  // the pod is gone once the leader has reached the far side and the rest have followed it off screen
  const off = d => d.x < -d.len || d.x > aspect + d.len || d.y < -d.len || d.y > 1 + d.len;
  if ((Math.hypot(lead.tx - lead.x, lead.ty - lead.y) < 0.3 && dolphins.every(off)) || podAge > 90) dolphins = [];
}

// ---------------------------------------------------------------- reef sharks: one, now and then two, patrol the reef edge
let sharks = [];
let sharkTimer = rand(50, 110), sharkAge = 0;
function spawnSharks() {
  const [sx, sy] = offscreenSeaPoint(0.35, 0.45);
  let ex = aspect - sx, ey = 1 - sy, best = 0;
  for (let i = 0; i < 24; i++) {
    const [x, y] = offscreenSeaPoint(0.35, 0.6), dd = Math.hypot(x - sx, y - sy);
    if (dd > best) { best = dd; ex = x; ey = y; }
  }
  const n = Math.random() < 0.3 ? 2 : 1, ang = Math.atan2(ey - sy, ex - sx);
  sharks = [];
  for (let i = 0; i < n; i++) {
    const g = rand(-0.03, 0.03), back = i * rand(0.25, 0.4);
    sharks.push({ x: sx - Math.cos(ang) * back, y: sy - Math.sin(ang) * back, ang, tx: ex, ty: ey,
                  vx: Math.cos(ang) * 0.07, vy: Math.sin(ang) * 0.07, angVel: 0, bend: 0, len: rand(0.15, 0.19),
                  phase: rand(0, TAU), beat: rand(0.75, 0.95), depth: rand(0.18, 0.26), wander: rand(0, TAU),
                  shy: 0, col: [0.21 + g, 0.205 + g, 0.19 + g] });
  }
  sharkAge = 0;
}
// a shark cruises slowly toward the far side, keeping to the reef edge: away from the shallow sand and out of
// the open deep, weaving a little as it goes; it turns away from a splash or a fast sweep of the cursor
function updateSharks(dt) {
  if (!S.sharks) { sharks = []; return; }
  if (!sharks.length) {
    sharkTimer -= dt;
    if (sharkTimer <= 0) { spawnSharks(); sharkTimer = rand(90, 200); }
    return;
  }
  sharkAge += dt;
  for (const k of sharks) {
    const onScreen = k.x > 0 && k.x < aspect && k.y > 0 && k.y < 1;
    const dx = k.tx - k.x, dy = k.ty - k.y, dist = Math.hypot(dx, dy) + 1e-4, cruise = 0.07 * (1 + 1.5 * k.shy);
    k.wander += dt * rand(-0.6, 0.6);
    const wx = Math.cos(k.wander) * 0.35, wy = Math.sin(k.wander) * 0.35;
    let ax = ((dx / dist + wx * 0.5) * cruise - k.vx) * 0.5, ay = ((dy / dist + wy * 0.5) * cruise - k.vy) * 0.5;
    if (onScreen) {
      const hx = k.x + Math.cos(k.ang) * 0.18, hy = k.y + Math.sin(k.ang) * 0.18, D = depthAt(hx, hy);
      const [gx, gy] = deeperDir(k.x, k.y);
      if (D < 0.3) { ax += gx * 0.12; ay += gy * 0.12; }
      else if (D > 1.4) { ax -= gx * 0.06; ay -= gy * 0.06; }
    }
    if (mouse.inside && mouse.speed > 0.3 && onScreen) {
      const mx = k.x - mouse.x, my = k.y - mouse.y, md = Math.hypot(mx, my) + 1e-4;
      if (md < 0.2) { ax += mx / md * 0.3; ay += my / md * 0.3; k.shy = 1; }
    }
    k.vx += ax * dt; k.vy += ay * dt;
    const sp = Math.hypot(k.vx, k.vy);
    if (sp > 0.25) { k.vx *= 0.25 / sp; k.vy *= 0.25 / sp; }
    k.x += k.vx * dt; k.y += k.vy * dt;
    steerHeading(k, dt, 1.0);
    k.bend += (Math.max(-0.5, Math.min(0.5, k.angVel * 0.3)) - k.bend) * Math.min(1, dt * 4);
    k.phase += dt * TAU * k.beat * (1 + k.shy);
    k.shy = Math.max(0, k.shy - dt * 0.4);
  }
  const off = k => k.x < -k.len || k.x > aspect + k.len || k.y < -k.len || k.y > 1 + k.len;
  const lead = sharks[0];
  if ((Math.hypot(lead.tx - lead.x, lead.ty - lead.y) < 0.3 && sharks.every(off)) || sharkAge > 110) sharks = [];
}

let gullTimer = rand(6, 20);
function updateGulls(dt) {
  if (!S.beachLife) { gulls.length = 0; return; }
  gullTimer -= dt;
  if (gullTimer <= 0) {
    gullTimer = rand(30, 80);
    const a = rand(0, TAU), dx = Math.cos(a), dy = Math.sin(a), side = rand(-0.35, 0.35);
    const cx = aspect / 2 - dx * (aspect * 0.6 + 0.4) - dy * side, cy = 0.5 - dy * (aspect * 0.6 + 0.4) + dx * side;
    const n = Math.random() < 0.4 ? 1 + Math.floor(rand(1, 3)) : 1;
    for (let i = 0; i < n; i++) {
      gulls.push({ x: cx - dx * i * 0.09 + dy * rand(-0.08, 0.08), y: cy - dy * i * 0.09 - dx * rand(-0.08, 0.08),
                   ang: a + rand(-0.06, 0.06), len: rand(0.055, 0.07), phase: rand(0, TAU), glide: rand(0, 2), speed: rand(0.2, 0.26) });
    }
  }
  for (const g of gulls) {
    g.x += Math.cos(g.ang) * g.speed * dt; g.y += Math.sin(g.ang) * g.speed * dt;
    g.glide -= dt;
    if (g.glide < -1.2) g.glide = rand(1, 3);
    if (g.glide < 0) g.phase += dt * TAU * 2.6;
    g.ang += Math.sin(g.phase * 0.05) * 0.02 * dt;
  }
  gulls = gulls.filter(g => g.x > -1 && g.x < aspect + 1 && g.y > -1 && g.y < 2);
}

function updateJellies(dt) {
  const cur = world.current;
  for (const j of jellies) {
    j.phase += dt * j.rate;
    // a push with every contraction of the bell, then a glide
    const thrust = Math.max(0, -Math.cos(j.phase));
    j.turn += rand(-1, 1) * dt * 0.2;
    j.turn *= Math.exp(-dt * 0.3);
    j.ang = wrapAngle(j.ang + j.turn * dt);
    if (depthAt(j.x + Math.cos(j.ang) * 0.08, j.y + Math.sin(j.ang) * 0.08) < 0.3) {
      const [gx, gy] = deeperDir(j.x, j.y);
      j.ang = wrapAngle(j.ang + Math.max(-0.8 * dt, Math.min(0.8 * dt, wrapAngle(Math.atan2(gy, gx) - j.ang))));
    }
    const swim = 0.004 + 0.022 * thrust;
    const kd = 1 - Math.exp(-dt * 1.5);
    j.vx += (Math.cos(j.ang) * swim + cur[0] * 0.6 - j.vx) * kd;
    j.vy += (Math.sin(j.ang) * swim + cur[1] * 0.6 - j.vy) * kd;
    if (mouse.inside && mouse.speed > 0.15) {
      const dx = j.x - mouse.x, dy = j.y - mouse.y, d = Math.hypot(dx, dy) + 1e-4;
      if (d < 0.12) { const k = (1 - d / 0.12) * Math.min(1, dt * 4); j.vx += mouse.vx * 0.25 * k; j.vy += mouse.vy * 0.25 * k; }
    }
    j.x += j.vx * dt; j.y += j.vy * dt;
    const m = 0.15;
    if (j.x < -m || j.x > aspect + m || j.y < -m || j.y > 1 + m) {
      [j.x, j.y] = offscreenSeaPoint(0.4, 0.1);
      j.ang = Math.atan2(0.5 - j.y, aspect / 2 - j.x) + rand(-0.6, 0.6);
    }
  }
}

function updateFloats(dt) {
  const cur = world.current;
  for (const f of floats) {
    const k = Math.min(1, dt * 0.25);
    f.vx += (cur[0] - f.vx) * k; f.vy += (cur[1] - f.vy) * k;
    f.va *= Math.exp(-dt * 0.8);
    if (mouse.inside && mouse.speed > 0.02) {
      const dx = f.x - mouse.x, dy = f.y - mouse.y, d = Math.hypot(dx, dy) + 1e-4, R = f.len * 0.45 + 0.022;
      if (d < R) {
        const kk = (1 - d / R) * Math.min(1, dt * 10);
        f.vx += (mouse.vx * 0.8 - f.vx) * kk + dx / d * 0.02 * kk;
        f.vy += (mouse.vy * 0.8 - f.vy) * kk + dy / d * 0.02 * kk;
        f.va += (dx * mouse.vy - dy * mouse.vx) / (d * d + 1e-3) * 0.08 * kk;
      }
    }
    for (const g of floats) {
      if (g === f) continue;
      const dx = f.x - g.x, dy = f.y - g.y, d = Math.hypot(dx, dy) + 1e-4, sd = (f.len + g.len) * 0.42;
      if (d < sd) { f.vx += dx / d * (sd - d) * dt * 6; f.vy += dy / d * (sd - d) * dt * 6; }
    }
    if (depthAt(f.x, f.y) < 0.06) {
      const [gx, gy] = deeperDir(f.x, f.y);
      f.vx += gx * 0.12 * dt; f.vy += gy * 0.12 * dt;
    }
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.ang += f.va * dt;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > 0.05 && Math.random() < dt * 8) addDrop(f.x, f.y, f.x, f.y, 0.012, -0.08 * S.ripple * Math.min(1, sp * 4));
    const m = 0.08;
    if (f.x < -m) f.x += aspect + 2 * m; else if (f.x > aspect + m) f.x -= aspect + 2 * m;
    if (f.y < -m) f.y += 1 + 2 * m; else if (f.y > 1 + m) f.y -= 1 + 2 * m;
    if (depthAt(f.x, f.y) < 0.02) [f.x, f.y] = offscreenSeaPoint(0.15, 0.07);
  }
}

let rainAcc = 0;
function updateRain(dt) {
  rainAcc += S.rain * 22 * dt;
  while (rainAcc >= 1) {
    rainAcc -= 1;
    const x = rand(0, aspect), y = rand(0, 1);
    addDrop(x, y, x, y, rand(0.006, 0.011), -rand(0.25, 0.45));
  }
}

// ---------------------------------------------------------------- light
//      hour  elev  az   sun colour            ambient                 sky                 plankton reflect glint warm
const NIGHT = [55, 200, [0.055, 0.075, 0.13], [0.008, 0.014, 0.028], [0.02, 0.035, 0.07], 1.0, 1.4, 0.7, 0.0];
const KEYS = [
  [0.0, ...NIGHT],
  [4.8, ...NIGHT],
  [6.0,  6,  95,  [1.00, 0.62, 0.40], [0.15, 0.14, 0.20],    [0.85, 0.62, 0.55], 0.25, 3.5, 1.6, 1.0],
  [7.5,  24, 108, [1.05, 0.92, 0.78], [0.20, 0.25, 0.31],    [0.72, 0.82, 0.92], 0.0,  1.5, 1.1, 0.4],
  [12.5, 68, 180, [1.15, 1.12, 1.06], [0.24, 0.31, 0.35],    [0.76, 0.88, 1.00], 0.0,  1.2, 1.0, 0.0],
  [16.0, 40, 245, [1.12, 1.00, 0.84], [0.23, 0.28, 0.32],    [0.74, 0.84, 0.95], 0.0,  1.4, 1.1, 0.15],
  [17.8, 9,  272, [1.15, 0.68, 0.36], [0.22, 0.18, 0.22],    [1.00, 0.66, 0.42], 0.1,  4.0, 1.9, 1.0],
  [18.9, 3,  282, [0.30, 0.24, 0.36], [0.05, 0.05, 0.10],    [0.30, 0.22, 0.32], 0.6,  2.5, 0.8, 0.5],
  [20.0, ...NIGHT],
  [24.0, ...NIGHT],
];
const MODE_HOURS = [null, 8.5, 12.5, 17.8, 22];

function currentHour() {
  if (S.timeMode === -1) return +Q.get('hour');
  if (S.timeMode > 0) return MODE_HOURS[S.timeMode];
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function lighting() {
  const h = ((currentHour() % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (h - a[0]) / Math.max(1e-6, b[0] - a[0]);
  t = t * t * (3 - 2 * t);
  const dirOf = k => {
    const az = k[2] * Math.PI / 180, el = k[1] * Math.PI / 180;
    return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  };
  const da = dirOf(a), db = dirOf(b);
  let sun = lerp3(da, db, t);
  const sl = Math.hypot(...sun); sun = sun.map(v => v / sl);
  const horiz = Math.hypot(sun[0], sun[1]) + 1e-6;
  const sinW = Math.min(0.99, Math.sqrt(1 - sun[2] * sun[2]) / 1.333);
  const cosW = Math.sqrt(1 - sinW * sinW);
  const tanW = sinW / cosW;
  // glints: half vector between sun and an overhead eye, kept fairly upright so they still appear at dusk
  let hv = [sun[0], sun[1], sun[2] + 1];
  const hl = Math.hypot(...hv); hv = hv.map(v => v / hl);
  const tilt = Math.hypot(hv[0], hv[1]) / hv[2];
  if (tilt > 0.16) { const f = 0.16 / tilt; hv = [hv[0] * f, hv[1] * f, hv[2]]; const l2 = Math.hypot(...hv); hv = hv.map(v => v / l2); }
  return {
    sunShift: [-sun[0] / horiz * tanW, -sun[1] / horiz * tanW],
    pathK: 1 / cosW,
    sunCol: lerp3(a[3], b[3], t),
    amb: lerp3(a[4], b[4], t),
    sky: lerp3(a[5], b[5], t),
    bio: lerp(a[6], b[6], t),
    refl: lerp(a[7], b[7], t),
    glint: lerp(a[8], b[8], t),
    warm: lerp(a[9], b[9], t),
    glintH: hv,
    sunDir: sun,
  };
}

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

// ---------------------------------------------------------------- tide: rises and falls with real time
let tideNow = 0;
function updateTide() {
  if (Q.has('tide')) { tideNow = +Q.get('tide'); return; }
  if (!S.tide || S.shore >= 6) { tideNow = 0; return; }
  const hours = Date.now() / 3.6e6;
  tideNow = 0.05 * Math.cos(TAU * hours / 12.42 + 0.6);   // a semidiurnal tide, high twice a day
}

// ---------------------------------------------------------------- sound (off by default): noise shaped into surf
const audio = { ctx: null, out: null, noise: null, lastWave: -1 };
function pcgJS(v) {
  v >>>= 0;
  const st = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
// the shader's hash21, so the sounds line up with the waves on screen
function hash21JS(x, y) {
  const ix = (Math.floor(x) + (1 << 20)) >>> 0, iy = (Math.floor(y) + (1 << 20)) >>> 0;
  return pcgJS((ix + pcgJS(iy)) >>> 0) * 2.3283064e-10;
}
function audioStart() {
  if (!audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = audio.ctx = new AC();
    audio.out = ctx.createGain();
    audio.out.gain.value = 0;
    audio.out.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    audio.noise = white;
    // a low, distant surf that never stops
    const brown = ctx.createBuffer(1, len, ctx.sampleRate), bd = brown.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = b * 3.5; }
    const src = ctx.createBufferSource();
    src.buffer = brown; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(audio.out);
    src.start();
  }
  if (audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
}
function audioLevel() {
  if (audio.ctx) audio.out.gain.setTargetAtTime(S.sound ? S.volume : 0, audio.ctx.currentTime, 0.4);
}
function hiss(at, type, freq, q, attack, decay, gain) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.noise; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  src.connect(f).connect(g).connect(audio.out);
  src.start(at, Math.random() * 3);
  src.stop(at + attack + decay + 0.1);
}
function plop() {
  if (audio.ctx.state !== 'running') return;
  const ctx = audio.ctx, at = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(520, at);
  o.frequency.exponentialRampToValueAtTime(140, at + 0.12);
  g.gain.setValueAtTime(0.25, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
  o.connect(g).connect(audio.out);
  o.start(at); o.stop(at + 0.25);
  hiss(at, 'highpass', 3000, 0.7, 0.01, 0.25, 0.08);
}
// each wave: a crash where it breaks, a rush up the sand, a fizz as it drains back
function waveSounds() {
  if (!S.sound || !audio.ctx || audio.ctx.state !== 'running' || S.shore >= 6) return;
  const T = time % 36000, n0 = Math.floor(T / 9);
  if (n0 < audio.lastWave - 3) audio.lastWave = n0 - 2;
  for (let n = n0 - 1; n <= n0 + 1; n++) {
    if (n <= audio.lastWave) continue;
    const A = Math.min(1, Math.max(0.2, 0.55 + 0.28 * Math.sin(n * 0.85 + 1.3) + 0.4 * (hash21JS(n, 1) - 0.5)));
    const start = (n + 0.42 * (hash21JS(n, 2) - 0.5)) * 9;
    const tb = (0.72 - Math.sqrt(0.035 + 0.075 * A)) / 0.45, tUp = 0.9 + 1.3 * A;
    const lead = start + tb - T;
    if (lead > 1.5) continue;
    audio.lastWave = n;
    if (lead < -0.5) continue;
    const at = audio.ctx.currentTime + Math.max(0, lead);
    hiss(at, 'lowpass', 700 + 700 * A, 0.7, 0.06, 1.0 + 1.4 * A, 0.5 * A);
    const run = at + (1.6 - tb);
    hiss(run, 'bandpass', 1600, 0.6, 0.25, tUp, 0.22 * A);
    hiss(run + tUp, 'highpass', 2800, 0.7, 0.6, 2.6 * tUp, 0.08 * A);
  }
}

// ---------------------------------------------------------------- the seabed's number, so a favourite can be kept
const seedTag = document.createElement('div');
seedTag.id = 'seedTag';
seedTag.style.cssText = 'position:fixed;top:24px;right:24px;padding:8px 14px;border-radius:8px;background:rgba(3,28,36,.6);' +
  'color:#eaf7f5;font:16px/1.4 "Microsoft JhengHei",system-ui,sans-serif;letter-spacing:.04em;opacity:0;transition:opacity .6s;pointer-events:none';
document.body.appendChild(seedTag);
let seedTagTimer = 0, seedWord = 'Seabed No. 海床編號';
function showSeed() {
  seedTag.textContent = `${seedWord} ${seed}`;
  seedTag.style.opacity = '1';
  clearTimeout(seedTagTimer);
  seedTagTimer = setTimeout(() => { seedTag.style.opacity = '0'; }, 15000);
}

function regenerate() {
  seed = (Math.random() * 2 ** 31) | 0;
  makeWorld();
  requestFloor();
  showSeed();
}

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
requestAnimationFrame(frame);
})();

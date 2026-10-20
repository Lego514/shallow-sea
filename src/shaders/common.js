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


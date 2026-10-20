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


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


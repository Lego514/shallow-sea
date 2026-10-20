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


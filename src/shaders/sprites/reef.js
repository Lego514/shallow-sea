// sprites: the reef's residents, sea anemones and an octopus, and the ink an octopus leaves behind
const SPRITE_REEF = /* glsl */`#if defined(G_REEF)
uniform sampler2D u_floor;
float sminO(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// distance from p to the segment ab, and how far along it the nearest point is
float segDist(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

// a bubble-tip sea anemone seen from above, in diameters: rings of fat tentacles around the oral disc, each swelling
// to a bulb near its tip. They sway, lean down-current (the quad's heading) and pull in when touched.
// y of v_b: time, z: how far the tentacles are pulled in; w of v_c: which colours (0 green with pink tips, 1 rose)
vec4 anemone(vec2 q, out float sha) {
  float t = v_b.y, pull = v_b.z, look = v_c.w;
  float aa = fwidth(q.x) + v_blur;
  vec3 baseC = mix(vec3(0.50, 0.52, 0.30), vec3(0.70, 0.30, 0.32), step(0.5, look));
  vec3 tipC = mix(vec3(0.95, 0.50, 0.72), vec3(1.0, 0.74, 0.66), step(0.5, look));
  float r = length(q);
  // the oral disc, with the mouth in the middle; mostly hidden under the inner tentacles
  float disc = smoothstep(aa, -aa, r - 0.085);
  vec3 dc = mix(vec3(0.36, 0.30, 0.20), vec3(0.58, 0.50, 0.36), smoothstep(0.085, 0.0, r));
  dc = mix(dc, vec3(0.22, 0.13, 0.10), smoothstep(0.016 + aa, 0.016 - aa, length(q * vec2(1.0, 2.4))));
  vec4 col = vec4(dc, 1.0) * disc;
  float ang = atan(q.y, q.x);
  // the outer ring first: the tentacles nearer the middle stand up over it
  for (int ring = 2; ring >= 0; ring--) {
    float fr = float(ring), N = 13.0 + 7.0 * fr;
    float r0 = 0.045 + 0.05 * fr;
    float L = (0.15 + 0.035 * fr) * (1.0 - 0.45 * pull);
    float th = (0.021 + 0.003 * fr) * (1.0 + 0.35 * pull);
    float near = floor((ang / 6.2831853 - 0.35 * fr / N) * N + 0.5);
    float best = 1e3, bh = 0.0, bv = 0.0;
    for (int k = -1; k <= 1; k++) {
      float id = mod(near + float(k), N);
      float hv = hash21(vec2(id, fr + look * 7.0));
      float a = (id + 0.35 * fr + (hv - 0.5) * 0.45) / N * 6.2831853;
      float sw = (0.13 * sin(t * 1.3 + id * 0.9 + fr * 1.7) + 0.05 * sin(t * 2.9 + id * 2.3)) * (1.0 - 0.6 * pull);
      vec2 b = vec2(cos(a), sin(a)) * r0;
      float l = L * (0.85 + 0.3 * hv);
      vec2 m = b + vec2(cos(a + sw), sin(a + sw)) * l * 0.5;
      vec2 e = m + vec2(cos(a + sw * 2.0), sin(a + sw * 2.0)) * l * 0.5 + vec2(0.035, 0.0) * (1.0 - pull);
      float h1, h2;
      float d1 = segDist(q, b, m, h1), d2 = segDist(q, m, e, h2);
      float h = d1 < d2 ? h1 * 0.5 : 0.5 + h2 * 0.5;
      float rad = th * (0.85 + 0.15 * h + 0.55 * exp(-pow((h - 0.8) / 0.13, 2.0)));
      float dd = min(d1, d2) - rad;
      if (dd < best) { best = dd; bh = h; bv = hv; }
    }
    float cov = smoothstep(aa, -aa, best);
    float nz = clamp(-best / (th * 1.3), 0.0, 1.0);
    vec3 c = mix(baseC * (0.85 + 0.3 * bv), tipC, smoothstep(0.55, 0.95, bh));
    c *= (0.62 + 0.48 * sqrt(nz)) * (0.92 + 0.05 * (2.0 - fr));
    col = over(vec4(c, 1.0) * cov, col);
  }
  sha = col.a * 0.5;
  return col;
}

// an octopus seen from above, in arm spans: the mantle behind, the head with its eyes, eight arms around them,
// webbed at the roots. y of v_b: time, z: how far the arms are spread (0 trailing behind it in a jet, 1 spread on
// the seabed); rgb of v_c: camouflage (0 its own colours .. 1 the seabed's), a startled dark flash, how flat it
// presses itself; w: a seed for its mottling
vec4 octopus(vec2 q, out float sha) {
  float t = v_b.y, spread = v_b.z, camo = v_c.r, flash = v_c.g, press = v_c.b, seed = v_c.w;
  float aa = fwidth(q.x) + v_blur;
  vec2 mq = (q - vec2(-0.16, 0.0)) / vec2(0.145 * (1.0 - 0.1 * press), 0.1 * (1.0 + 0.25 * press));
  float d = sminO((length(mq) - 1.0) * 0.1, length((q - vec2(-0.02, 0.0)) / vec2(0.08, 0.085)) * 0.08 - 0.08, 0.035);
  float arms = 1e3, armS = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i), side = i < 4 ? 1.0 : -1.0, k = mod(fi, 4.0);
    float hv = hash21(vec2(fi, seed * 13.0));
    // spread round it on the seabed, reaching and curling in turn; in a jet, all trailing straight behind
    float a = mix(side * (0.03 + 0.035 * k), side * (0.35 + 0.7 * k) + 0.18 * sin(t * 1.6 + fi * 1.7), spread);
    float curl = mix(0.35 * sin(t * 2.4 - fi), (0.6 + 0.6 * sin(t * 0.5 + fi * 2.3)) * side * (0.5 + hv), spread);
    float segL = mix(0.1, 0.08 + 0.015 * hv, spread);
    vec2 p = vec2(0.02, 0.0) + vec2(cos(a), sin(a)) * 0.04;
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      a += curl * (0.15 + 0.25 * fj);                    // curling more towards the tip
      vec2 nx = p + vec2(cos(a), sin(a)) * segL;
      float h;
      float dd = segDist(q, p, nx, h);
      float s = (fj + h) / 4.0;                          // 0 at the root, 1 at the tip
      dd -= mix(0.05, 0.009, s) * (1.0 + 0.2 * press);
      if (dd < arms) { arms = dd; armS = s; }
      p = nx;
    }
  }
  d = sminO(d, arms, 0.04);                             // webbed between the arms' roots
  float body = smoothstep(aa, -aa, d);

  // its own colours: a mottled red-brown, pale papillae, dark bands rippling over it as it moves
  float m = clamp(0.5 + 0.6 * gnoise(q * 14.0 + seed * 31.0) + 0.3 * gnoise(q * 31.0 - seed * 7.0), 0.0, 1.0);
  vec3 own = mix(vec3(0.46, 0.17, 0.10), vec3(0.86, 0.48, 0.30), m);
  float pap = step(0.86, hash21(floor(q * 70.0 + seed * 5.0)));
  own = mix(own, vec3(0.92, 0.80, 0.68), pap * 0.5);
  own *= 1.0 - 0.35 * smoothstep(0.4, 1.0, sin(dot(q, vec2(1.0, 0.3)) * 26.0 + t * 5.0)) * (1.0 - press) * spread;
  float rim = smoothstep(0.0, -0.03, d);
  own *= 0.75 + 0.35 * rim;
  // startled: dark red with pale spots
  vec2 sq = q * 30.0 + seed * 3.0;
  float spot = step(0.6, hash21(floor(sq))) * smoothstep(0.34, 0.24, length(fract(sq) - 0.5));
  vec3 alarm = mix(vec3(0.32, 0.07, 0.05), vec3(0.95, 0.90, 0.85), spot);
  own = mix(own, alarm, flash);
  // camouflage: the seabed under it, a little textured, so that a sharp eye can still find it
  vec3 sea = texelFetch(u_floor, ivec2(gl_FragCoord.xy), 0).rgb;
  float cam = camo * (1.0 - flash);
  vec3 c = mix(own, sea * (0.9 + 0.18 * (m - 0.5) + 0.1 * pap) * (0.92 + 0.08 * rim), cam);
  // the eyes: raised bumps on the head with a dark bar for a pupil
  vec2 eq = vec2(q.x + 0.01, abs(q.y) - 0.055);
  c = mix(c, vec3(0.85, 0.78, 0.55), smoothstep(0.02 + aa, 0.02 - aa, length(eq)) * (1.0 - 0.7 * cam));
  c = mix(c, vec3(0.03), smoothstep(0.007 + aa, 0.007 - aa, length(eq * vec2(0.6, 2.2))) * (1.0 - 0.5 * cam));
  c *= 1.0 - 0.18 * smoothstep(-0.012, 0.0, d) * (1.0 - 0.5 * cam);
  sha = body * mix(0.5, 0.15, press);
  return vec4(c, 1.0) * body;
}

// ink: a dark cloud that spreads and thins out. y of v_b: its age in seconds
vec4 ink(vec2 q, out float sha) {
  float age = v_b.y, seed = v_c.w;
  float k = clamp(age / 5.0, 0.0, 1.0);
  vec2 w = q + 0.12 * vec2(gnoise(q * 6.0 + seed * 9.0 + age * 0.3), gnoise(q * 6.0 - seed * 5.0 - age * 0.3));
  float r = mix(0.16, 0.56, sqrt(k));
  float dens = smoothstep(r, r * 0.35, length(w)) * (0.75 + 0.25 * gnoise(w * 10.0 + seed * 4.0));
  float a = clamp(dens * pow(1.0 - k, 1.5) * 1.7, 0.0, 0.95) * smoothstep(0.0, 0.12, age);
  sha = a * 0.6;
  return vec4(vec3(0.06, 0.045, 0.05) * a, a);
}

#endif
`;

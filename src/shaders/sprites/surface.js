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


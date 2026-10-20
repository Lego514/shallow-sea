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


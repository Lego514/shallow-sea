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


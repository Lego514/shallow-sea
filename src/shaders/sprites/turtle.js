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


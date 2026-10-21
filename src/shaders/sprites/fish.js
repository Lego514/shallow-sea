// sprites: reef fish, small and big
const SPRITE_FISH = /* glsl */`#if defined(G_SMALL)
// reef fish seen from above, head along +x, in body lengths: snout at x = 0.5, tail tips at -0.5.
// x of v_b: 0 a little schooling fish, 1 a big fish; w of v_c says which big fish: 1 yellow tang, 2 sergeant major,
// 3 bluefin trevally, 4 clownfish
vec4 fish(vec2 q, out float sha) {
  float phase = v_b.y, bend = v_b.z, look = v_c.w;
  float bigF = step(0.5, v_b.x);
  float isTang = bigF * step(0.5, look) * step(look, 1.5), isSgt = bigF * step(1.5, look) * step(look, 2.5);
  float isTrev = bigF * step(2.5, look) * step(look, 3.5), isClown = bigF * step(3.5, look), isSmall = 1.0 - bigF;
  float aa = fwidth(q.x) + v_blur;
  float t = q.x + 0.5;                       // 0 tail tip .. 1 snout
  float tl = clamp(1.0 - t, 0.0, 1.0);
  q.y -= bend * (q.x - 0.25) * (q.x - 0.25);
  q.y -= 0.075 * tl * tl * sin(t * 6.0 - phase);
  float ay = abs(q.y);
  float mw = isSmall * 0.075 + isTang * 0.11 + isSgt * 0.135 + isTrev * 0.11 + isClown * 0.15;

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
  // tail: forked on most, nearly square on the tang, a deep crescent on the trevally, a rounded fan on the clownfish
  float u = t / 0.2;
  float fork = isSmall * 0.6 + isSgt * 0.5 + isTrev * 0.85 + isTang * 0.08;
  float outer = mw * mix(mix(1.25, 1.5, isTrev), 0.2, clamp(u, 0.0, 1.0));
  outer = mix(outer, mw * (0.25 + 0.9 * sin(clamp(1.0 - u, 0.0, 1.0) * 2.9)), isClown);
  float notch = mw * 1.1 * clamp(1.0 - u / max(fork, 0.05), 0.0, 1.0) * step(0.1, fork);
  float tail = smoothstep(aa, -aa, max(max(ay - outer, notch - ay), max(-t, t - 0.21)));
  // pectoral fins flicking at the sides; long sickles on the trevally
  float flap = sin(phase * 0.5 + 1.0);
  vec2 fd = normalize(vec2(-0.75, 0.62 + 0.25 * flap));
  float fL = mix(0.07, 0.11, isTrev) + 0.03 * isClown, fW = mix(0.026, 0.02, isTrev) + 0.016 * isClown;
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
  // clownfish: bright orange with three white bands, each edged in black; the middle one bulges forward
  float band = min(min(abs(q.x - 0.25) - 0.03, abs(q.x - 0.01 - 0.05 * (1.0 - cy * cy)) - 0.045), abs(q.x + 0.27) - 0.022);
  vec3 cClown = mix(back * (0.85 + 0.15 * nz), vec3(0.05), smoothstep(0.016, 0.009, band));
  cClown = mix(cClown, vec3(0.97, 0.96, 0.93), smoothstep(0.004, -0.004, band));
  vec3 bc = cSmall * isSmall + cTang * isTang + cSgt * isSgt + cTrev * isTrev + cClown * isClown;
  bc *= 0.8 + 0.25 * nz;                                                                   // rounded
  bc = mix(bc, back * 0.6, dors * (1.0 - isTang) * 0.6);
  // eyes on the sides of the head
  float er = mix(0.016, 0.022, bigF);
  vec2 eq = vec2(q.x - 0.37 + 0.07 * isTang, ay - w * 0.72);
  bc = mix(bc, vec3(0.75, 0.78, 0.8), smoothstep(er * 1.6, er * 1.15, length(eq)) * isSmall * 0.6);
  bc = mix(bc, vec3(0.04), smoothstep(er + aa, er - aa, length(eq)));
  // fins: see-through, tinted to the fish; electric blue on the trevally, dark-edged tail on the sergeant major
  vec3 finCol = isSmall * vec3(0.75, 0.82, 0.86) + isTang * back + isSgt * vec3(0.7, 0.72, 0.6) + isTrev * vec3(0.2, 0.55, 0.95)
              + isClown * back;
  finCol = mix(finCol, vec3(0.12), isSgt * smoothstep(0.6, 1.0, ay / max(outer, 1e-3)) * tail);
  finCol = mix(finCol, vec3(0.06), isClown * max(smoothstep(0.75, 0.95, ay / max(outer, 1e-3)) * tail * step(t, 0.17),
                                                 smoothstep(0.3, 0.9, dot(fq, fd) / fL) * fin));
  vec4 col = vec4(finCol, 1.0) * max(tail, fin) * mix(0.45, 0.75, bigF) * (1.0 + 0.3 * isClown);
  col = over(vec4(bc, 1.0) * body * 0.96, col);
  sha = max(body * 0.85, max(tail, fin) * 0.45);
  return col;
}

#endif
`;


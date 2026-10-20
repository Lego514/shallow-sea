// sprites: flowers and leaves floating on the surface
const SPRITE_FLOATS = /* glsl */`#if defined(G_SMALL)
vec4 flower(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  vec4 col = vec4(0.0);
  float r0 = v_c.w * 6.2831853;
  for (int k = 0; k < 5; k++) {
    float ang = r0 + float(k) * 1.2566371;
    vec2 d = rot(-ang) * q;
    d.y += 0.35 * d.x * d.x;                 // pinwheel twist
    d.x -= 0.21;
    float e = (length(vec2(d.x / 0.23, d.y / 0.14)) - 1.0) * 0.14;
    float pa = smoothstep(aa, -aa, e);
    float shade = 0.84 + 0.16 * smoothstep(-0.14, 0.14, d.y);
    vec3 pc = mix(vec3(0.99, 0.78, 0.28), vec3(0.99, 0.98, 0.95), smoothstep(-0.2, 0.02, d.x));
    pc = mix(pc, v_c.rgb, smoothstep(0.0, 0.2, d.x) * 0.5);
    col = over(vec4(pc * shade, 1.0) * pa, col);
  }
  sha = col.a * 0.9;
  return col;
}

vec4 leaf(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  float t = q.x + 0.5;
  float y = q.y - 0.06 * sin(t * 3.14159) * (v_c.w - 0.5);
  float w = 0.2 * pow(max(sin(3.14159 * clamp(t, 0.0, 1.0)), 0.0), 0.75) * (1.0 + 0.3 * (0.5 - t));
  float lf = smoothstep(aa, -aa, max(abs(y) - w, max(-t, t - 1.0) * 0.5));
  float stem = smoothstep(aa, -aa, max(abs(q.y) - 0.012, max(q.x + 0.62, -q.x - 0.48)));
  float a = max(lf, stem);
  vec3 base = v_c.rgb;
  float ry = abs(y) / max(w, 1e-3);
  vec3 col = base * (0.85 + 0.25 * ry);
  float vein = smoothstep(0.016, 0.0, abs(y)) + 0.6 * smoothstep(0.08, 0.0, abs(fract((t - abs(y) * 1.3) * 7.0) - 0.5)) * step(0.1, ry);
  col = mix(col, base * 1.3 + 0.05, clamp(vein, 0.0, 1.0) * 0.5);
  col = mix(col, base * 0.7, stem * (1.0 - lf));
  sha = a * 0.85;
  return vec4(col * a, a);
}

// sea turtles seen from above, in body lengths: the carapace runs from x = -0.46 to 0.42, the head to about 0.68.
// z.bend picks the species: 0 green, 1 hawksbill, 2 olive ridley.
// Carapace outline: sh = (half width, how far forward the widest point sits, bluntness)
#endif
`;


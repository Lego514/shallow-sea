// sprites: hermit crabs and crumbs of fish food
const SPRITE_BEACH = /* glsl */`#if defined(G_SMALL)
vec4 hermitCrab(vec2 q, out float sha) {
  float ph = v_b.y, hide = v_b.z, aa = fwidth(q.x) + v_blur;
  vec2 sq = q + vec2(0.08, 0.0);
  float shell = smoothstep(aa, -aa, (length(vec2(sq.x / 0.36, sq.y / 0.27)) - 1.0) * 0.27);
  vec2 sc = sq - vec2(-0.12, 0.05);
  float band = 0.5 + 0.5 * sin(length(sc) * 42.0 - atan(sc.y, sc.x) * 2.0);
  vec3 shc = v_c.rgb * (0.75 + 0.3 * band) * (0.8 + 0.3 * smoothstep(0.3, -0.1, length(sq - vec2(0.05, 0.08))));
  vec2 bq = q + vec2(hide * 0.2, 0.0);
  float body = smoothstep(aa, -aa, (length(vec2((bq.x - 0.28) / 0.10, bq.y / 0.12)) - 1.0) * 0.10);
  float claws = max(smoothstep(aa, -aa, (length(vec2((bq.x - 0.40) / 0.09, (bq.y - 0.07) / 0.06)) - 1.0) * 0.06),
                    smoothstep(aa, -aa, (length(vec2((bq.x - 0.38) / 0.06, (bq.y + 0.08) / 0.04)) - 1.0) * 0.04));
  float legs = 0.0;
  for (int k = 0; k < 3; k++) for (int sd = 0; sd < 2; sd++) {
    float side = sd == 0 ? 1.0 : -1.0;
    vec2 base = vec2(0.22 - 0.07 * float(k), 0.10 * side);
    float ang = side * (1.25 + 0.3 * float(k) + 0.35 * sin(ph + float(k) * 2.1 + side));
    vec2 dir = vec2(cos(ang), sin(ang)), lq = bq - base;
    float t = clamp(dot(lq, dir), 0.0, 0.24);
    legs = max(legs, smoothstep(0.022 + aa, 0.022 - aa, length(lq - dir * t)));
  }
  float eyes = smoothstep(0.02 + aa, 0.02 - aa, length(vec2(bq.x - 0.47, abs(bq.y) - 0.035)));
  float crab = max(max(body, claws), legs) * (1.0 - hide);
  vec4 c = vec4(vec3(0.80, 0.33, 0.18), 1.0) * crab;
  c = over(vec4(0.05, 0.03, 0.03, 1.0) * eyes * (1.0 - hide), c);
  c = over(vec4(shc, 1.0) * shell, c);
  sha = c.a * 0.8;
  return c;
}

// a crumb of fish food: a little rounded flake, lit on one side
vec4 pellet(vec2 q, out float sha) {
  float aa = fwidth(q.x) + v_blur;
  float a = smoothstep(0.5 + aa, 0.5 - aa, length(q * vec2(1.0, 1.2)));
  vec3 c = v_c.rgb * (0.75 + 0.45 * smoothstep(0.55, -0.1, length(q - vec2(-0.12, 0.16))));
  sha = a * 0.7;
  return vec4(c * a, a);
}

#endif
`;


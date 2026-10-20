// ---- ripple simulation
const SIM_STEP_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_aspect;
uniform float u_damp;
uniform sampler2D u_floor;
uniform float u_tide;
// how fast ripples run here, as a share of their speed in deep water (squared). Water waves obey
// c² = (g/k)·tanh(kh): in shallow water that is g·h, so c = √(gh), and it levels off once the water is deeper
// than the ripples are long. Never quite zero, so the very edge of the water still moves
float speed2(vec2 uv) { return max(tanh(max(texture(u_floor, uv).a + u_tide * 1.1, 0.0) / 0.45), 0.04); }
void main() {
  vec4 s = texture(u_state, v_uv);
  // the shallow-water wave equation, d²h/dt² = div(c² grad h), with c² taken between each pair of cells: ripples
  // slow down, bunch up and grow taller as the water shoals, bend around the shallows and partly reflect off them
  vec2 ex = vec2(u_texel.x, 0.0), ey = vec2(0.0, u_texel.y);
  float k0 = speed2(v_uv);
  float flow = (k0 + speed2(v_uv + ex)) * (texture(u_state, v_uv + ex).r - s.r)
             + (k0 + speed2(v_uv - ex)) * (texture(u_state, v_uv - ex).r - s.r)
             + (k0 + speed2(v_uv + ey)) * (texture(u_state, v_uv + ey).r - s.r)
             + (k0 + speed2(v_uv - ey)) * (texture(u_state, v_uv - ey).r - s.r);
  s.g += flow * 0.25;                               // in deep water exactly the old 2 * (average - h)
  s.g *= u_damp;
  s.r += s.g;
  s.r *= 0.9993;
  // absorb at the screen edges: the sea goes on beyond them
  float edge = min(min(v_uv.x, 1.0 - v_uv.x) * u_aspect, min(v_uv.y, 1.0 - v_uv.y));
  s.rg *= mix(0.88, 1.0, smoothstep(0.0, 0.05, edge));
  // and die out on the beach
  s.rg *= mix(0.6, 1.0, smoothstep(-0.005, 0.04, texture(u_floor, v_uv).a + u_tide * 1.1));
  o = s;
}`;

const SIM_DROP_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform float u_aspect;
uniform vec4 u_dA[${MAX_DROPS}];
uniform vec2 u_dB[${MAX_DROPS}];
uniform int u_count;
void main() {
  vec4 s = texture(u_state, v_uv);
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    vec2 a = u_dA[i].xy, ba = u_dB[i] - a, pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    float x = max(0.0, 1.0 - length(pa - ba * h) / u_dA[i].z);
    s.r += (0.5 - 0.5 * cos(x * 3.14159265)) * u_dA[i].w;
  }
  o = s;
}`;


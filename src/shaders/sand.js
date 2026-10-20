// ---- writing in the sand; the swash smooths it away again
const SAND_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_state;
uniform float u_aspect, u_dt;
uniform vec2 u_s1, u_s3;
uniform vec4 u_dA[${MAX_DROPS}];
uniform vec2 u_dB[${MAX_DROPS}];
uniform int u_count;
uniform sampler2D u_coast;
uniform float u_tide;
${NOISE}${SWASH}
void main() {
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec3 cst = texture(u_coast, v_uv).xyz;
  float s = cst.x + u_tide;
  if (s > 0.05) { o = vec4(0.0); return; }
  float g = texture(u_state, v_uv).r;
  if (s > swash(vec3(s, cst.yz)).edge - 0.004) {
    g *= exp(-u_dt * 2.5);
  } else {
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      if (i >= u_count) break;
      vec2 a = u_dA[i].xy, ba = u_dB[i] - a, pa = p - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
      float r = u_dA[i].z;
      g = max(g, smoothstep(r, r * 0.3, length(pa - ba * h)) * u_dA[i].w);
    }
  }
  o = vec4(g, 0.0, 0.0, 1.0);
}`;


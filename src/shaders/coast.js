// ---- coast map, baked with the seabed: shoreS, distance along the coast, swash timing offset
const COAST_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform float u_aspect;
uniform vec2 u_s1, u_s3;
${NOISE}${SHORE}
void main() {
  if (u_shore.z <= 0.0) { o = vec4(9.0, 0.0, 0.0, 1.0); return; }
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec2 d = p - u_shore.xy;
  vec2 ref = normalize(vec2(0.5 * u_aspect, 0.5) - u_shore.xy);
  float along = atan(ref.x * d.y - ref.y * d.x, dot(ref, d)) * u_shore.z;
  o = vec4(shoreS(p), along, 0.07 * gnoise(vec2(along * 1.6, 3.7)), 1.0);
}`;

const FULLSCREEN_VS = /* glsl */`#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;


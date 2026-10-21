// ---- fish, rays, flowers, leaves (instanced SDF sprites)
const SPRITE_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_a;   // x, y, heading, length
layout(location = 2) in vec4 i_b;   // species, phase, bend, depth fraction (0 surface .. 1 seabed)
layout(location = 3) in vec4 i_c;   // rgb, extra
uniform float u_aspect;
uniform int u_shadow;
uniform sampler2D u_floor;
uniform sampler2D u_sim;
uniform vec2 u_sunShift;
uniform vec2 u_simTexel;
uniform float u_simScale;
out vec2 v_q;
out vec4 v_b;
out vec4 v_c;
out float v_blur;
void main() {
  float sp = i_b.x, len = i_a.w;
  // half size of the quad and where its centre sits, in body lengths (x points the way the creature faces)
  vec2 ext, off = vec2(0.0);
  if (sp < 1.5) ext = vec2(0.62, 0.36);                                  // fish
  else if (sp < 2.5) { ext = vec2(0.86, 0.45); off = vec2(-0.39, 0.0); } // stingray, tail behind
  else if (sp < 3.5) ext = vec2(0.6, 0.6);                               // flower
  else if (sp < 4.5) ext = vec2(0.68, 0.32);                             // leaf
  else if (sp < 5.5) { ext = vec2(1.5, 1.0); off = vec2(-1.0, 0.0); }    // eagle ray, long tail behind
  else if (sp < 6.5) { ext = vec2(0.56, 1.18); off = vec2(-0.08, 0.0); } // manta
  else if (sp < 7.5) ext = vec2(0.62, 0.62);                             // moon jelly
  else if (sp < 8.5) { ext = vec2(0.72, 0.62); off = vec2(-0.2, 0.0); }  // spotted lagoon jelly, arms trailing
  else if (sp < 9.5) { ext = vec2(0.74, 0.88); off = vec2(0.06, 0.0); } // sea turtle
  else if (sp < 10.5) ext = vec2(0.62, 0.62);                            // hermit crab
  else if (sp < 11.5) { ext = vec2(0.66, 1.0); off = vec2(-0.08, 0.0); } // gull (only its shadow is drawn)
  else if (sp < 12.5) ext = vec2(0.62, 0.62);                            // a crumb of fish food
  else if (sp < 13.5) { ext = vec2(0.6, 0.3); off = vec2(-0.03, 0.0); } // dolphin
  else if (sp < 14.5) ext = vec2(1.0, 1.0);                              // whitewater from a leap
  else if (sp < 15.5) ext = vec2(0.62, 0.62);                            // turtle hatchling
  else if (sp < 16.5) { ext = vec2(0.58, 0.3); off = vec2(-0.02, 0.0); } // reef shark
  else if (sp < 18.5) ext = vec2(0.62, 0.62);                            // sea anemone, octopus
  else ext = vec2(0.66, 0.66);                                           // octopus ink
  vec2 pos = i_a.xy;
  vec2 uv = clamp(vec2(pos.x / u_aspect, pos.y), 0.0, 1.0);
  float blur = 0.0;
  if (u_shadow == 1 && sp > 10.5 && sp < 11.5) {
    blur = 0.006;                                   // a gull high overhead: a soft shadow, already placed
  } else if (u_shadow == 1) {
    float D = max(textureLod(u_floor, uv, 0.0).a, 0.0);
    float above = min(D * (1.0 - i_b.w), 0.6);
    pos += u_sunShift * above;
    blur = 0.0025 + above * 0.02;
  } else if (u_shadow == 2) {
    blur = 0.012;                                   // glow halo around jellyfish at night
  }
  if (i_b.w < 0.01) {
    // floating things ride the ripples
    vec2 t = u_simTexel;
    vec2 g = vec2(textureLod(u_sim, uv + vec2(t.x, 0.0), 0.0).r - textureLod(u_sim, uv - vec2(t.x, 0.0), 0.0).r,
                  textureLod(u_sim, uv + vec2(0.0, t.y), 0.0).r - textureLod(u_sim, uv - vec2(0.0, t.y), 0.0).r);
    pos -= g * 0.5 * u_simScale * 0.03;
  }
  vec2 local = (a_corner * ext + off) * len + a_corner * blur * 1.5;
  float c = cos(i_a.z), s = sin(i_a.z);
  vec2 w = pos + mat2(c, s, -s, c) * local;
  v_q = local / len;
  v_b = i_b;
  v_c = i_c;
  v_blur = blur / len;
  gl_Position = vec4(w.x / u_aspect * 2.0 - 1.0, w.y * 2.0 - 1.0, 0.0, 1.0);
}`;


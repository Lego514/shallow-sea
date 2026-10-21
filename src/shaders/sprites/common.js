// the fragment shader's start, shared by the five sprite programs: inputs, noise, compositing, the glow flag
const SPRITE_HEAD = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 v_q;
in vec4 v_b;
in vec4 v_c;
in float v_blur;
uniform int u_shadow;
out vec4 o;
${NOISE}

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
float g_glow = -1.0;                                          // a sprite's own night glow, when it sets one

`;


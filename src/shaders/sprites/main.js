// the fragment shader's main, then the whole fragment shader put together
const SPRITE_MAIN = /* glsl */`void main() {
  // each program holds one group of species (see SPRITE_GROUP), so it only tells those apart
  float sp = v_b.x, sha = 0.0;
  vec4 c = vec4(0.0);
#if defined(G_SMALL)
  if (sp < 1.5) c = fish(v_q, sha);
  else if (sp < 3.5) c = flower(v_q, sha);
  else if (sp < 4.5) c = leaf(v_q, sha);
  else if (sp < 10.5) c = hermitCrab(v_q, sha);
  else if (sp < 11.5) c = gull(v_q, sha);
  else if (sp < 12.5) c = pellet(v_q, sha);
  else if (sp < 14.5) c = spray(v_q, sha);
  else c = hatchling(v_q, sha);
#elif defined(G_RAY)
  if (sp < 2.5) c = stingray(v_q, sha);
  else if (sp < 5.5) c = eagleRay(v_q, sha);
  else c = manta(v_q, sha);
#elif defined(G_TURTLE)
  c = turtle(v_q, sha);
#elif defined(G_REEF)
  if (sp < 17.5) c = anemone(v_q, sha);
  else if (sp < 18.5) c = octopus(v_q, sha);
  else c = ink(v_q, sha);
#else
  if (sp < 7.5) c = moonJelly(v_q, sha);
  else if (sp < 8.5) c = lagoonJelly(v_q, sha);
  else if (sp < 13.5) c = dolphin(v_q, sha);
  else c = shark(v_q, sha);
#endif
  if (u_shadow == 1) o = vec4(sha, 0.0, 0.0, sha);
  else if (u_shadow == 2) o = vec4(0.0, sp > 6.5 && sp < 8.5 ? (g_glow >= 0.0 ? g_glow : min(c.a * 1.8, 1.0)) : 0.0, 0.0, 0.0);   // jellyfish glow
  else o = c;
}`;
const SPRITE_FS = [SPRITE_HEAD, SPRITE_FISH, SPRITE_RAYS, SPRITE_JELLIES, SPRITE_FLOATS, SPRITE_TURTLE, SPRITE_BEACH, SPRITE_BIG, SPRITE_SURFACE, SPRITE_REEF, SPRITE_MAIN].join('');


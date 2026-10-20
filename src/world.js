// ---------------------------------------------------------------- world
function mulberry32(a) {
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

let seed = Q.has('seed') ? (+Q.get('seed') | 0) : (Math.random() * 2 ** 31) | 0;
let world;

function makeWorld() {
  const r = mulberry32(seed);
  const s = () => r() * 80 + 10;
  const wind = r() * TAU;
  const waves = [];
  for (let i = 0; i < NW; i++) {
    const lam = 0.05 * Math.pow(5, i / (NW - 1)) * (0.85 + 0.3 * r());
    const k = TAU / lam;
    const dir = wind + (r() - 0.5) * 2.6;
    waves.push({ kx: k * Math.cos(dir), ky: k * Math.sin(dir), k, amp: Math.pow(lam, 1.6), omega: Math.sqrt(6.1 * k), ph: r() * TAU });
  }
  // normalise so the rms surface curvature is 1 (u_waveAmp scales it)
  let c2 = 0;
  for (const w of waves) c2 += (w.amp * w.k * w.k) ** 2 * 0.5;
  for (const w of waves) w.amp /= Math.sqrt(c2);
  const sa = r() * TAU, sm = 0.05 + r() * 0.1;
  const ca = wind + (r() - 0.5);
  world = {
    s: [s(), s(), s(), s(), s(), s(), s(), s()],
    ang: r() * TAU,
    slope: [Math.cos(sa) * sm, Math.sin(sa) * sm],
    waves,
    current: [Math.cos(ca) * 0.0065, Math.sin(ca) * 0.0065],
    cloudVel: [Math.cos(wind) * 0.012, Math.sin(wind) * 0.012],
  };
}
makeWorld();


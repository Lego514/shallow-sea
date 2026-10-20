// ---------------------------------------------------------------- light
//      hour  elev  az   sun colour            ambient                 sky                 plankton reflect glint warm
const NIGHT = [55, 200, [0.055, 0.075, 0.13], [0.008, 0.014, 0.028], [0.02, 0.035, 0.07], 1.0, 1.4, 0.7, 0.0];
const KEYS = [
  [0.0, ...NIGHT],
  [4.8, ...NIGHT],
  [6.0,  6,  95,  [1.00, 0.62, 0.40], [0.15, 0.14, 0.20],    [0.85, 0.62, 0.55], 0.25, 3.5, 1.6, 1.0],
  [7.5,  24, 108, [1.05, 0.92, 0.78], [0.20, 0.25, 0.31],    [0.72, 0.82, 0.92], 0.0,  1.5, 1.1, 0.4],
  [12.5, 68, 180, [1.15, 1.12, 1.06], [0.24, 0.31, 0.35],    [0.76, 0.88, 1.00], 0.0,  1.2, 1.0, 0.0],
  [16.0, 40, 245, [1.12, 1.00, 0.84], [0.23, 0.28, 0.32],    [0.74, 0.84, 0.95], 0.0,  1.4, 1.1, 0.15],
  [17.8, 9,  272, [1.15, 0.68, 0.36], [0.22, 0.18, 0.22],    [1.00, 0.66, 0.42], 0.1,  4.0, 1.9, 1.0],
  [18.9, 3,  282, [0.30, 0.24, 0.36], [0.05, 0.05, 0.10],    [0.30, 0.22, 0.32], 0.6,  2.5, 0.8, 0.5],
  [20.0, ...NIGHT],
  [24.0, ...NIGHT],
];
const MODE_HOURS = [null, 8.5, 12.5, 17.8, 22];

function currentHour() {
  if (S.timeMode === -1) return +Q.get('hour');
  if (S.timeMode > 0) return MODE_HOURS[S.timeMode];
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function lighting() {
  const h = ((currentHour() % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (h - a[0]) / Math.max(1e-6, b[0] - a[0]);
  t = t * t * (3 - 2 * t);
  const dirOf = k => {
    const az = k[2] * Math.PI / 180, el = k[1] * Math.PI / 180;
    return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  };
  const da = dirOf(a), db = dirOf(b);
  let sun = lerp3(da, db, t);
  const sl = Math.hypot(...sun); sun = sun.map(v => v / sl);
  const horiz = Math.hypot(sun[0], sun[1]) + 1e-6;
  const sinW = Math.min(0.99, Math.sqrt(1 - sun[2] * sun[2]) / 1.333);
  const cosW = Math.sqrt(1 - sinW * sinW);
  const tanW = sinW / cosW;
  // glints: half vector between sun and an overhead eye, kept fairly upright so they still appear at dusk
  let hv = [sun[0], sun[1], sun[2] + 1];
  const hl = Math.hypot(...hv); hv = hv.map(v => v / hl);
  const tilt = Math.hypot(hv[0], hv[1]) / hv[2];
  if (tilt > 0.16) { const f = 0.16 / tilt; hv = [hv[0] * f, hv[1] * f, hv[2]]; const l2 = Math.hypot(...hv); hv = hv.map(v => v / l2); }
  return {
    sunShift: [-sun[0] / horiz * tanW, -sun[1] / horiz * tanW],
    pathK: 1 / cosW,
    sunCol: lerp3(a[3], b[3], t),
    amb: lerp3(a[4], b[4], t),
    sky: lerp3(a[5], b[5], t),
    bio: lerp(a[6], b[6], t),
    refl: lerp(a[7], b[7], t),
    glint: lerp(a[8], b[8], t),
    warm: lerp(a[9], b[9], t),
    glintH: hv,
    sunDir: sun,
  };
}


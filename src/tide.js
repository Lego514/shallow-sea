// ---------------------------------------------------------------- tide: rises and falls with real time
let tideNow = 0;
function updateTide() {
  if (Q.has('tide')) { tideNow = +Q.get('tide'); return; }
  if (!S.tide || S.shore >= 6) { tideNow = 0; return; }
  const hours = Date.now() / 3.6e6;
  tideNow = 0.05 * Math.cos(TAU * hours / 12.42 + 0.6);   // a semidiurnal tide, high twice a day
}


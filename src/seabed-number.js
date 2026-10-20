// ---------------------------------------------------------------- the seabed's number, so a favourite can be kept
const seedTag = document.createElement('div');
seedTag.id = 'seedTag';
seedTag.style.cssText = 'position:fixed;top:24px;right:24px;padding:8px 14px;border-radius:8px;background:rgba(3,28,36,.6);' +
  'color:#eaf7f5;font:16px/1.4 "Microsoft JhengHei",system-ui,sans-serif;letter-spacing:.04em;opacity:0;transition:opacity .6s;pointer-events:none';
document.body.appendChild(seedTag);
let seedTagTimer = 0, seedWord = 'Seabed No. 海床編號';
function showSeed() {
  seedTag.textContent = `${seedWord} ${seed}`;
  seedTag.style.opacity = '1';
  clearTimeout(seedTagTimer);
  seedTagTimer = setTimeout(() => { seedTag.style.opacity = '0'; }, 15000);
}

function regenerate() {
  seed = (Math.random() * 2 ** 31) | 0;
  makeWorld();
  requestFloor();
  showSeed();
}


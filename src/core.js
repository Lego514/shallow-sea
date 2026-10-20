const TAU = Math.PI * 2;
const NW = 10;          // analytic wind waves
const MAX_DROPS = 16;   // ripple impulses per frame
const MAX_FISH = 64;
const MAX_FLOATS = 12;
const MAX_PELLETS = 60;
const MAX_DOLPHINS = 6;
const MAX_SPRAY = 8;
const MAX_HATCH = 12;
const MAX_SHARKS = 2;

const canvas = document.getElementById('sea');
const msgEl = document.getElementById('msg');
const statsEl = document.getElementById('stats');
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');

function fail(text) { msgEl.textContent = text; msgEl.style.display = 'flex'; }

const gl = canvas.getContext('webgl2', {
  alpha: false, antialias: false, depth: false, stencil: false,
  premultipliedAlpha: false, powerPreference: 'high-performance',
});
if (!gl) { fail('This wallpaper needs WebGL2, which this browser or graphics driver doesn’t provide.\n這個桌布需要 WebGL2，但這個瀏覽器或顯示卡驅動不支援。'); return; }
if (!gl.getExtension('EXT_color_buffer_float')) { fail('Your graphics card can’t render to floating-point textures (EXT_color_buffer_float).\n顯示卡不支援浮點渲染（EXT_color_buffer_float）。'); return; }


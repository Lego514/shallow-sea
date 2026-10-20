// ---------------------------------------------------------------- GL plumbing
// The browser compiles and links in the background, several programs side by side where it can
// (KHR_parallel_shader_compile), so every program is started before any is asked whether it worked.
function startProgram(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  return p;
}
function finishProgram(p) {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    for (const s of gl.getAttachedShaders(p)) {
      if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) continue;
      const log = gl.getShaderInfoLog(s);
      console.error(log + '\n' + gl.getShaderSource(s).split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error(log);
    }
    throw new Error(gl.getProgramInfoLog(p));
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}
function makeTarget(w, h, ifmt, fmt, type, filter = gl.LINEAR) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
const rgba8 = (w, h) => makeTarget(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
const rgba16f = (w, h) => makeTarget(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

gl.getExtension('KHR_parallel_shader_compile');
// species → which sprite program draws it. One program for every species took the longest of all to compile;
// four smaller ones compile side by side
const SPRITE_GROUPS = ['G_SMALL', 'G_RAY', 'G_TURTLE', 'G_BIG'];
const SPRITE_GROUP = [0, 0, 1, 0, 0, 1, 1, 3, 3, 2, 0, 0, 0, 3, 0, 0, 3];
const spriteFS = g => SPRITE_FS.replace('#version 300 es\n', '#version 300 es\n#define ' + g + '\n');
let floorHeightP, floorBaseP, floorRocksP, floorReefP, floorGardenP, floorDetailP, stepP, dropP, spriteP, compP, sandP, coastP;
try {
  [floorHeightP, floorBaseP, floorRocksP, floorReefP, floorGardenP, floorDetailP, stepP, dropP, ...spriteP] = [
    [FULLSCREEN_VS, FLOOR_HEIGHT_FS], [FULLSCREEN_VS, FLOOR_BASE_FS], [FULLSCREEN_VS, FLOOR_ROCKS_FS],
    [FULLSCREEN_VS, FLOOR_REEF_FS], [FULLSCREEN_VS, FLOOR_GARDEN_FS], [FULLSCREEN_VS, FLOOR_DETAIL_FS], [FULLSCREEN_VS, SIM_STEP_FS],
    [FULLSCREEN_VS, SIM_DROP_FS], ...SPRITE_GROUPS.map(g => [SPRITE_VS, spriteFS(g)]), [FULLSCREEN_VS, COMPOSITE_FS],
    [FULLSCREEN_VS, SAND_FS], [FULLSCREEN_VS, COAST_FS],
  ].map(([vs, fs]) => startProgram(vs, fs)).map(finishProgram);
  [compP, sandP, coastP] = spriteP.splice(SPRITE_GROUPS.length);
} catch (e) {
  fail('A shader failed to compile: ' + e.message + '\n著色器編譯失敗。');
  return;
}

const triVAO = gl.createVertexArray();
gl.bindVertexArray(triVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

function makeBatch(max) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, max * 48, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }
  gl.bindVertexArray(null);
  return { vao, buf, data: new Float32Array(max * 12), count: 0 };
}
const deepBatch = makeBatch(4);
const fishBatch = makeBatch(MAX_FISH + 32 + MAX_PELLETS + MAX_DOLPHINS + MAX_SHARKS);
const floatBatch = makeBatch(MAX_FLOATS + 6 + MAX_PELLETS + MAX_DOLPHINS + MAX_SPRAY + MAX_HATCH);
const skyBatch = makeBatch(6);

function drawTri() { gl.bindVertexArray(triVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }


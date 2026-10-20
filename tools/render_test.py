"""Render a few fixed scenes of the wallpaper and compare them with the reference pictures in tests/render/.

Run from the repository root:   python tools/render_test.py            (fails if a scene looks different)
                                python tools/render_test.py --update   (after a change meant to look different)
                                python tools/render_test.py --channel chrome   (use the installed Chrome)

Each scene opens shallow-sea/index.html in headless Chromium with software WebGL (SwiftShader), so it runs the
same on a laptop and on a GitHub server with no graphics card. Everything that is normally random is pinned: the
seabed number and the hour come from the URL, Math.random is seeded, and the frames are driven one by one with a
made-up clock through the page's own loop. A scene fails if any shader fails to compile, the page logs an error
or a WebGL warning, or its last frame differs from the reference by more than a little. A failed run leaves what
it drew and a picture of the difference in tests/render/out/.

Needs Playwright:   pip install playwright==1.63.0   and   python -m playwright install chromium
"""
import argparse
import base64
import functools
import http.server
import os
import re
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
REF = os.path.join(ROOT, 'tests', 'render')
OUT = os.path.join(REF, 'out')

WIDTH, HEIGHT = 480, 300            # the user's screen shape (1.6), small enough for software rendering

# name, URL query, then the script that plays it: run(n) draws n frames of 1/30 s (nobody is touching the wallpaper,
# so it runs at 30 FPS), `sea` is the page's test hooks
SCENES = [
    ('noon', 'seed=4242&hour=12.5&tide=0',
     'run(20); sea.splash(0.62, 0.55); run(18);'),
    ('sunset', 'seed=777&shore=2&hour=17.8&tide=0.03',
     'run(38);'),
    ('night', 'seed=31337&shore=5&hour=22&tide=0',
     'run(38);'),
    # the big visitors, moved from their starting point off screen into view
    ('visitors', 'seed=4242&hour=9&tide=0',
     'sea.spawnDolphins(); sea.spawnSharks(); run(1);'
     'bring(sea.dolphins, 1.15, 0.62); bring(sea.sharks, 0.95, 0.3);'
     'run(10); sea.leapDolphin(1); run(20);'),
]

# a pixel counts as different when a colour channel is off by more than PIXEL_TOL (of 255); a scene fails when more
# than BAD_SHARE of its pixels are (72 of 144,000), or when the average difference is above MEAN_TOL. Software
# rendering gives the same pixels on Windows and Linux, so this only leaves room for a different processor
PIXEL_TOL, BAD_SHARE, MEAN_TOL = 16, 0.0005, 0.25

# sea.js is served inside a block that gives it, and only it, a seeded Math.random and a requestAnimationFrame that
# never calls back (the frames are driven by the test). Anything else on the page that draws random numbers, such
# as a script injected by an ad blocker, then can't shift the wallpaper's sequence
WRAP = '''{
let s = 0x2545f491;
const Math = Object.create(globalThis.Math, { random: { value: () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = globalThis.Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + globalThis.Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
} } });
const requestAnimationFrame = () => 0;
%s
}
'''

PLAY = '''script => {
  let n = 0;
  const run = k => {
    for (let i = 0; i < k; i++, n++)
      if (!sea.driveFrame(1e7 + n * 1000 / 30)) throw new Error('frame ' + n + ' was not drawn');
  };
  // move a group of creatures so that its first one is at (x, y), keeping their formation
  const bring = (list, x, y) => {
    const dx = x - list[0].x, dy = y - list[0].y;
    for (const c of list) { c.x += dx; c.y += dy; }
  };
  new Function('sea', 'run', 'bring', script)(sea, run, bring);
  run(1);
  return document.getElementById('sea').toDataURL('image/png');
}'''

COMPARE = '''async ([shot, ref, tol]) => {
  const load = async src => { const im = new Image(); im.src = src; await im.decode(); return im; };
  const [a, b] = await Promise.all([load(shot), load(ref)]);
  if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}x${a.height}, not ${b.width}x${b.height}` };
  const c = new OffscreenCanvas(a.width, a.height), g = c.getContext('2d', { willReadFrequently: true });
  const pixels = im => { g.drawImage(im, 0, 0); return g.getImageData(0, 0, a.width, a.height); };
  const A = pixels(a).data, img = pixels(b), B = img.data;
  let sum = 0, bad = 0, max = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
    sum += d; max = Math.max(max, d);
    // the difference picture: the reference, dimmed to grey, with the pixels that changed in red
    const grey = (B[i] + B[i + 1] + B[i + 2]) / 12;
    if (d > tol) bad++;
    B[i] = d > tol ? 255 : grey + d * 8; B[i + 1] = B[i + 2] = grey;
  }
  g.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const diff = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  const n = A.length / 4;
  return { mean: sum / n, bad: bad / n, max, diff };
}'''

# messages that are only the browser talking about itself
HARMLESS = re.compile(r'GPU stall due to ReadPixels|Permissions-Policy header|Automatic fallback to software WebGL')


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def wrapped_sea():
    with open(os.path.join(ROOT, 'shallow-sea', 'sea.js'), encoding='utf-8') as f:
        head, tail = WRAP.split('%s')
        return head + f.read() + tail


def save(path, data_url):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(base64.b64decode(data_url.split(',', 1)[1]))


def run_scene(browser, port, name, query, script):
    page = browser.new_page(viewport={'width': WIDTH, 'height': HEIGHT}, device_scale_factor=1)
    problems = []
    page.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    page.on('console', lambda m: problems.append(f'console {m.type}: {m.text.splitlines()[0][:300]}')
            if (m.type == 'error' or 'WebGL' in m.text) and not HARMLESS.search(m.text) else None)
    page.route('**/favicon.ico', lambda r: r.fulfill(status=204))
    page.route('**/shallow-sea/sea.js', lambda r: r.fulfill(body=wrapped_sea(), content_type='text/javascript'))
    page.goto(f'http://127.0.0.1:{port}/shallow-sea/index.html?{query}')
    msg = page.evaluate("() => document.getElementById('msg').textContent")
    if msg:
        problems.append('the page says: ' + msg.splitlines()[0])
    shot = None
    if page.evaluate('() => !!(window.sea && window.sea.driveFrame)'):     # (without the hooks, `sea` is the canvas)
        try:
            shot = page.evaluate(PLAY, script)
        except Exception as e:      # the scene's own script or a frame threw
            problems.append(str(e).splitlines()[0].replace('Page.evaluate: ', ''))
    return page, shot, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--update', action='store_true', help='write new reference pictures')
    ap.add_argument('--channel', help='a browser installed on this computer (chrome, msedge) instead of Playwright\'s')
    ap.add_argument('scenes', nargs='*', help='only these scenes')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    srv = serve()
    port = srv.server_address[1]
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=args.channel, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        print(f'{browser.version}, {WIDTH}x{HEIGHT}')
        for name, query, script in SCENES:
            if args.scenes and name not in args.scenes:
                continue
            t0 = time.time()
            page, shot, problems = run_scene(browser, port, name, query, script)
            ref = os.path.join(REF, name + '.png')
            verdict = ''
            if shot and args.update and not problems:
                save(ref, shot)
                verdict = 'reference written'
            elif shot and not os.path.exists(ref):
                problems.append('no reference picture yet (run with --update)')
            elif shot and not args.update:
                r = page.evaluate(COMPARE, [shot, f'/tests/render/{name}.png', PIXEL_TOL])
                if 'size' in r:
                    problems.append('the picture is ' + r['size'])
                else:
                    verdict = f'{100 * r["bad"]:.3f}% of pixels differ, mean {r["mean"]:.3f}, max {r["max"]}'
                    if r['bad'] > BAD_SHARE or r['mean'] > MEAN_TOL:
                        problems.append('looks different from the reference: ' + verdict)
                        save(os.path.join(OUT, name + '-diff.png'), r['diff'])
            if problems and shot:
                save(os.path.join(OUT, name + '.png'), shot)
            page.close()
            print(f'{"FAIL" if problems else "ok  "}  {name:9} {time.time() - t0:5.1f} s  {verdict}')
            for line in problems:
                print('      ' + line)
            if problems:
                failed.append(name)
        browser.close()
    srv.shutdown()
    if failed:
        print(f'{len(failed)} scene(s) failed; what they drew is in tests/render/out/')
        sys.exit(1)


if __name__ == '__main__':
    main()

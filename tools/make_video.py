"""Make the introduction video: scripted shots of the wallpaper with captions, in English and in Chinese.

Run from the repository root:   python tools/make_video.py               (writes dist/shallow-sea-en.mp4 and -zh.mp4)
                                python tools/make_video.py --stills 30   (every 30th frame as a picture, to check shots)
                                python tools/make_video.py --only feed   (just these shots)

The shots are played the way the render test plays its scenes (tools/render_test.py): the seabed, the random numbers
and the clock are pinned, and the frames are driven one by one, so the same video comes out every time. Here the
browser uses the real graphics card and draws at 2560x1440; the frames are cropped for close-ups, scaled to
1920x1080, and get a cursor and the captions before they go to ffmpeg.

Needs Playwright with Chrome installed, Pillow, NumPy and imageio-ffmpeg (which brings its own ffmpeg).
"""
import argparse
import base64
import io
import math
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_test  # noqa: E402  (the local server)

ROOT = render_test.ROOT
DIST = os.path.join(ROOT, 'dist')
FPS = 60
VIEW_W, VIEW_H, DPR = 1280, 720, 2         # the page's size in CSS pixels; it draws at 2560x1440
OUT_W, OUT_H = 1920, 1080
FADE = 0.5                                 # seconds of cross-fade between shots
FONTS = r'C:\Windows\Fonts'

# sea.js inside a block of its own, as in the render test, plus a clock whose hour the video sets (window.videoHour)
WRAP = '''{
let s = 0x2545f491;
const Math = Object.create(globalThis.Math, { random: { value: () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = globalThis.Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + globalThis.Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
} } });
const requestAnimationFrame = () => 0;
const Date = class extends globalThis.Date {
  constructor(...a) {
    if (a.length) { super(...a); return; }
    super(2026, 5, 21);
    this.setTime(this.getTime() + window.videoHour * 3.6e6);
  }
};
%s
}
'''


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def along(points, t):
    """A point on a smooth curve (Catmull-Rom) through points, t from 0 to 1."""
    n = len(points) - 1
    u = min(n - 1e-9, max(0.0, t * n))
    i = int(u)
    f = u - i
    p0, p1, p2, p3 = (points[max(0, i - 1)], points[i], points[i + 1], points[min(n, i + 2)])
    return tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f
                        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f) for k in (0, 1))


def heart(cx, cy, size, t):
    a = 2 * math.pi * t
    x = 16 * math.sin(a) ** 3
    y = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
    return cx + x * size / 16, cy - y * size / 16


# ---------------------------------------------------------------- the shots
# Each shot: the page's URL query, its length, the hour, settings changed from the defaults, an optional setup script,
# the mouse (CSS pixels and whether the button is down, or None when there is no cursor), and the framing: the centre
# in CSS pixels and a zoom.

def keys(frames):
    """The mouse from keyframes (t, x, y, down): it glides between them, eased; None before the first."""
    def at(t):
        if t < frames[0][0]:
            return None
        for (t0, x0, y0, d0), (t1, x1, y1, _) in zip(frames, frames[1:]):
            if t < t1:
                f = ease((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
                return lerp(x0, x1, f), lerp(y0, y1, f), d0
        return frames[-1][1:]
    return at


def then(*parts):
    """Mouse functions one after another: (until, function) pairs, None once the last has ended."""
    def at(t):
        for until, fn in parts:
            if t < until:
                return fn(t)
        return None
    return at


TOUCH = then(
    (0.3, lambda t: None),
    (2.0, lambda t: (*along([(980, 560), (820, 450), (640, 300), (500, 280), (470, 380)], ease((t - 0.3) / 1.7)), True)),
    (99, keys([(2.0, 470, 380, False), (2.4, 700, 420, True), (2.52, 700, 420, False), (3.0, 560, 300, True),
               (3.12, 560, 300, False), (3.6, 820, 330, True), (3.72, 820, 330, False), (5.6, 900, 400, False)])))

FEED = keys([(0.2, 640, 640, False), (0.9, 400, 430, True), (4.3, 400, 430, False), (5.6, 470, 360, False)])

HEART_AT = (205, 220, 58)
SAND = then(
    (0.2, lambda t: None),
    (0.7, keys([(0.2, 340, 110, False), (0.7, *heart(*HEART_AT, 0), False)])),
    (3.0, lambda t: (*heart(*HEART_AT, ease((t - 0.7) / 2.3) * 0.999), True)),
    (4.2, keys([(3.0, *heart(*HEART_AT, 0.999), False), (4.2, 440, 40, False)])))

CAUSTICS = then(
    (3.2, keys([(0.5, 760, 560, False), (1.25, 520, 330, False), (1.4, 520, 330, True), (1.52, 520, 330, False),
                (2.4, 520, 330, False), (3.2, 380, 640, False)])))

NIGHT = then(
    (6.0, lambda t: None),
    (9.0, lambda t: (*along([(1100, 610), (950, 520), (820, 420), (700, 400), (620, 470), (700, 560), (860, 560)],
                           ease((t - 6.0) / 3.0)), False)))


VISITORS = ('sea.spawnDolphins(); sea.spawnSharks();'
            'const bring = (list, x, y) => { const dx = x - list[0].x, dy = y - list[0].y;'
            '  for (const c of list) { c.x += dx; c.y += dy; } };'
            'bring(sea.dolphins, 1.05, 0.62); bring(sea.sharks, 1.2, 0.3);')

# the ripple strength at the top of its slider (the default is 0.6), so that a touch shows at video size
STRONG = {'ripple': 1.0}

SHOTS = [
    dict(name='title', query='seed=1999&shore=0&tide=0', seconds=5.0, hour=10.5,
         frame=lambda t: (640, 360, 1.0 + 0.08 * t / 5)),
    dict(name='touch', query='seed=1999&shore=0&tide=0', seconds=5.5, hour=11, mouse=TOUCH, warm=2.0, settings=STRONG | {'waves': 0.3},
         frame=lambda t: (700, 380, 1.12)),
    dict(name='feed', query='seed=1999&shore=0&tide=0', seconds=5.5, hour=11.5, mouse=FEED, warm=4.0, settings=STRONG,
         frame=lambda t: (420, 420, 1.45)),
    dict(name='sand', query='seed=1999&shore=0&tide=0', seconds=6.0, hour=12, mouse=SAND, warm=5.5,
         frame=lambda t: (330, 240, 1.4 + 0.05 * t / 6)),
    dict(name='caustics', query='seed=1999&shore=0&tide=0', seconds=5.0, hour=12.5, mouse=CAUSTICS, warm=6.0, settings=STRONG,
         frame=lambda t: (520, 330, 1.4)),
    dict(name='visitors', query='seed=2024&shore=0&tide=0', seconds=6.0, hour=9.5, setup=VISITORS,
         events=[(1.0, 'sea.leapDolphin(1)'), (3.2, 'sea.leapDolphin(2)')],
         frame=lambda t: (880, 360, 1.15)),
    dict(name='night', query='seed=1999&shore=0&tide=0', seconds=13.5, mouse=NIGHT, settings=STRONG,
         hour=lambda t: lerp(15.5, 21.7, ease(t / 6.5)),
         frame=lambda t: (640, 360, 1.0)),
]

# captions: shot, from, to (seconds into the shot), heading and line in each language
CAPTIONS = [
    ('touch', 0.6, 5.2, {'en': ('Touch the water', 'Ripples solve the shallow-water wave equation on the GPU'),
                         'zh': ('伸手碰水', '漣漪在 GPU 上解淺水波方程')}),
    ('feed', 0.4, 5.2, {'en': ('Hold still to feed the fish', 'They gather, chase and nibble'),
                        'zh': ('按住不動來餵魚', '魚群會聚過來搶食')}),
    ('sand', 0.4, 5.7, {'en': ('Write in the sand', 'The swash smooths it away again'),
                        'zh': ('在沙灘上寫字', '沖上岸的浪會再把它抹平')}),
    ('caustics', 0.4, 4.8, {'en': ('Light from physics', 'Caustics from the Jacobian of refraction, colour from absorption'),
                            'zh': ('照物理算的光', '焦散來自折射的 Jacobian，顏色來自水的吸收')}),
    ('visitors', 0.4, 5.7, {'en': ('15+ species', 'Each one drawn live as an animated distance field'),
                            'zh': ('十幾種生物', '每一隻都是即時畫出的距離場')}),
    ('night', 0.5, 4.5, {'en': ('From day to night', 'The sun follows your clock'),
                         'zh': ('從白天到夜晚', '太陽跟著你的時鐘走')}),
    ('night', 6.0, 9.0, {'en': ('Glowing plankton', 'At night the water lights up wherever it moves'),
                         'zh': ('發光的浮游生物', '夜裡，水一動就會亮起來')}),
]
TITLE = {'en': ('Shallow Sea', 'An interactive tropical shore, rendered live in WebGL2'),
         'zh': ('淺海', '即時運算的互動熱帶海岸 · WebGL2')}
END = {'en': ('Shallow Sea', ['No engine, no libraries: hand-written WebGL2 shaders',
                              'Try it in your browser    lego514.github.io/shallow-sea',
                              'Source    github.com/Lego514/shallow-sea'],
              'Lively Wallpaper  ·  Wallpaper Engine  ·  any browser'),
       'zh': ('淺海', ['沒有引擎、沒有函式庫：手寫的 WebGL2 著色器',
                      '在瀏覽器裡試試    lego514.github.io/shallow-sea',
                      '原始碼    github.com/Lego514/shallow-sea'],
              'Lively Wallpaper  ·  Wallpaper Engine  ·  任何瀏覽器')}
END_AT = 9.6          # seconds into the last shot when the end card comes up


# ---------------------------------------------------------------- drawing the overlays
def font(lang, weight, size):
    names = {('en', 'bold'): 'seguisb.ttf', ('en', 'regular'): 'segoeui.ttf', ('en', 'light'): 'segoeuil.ttf',
             ('zh', 'bold'): 'msjhbd.ttc', ('zh', 'regular'): 'msjh.ttc', ('zh', 'light'): 'msjhl.ttc'}
    return ImageFont.truetype(os.path.join(FONTS, names[lang, weight]), size)


class Layer:
    """Text drawn once, with a soft shadow, kept as premultiplied colour and alpha over its bounding box."""

    def __init__(self, items):
        img = Image.new('RGBA', (OUT_W, OUT_H), (0, 0, 0, 0))
        shadow = Image.new('L', (OUT_W, OUT_H), 0)
        d, ds = ImageDraw.Draw(img), ImageDraw.Draw(shadow)
        for x, y, text, fnt, alpha, anchor in items:
            d.text((x, y), text, font=fnt, fill=(255, 255, 255, int(255 * alpha)), anchor=anchor)
            ds.text((x, y + 2), text, font=fnt, fill=int(150 * alpha), anchor=anchor)
        shadow = shadow.filter(ImageFilter.GaussianBlur(7))
        a = np.asarray(img, np.float32) / 255
        sh = np.asarray(shadow, np.float32)[..., None] / 255
        col = a[..., :3] * a[..., 3:]
        alpha = a[..., 3:] + sh * (1 - a[..., 3:])
        ys, xs = np.nonzero(alpha[..., 0] > 0.002)
        self.box = (ys.min(), ys.max() + 1, xs.min(), xs.max() + 1)
        y0, y1, x0, x1 = self.box
        self.col, self.alpha = col[y0:y1, x0:x1], alpha[y0:y1, x0:x1]

    def over(self, frame, opacity):
        if opacity <= 0:
            return
        y0, y1, x0, x1 = self.box
        region = frame[y0:y1, x0:x1]
        region[:] = region * (1 - self.alpha * opacity) + self.col * 255 * opacity


def caption_layer(lang, heading, line):
    x, y = 110, OUT_H - 118
    return Layer([(x, y - 58, heading, font(lang, 'bold', 50), 1.0, 'ls'),
                  (x, y, line, font(lang, 'light' if lang == 'en' else 'regular', 31), 0.9, 'ls')])


def title_layer(lang):
    big, sub = TITLE[lang]
    return Layer([(OUT_W / 2, OUT_H / 2 + 10, big, font(lang, 'bold', 128), 1.0, 'ms'),
                  (OUT_W / 2, OUT_H / 2 + 74, sub, font(lang, 'light' if lang == 'en' else 'regular', 38), 0.92, 'ms')])


def end_layer(lang):
    big, lines, small = END[lang]
    items = [(OUT_W / 2, 420, big, font(lang, 'bold', 104), 1.0, 'ms')]
    for i, text in enumerate(lines):
        items.append((OUT_W / 2, 520 + 62 * i, text, font(lang, 'regular', 36 if i == 0 else 33), 0.95, 'ms'))
    items.append((OUT_W / 2, 780, small, font(lang, 'light' if lang == 'en' else 'regular', 28), 0.75, 'ms'))
    return Layer(items)


def cursor_sprite(down):
    """A soft white ring, filled in while the button is down, drawn 4x large and scaled down for smooth edges."""
    s, r = 4, 17
    size = (r + 8) * 2 * s
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size / 2
    rr = (r - 3 if down else r) * s
    d.ellipse((c - rr - 2 * s, c - rr - 2 * s, c + rr + 2 * s, c + rr + 2 * s), outline=(0, 0, 0, 70), width=5 * s)
    d.ellipse((c - rr, c - rr, c + rr, c + rr), outline=(255, 255, 255, 235), width=3 * s,
              fill=(255, 255, 255, 110) if down else None)
    img = img.resize((size // s, size // s), Image.LANCZOS)
    a = np.asarray(img, np.float32) / 255
    return a[..., :3] * a[..., 3:], a[..., 3:]


CURSOR = {False: cursor_sprite(False), True: cursor_sprite(True)}


def draw_cursor(frame, x, y, down, opacity=1.0):
    col, alpha = CURSOR[down]
    h, w = alpha.shape[:2]
    x0, y0 = int(round(x - w / 2)), int(round(y - h / 2))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(OUT_W, x0 + w), min(OUT_H, y0 + h)
    if x1c <= x0c or y1c <= y0c:
        return
    a = alpha[sy0:sy0 + y1c - y0c, sx0:sx0 + x1c - x0c] * opacity
    c = col[sy0:sy0 + y1c - y0c, sx0:sx0 + x1c - x0c] * opacity
    region = frame[y0c:y1c, x0c:x1c]
    region[:] = region * (1 - a) + c * 255


def darken(frame, amount):
    frame *= 1 - amount


def bottom_shade(frame, amount):
    """A gradient behind the captions, so white text reads on bright sand."""
    if amount <= 0:
        return
    h = 360
    g = np.linspace(0, 1, h, dtype=np.float32) ** 1.6 * 0.45 * amount
    frame[OUT_H - h:] *= (1 - g)[:, None, None]


# ---------------------------------------------------------------- playing a shot
def crop_box(cx, cy, zoom):
    """The part of the 2560x1440 frame to show, from a centre in CSS pixels and a zoom, kept inside the frame."""
    w, h = VIEW_W * DPR / zoom, VIEW_H * DPR / zoom
    x0 = min(VIEW_W * DPR - w, max(0, cx * DPR - w / 2))
    y0 = min(VIEW_H * DPR - h, max(0, cy * DPR - h / 2))
    return x0, y0, w, h


def play(browser, port, shot, stills_every=0):
    """Yields (frame as float32 HxWx3 0..255, cursor (x, y, down) in output pixels or None) for each frame of a shot."""
    page = browser.new_page(viewport={'width': VIEW_W, 'height': VIEW_H}, device_scale_factor=DPR)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/favicon.ico', lambda r: r.fulfill(status=204))
    with open(os.path.join(ROOT, 'shallow-sea', 'sea.js'), encoding='utf-8') as f:
        body = WRAP.replace('%s', f.read())
    page.route('**/shallow-sea/sea.js', lambda r: r.fulfill(body=body, content_type='text/javascript'))
    hour = shot['hour'] if callable(shot['hour']) else (lambda t, h=shot['hour']: h)
    page.add_init_script(f'window.videoHour = {hour(0)};')
    page.goto(f'http://127.0.0.1:{port}/shallow-sea/index.html?{shot["query"]}')
    if errors or not page.evaluate('() => !!(window.sea && window.sea.driveFrame)'):
        raise RuntimeError(f'{shot["name"]}: the page did not start: {errors}')
    page.evaluate('() => { sea.mouse.lastMove = 1e9; }')          # not idle: draw every frame, at 60 FPS
    if shot.get('settings'):
        page.evaluate('s => Object.assign(sea.settings, s)', shot['settings'])
    if shot.get('setup'):
        page.evaluate('() => { ' + shot['setup'] + ' }')
    # let the scene settle before the shot starts (fish spread out, waves come in)
    warm = int(shot.get('warm', 1.0) * FPS)
    page.evaluate(f'''() => {{ for (let i = 0; i < {warm}; i++) sea.driveFrame(1e7 + i * 1000 / {FPS}); }}''')
    n0 = warm
    events = list(shot.get('events', []))
    mouse_fn = shot.get('mouse', lambda t: None)
    state = None                                  # (x, y, down) last sent to the page
    frames = int(round(shot['seconds'] * FPS))
    for i in range(frames):
        t = i / FPS
        m = mouse_fn(t)
        if m is not None:
            x, y, down = m
            if state is None or (x, y) != state[:2]:
                page.mouse.move(x, y)
            if down and not (state and state[2]):
                page.mouse.down()
            if not down and state and state[2]:
                page.mouse.up()
        elif state is not None:                       # the cursor leaves the picture
            if state[2]:
                page.mouse.up()
            page.evaluate("() => document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))")
        state = m
        while events and events[0][0] <= t:
            page.evaluate('() => { ' + events.pop(0)[1] + ' }')
        now = 1e7 + (n0 + i) * 1000 / FPS
        want = not stills_every or i % stills_every == 0
        data = page.evaluate('''([now, hour, want]) => { window.videoHour = hour;
            if (!sea.driveFrame(now)) throw new Error('frame not drawn');
            return want ? document.getElementById('sea').toDataURL('image/jpeg', 0.95) : null; }''', [now, hour(t), want])
        if data is None:
            continue
        img = Image.open(io.BytesIO(base64.b64decode(data.split(',', 1)[1]))).convert('RGB')
        cx, cy, zoom = shot['frame'](t)
        x0, y0, w, h = crop_box(cx, cy, zoom)
        img = img.resize((OUT_W, OUT_H), Image.LANCZOS, box=(x0, y0, x0 + w, y0 + h))
        cur = None
        if m is not None:
            cur = ((m[0] * DPR - x0) * OUT_W / w, (m[1] * DPR - y0) * OUT_H / h, m[2])
        yield i, np.asarray(img, np.float32).copy(), cur
    if errors:
        raise RuntimeError(f'{shot["name"]}: {errors}')
    page.close()


# ---------------------------------------------------------------- the whole video
def timeline():
    """Where each shot starts in the video: shots overlap by FADE seconds."""
    starts, at = [], 0.0
    for s in SHOTS:
        starts.append(at)
        at += s['seconds'] - FADE
    return starts, at + FADE


def overlay(frame, lang, shot_name, t, layers):
    """Captions and cards for one language at time t into a shot."""
    for name, a, b, _ in CAPTIONS:
        if name == shot_name and a - 0.3 <= t <= b + 0.3:
            o = ease((t - a) / 0.35) * (1 - ease((t - b) / 0.35))
            bottom_shade(frame, o)
            layers[(name, a)].over(frame, o)
    if shot_name == 'title':
        o = ease((t - 0.7) / 0.6) * (1 - ease((t - 3.9) / 0.6))
        darken(frame, 0.22 * o)
        layers['title'].over(frame, o)
    if shot_name == SHOTS[-1]['name'] and t >= END_AT:
        o = ease((t - END_AT) / 0.8)
        darken(frame, 0.45 * o)
        layers['end'].over(frame, o)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--stills', type=int, default=0, metavar='N', help='save every Nth frame as a picture instead')
    ap.add_argument('--only', nargs='*', help='only these shots')
    ap.add_argument('--langs', default='en,zh')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright
    import imageio_ffmpeg

    langs = args.langs.split(',')
    layers = {lang: {'title': title_layer(lang), 'end': end_layer(lang),
                     **{(n, a): caption_layer(lang, *texts[lang]) for n, a, b, texts in CAPTIONS}} for lang in langs}
    shots = [s for s in SHOTS if not args.only or s['name'] in args.only]
    os.makedirs(DIST, exist_ok=True)
    stills_dir = os.path.join(DIST, 'video-stills')
    if args.stills:
        os.makedirs(stills_dir, exist_ok=True)

    encoders = {}
    if not args.stills:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        for lang in langs:
            out = os.path.join(DIST, f'shallow-sea-{lang}.mp4')
            encoders[lang] = subprocess.Popen(
                [ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}',
                 '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
                 '-movflags', '+faststart', out], stdin=subprocess.PIPE)

    srv = render_test.serve()
    port = srv.server_address[1]
    fade_n = int(FADE * FPS)
    tail = []                       # the last frames of the shot before, waiting to be faded into the next
    t_start = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        for k, shot in enumerate(shots):
            t0 = time.time()
            frames = int(round(shot['seconds'] * FPS))
            new_tail = []
            for i, frame, cur in play(browser, port, shot, args.stills):
                t = i / FPS
                if cur:
                    draw_cursor(frame, *cur)
                if args.stills:
                    for lang in langs:
                        f = frame.copy()
                        overlay(f, lang, shot['name'], t, layers[lang])
                        Image.fromarray(f.clip(0, 255).astype(np.uint8)).save(
                            os.path.join(stills_dir, f'{shot["name"]}-{i:04d}-{lang}.jpg'), quality=90)
                    continue
                # captions first, so that a caption fades out with its shot
                outs = {}
                for lang in langs:
                    f = frame.copy()
                    overlay(f, lang, shot['name'], t, layers[lang])
                    outs[lang] = f
                if i < fade_n and tail:
                    w = ease((i + 1) / (fade_n + 1))
                    prev = tail.pop(0)
                    outs = {lang: prev[lang].astype(np.float32) * (1 - w) + outs[lang] * w for lang in langs}
                if k < len(shots) - 1 and i >= frames - fade_n:
                    new_tail.append({lang: f.clip(0, 255).astype(np.uint8) for lang, f in outs.items()})
                    continue
                for lang in langs:
                    encoders[lang].stdin.write(outs[lang].clip(0, 255).astype(np.uint8).tobytes())
            tail = new_tail
            print(f'{shot["name"]:9} {shot["seconds"]:4.1f} s of video in {time.time() - t0:5.1f} s', flush=True)
        browser.close()
    srv.shutdown()
    for lang, enc in encoders.items():
        enc.stdin.close()
        enc.wait()
        print('wrote', os.path.join(DIST, f'shallow-sea-{lang}.mp4'))
    print(f'{time.time() - t_start:.0f} s in all; the video is {timeline()[1]:.1f} s long')


if __name__ == '__main__':
    main()

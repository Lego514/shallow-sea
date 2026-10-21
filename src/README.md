# Source of `sea.js`

The wallpaper ships as one classic script, `shallow-sea/sea.js`, because Lively Wallpaper and Wallpaper Engine load it straight from disk, where browsers refuse ES modules. `tools/build.py` joins these files, in the order listed there, inside one closure. They share its top-level names the way the sections of one long file would, so a name defined in an earlier file can be used in a later one.

```bash
python tools/build.py          # writes shallow-sea/sea.js
python tools/build.py --check  # what CI runs: fails if sea.js is not what src/ builds
```

## The render test

`tools/render_test.py` opens the wallpaper in headless Chromium with software WebGL (SwiftShader) and plays five fixed scenes: noon with a splash, sunset on another shore, night with glowing jellies, dolphins with a shark, and an octopus jetting away from beside an anemone. The seabed, the hour, the random numbers and the clock are all pinned, so each scene draws the same pixels on any computer, Windows or Linux. The test fails if a shader doesn't compile, the page logs an error or a WebGL warning, or a scene's last frame differs from its reference picture in `tests/render/`. CI runs it before publishing the web version, and a failed run keeps what it drew, with a difference picture, as the `render-test` artifact.

```bash
pip install playwright==1.63.0
python -m playwright install chromium
python tools/render_test.py            # compare with the references
python tools/render_test.py --update   # after a change that is meant to look different: new references
```

Commit the new references with the change that needed them. A visual change that the references don't show yet fails CI, and the web version isn't published.

## How a frame is made

1. **Simulate** (`loop.js`, `creatures/`, `input.js`): creatures move, the mouse and rain drop impulses into the ripple simulation, waves and the tide advance.
2. **Ripples** (`shaders/ripples.js`): a height field on the GPU steps the shallow-water wave equation, with the wave speed set by the water depth.
3. **Sprites** (`shaders/sprites/`): every creature is an instanced quad whose fragment shader draws it as a signed-distance shape. One pass writes their shadows, cast along the refracted sun ray, into a shadow map; others draw what lies near the seabed, what swims in mid-water and what floats on the surface into separate layers.
4. **Composite** (`shaders/composite.js`): for every pixel, the surface slope (wind waves plus ripples) refracts the view into the baked seabed; caustics come from the Jacobian of the refraction map; light is absorbed with depth, red first; the creature layers, Fresnel reflection, sun and moon glints and the surf go on top.

The seabed itself (`shaders/seabed.js`, built by `targets.js`) is drawn only when a new one is made: six small passes hand their work on in float textures, ending in one texture of colour plus water depth.

## Where things are

| File | What it holds |
| --- | --- |
| `core.js`, `settings.js` | limits, the canvas, URL parameters; the settings and quality levels |
| `shaders/common.js` | GLSL shared by several programs: hashes and noise, the coastline, the waves washing up the beach |
| `shaders/coast.js` | the baked coast map (distance from the shore, distance along it) |
| `shaders/seabed.js` | the seabed's six passes: relief; sand and seagrass; boulders; coral reefs; coral gardens and the water depth; pebbles and starfish |
| `shaders/ripples.js` | the ripple simulation and the impulses that start ripples |
| `shaders/sprites/` | the sprite vertex shader, then one file per group of creatures, then `main.js`, which puts the five fragment programs together |
| `shaders/composite.js` | the final image, including the wind waves that feel the bottom (`waveHere`) and the glitter |
| `shaders/sand.js` | writing in the sand, and the swash smoothing it away |
| `gl.js` | compiling every program side by side (`KHR_parallel_shader_compile`), render targets, instance batches |
| `world.js` | the seeded world: wind waves, shore, noise offsets |
| `targets.js` | building the seabed and coast map, reading back the depth map, the wind waves' phase table |
| `creatures/` | where creatures appear (`spawn.js`) and how each kind behaves |
| `light.js` | the sun, sky and colours through the day |
| `loop.js` | the frame loop: frame-rate limits (at most 60, 30 when idle), then one step of everything |
| `frame.js` | one frame's drawing: packing instances, the ripple simulation, sprites, the composite |
| `tide.js`, `sound.js`, `seabed-number.js` | the tide, the surf sound, the seabed number |
| `properties.js` | Lively and Wallpaper Engine settings, the test hooks on `window.sea`, start-up |

"""Build shallow-sea/sea.js from the source files in src/.

Run from the repository root:   python tools/build.py           (writes shallow-sea/sea.js)
                                python tools/build.py --check   (fails if sea.js is not what src/ builds)

The wallpaper has to be a single classic script: Lively and Wallpaper Engine load it straight from disk, where
browsers refuse ES modules. So the sources are plain parts of one function body, joined in the order below and
wrapped in one closure; they share its top-level names the way the sections of one file would.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'shallow-sea', 'sea.js')

ORDER = [
    'core.js',                  # limits shared by everything, the canvas, URL parameters
    'settings.js',              # the settings object and quality levels
    'shaders/common.js',        # GLSL shared by several programs: noise, the coastline, waves washing up the beach
    'shaders/coast.js',         # the baked coast map; the full-screen vertex shader
    'shaders/seabed.js',        # the seabed, in six passes
    'shaders/ripples.js',       # the ripple simulation (shallow-water wave equation)
    'shaders/sprites/vertex.js',            # every creature and floating thing, as signed-distance sprites:
    'shaders/sprites/common.js',            #   placed, shadowed and blurred by the vertex shader, drawn by
    'shaders/sprites/fish.js',              #   one of five fragment programs, each holding one group
    'shaders/sprites/rays.js',
    'shaders/sprites/jellies.js',
    'shaders/sprites/floats.js',
    'shaders/sprites/turtle.js',
    'shaders/sprites/beach.js',
    'shaders/sprites/sharks-dolphins.js',
    'shaders/sprites/surface.js',
    'shaders/sprites/reef.js',
    'shaders/sprites/main.js',
    'shaders/composite.js',     # the final image: refraction, caustics, absorption, glints, surf
    'shaders/sand.js',          # writing in the sand
    'gl.js',                    # compiling the programs side by side, render targets, instance batches
    'world.js',                 # the seeded world: wind waves, shore, seabed noise
    'targets.js',               # building the seabed and coast map, the depth map, the wind waves' phase table
    'creatures/spawn.js',       # where creatures appear and how many
    'input.js',                 # mouse, touch, writing in the sand
    'creatures/food.js',        # fish food
    'creatures/behaviour.js',   # fish schooling, rays, turtles, jellies, crabs, gulls
    'creatures/hatchlings.js',  # turtle hatchlings on the beach at night
    'creatures/dolphins.js',    # the dolphin pod and its leaps
    'creatures/sharks.js',      # reef sharks
    'creatures/reef.js',        # anemones and their clownfish, the octopus
    'light.js',                 # the sun and sky through the day
    'frame.js',                 # one frame's work: instances, the ripple simulation, sprites, composite
    'tide.js',
    'sound.js',
    'seabed-number.js',         # the number that brings back a seabed you liked
    'loop.js',                  # the frame loop: frame-rate limits, then simulate and draw
    'properties.js',            # Lively and Wallpaper Engine settings, test hooks, start-up
]


def build():
    prologue = open(os.path.join(SRC, '_prologue.txt'), encoding='utf-8').read()
    body = ''.join(open(os.path.join(SRC, name), encoding='utf-8').read() for name in ORDER)
    return prologue + body + '})();\n'


def main():
    listed = {n.replace('/', os.sep) for n in ORDER}
    found = {os.path.relpath(os.path.join(d, f), SRC) for d, _, fs in os.walk(SRC) for f in fs if f.endswith('.js')}
    if found != listed:
        sys.exit('src/ and ORDER disagree: ' + ', '.join(sorted(found ^ listed)))
    out = build()
    if '--check' in sys.argv:
        current = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        if current != out:
            sys.exit('shallow-sea/sea.js is out of date: run python tools/build.py')
        print('shallow-sea/sea.js matches src/')
        return
    open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
    print(f'wrote shallow-sea/sea.js ({out.count(chr(10))} lines from {len(ORDER)} files)')


if __name__ == '__main__':
    main()

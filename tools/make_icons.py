#!/usr/bin/env python3
"""The app's icons as PNGs (static/icons/), drawn from the favicon of static/index.html: a green rounded square
with a black check. Pure Python (zlib), no dependency: run it again only if the favicon changes.

    python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'static', 'icons')
GREEN = (0x62, 0xDB, 0x15)
# The favicon's geometry, in its 100×100 viewBox: the square's corner radius, the check's points and stroke.
RADIUS, STROKE = 22, 12
CHECK = [(28, 52), (43, 67), (73, 35)]
SAMPLES = 4  # per side, per pixel: anti-aliased edges


def _seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _in_square(x, y, inset=0.0):
    lo, hi, r = inset, 100 - inset, RADIUS
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    cx = min(max(x, lo + r), hi - r)
    cy = min(max(y, lo + r), hi - r)
    return math.hypot(x - cx, y - cy) <= r


def pixel(x, y, full_bleed):
    """RGBA of one point of the 100×100 drawing. A full-bleed icon (Apple's, which rounds it itself) is square."""
    if any(_seg_dist((x, y), a, b) <= STROKE / 2 for a, b in zip(CHECK, CHECK[1:])):
        return (0, 0, 0, 255)
    if full_bleed or _in_square(x, y):
        return (*GREEN, 255)
    return (0, 0, 0, 0)


def render(size, full_bleed=False):
    rows = []
    step = 100 / size
    for j in range(size):
        row = bytearray([0])  # filter: none
        for i in range(size):
            acc = [0, 0, 0, 0]
            for sj in range(SAMPLES):
                for si in range(SAMPLES):
                    r, g, b, a = pixel((i + (si + 0.5) / SAMPLES) * step, (j + (sj + 0.5) / SAMPLES) * step, full_bleed)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            n = SAMPLES * SAMPLES
            alpha = acc[3] / n
            row += bytes([round(acc[0] / acc[3]) if acc[3] else 0, round(acc[1] / acc[3]) if acc[3] else 0,
                          round(acc[2] / acc[3]) if acc[3] else 0, round(alpha)])
        rows.append(bytes(row))
    return png(size, size, b''.join(rows))


def png(w, h, raw):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, bleed in (('icon-192.png', 192, False), ('icon-512.png', 512, False), ('apple-touch-icon.png', 180, True)):
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(render(size, bleed))
        print(f'static/icons/{name}')


if __name__ == '__main__':
    main()

"""Deterministic original pixel sheets and tiny synthesized WAVs for the Mad Stool mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/stool'
(root / 'sprites').mkdir(parents=True, exist_ok=True)
(root / 'sounds').mkdir(parents=True, exist_ok=True)


def chunk(t, d):
    return struct.pack('!I', len(d)) + t + d + struct.pack('!I', zlib.crc32(t + d) & 0xffffffff)


def sheet(name, fw, fh, frames, paint):
    rows = []
    for y in range(fh):
        row = bytearray()
        for f in range(frames):
            for x in range(fw):
                row.extend(paint(f, x, y) or (0, 0, 0, 0))
        rows.append(b'\0' + bytes(row))
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', fw * frames, fh, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))
    (root / 'sprites' / (name + '.png')).write_bytes(png)


WOOD = (150, 100, 62, 255)
WOOD_DK = (98, 64, 38, 255)
WOOD_LT = (190, 142, 92, 255)
WOOD_EDGE = (74, 46, 26, 255)
NAIL_STEEL = (176, 182, 190, 255)
NAIL_HEAD = (214, 218, 224, 255)
NAIL_DK = (110, 114, 122, 255)
EYE_RED = (226, 58, 46, 255)
EYE_DK = (110, 18, 16, 255)
SPLINTER = (222, 190, 140, 255)
SOCKET = (60, 38, 22, 255)


# Legs jiggle sideways by frame to sell the "rabid" wobble; a leg is a 2px-wide
# post at each corner, offset a little per frame so the whole thing never sits still.
def leg_dx(f, corner):
    wob = (-1, 0, 1)[f % 3]
    return wob if corner == 0 else -wob


def body_paint(f, x, y, legless=False):
    # angry eyes cut into the seat's front lip
    if 3 <= y <= 4:
        for ex in (5, 10):
            if ex <= x <= ex + 1:
                return EYE_RED if (x + f) % 2 == 0 else EYE_DK
    # tabletop seat with a plank seam and a rim shadow
    if 1 <= y <= 6 and 1 <= x <= 14:
        if y == 1 or x == 1 or x == 14:
            return WOOD_EDGE
        if y == 6:
            return WOOD_DK
        if x == 7 or x == 8:
            return WOOD_DK
        return WOOD if (x // 2) % 2 == 0 else WOOD_LT
    # two back legs, dimmer (perspective), always present
    for bx in (6, 9):
        lx = bx + leg_dx(f, 0 if bx == 6 else 1)
        if 7 <= y <= 13 and lx - 1 <= x <= lx:
            return WOOD_DK
    # front-left leg, always present
    lx = 3 + leg_dx(f, 0)
    if 7 <= y <= 14 and lx <= x <= lx + 1:
        return WOOD_EDGE if y == 14 else (WOOD if y % 2 else WOOD_LT)
    if legless:
        # front-right leg torn off: a splintered stump instead
        rx = 11
        if y == 7 and rx <= x <= rx + 1:
            return SOCKET
        if y == 8 and rx <= x <= rx + 1:
            return SPLINTER if (x + f) % 2 == 0 else SOCKET
        return None
    # front-right leg, always present
    rx = 11 + leg_dx(f, 1)
    if 7 <= y <= 14 and rx <= x <= rx + 1:
        return WOOD_EDGE if y == 14 else (WOOD if y % 2 else WOOD_LT)
    return None


sheet('body', 16, 16, 3, lambda f, x, y: body_paint(f, x, y, legless=False))
sheet('body_melee', 16, 16, 3, lambda f, x, y: body_paint(f, x, y, legless=True))


def nail_paint(f, x, y):
    if y == 0:
        return NAIL_HEAD if 0 <= x <= 3 else None
    if 1 <= x <= 2:
        return NAIL_STEEL if y < 7 else NAIL_DK
    return None


sheet('nail', 4, 8, 1, nail_paint)


def leg_paint(f, x, y):
    # a torn-off stool leg swung like a club, nail tips poking out near the head
    lean = 1 if f == 1 else 0
    cx = 3 + lean
    if cx <= x <= cx + 1:
        if y >= 3:
            return WOOD_DK if y % 3 == 0 else WOOD
        return WOOD_EDGE
    if y in (2, 4) and (x == cx - 1 or x == cx + 2):
        return NAIL_STEEL
    return None


sheet('leg', 8, 16, 2, leg_paint)


def spark_paint(f, x, y):
    cx, cy = 3.5, 3.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = 3.4 if f == 0 else 2.2
    if abs(dx) <= 0.6 or abs(dy) <= 0.6:
        if d <= r:
            return NAIL_HEAD if d <= r - 1.4 else SPLINTER
    if abs(dx - dy) <= 0.6 or abs(dx + dy) <= 0.6:
        if d <= r - 0.8:
            return SPLINTER
    return None


sheet('spark', 8, 8, 2, spark_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# clack: a short hard wooden knock with a metallic nail-head overtone
wav('clack', (
    7200 * (1 - i / 900) * (math.sin(i * 1.7) + 0.5 * math.sin(i * 3.1) + 0.25 * math.sin(i * 5.3))
    for i in range(900)
))
# creak: a low, unstable wood-creaking groan — pitch drifts to feel unhinged
wav('creak', (
    3600 * (1 - i / 6600) * math.sin(i * (0.09 + 0.03 * math.sin(i * 0.002)))
    for i in range(6600)
))
print('stool assets written to', root)

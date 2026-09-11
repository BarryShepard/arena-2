"""Deterministic original pixel sheets and tiny synthesized WAVs for the Bull mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/bull'
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


FUR = (120, 74, 44, 255)
FUR_DK = (80, 48, 28, 255)
FUR_HL = (150, 100, 62, 255)
HORN = (226, 216, 188, 255)
HORN_DK = (176, 164, 132, 255)
SNOUT = (196, 120, 110, 255)
SNOUT_DK = (150, 84, 78, 255)
NOSTRIL = (60, 24, 20, 255)
RING = (214, 182, 70, 255)
EYE_WHITE = (240, 236, 224, 255)
EYE_RED = (200, 30, 30, 255)
WING = (52, 40, 36, 255)
WING_DK = (32, 24, 22, 255)

DARK_FUR = (58, 34, 22, 255)
DARK_FUR_DK = (36, 20, 12, 255)
DARK_FUR_HL = (92, 54, 32, 255)
GLOW = (255, 70, 40, 255)
GLOW_HL = (255, 160, 90, 255)
FLAME = (255, 140, 40, 235)
FLAME_HL = (255, 210, 120, 245)


def bull_head(x, y, fur, fur_dk, fur_hl, horn, horn_dk, snout, snout_dk, eye):
    # horns, sweeping up and out from the skull
    if (x in (1, 2) and y in (3, 4)) or (x in (13, 14) and y in (3, 4)):
        return horn if (x + y) % 2 == 0 else horn_dk
    if (x in (3, 4) and y in (4, 5)) or (x in (11, 12) and y in (4, 5)):
        return horn_dk
    # ears
    if (x in (2, 3) and y in (7, 8)) or (x in (12, 13) and y in (7, 8)):
        return fur_dk
    # skull mass
    if 4 <= x <= 11 and 5 <= y <= 13:
        if 5 <= x <= 6 and y == 7:
            return eye
        if 9 <= x <= 10 and y == 7:
            return eye
        if x in (4, 11) or y == 5:
            return fur_dk
        if 6 <= x <= 9 and 11 <= y <= 13:
            return snout if (x, y) not in ((6, 12), (9, 12)) else NOSTRIL
        if 6 <= x <= 9 and y == 10:
            return snout_dk
        return fur_hl if (x + y) % 3 == 0 else fur
    # nose ring
    if x in (7, 8) and y == 14:
        return RING
    return None


def body_paint(f, x, y):
    p = bull_head(x, y, FUR, FUR_DK, FUR_HL, HORN, HORN_DK, SNOUT, SNOUT_DK, EYE_WHITE)
    if p:
        return p
    # small bat wings flapping up (f=0) / down (f=1) either side of the head
    if f == 0:
        if x == 0 and y in (8, 9):
            return WING
        if x == 1 and y in (7, 8, 9):
            return WING if y != 8 else WING_DK
        if x == 14 and y in (7, 8, 9):
            return WING if y != 8 else WING_DK
        if x == 15 and y in (8, 9):
            return WING
    else:
        if x == 1 and y in (9, 10):
            return WING
        if x == 0 and y in (9, 10, 11):
            return WING if y != 10 else WING_DK
        if x == 15 and y in (9, 10, 11):
            return WING if y != 10 else WING_DK
        if x == 14 and y in (9, 10):
            return WING
    return None


sheet('body', 16, 16, 2, body_paint)


def minotaur_paint(f, x, y):
    p = bull_head(x, y, DARK_FUR, DARK_FUR_DK, DARK_FUR_HL, HORN, HORN_DK, SNOUT_DK, (110, 56, 50, 255),
                   GLOW if f == 0 else GLOW_HL)
    if p:
        return p
    # bigger, angrier: flame wisps instead of wings
    flame = FLAME if f == 0 else FLAME_HL
    if x in (0, 1) and y in (9, 10, 11):
        if x == 1 or y == 10:
            return flame
    if x in (14, 15) and y in (9, 10, 11):
        if x == 14 or y == 10:
            return flame
    return None


sheet('minotaur', 16, 16, 2, minotaur_paint)


def gore_paint(f, x, y):
    cx, cy = 3.5, 3.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    r = (2.6 if f == 0 else 3.4) * (0.55 + 0.45 * abs(math.sin(ang * 3 + f * 2)))
    if d > r:
        return None
    if d > r - 1:
        return (150, 20, 20, 255)
    return (90, 10, 10, 255)


sheet('gore', 8, 8, 2, gore_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# roar: low guttural bellow, thick detuned partials with a slow pitch sag and slow decay
wav('roar', (
    6000 * (1 - i / 9000) * (1 + 0.5 * math.sin(i * 0.01)) *
    (math.sin(i * (0.075 - i * 0.0000015)) + 0.5 * math.sin(i * (0.15 - i * 0.000003)) + 0.3 * math.sin(i * 0.038))
    for i in range(9000)
))
# crunch: short noisy bite/impact thud, deterministic pseudo-noise (no random module) with fast decay
wav('crunch', (
    9000 * (1 - i / 700) *
    ((((i * 1103515245 + 12345) >> 8) & 0xff) / 127.5 - 1) * (0.6 + 0.4 * math.sin(i * 0.09))
    for i in range(700)
))
print('bull assets written to', root)

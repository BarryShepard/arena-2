"""Deterministic original pixel sheets and tiny synthesized WAVs for the Serpent mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/serpent'
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


SCALE = (74, 168, 94, 255)
SCALE_DK = (44, 118, 62, 255)
BAND = (232, 198, 64, 255)
BAND_DK = (176, 142, 34, 255)
BELLY = (222, 214, 172, 255)
EYE = (30, 20, 10, 255)
EYE_RING = (255, 224, 120, 255)
FANG = (250, 250, 240, 255)
VENOM = (150, 224, 90, 255)
VENOM_DK = (86, 158, 46, 255)
HUSK = (196, 182, 132, 255)
HUSK_DK = (140, 126, 84, 255)
HUSK_CRACK = (96, 84, 54, 255)


def body_paint(f, x, y):
    # 16x16 rounded serpent segment, striped diagonally; head markings (eyes/fangs)
    # sit at the right edge so the sprite reads as "facing" along +x (angle 0).
    cx, cy = 8.0, 8.0
    dx, dy = x - cx, y - cy
    d = math.hypot(dx / 1.05, dy)
    if d > 7.3:
        return None
    stripe = int((x * 0.6 + y * 0.6 + f * 2) // 2) % 2
    base = BAND if stripe == 0 else SCALE
    dark = BAND_DK if stripe == 0 else SCALE_DK
    if y >= 11:
        base = BELLY
        dark = BELLY
    if d > 6.1:
        return dark
    # head markings near the leading edge
    if x >= 11 and 4 <= y <= 11:
        if (y in (5, 10)) and x >= 12:
            return EYE_RING
        if (y in (6, 9)) and x >= 12:
            return EYE
        if y in (7, 8) and x >= 13:
            return FANG if (x + f) % 2 == 0 else EYE_RING
    return base


sheet('body', 16, 16, 2, body_paint)


def spit_paint(f, x, y):
    cx, cy = 3.5, 3.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = 3.1 if f == 0 else 2.5
    if d > r:
        return None
    if d > r - 1:
        return VENOM_DK
    return VENOM if (x + y + f) % 2 == 0 else VENOM_DK


sheet('spit', 8, 8, 2, spit_paint)


def skin_paint(f, x, y):
    cx, cy = 11.5, 11.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx / 1.1, dy)
    if d > 11:
        return None
    ring = int(d) % 3
    crack = (int(dx * 2) ^ int(dy * 2)) % 7 == 0
    if crack and d < 10:
        return HUSK_CRACK
    if d > 9.3:
        return HUSK_DK
    return HUSK if ring != 1 else HUSK_DK


sheet('skin', 24, 24, 1, skin_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# hiss: broadband noise-ish rattle (sum of odd harmonics beating against each
# other) with a fast decay — a strike or a scale scraping a wall.
wav('hiss', (
    6200 * (1 - i / 1400) * (math.sin(i * 1.7) + 0.5 * math.sin(i * 2.3) + 0.35 * math.sin(i * 3.1))
    for i in range(1400)
))
# spit: short wet pop, a quick pitch drop
wav('spit', (
    5200 * (1 - i / 700) * math.sin(i * (0.9 + i * 0.0009))
    for i in range(700)
))
# shed: dry rustle — filtered-feeling low buzz with slow tremolo, longer decay
wav('shed', (
    3400 * (1 - i / 4200) * (1 + 0.5 * math.sin(i * 0.04)) * math.sin(i * 0.34 + 0.3 * math.sin(i * 0.11))
    for i in range(4200)
))
print('serpent assets written to', root)

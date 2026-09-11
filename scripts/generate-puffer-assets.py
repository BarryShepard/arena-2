"""Deterministic original pixel sheets and tiny synthesized WAVs for the Puffer mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/puffer'
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


BASE = (70, 120, 190, 255)      # body blue
HI = (140, 190, 255, 255)       # body highlight
BELLY = (245, 210, 110, 255)    # belly yellow
BELLY_HI = (255, 236, 170, 255)
DARK = (30, 36, 60, 255)        # eye / outline
EYE_HI = (255, 255, 255, 255)
PINK = (255, 150, 160, 255)     # mouth
SPIKE = (225, 228, 235, 255)
SPIKE_DK = (150, 152, 168, 255)


def body_paint(f, x, y):
    cx, cy = 7.5, 8.0
    dx, dy = x - cx, y - cy + (0.4 if f == 1 else 0)
    d = math.hypot(dx, dy)
    if f == 1 and 6.2 <= d <= 7.6:
        ang = math.atan2(dy, dx)
        k = (ang + math.pi) / (math.pi / 4)
        if abs(k - round(k)) < 0.22:
            return SPIKE if d < 7.0 else SPIKE_DK
    if d <= 6.2:
        if (x, y) in ((10, 6), (11, 6)):
            return DARK
        if (x, y) == (10, 5):
            return EYE_HI
        if 11 <= x <= 12 and y == 9:
            return PINK
        if dy > 1.5:
            return BELLY_HI if dy > 3.2 else BELLY
        if dx < -2 and dy < -2:
            return HI
        return BASE
    return None


sheet('body', 16, 16, 2, body_paint)


def water_paint(f, x, y):
    cx, cy = 3.5, 3.5
    d = math.hypot(x - cx, y - cy)
    r = (2.0, 3.1)[f]
    if abs(d - r) < 0.9:
        return (120, 195, 255, 200) if f == 0 else (170, 222, 255, 150)
    return None


sheet('water', 8, 8, 2, water_paint)


def spit_paint(f, x, y):
    cx, cy = 3.5, 2.6
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy * 0.85)
    if d <= 1.6:
        return (140, 210, 255, 255) if d < 0.9 else (80, 160, 235, 255)
    if abs(dx) < 0.7 and cy < y < 6.2:
        return (80, 160, 235, 255)
    return None


sheet('spit', 8, 8, 1, spit_paint)


def spike_paint(f, x, y):
    cx, cy = 11.5, 11.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = (6, 10, 13)[f]
    ang = math.atan2(dy, dx)
    k = (ang + math.pi) / (math.pi / 6)
    spiky = abs(k - round(k)) < 0.28
    ring = ((190, 230, 255, 255), (120, 190, 255, 255), (70, 130, 210, 255))[f]
    if d <= 4:
        return ring
    if d <= r and spiky and d >= r - 4:
        return ring
    return None


sheet('spike', 24, 24, 3, spike_paint)

K = (96, 102, 116, 255)
KD = (56, 60, 74, 255)
KH = (150, 158, 176, 255)
GLASS = (120, 190, 255, 255)
GLASS_HI = (170, 224, 255, 255)


def robot_paint(f, x, y):
    if 3 <= x <= 12 and 3 <= y <= 14:
        if x in (3, 12) or y in (3, 14):
            return KD
        if 5 <= x <= 10 and 5 <= y <= 8:
            if (x, y) in ((7, 6), (8, 6)):
                return DARK
            return GLASS if (x + y) % 2 == 0 else GLASS_HI
        if 5 <= x <= 10 and y == 11:
            return KD
        return K if (x + y) % 2 == 0 else KH
    fy = 11 if f == 0 else 9
    if 1 <= x <= 2 and fy <= y <= fy + 1:
        return KD
    fy2 = 9 if f == 0 else 11
    if 13 <= x <= 14 and fy2 <= y <= fy2 + 1:
        return KD
    return None


sheet('robot', 16, 16, 2, robot_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# splash: watery swish with quick decay
wav('splash', (6000 * (1 - i / 2400) * math.sin(i * (0.35 - 0.00008 * i)) for i in range(2400)))
# thud: low heavy punch/impact thump
wav('thud', (9500 * (1 - i / 1600) * math.sin(i * 0.045) for i in range(1600)))
print('puffer assets written to', root)

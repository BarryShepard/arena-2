"""Deterministic original pixel sheets and tiny synthesized WAVs for the Scavenger mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/scavenger'
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


STEEL = (120, 128, 140, 255)
STEEL_DK = (66, 72, 82, 255)
RUST = (150, 85, 40, 255)
RUST_DK = (100, 56, 26, 255)
COPPER = (196, 130, 60, 255)
LEATHER = (86, 62, 42, 255)
GOGGLE = (150, 230, 120, 255)
GOGGLE_DK = (70, 130, 70, 255)
BLADE = (214, 224, 232, 255)
BLADE_EDGE = (255, 255, 255, 255)
FLAME_A = (255, 150, 40, 235)
FLAME_B = (255, 220, 120, 245)


def body_paint(f, x, y):
    # head + goggle band
    if 6 <= x <= 9 and 1 <= y <= 4:
        if y == 1 or y == 4 or x == 6 or x == 9:
            return STEEL_DK
        if 2 <= y <= 3:
            return GOGGLE if (x + f) % 2 == 0 else GOGGLE_DK
        return STEEL
    if 6 <= x <= 9 and y == 5:
        return LEATHER
    # torso plating with a rivet on each side and a centre seam
    if 4 <= x <= 11 and 5 <= y <= 10:
        if x in (7, 8):
            return STEEL_DK
        if (x, y) in ((5, 7), (10, 7)):
            return COPPER
        if x in (4, 11) or y == 10:
            return RUST_DK
        return RUST
    # plain left arm
    if 2 <= x <= 3 and 6 <= y <= 9:
        return STEEL if x == 3 else STEEL_DK
    # right arm with the blade-fin jutting out
    if 12 <= x <= 13 and 6 <= y <= 9:
        return STEEL if x == 12 else STEEL_DK
    if x == 14 and y in (7, 8):
        return BLADE
    if x == 15 and y in (7, 8) and (x + y + f) % 2 == 0:
        return BLADE_EDGE
    if x == 13 and y in (6, 9):
        return BLADE
    # plain left leg (boot)
    if 5 <= x <= 6 and 11 <= y <= 15:
        return STEEL_DK if y == 15 else STEEL
    # rocket-booster right leg
    if 8 <= x <= 10 and 11 <= y <= 12:
        return RUST_DK
    if 8 <= x <= 11 and y == 13:
        return STEEL_DK
    if 8 <= x <= 11 and y == 14:
        return FLAME_A
    if 9 <= x <= 10 and y == 15:
        return FLAME_B if f == 1 else FLAME_A
    return None


sheet('body', 16, 16, 2, body_paint)


def spike_paint(f, x, y):
    cx, cy = 11.5, 11.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    base = (5, 8, 11)[f]
    jag = 3.2 * (0.5 + 0.5 * math.cos(ang * 7 + f))
    r = base + jag
    if d > r:
        return None
    if d > r - 1.4:
        return BLADE_EDGE if int((ang + math.pi) * 3) % 2 == 0 else STEEL
    if d > r - 3:
        return RUST if (int(dx) + int(dy)) % 2 == 0 else RUST_DK
    return COPPER


sheet('spike', 24, 24, 3, spike_paint)


def spark_paint(f, x, y):
    cx, cy = 3.5, 3.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = 3.4 if f == 0 else 2.2
    if abs(dx) <= 0.6 or abs(dy) <= 0.6:
        if d <= r:
            return BLADE_EDGE if d <= r - 1.4 else BLADE
    if abs(dx - dy) <= 0.6 or abs(dx + dy) <= 0.6:
        if d <= r - 0.8:
            return BLADE
    return None


sheet('spark', 8, 8, 2, spark_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# clang: two close-detuned high metallic partials, fast decay — a blade/scrap impact
wav('clang', (
    8500 * (1 - i / 1200) * (math.sin(i * 1.35) + 0.6 * math.sin(i * 1.9) + 0.3 * math.sin(i * 2.6))
    for i in range(1200)
))
# hum: low electromagnetic buzz with tremolo, slow decay — the magnet powering up
wav('hum', (
    5200 * (1 - i / 5400) * (1 + 0.4 * math.sin(i * 0.05)) * math.sin(i * 0.24)
    for i in range(5400)
))
print('scavenger assets written to', root)

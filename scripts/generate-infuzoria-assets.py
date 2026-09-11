"""Deterministic original pixel sheets and tiny synthesized WAVs for the Infuzoria mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/infuzoria'
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


MEMBRANE = (70, 150, 100, 220)   # translucent green-blue cell wall
CYTO = (140, 220, 165, 235)      # cytoplasm fill
CYTO_HI = (190, 245, 205, 255)   # highlight
NUCLEUS = (70, 100, 70, 255)     # nucleus
NUCLEUS_HI = (110, 140, 100, 255)
VACUOLE = (120, 200, 230, 200)   # food vacuole dot
CILIA = (200, 235, 205, 190)     # cilia hair


def body_paint(f, x, y):
    cx, cy = 7.5, 7.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = 6.4
    # cilia: short hairs radiating from the membrane, alternating on/off per hair each frame
    if r < d <= r + 1.6:
        ang = math.atan2(dy, dx)
        k = (ang + math.pi) / (math.pi / 6)
        if abs(k - round(k)) < 0.3 and int(round(k)) % 2 == f:
            return CILIA
        return None
    if d <= r:
        if d > r - 1.1:
            return MEMBRANE
        # nucleus, offset toward the back
        ndx, ndy = x - (cx - 1.3), y - (cy - 1.0)
        nd = math.hypot(ndx, ndy)
        if nd <= 2.1:
            return NUCLEUS_HI if nd < 1.0 else NUCLEUS
        # a couple of food vacuoles near the front
        if math.hypot(x - (cx + 2.4), y - (cy + 1.6)) <= 1.1:
            return VACUOLE
        if math.hypot(x - (cx + 1.4), y - (cy - 2.3)) <= 0.8:
            return VACUOLE
        return CYTO_HI if dy < -1.5 and dx < 0.5 else CYTO
    return None


sheet('body', 16, 16, 2, body_paint)


def daughter_paint(f, x, y):
    cx, cy = 3.5, 3.5
    dx, dy = x - cx, y - cy + (0.3 if f == 1 else 0)
    d = math.hypot(dx, dy)
    r = 2.9
    if d <= r:
        if d > r - 0.8:
            return MEMBRANE
        if math.hypot(x - (cx - 0.6), y - (cy - 0.4)) <= 0.9:
            return NUCLEUS
        return CYTO_HI if dy < -0.8 else CYTO
    return None


sheet('daughter', 8, 8, 2, daughter_paint)

CLOUD_A = (150, 90, 210, 210)
CLOUD_B = (110, 60, 170, 190)
CLOUD_C = (190, 140, 235, 170)
BUBBLE = (220, 190, 250, 220)


def cloud_paint(f, x, y):
    cx, cy = 11.5, 11.5
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    r = (7, 9.5, 11.5)[f]
    ring = (CLOUD_A, CLOUD_B, CLOUD_C)[f]
    if d > r:
        return None
    # a few bubbling pockets scattered across the puff, shifting each frame
    for bx, by in ((cx - 3, cy - 2), (cx + 2.5, cy + 3), (cx - 1, cy + 3.5), (cx + 3.5, cy - 3)):
        bx2 = bx + math.sin(f * 2.1 + bx) * 0.8
        by2 = by + math.cos(f * 2.1 + by) * 0.8
        if math.hypot(x - bx2, y - by2) <= 1.3:
            return BUBBLE
    if d > r - 1.6:
        return None
    return ring


sheet('cloud', 24, 24, 3, cloud_paint)


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# squelch: wet melee impact — two close low frequencies beating against each other, fast decay
wav('squelch', (
    7000 * (1 - i / 1400) * (math.sin(i * 0.11) + 0.5 * math.sin(i * 0.14)) for i in range(1400)
))
# gloop: descending pitch "blub" — frequency sweeps down as the cell splits/engulfs, slow decay
wav('gloop', (
    6500 * (1 - i / 3200) * math.sin(i * (0.09 + 0.00004 * (3200 - i))) for i in range(3200)
))
print('infuzoria assets written to', root)

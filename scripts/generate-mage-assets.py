"""Deterministic original pixel sheets and tiny synthesized WAVs for the Mage mod; stdlib only."""
import struct, zlib, wave, math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'characters/mage'
(root / 'sprites').mkdir(parents=True, exist_ok=True)
(root / 'sounds').mkdir(parents=True, exist_ok=True)

PALETTE = {
    '.': (0, 0, 0, 0),
    'h': (58, 40, 112, 255),    # hat
    'H': (104, 76, 176, 255),   # hat highlight
    'r': (78, 62, 160, 255),    # robe
    'R': (124, 104, 206, 255),  # robe light
    'f': (232, 204, 172, 255),  # face
    'e': (22, 20, 40, 255),     # eyes
    'g': (240, 200, 80, 255),   # gold trim
    's': (150, 100, 60, 255),   # staff
    'o': (110, 220, 255, 255),  # orb
    'O': (210, 250, 255, 255),  # orb bright
    'b': (60, 160, 255, 255),   # bolt core
    'B': (190, 236, 255, 255),  # bolt highlight
    'v': (150, 60, 220, 255),   # violet
    'V': (220, 170, 255, 255),  # violet light
    'k': (40, 44, 60, 255),     # dark metal
    'K': (96, 104, 128, 255),   # light metal
    'w': (255, 255, 255, 255),
}


def chunk(t, d):
    return struct.pack('!I', len(d)) + t + d + struct.pack('!I', zlib.crc32(t + d) & 0xffffffff)


def sheet(name, frames):
    """frames: list of equally sized ASCII-art frames laid out horizontally."""
    h = len(frames[0]); fw = len(frames[0][0]); w = fw * len(frames)
    rows = []
    for y in range(h):
        row = bytearray()
        for fr in frames:
            assert len(fr) == h and all(len(l) == fw for l in fr), name
            for ch in fr[y]:
                row.extend(PALETTE[ch])
        rows.append(b'\0' + bytes(row))
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))
    (root / 'sprites' / (name + '.png')).write_bytes(png)


body1 = [
    '......hh........',
    '.....hhhh.......',
    '....hhHhhh......',
    '...hhhhhhhh.....',
    '..hhhHhhhhhh....',
    '.gggggggggggg...',
    '....ffffff..s...',
    '....feffef..o...',
    '....ffffff..s...',
    '.....rrrr...s...',
    '....rrRrrr..s...',
    '...rrrRrrrr.s...',
    '...rrrrrrrr.s...',
    '..rrrrrrrrrr....',
    '..rrrrrrrrrr....',
    '..gggggggggg....',
]
body2 = body1[:7] + ['....feffef..O...'] + body1[8:13] + [
    '..rrrrrrrrrr....',
    '..gggggggggg....',
    '................',
]
sheet('body', [body1, body2])

bolt1 = ['........', '...BB...', '..BbbB..', '.BbbbbB.', '.BbbbbB.', '..BbbB..', '...BB...', '........']
bolt2 = ['...B....', '..BbB...', '.BbbbB..', 'BbbBbbB.', '.BbbbB..', '..BbB...', '...B....', '........']
sheet('bolt', [bolt1, bolt2])

spark = [
    ['........', '........', '...ww...', '..wBBw..', '..wBBw..', '...ww...', '........', '........'],
    ['...B....', '.B.BB.B.', '..wBBw..', 'BBwbbwBB', 'BBwbbwBB', '..wBBw..', '.B.BB.B.', '...B....'],
    ['B......B', '.b....b.', '..b..b..', '...bb...', '...bb...', '..b..b..', '.b....b.', 'B......B'],
]
sheet('spark', spark)

turret1 = [
    '................',
    '.......VV.......',
    '......VvvV......',
    '.....VvvvvV.....',
    '.....vvvvvv.....',
    '......vvvv......',
    '.......vv.......',
    '......KKKK......',
    '.....KkkkkK.....',
    '.....KkkkkK.....',
    '....KkkkkkkK....',
    '....KkkkkkkK....',
    '...KkkkkkkkkK...',
    '...kkkkkkkkkk...',
    '..kkkkkkkkkkkk..',
    '..KKKKKKKKKKKK..',
]
turret2 = turret1[:1] + ['.......ww.......', '......VVVV......', '.....VVvvVV.....'] + turret1[4:]
sheet('turret', [turret1, turret2])

zone1 = [
    '............vvvvvvvv............',
    '.........vvv........vvv.........',
    '.......vv..............vv.......',
    '......v..................v......',
    '.....v.....V........V.....v.....',
    '....v.....V.V......V.V.....v....',
    '...v.....V...V....V...V.....v...',
    '...v....V.....V..V.....V....v...',
    '..v.....V......VV......V.....v..',
    '..v....V.......VV.......V....v..',
    '..v....V......V..V......V....v..',
    '.v.....V.....V....V.....V.....v.',
    '.v......V...V......V...V......v.',
    '.v.......VVV........VVV.......v.',
    '.v............................v.',
    '.v.............vv.............v.',
    '.v.............vv.............v.',
    '.v............................v.',
    '.v.......VVV........VVV.......v.',
    '.v......V...V......V...V......v.',
    '.v.....V.....V....V.....V.....v.',
    '..v....V......V..V......V....v..',
    '..v....V.......VV.......V....v..',
    '..v.....V......VV......V.....v..',
    '...v....V.....V..V.....V....v...',
    '...v.....V...V....V...V.....v...',
    '....v.....V.V......V.V.....v....',
    '.....v.....V........V.....v.....',
    '......v..................v......',
    '.......vv..............vv.......',
    '.........vvv........vvv.........',
    '............vvvvvvvv............',
]
zone2 = [l.replace('V', 'w') for l in zone1]
sheet('zone', [zone1, zone2])

rune1 = [
    '....oooooooo....',
    '..oo........oo..',
    '.o....OOOO....o.',
    '.o...O....O...o.',
    'o...O..OO..O...o',
    'o...O.O..O.O...o',
    'o...O.O..O.O...o',
    'o....O.OO.O....o',
    'o....O.OO.O....o',
    'o...O.O..O.O...o',
    'o...O.O..O.O...o',
    'o...O..OO..O...o',
    '.o...O....O...o.',
    '.o....OOOO....o.',
    '..oo........oo..',
    '....oooooooo....',
]
rune2 = [l.replace('O', 'B').replace('o', 'O') for l in rune1]
sheet('rune', [rune1, rune2])


def wav(name, samples):
    with wave.open(str(root / 'sounds' / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', max(-32000, min(32000, int(s)))) for s in samples))


# cast: rising chirp with quick decay
wav('cast', (8000 * (1 - i / 3300) * math.sin(i * (0.05 + 0.00012 * i)) for i in range(3300)))
# zap: buzzy square-ish crackle with decay
wav('zap', (7000 * (1 - i / 2600) * (1 if math.sin(i * 0.31) * math.sin(i * 0.017) > 0 else -1) for i in range(2600)))
print('mage assets written to', root)

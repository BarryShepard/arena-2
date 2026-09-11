"""Deterministic original pixel sprite and a tiny synthesized WAV; no artwork dependencies."""
import struct,zlib,wave,math
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'characters/fighter'
w,h=32,16
pixels=[]
for y in range(h):
 row=bytearray()
 for x in range(w):
  xx=x%16
  if 4<=xx<=11 and 3<=y<=12: c=(194,201,175,255)
  elif (2<=xx<=3 or 12<=xx<=13) and 5<=y<=11: c=(91,106,98,255)
  else:c=(0,0,0,0)
  if 5<=xx<=10 and y in (5,6):c=(31,45,45,255)
  if y==12 and x>=16 and xx in (4,5,10,11):c=(0,0,0,0)
  row.extend(c)
 pixels.append(b'\0'+row)
def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
(root/'sprites/body.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(pixels)))+chunk(b'IEND',b''))
with wave.open(str(root/'sounds/hit.wav'),'wb') as f:
 f.setparams((1,2,22050,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',int(9000*(1-i/2205)*math.sin(i*(.12+.00007*i)))) for i in range(2205)))

"""Deterministic pixel sprites and two synthesized WAVs for Bud; no artwork dependencies."""
import struct,zlib,wave,math
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'characters/bud'
(root/'sprites').mkdir(parents=True,exist_ok=True);(root/'sounds').mkdir(parents=True,exist_ok=True)
def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
def sheet(name,fw,fh,frames,paint):
 rows=[]
 for y in range(fh):
  row=bytearray()
  for f in range(frames):
   for x in range(fw):row.extend(paint(f,x,y) or (0,0,0,0))
  rows.append(b'\0'+bytes(row))
 (root/'sprites'/(name+'.png')).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',fw*frames,fh,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b''))
def blob(base,hi,dark,leaf,spiky):
 def paint(f,x,y):
  dx,dy=x-7.5,y-8+(0.5 if f else 0);d=math.hypot(dx,dy*1.15 if f else dy)
  if spiky and f==1 and abs(abs(dx)-abs(dy))<0.6 and 6<=d<=8.2:return dark
  if d<=6.5:
   if (x,y) in((5,7),(9,7)):return dark
   if 5<=x<=9 and y==10:return dark
   if dx<-2 and dy<-2:return hi
   return base
  if leaf and y in(0,1) and 6+f<=x<=8+f:return leaf
  if spiky and abs(abs(dx)-abs(dy))<0.6 and 6<=d<=7.5:return dark
 return paint
def seed(base,hi,dark):
 def paint(f,x,y):
  d=math.hypot(x-3.5,y-3.5-(0.5 if f else 0))
  if d<=3.2:return dark if (x,y)==(3,3) else hi if x<3 and y<3 else base
 return paint
G=(120,206,84,255);GH=(190,240,140,255);GD=(34,78,40,255);L=(60,150,60,255)
P=(192,90,214,255);PH=(240,170,255,255);PD=(70,20,90,255)
sheet('body',16,16,2,blob(G,GH,GD,L,False))
sheet('thorn',16,16,2,blob(P,PH,PD,None,True))
sheet('seed',8,8,2,seed(G,GH,GD))
sheet('seedthorn',8,8,2,seed(P,PH,PD))
sheet('shot',4,4,1,lambda f,x,y:(230,255,150,255) if abs(x-1.5)+abs(y-1.5)<=2 else None)
def mine(f,x,y):
 d=math.hypot(x-3.5,y-3.5)
 if d<=1:return (255,70,50,255) if f==0 else (90,30,20,255)
 if d<=3.4:return (70,72,40,255) if (x+y)%2 else (100,102,60,255)
sheet('mine',8,8,2,mine)
def boom(f,x,y):
 d=math.hypot(x-11.5,y-11.5);r=(5,9,11.5)[f]
 if d<=r and(f==0 or d>=r-3.5):return((255,240,120,255),(255,170,60,255),(180,60,40,255))[f]
 if f==0 and d<=8 and (x+y)%3==0:return(255,190,80,255)
sheet('boom',24,24,3,boom)
def wav(name,samples):
 with wave.open(str(root/'sounds'/(name+'.wav')),'wb') as f:
  f.setparams((1,2,22050,0,'NONE','not compressed'));f.writeframes(b''.join(struct.pack('<h',max(-32767,min(32767,int(s)))) for s in samples))
wav('pop',[7000*(1-i/1800)*math.sin(i*(0.25-0.00006*i)) for i in range(1800)])
seed_=1;noise=[]
for i in range(6600):
 seed_=(seed_*1103515245+12345)&0x7fffffff;noise.append(11000*(1-i/6600)**2*(0.6*math.sin(i*0.03)+0.5*(seed_/0x7fffffff*2-1)))
wav('boom',noise)

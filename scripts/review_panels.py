"""Offline source-image review panels. Does not modify annotations."""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];VID='e2b08207-6749-49c3-8cfe-6454c6d2a3a3'
p=argparse.ArgumentParser();p.add_argument('--frames',required=True);p.add_argument('--region',required=True);p.add_argument('--out',required=True);p.add_argument('--width',type=int,default=400);p.add_argument('--cols',type=int,default=3);p.add_argument('--spec');p.add_argument('--groups',action='store_true');args=p.parse_args()
frames=[]
for v in args.frames.split(','):
 if ':' in v:
  parts=list(map(int,v.split(':')));frames.extend(range(*parts))
 else:frames.append(int(v))
region=list(map(int,args.region.split(',')));w=args.width;h=round((region[3]-region[1])*w/(region[2]-region[0]));scale=w/(region[2]-region[0]);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
sheet=Image.new('RGB',(w*args.cols,(h+24)*math.ceil(len(frames)/args.cols)),(12,18,24));draw=ImageDraw.Draw(sheet)
obs=json.load(open(args.spec))['observations'] if args.spec else []
groups=json.load(open(ROOT/'.frameinsight/review/candidate-groups.json'))['tracks'] if args.groups else {}
for index,f in enumerate(frames):
 im=Image.open(ROOT/'.frameinsight/frames'/VID/f'{f:08d}.png').crop(region).resize((w,h));d=ImageDraw.Draw(im)
 entries=[(o['person_id'],o['b'],'#18ff90') for o in obs if o['frame']==f]
 for g,rows in groups.items():
  for r in rows:
   if r['frame']==f:entries.append(('G'+g,r['proposal']['box'],'#ffe56b'))
 for label,b,color in entries:
  if b[0]>=region[2] or b[2]<=region[0] or b[1]>=region[3] or b[3]<=region[1]:continue
  q=[(b[0]-region[0])*scale,(b[1]-region[1])*scale,(b[2]-region[0])*scale,(b[3]-region[1])*scale];d.rectangle(q,outline=color,width=2);d.text((max(0,q[0]),max(0,q[1])),str(label),font=font,fill=color,stroke_width=1,stroke_fill='black')
 x=index%args.cols*w;y=index//args.cols*(h+24);sheet.paste(im,(x,y+24));draw.text((x+5,y+3),f'Frame {f}',font=font,fill='white')
sheet.save(ROOT/args.out,quality=95);print(str(ROOT/args.out))

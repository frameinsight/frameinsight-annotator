"""Local inspection artifact. Does not mutate annotations or approval state."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--video',default='e2b08207-6749-49c3-8cfe-6454c6d2a3a3');p.add_argument('--start',type=int,default=0);p.add_argument('--step',type=int,default=1);p.add_argument('--count',type=int,default=12);p.add_argument('--width',type=int,default=960);p.add_argument('--cols',type=int,default=3);p.add_argument('--proposals',action='store_true');p.add_argument('--output');args=p.parse_args()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
cache=ROOT/'.frameinsight/frames'/args.video;out=ROOT/'.frameinsight/review';out.mkdir(exist_ok=True)
frames=list(range(args.start,args.start+args.count*args.step,args.step));h=round(args.width*1620/2880)+28
sheet=Image.new('RGB',(args.width*args.cols,h*((len(frames)+args.cols-1)//args.cols)),(12,18,23));draw=ImageDraw.Draw(sheet)
proposal_data={}
if args.proposals:
    import sqlite3
    c=sqlite3.connect(ROOT/'.frameinsight/projects.sqlite3')
    for f,s in c.execute('SELECT frame_index,data FROM proposals WHERE video_id=? AND frame_index BETWEEN ? AND ?',(args.video,frames[0],frames[-1])):proposal_data.setdefault(f,[]).append(json.loads(s))
for idx,f in enumerate(frames):
    path=cache/f'{f:08d}.png'
    if not path.exists():continue
    im=Image.open(path).convert('RGB');scale=args.width/im.width;im=im.resize((args.width,h-28));d=ImageDraw.Draw(im)
    for n,b in enumerate(sorted(proposal_data.get(f,[]),key=lambda p:p['box'][0])):
        if b['confidence']<.25:continue
        x1,y1,x2,y2=[v*scale for v in b['box']];d.rectangle((x1,y1,x2,y2),outline='#75ffb6',width=2);d.text((x1,max(0,y1-20)),f'{n}:{b["confidence"]:.2f}',fill='#ffff6b',font=font,stroke_width=1,stroke_fill='black')
    x=(idx%args.cols)*args.width;y=(idx//args.cols)*h;sheet.paste(im,(x,y+28));draw.text((x+8,y+3),f'SOURCE FRAME {f}',font=font,fill='#c7e8d8')
output=Path(args.output) if args.output else out/f'sheet-{args.start:04d}-{args.step}.jpg';sheet.save(output,quality=90);print(output)

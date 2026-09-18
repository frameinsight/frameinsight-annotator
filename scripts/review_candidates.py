"""Build adjacent-frame inspection groups, NEVER approved annotations.

This offline test aid writes only review JSON/contact sheets. Group numbers are
candidate continuity, not physical person IDs. Human visual decisions are required.
"""
import json,sqlite3
from pathlib import Path
import numpy as np

from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];VID='e2b08207-6749-49c3-8cfe-6454c6d2a3a3';out=ROOT/'.frameinsight/review';out.mkdir(exist_ok=True)
c=sqlite3.connect(ROOT/'.frameinsight/projects.sqlite3');rows=c.execute('SELECT frame_index,data FROM proposals WHERE video_id=? ORDER BY frame_index',(VID,)).fetchall();frames={}
for f,data in rows:frames.setdefault(f,[]).append(json.loads(data))
def iou(a,b):
    x=max(0,min(a[2],b[2])-max(a[0],b[0]));y=max(0,min(a[3],b[3])-max(a[1],b[1]));inter=x*y
    return inter/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter+1e-6)
def overlap_smaller(a,b):
    inter=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return inter/(min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1]))+1e-6)
tracks={};last=[];next_id=1;removed=[]
for frame in range(max(frames,default=-1)+1):
    proposals=sorted([p for p in frames.get(frame,[]) if p['confidence']>=.25],key=lambda p:-p['confidence']);kept=[]
    for p in proposals:
        if any(iou(p['box'],q['box'])>.6 or overlap_smaller(p['box'],q['box'])>.9 for q in kept):removed.append({'frame':frame,'proposal':p['id'],'reason':'Possible same-class duplicate; inspection aid only'});continue
        kept.append(p)
    old=[t for t in last if tracks[t][-1]['frame']==frame-1];cost=np.ones((len(old),len(kept)))
    for j,t in enumerate(old):
        prev=tracks[t][-1]['proposal']['box'];predict=prev
        if len(tracks[t])>=2:
            before=tracks[t][-2]['proposal']['box'];predict=[a+np.clip(a-b,-80,80) for a,b in zip(prev,before)]
        for k,p in enumerate(kept):cost[j,k]=1-max(iou(prev,p['box']),iou(predict,p['box']))
    matched={};newlast=[]
    if len(old) and len(kept):
        used_old=set();used_new=set()
        for index in np.argsort(cost,axis=None):
            j,k=np.unravel_index(index,cost.shape)
            if cost[j,k]>=.85:break
            if j not in used_old and k not in used_new:
                matched[k]=old[j];used_old.add(j);used_new.add(k)
    for k,p in enumerate(kept):
        t=matched.get(k)
        if t is None:t=next_id;next_id+=1;tracks[t]=[]
        tracks[t].append({'frame':frame,'proposal':p});newlast.append(t)
    last=newlast
json.dump({'video_id':VID,'status':'inspection_groups_not_verified_identities','tracks':tracks,'possible_duplicates':removed},open(out/'candidate-groups.json','w'))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
summary=[]
for t,records in tracks.items():
    if len(records)<3:continue
    summary.append({'candidate':t,'start':records[0]['frame'],'end':records[-1]['frame'],'count':len(records),'mean_confidence':sum(r['proposal']['confidence'] for r in records)/len(records)})
summary.sort(key=lambda x:x['start'])
for offset in range(0,len(summary),24):
    entries=summary[offset:offset+24];sheet=Image.new('RGB',(1440,240*((len(entries)+5)//6)),(15,22,29));draw=ImageDraw.Draw(sheet)
    for n,entry in enumerate(entries):
        rec=tracks[entry['candidate']][len(tracks[entry['candidate']])//2];f=rec['frame'];b=rec['proposal']['box'];im=Image.open(ROOT/'.frameinsight/frames'/VID/f'{f:08d}.png');pad=10;box=(max(0,b[0]-pad),max(0,b[1]-pad),min(im.width,b[2]+pad),min(im.height,b[3]+pad));crop=im.crop(box);crop.thumbnail((225,200));x=n%6*240;y=n//6*240;sheet.paste(crop,(x+(240-crop.width)//2,y+36));draw.text((x+5,y+3),f'G{entry["candidate"]}  {entry["start"]}–{entry["end"]}',font=font,fill='#a6edce');draw.text((x+5,y+20),f'{entry["count"]} frames  sample {f}',font=font,fill='#a5b3bf')
    sheet.save(out/f'groups-{offset//24:02d}.jpg',quality=92)
json.dump(summary,open(out/'groups-summary.json','w'),indent=2);print('Frames',len(frames),'groups',len(tracks),'long groups',len(summary))

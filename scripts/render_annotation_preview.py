"""Render a labelled inspection MP4 from native source-frame annotations and source PTS."""
import json
import zipfile
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
import av
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
source_archive=ROOT/'deliverables/OCCLUSION_01_cam01/annotations-native.zip'
with zipfile.ZipFile(source_archive) as z:p=json.loads(z.read('native/project.json'))
vid,v=next(iter(p['videos'].items()));state=p['state'];by_frame=defaultdict(list)
for o in state['observations'].values():by_frame[o['frame_index']].append(o)
output=ROOT/'deliverables/OCCLUSION_01_cam01/annotated-preview.mp4'
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
headerfont=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
width,height,header=1440,810,40
scale=width/v['width']
source=av.open(v['source']);source_stream=source.streams.video[0]
dest=av.open(str(output),'w',options={'movflags':'+faststart'})
stream=dest.add_stream('libx264',rate=source_stream.average_rate)
stream.width=width;stream.height=height+header;stream.pix_fmt='yuv420p';stream.time_base=source_stream.time_base
stream.codec_context.time_base=source_stream.time_base
stream.options={'crf':'21','preset':'veryfast','threads':'2'}
uncertain={e[k] for e in state['links'].values() if e['relation']=='unresolved' for k in ('source','target')}
count=0
for index,frame in enumerate(source.decode(source_stream)):
    ledger=p['frames'][vid][index];assert frame.pts==ledger['pts']
    image=Image.new('RGB',(width,height+header),(15,22,27));image.paste(frame.to_image().resize((width,height),Image.Resampling.LANCZOS),(0,header));draw=ImageDraw.Draw(image)
    draw.text((12,10),'B visible  |  A full (when supported)  |  ? unresolved identity relation',font=headerfont,fill=(218,231,229))
    draw.text((1120,10),f'Frame {index:03d}/612   PTS {ledger["seconds"]:06.3f}s',font=headerfont,fill=(218,231,229))
    for o in by_frame[index]:
        for g,color in [('person_ext',(103,226,177)),('person_visible',(186,167,255))]:
            box=o[g]
            if box is None:continue
            x1,y1,x2,y2=[c*scale for c in box];y1+=header;y2+=header
            draw.rectangle((x1,y1,x2,y2),outline=color,width=2)
        b=o['person_visible'];x=b[0]*scale;y=max(header,b[1]*scale+header-17)
        label=str(state['identities'][o['identity_uuid']]['person_id'])+(' ?' if o['identity_uuid'] in uncertain else '')
        tw=draw.textlength(label,font=font)+8;x=min(width-tw,x)
        draw.rectangle((x,y,x+tw,y+16),fill=(29,25,46));draw.text((x+4,y),label,font=font,fill=(211,200,255))
    out=av.VideoFrame.from_image(image);out.pts=frame.pts;out.time_base=frame.time_base
    for packet in stream.encode(out):dest.mux(packet)
    if index in (0,200,410,612):image.save(ROOT/'.frameinsight/review'/f'preview-check-{index:03d}.jpg',quality=92)
    count+=1
    if count%100==0:print('Rendered',count,flush=True)
for packet in stream.encode():dest.mux(packet)
dest.close();source.close()
assert count==613
with av.open(str(output)) as rendered:
    decoded=list((f.pts,f.time_base) for f in rendered.decode(video=0))
assert len(decoded)==613
max_timing_error=max(abs(float(pts*tb)-p['frames'][vid][i]['seconds']) for i,(pts,tb) in enumerate(decoded))
assert max_timing_error<0.001
report={'path':str(output),'frames':count,'width':width,'height':height+header,'source_pts_preserved_within_seconds':max_timing_error,'revision':p['revision'],'purpose':'Inspection preview; native and dataset archives retain original-resolution coordinates and pixels.'}
(ROOT/'docs/preview-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)

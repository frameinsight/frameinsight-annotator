from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from concurrent.futures import ThreadPoolExecutor
import json
ROOT=Path(__file__).resolve().parents[1];meta=json.load(open(ROOT/'.frameinsight/clip-project.json'));vid=next(iter(meta['videos']));cache=ROOT/'.frameinsight/frames'/vid;out=ROOT/'.frameinsight/review/thumbs';out.mkdir(parents=True,exist_ok=True)
def thumb(p):
    target=out/(p.stem+'.jpg')
    if target.exists():return
    with Image.open(p) as im:im.resize((960,540)).save(target,quality=90)
with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(thumb,sorted(cache.glob('*.png'))))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
for start in range(0,613,12):
    sheet=Image.new('RGB',(2880,2272),(14,20,25));draw=ImageDraw.Draw(sheet)
    for n in range(12):
        frame=start+n
        if frame>=613:break
        im=Image.open(out/f'{frame:08d}.jpg');x=n%3*960;y=n//3*568;sheet.paste(im,(x,y+28));draw.text((x+8,y+3),f'FRAME {frame:03}',font=font,fill='white')
    sheet.save(out.parent/f'all-{start:03d}.jpg',quality=88)
print('613 thumbnails and 52 contact sheets ready',flush=True)

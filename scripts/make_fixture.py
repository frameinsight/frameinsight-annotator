from pathlib import Path
from fractions import Fraction
import av
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
path=ROOT/'tests/fixtures/numbered.mp4'
with av.open(str(path),'w') as out:
    s=out.add_stream('libx264',rate=Fraction(30000,1001));s.width=640;s.height=360;s.pix_fmt='yuv420p'
    for i in range(24):
        image=Image.new('RGB',(640,360),(30,40,50));d=ImageDraw.Draw(image);d.text((20,20),f'SOURCE FRAME {i:02d}',font=font,fill='white');d.rectangle((100+i*2,90,170+i*2,310),outline='#6ee7b7',width=3)
        frame=av.VideoFrame.from_image(image)
        for p in s.encode(frame):out.mux(p)
    for p in s.encode():out.mux(p)
print(path)

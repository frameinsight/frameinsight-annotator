"""Create portable synthetic source media; never include it in release packages."""
import argparse
from fractions import Fraction
from pathlib import Path
import av
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
font = ImageFont.load_default(size=30)
with av.open(str(args.output), 'w') as output:
    stream = output.add_stream('libx264', rate=Fraction(30000, 1001))
    stream.width = 640; stream.height = 360; stream.pix_fmt = 'yuv420p'
    for n in range(24):
        image = Image.new('RGB', (640, 360), (30, 40, 50))
        draw = ImageDraw.Draw(image)
        draw.text((20, 20), f'SOURCE FRAME {n:02d}', font=font, fill='white')
        draw.rectangle((100 + n * 2, 90, 170 + n * 2, 310), outline='#6ee7b7', width=3)
        for packet in stream.encode(av.VideoFrame.from_image(image)): output.mux(packet)
    for packet in stream.encode(): output.mux(packet)
print(args.output)

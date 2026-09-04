"""Vendor Portal app icons.

The manifest was pointing at the PROCUREMENT APP tile, so a vendor installing
the portal got the internal app's icon on their home screen. Same family —
Megawide red, white mark — but it has to say which app it is.

Regenerate: python scratchpad/gen_vendor_icons.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

RED = (238, 46, 36)          # #EE2E24, sampled from the existing tile
OUT = 'assets/icons'
MARK = 'assets/img/megawide-mark.png'      # white mark, RGBA
FONT = 'C:/Windows/Fonts/arialbd.ttf'

def tile(px, pad_frac, two_line=True):
    im = Image.new('RGB', (px, px), RED)
    d = ImageDraw.Draw(im)
    inner = px * (1 - 2 * pad_frac)
    left = (px - inner) / 2

    src = Image.open(MARK).convert('RGBA')
    white = Image.new('RGBA', src.size, (255, 255, 255, 0))
    white.putalpha(src.getchannel('A'))
    mark = white
    # the mark is 1020x850; scale to ~52% of the inner box width
    mw = inner * 0.52
    mh = mw * mark.size[1] / mark.size[0]
    mark = mark.resize((int(mw), int(mh)), Image.LANCZOS)

    # two text lines under the mark; size them off the inner box, not the tile,
    # so the maskable variant stays inside its safe zone
    fs = int(inner * 0.155)
    try:
        f = ImageFont.truetype(FONT, fs)
    except OSError:
        f = ImageFont.load_default()
    lines = ['VENDOR', 'PORTAL'] if two_line else ['VENDOR']
    gap = int(inner * 0.055)
    lh = [d.textbbox((0, 0), t, font=f)[3] - d.textbbox((0, 0), t, font=f)[1] for t in lines]
    block = mark.size[1] + gap + sum(lh) + gap // 2 * (len(lines) - 1)
    y = (px - block) / 2

    im.paste(mark, (int((px - mark.size[0]) / 2), int(y)), mark)
    y += mark.size[1] + gap
    for t, h in zip(lines, lh):
        bb = d.textbbox((0, 0), t, font=f)
        d.text(((px - (bb[2] - bb[0])) / 2 - bb[0], y - bb[1]), t, font=f, fill=(255, 255, 255))
        y += h + gap // 2
    return im

os.makedirs(OUT, exist_ok=True)
made = []
for name, px, pad in (('vendor-icon-192.png', 192, 0.10),
                      ('vendor-icon-512.png', 512, 0.10),
                      ('vendor-icon-192-maskable.png', 192, 0.18),
                      ('vendor-icon-512-maskable.png', 512, 0.18),
                      ('vendor-apple-touch-icon.png', 180, 0.10),
                      ('vendor-favicon-32.png', 32, 0.06)):
    im = tile(px, pad, two_line=(px >= 100))
    p = os.path.join(OUT, name)
    im.save(p, optimize=True)
    made.append((name, px, os.path.getsize(p)))
for n, px, sz in made:
    print('%-34s %4dpx  %5.1f KB' % (n, px, sz / 1024))

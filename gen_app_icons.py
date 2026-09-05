"""App icons for both apps, from one generator so they cannot drift.

    python gen_app_icons.py            # writes both sets

Megawide red tile, white mark, the app's name in two lines beneath. The
procurement set replaces the older tile IN PLACE, so no manifest or <link>
needs changing.

⚠️ assets/img/megawide-mark.png IS THE RED MARK — byte-identical to
   megawide-mark-red.png. Pasted straight onto the red tile it is invisible, so
   it is repainted white through its own alpha channel.

⚠️ The label font is FITTED, not a fixed fraction. "PROCUREMENT" is nearly twice
   the width of "VENDOR" at the same size, so a fixed size overflows the tile on
   one set and looks undersized on the other.
"""
from PIL import Image, ImageDraw, ImageFont
import os

RED  = (238, 46, 36)                       # #EE2E24, sampled from the old tile
MARK = 'assets/img/megawide-mark.png'
FONT = 'C:/Windows/Fonts/arialbd.ttf'
OUT  = 'assets/icons'

def _white_mark():
    src = Image.open(MARK).convert('RGBA')
    w = Image.new('RGBA', src.size, (255, 255, 255, 0))
    w.putalpha(src.getchannel('A'))
    return w

_MARK = _white_mark()

def favicon(px):
    """The browser-tab icon: a RED MARK ON TRANSPARENT, not the red tile.

    ⚠️ THIS IS A DELIBERATE, PRE-EXISTING CHOICE — commit ffd9efc made the
       favicon a bare red mark to match the Planning app's tab icon, and
       regenerating the tiles overwrote it with a white-on-red square. That was
       reported ("it changed to a white M logo version"), and it ALSO made the
       procurement favicon byte-identical to the vendor portal's, so the two
       apps were indistinguishable in a tab strip.
       The installed app TILES stay white-on-red; only the favicon is the mark.
       The vendor favicon deliberately KEEPS the tile, so the two differ.
    """
    src = Image.open(MARK).convert('RGBA')
    red = Image.new('RGBA', src.size, RED + (0,))
    red.putalpha(src.getchannel('A'))
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    mw = max(1, int(px * 0.92))
    mh = max(1, int(mw * src.size[1] / src.size[0]))
    m = red.resize((mw, mh), Image.LANCZOS)
    im.paste(m, ((px - mw) // 2, (px - mh) // 2), m)
    return im

def _fit_font(draw, lines, max_w, start):
    """Largest size at which every line fits max_w."""
    size = start
    while size > 6:
        try:
            f = ImageFont.truetype(FONT, size)
        except OSError:
            return ImageFont.load_default(), size
        if all(draw.textbbox((0, 0), t, font=f)[2] <= max_w for t in lines):
            return f, size
        size -= 1
    return ImageFont.truetype(FONT, 7), 7

def tile(px, pad_frac, lines):
    im = Image.new('RGB', (px, px), RED)
    d = ImageDraw.Draw(im)
    inner = px * (1 - 2 * pad_frac)

    # With no room for a label the mark simply gets the tile — a favicon with
    # unreadable text is worse than one with none.
    mw = inner * (0.52 if lines else 0.88)
    mh = mw * _MARK.size[1] / _MARK.size[0]
    mark = _MARK.resize((max(1, int(mw)), max(1, int(mh))), Image.LANCZOS)

    if not lines:
        im.paste(mark, (int((px - mark.size[0]) / 2), int((px - mark.size[1]) / 2)), mark)
        return im

    f, _ = _fit_font(d, lines, inner * 0.94, int(inner * 0.17))
    gap = int(inner * 0.055)
    hs = [d.textbbox((0, 0), t, font=f)[3] - d.textbbox((0, 0), t, font=f)[1] for t in lines]
    lead = max(2, gap // 2)
    block = mark.size[1] + gap + sum(hs) + lead * (len(lines) - 1)
    y = (px - block) / 2

    im.paste(mark, (int((px - mark.size[0]) / 2), int(y)), mark)
    y += mark.size[1] + gap
    for t, h in zip(lines, hs):
        bb = d.textbbox((0, 0), t, font=f)
        d.text(((px - (bb[2] - bb[0])) / 2 - bb[0], y - bb[1]), t, font=f, fill=(255, 255, 255))
        y += h + lead
    return im

# (filename, px, padding, label lines) — [] means mark only
SETS = {
    'procurement': [
        ('icon-192.png',          192, 0.10, ['PROCUREMENT', 'DASHBOARD']),
        ('icon-512.png',          512, 0.10, ['PROCUREMENT', 'DASHBOARD']),
        ('icon-192-maskable.png', 192, 0.18, ['PROCUREMENT', 'DASHBOARD']),
        ('icon-512-maskable.png', 512, 0.18, ['PROCUREMENT', 'DASHBOARD']),
        ('apple-touch-icon.png',  180, 0.10, ['PROCUREMENT', 'DASHBOARD']),
        ('icon-180.png',          180, 0.10, ['PROCUREMENT', 'DASHBOARD']),
    ],
    'vendor': [
        ('vendor-icon-192.png',          192, 0.10, ['VENDOR', 'PORTAL']),
        ('vendor-icon-512.png',          512, 0.10, ['VENDOR', 'PORTAL']),
        ('vendor-icon-192-maskable.png', 192, 0.18, ['VENDOR', 'PORTAL']),
        ('vendor-icon-512-maskable.png', 512, 0.18, ['VENDOR', 'PORTAL']),
        ('vendor-apple-touch-icon.png',  180, 0.10, ['VENDOR', 'PORTAL']),
        ('vendor-favicon-32.png',         32, 0.06, []),
    ],
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, items in SETS.items():
        print('\n' + name)
        for fn, px, pad, lines in items:
            p = os.path.join(OUT, fn)
            tile(px, pad, lines).save(p, optimize=True)
            print('  %-32s %4dpx  %5.1f KB  %s' % (fn, px, os.path.getsize(p) / 1024,
                                                   '/'.join(lines) or '(mark only)'))
    # Browser-tab icons — the bare red mark, NOT the tile. See favicon().
    print('\nprocurement favicons (red mark on transparent)')
    for fn, px in (('favicon-32.png', 32), ('favicon-16.png', 16)):
        p = os.path.join(OUT, fn)
        favicon(px).save(p, optimize=True)
        print('  %-32s %4dpx  %5.1f KB' % (fn, px, os.path.getsize(p) / 1024))
    favicon(32).save('assets/img/favicon.png', optimize=True)
    print('  %-32s %4dpx' % ('assets/img/favicon.png', 32))

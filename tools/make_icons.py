"""Draw the app icons (icons/*.png) from the same design as the favicon in index.html: three fret lines and a gold dot
on a dark tile. Needs Pillow:  python tools/make_icons.py

  icon-192.png, icon-512.png   rounded tile, for the install prompt and home screen
  maskable-512.png             full-bleed, the artwork kept inside the central 80% so any mask shape can cut it
  apple-touch-icon.png         180px, full-bleed (iOS rounds the corners itself)
"""
from pathlib import Path
from PIL import Image, ImageDraw

BG, LINE, GOLD = (16, 19, 17), (85, 102, 102), (220, 174, 79)
OUT = Path(__file__).resolve().parent.parent / 'icons'
SCALE = 4  # draw big, shrink for smooth edges


def draw(size, rounded, inset):
    """inset: fraction of the tile left empty around the artwork (the 32-unit favicon grid is mapped into the rest)."""
    big = size * SCALE
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 7 // 32, fill=BG)
    else:
        d.rectangle((0, 0, big, big), fill=BG)
    pad = big * inset
    unit = (big - 2 * pad) / 32

    def at(v):
        return pad + v * unit

    for x in (9, 16, 23):
        d.line((at(x), at(6), at(x), at(26)), fill=LINE, width=max(1, round(2 * unit)))
    r = 4.5 * unit
    d.ellipse((at(16) - r, at(16) - r, at(16) + r, at(16) + r), fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
draw(192, True, 0).save(OUT / 'icon-192.png')
draw(512, True, 0).save(OUT / 'icon-512.png')
draw(512, False, 0.1).save(OUT / 'maskable-512.png')
draw(180, False, 0.06).convert('RGB').save(OUT / 'apple-touch-icon.png')
print('wrote', *sorted(p.name for p in OUT.glob('*.png')))

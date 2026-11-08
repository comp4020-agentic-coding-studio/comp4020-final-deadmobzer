#!/usr/bin/env python3
"""Extract board-surface textures from the rulebook's own art into
public/art/board/. Source art (the full rulebook asset dump) is gitignored;
this script turns a couple of hand-picked crops into the small, committed
PNGs the 3D board uses instead of flat colour. Idempotent: re-run any time."""
import os
from PIL import Image

MISC = "Magnagothica Maleghast/Extra - Update (Anniversary 2)/Extra/MISC"
OUT = "public/art/board"

TILE_MAX = 1024  # board tiles are viewed closer than unit tokens

# Manually-chosen crop boxes (left, top, right, bottom) picked by eye to avoid
# linework/text and land on a clean, repeatable patch of texture.
CROPS = {
    # Dense halftone dot-screen from the king figure's cloak in the "Six
    # Lower Houses" splash page -> light tile surface.
    "light-tile.png": (f"{MISC}/necro splash.png", (4555, 1700, 4690, 1835)),
    # Scuffed/scratched dark background from the "Rot in Hell" banner,
    # clear of the red graffiti text and skull crest -> dark tile surface.
    "dark-tile.png": (f"{MISC}/banner.png", (1720, 290, 2000, 480)),
}


def save(src, dst, box, cap):
    if not os.path.exists(src):
        print("  MISSING", src)
        return False
    im = Image.open(src).convert("RGB").crop(box)
    w, h = im.size
    s = min(1.0, cap / max(w, h))
    if s < 1.0:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, optimize=True)
    return True


n = 0
for name, (src, box) in CROPS.items():
    if save(src, f"{OUT}/{name}", box, TILE_MAX):
        n += 1

print(f"extracted {n} board textures -> {OUT}/")

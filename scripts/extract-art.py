#!/usr/bin/env python3
"""Extract + downscale the unit tokens and portraits we use into public/art/.
Source art (the full rulebook asset dump) is gitignored; this script turns it
into the small, committed PNGs the app serves. Idempotent: re-run any time."""
import os
from PIL import Image

SRC_UNITS = "Magnagothica Maleghast/Unit Assets/Units"
SRC_PORT  = f"{SRC_UNITS}/Unitportraits"
OUT = "public/art"

TOKEN_MAX = 512     # board standees
PORT_MAX  = 256     # portraits / avatars

# house -> { unit_id: source_token_basename }  (source files are flat in SRC_UNITS)
ROSTER = {
    "carcass":      {"gunwight":"gunwight","ammo-goblin":"ammogoblin","enforcer":"enforcer","barrelform":"barrelform","egis-weapon":"aegisweapon"},
    "goregrinders": {"warhead":"warhead","painghoul":"painghoul","carnifex":"carnifex","painwheel":"painwheel","berserker":"berserker"},
    "gargamox":     {"host":"host","leech":"leech","rotten":"rotten","scum":"scum","slime":"slime"},
    "deadsouls":    {"banshee":"banshee","bounddevil":"bounddevil","cultist":"cultist","sacrifice":"sacrifice","vizigheist":"vizigheist"},
    "abhorrers":    {"antipriest":"antipriest","exorcist":"exorcist","holybody":"holybody","penitent":"penitent","zealot":"zealot"},
    "igorri":       {"chopdoc":"chopdoc","homonculus":"homonculus","lycan":"lycan","stitch":"stitch","strigoi":"strigoi"},
}
# necromancer portrait (board art + avatar) per house
NECRO = {
    "carcass":"carcassnecro","goregrinders":"grindernecro","gargamox":"moxnecro",
    "deadsouls":"deadsoulsnecro","abhorrers":"abhorrernecro","igorri":"igorrinecro",
}
# portrait subfolder names differ in case
PORT_DIR = {"carcass":"Carcass","goregrinders":"Goregrinders","gargamox":"gargamox",
            "deadsouls":"deadsouls","abhorrers":"abhorrers","igorri":"igorri"}
# a few portrait files are named differently from the token file
PORT_OVERRIDE = {"aegisweapon":"egisweapon", "vizigheist":"visigheist"}

def save(src, dst, cap):
    if not os.path.exists(src):
        print("  MISSING", src); return False
    im = Image.open(src).convert("RGBA")
    bbox = im.getbbox()          # trim transparent border
    if bbox: im = im.crop(bbox)
    w, h = im.size
    s = min(1.0, cap / max(w, h))
    if s < 1.0: im = im.resize((round(w*s), round(h*s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, optimize=True)
    return True

n = 0
for house, units in ROSTER.items():
    for uid, token in units.items():
        if save(f"{SRC_UNITS}/{token}.png", f"{OUT}/units/{house}/{uid}.png", TOKEN_MAX): n += 1
        pdir = PORT_DIR[house]
        ptoken = PORT_OVERRIDE.get(token, token)
        save(f"{SRC_PORT}/{pdir}/{ptoken}.png", f"{OUT}/portraits/{house}/{uid}.png", PORT_MAX)
    # necromancer: portrait doubles as board art + avatar
    necro = NECRO[house]
    save(f"{SRC_PORT}/Necromancers/{necro}.png", f"{OUT}/units/{house}/necromancer.png", TOKEN_MAX)
    save(f"{SRC_PORT}/Necromancers/{necro}.png", f"{OUT}/portraits/{house}/necromancer.png", PORT_MAX)

print(f"extracted {n} unit tokens + portraits -> {OUT}/")

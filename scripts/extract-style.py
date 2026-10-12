#!/usr/bin/env python3
"""One-time style sweep: pull fonts + colour palette from the Maleghast rulebook
into data/style.json + docs/style-guide.md. Reads the PDF only here; the rest of
the build reads the JSON. See plan step 0."""
import json, subprocess, tempfile, os, glob, collections
from PIL import Image
import numpy as np

PDF = "Magnagothica Maleghast/maleghast_update3.pdf"

# --- fonts (pdffonts) ---
raw = subprocess.run(["pdffonts", PDF], capture_output=True, text=True).stdout
fonts = []
for line in raw.splitlines()[2:]:
    name = line.split()[0] if line.split() else ""
    # strip the "ABCDEF+" subset prefix
    if "+" in name:
        name = name.split("+", 1)[1]
    if name:
        fonts.append(name)
fonts = sorted(set(fonts))

# --- palette: render a spread of pages, quantise, rank by frequency ---
SAMPLE_PAGES = [1, 8, 12, 16, 17, 19, 22, 25, 28, 31]
counter = collections.Counter()
per_page = {}
with tempfile.TemporaryDirectory() as tmp:
    for p in SAMPLE_PAGES:
        subprocess.run(["pdftoppm","-png","-r","40","-f",str(p),"-l",str(p),
                        PDF, f"{tmp}/p{p}"], capture_output=True)
        f = glob.glob(f"{tmp}/p{p}*.png")
        if not f:
            continue
        a = np.array(Image.open(f[0]).convert("RGB")).reshape(-1,3)
        q = (a//24*24)
        cols, cnts = np.unique(q, axis=0, return_counts=True)
        idx = np.argsort(-cnts)[:6]
        tot = cnts.sum()
        per_page[str(p)] = ["#%02x%02x%02x"%tuple(c) for c in cols[idx]]
        for c, n in zip(cols, cnts):
            counter[tuple(int(x) for x in c)] += int(n)

def hexes(items):
    return ["#%02x%02x%02x"%c for c,_ in items]

ranked = counter.most_common(24)
# neutrals = near-greyscale; accents = saturated
def is_neutral(c):
    return max(c)-min(c) < 28
neutrals = hexes([(c,n) for c,n in ranked if is_neutral(c)])[:6]
accents  = hexes([(c,n) for c,n in ranked if not is_neutral(c)])[:10]

style = {
    "source": "Magnagothica Maleghast rulebook (maleghast_update3.pdf)",
    "fonts": {
        "all": fonts,
        "roles": {
            "display_gothic": "Metal Blackletter",   # title / House / unit names
            "stat_label": "Impact",                    # MV HP DF ARM callouts
            "body": "Georgia",                          # body serif
            "incidental": "Arial",
        },
        "web_fallbacks": {
            "display_gothic": "'UnifrakturMaguntia','Pirata One',serif",
            "stat_label": "'Oswald','Anton','Impact',sans-serif",
            "body": "Georgia,'Times New Roman',serif",
        },
    },
    "palette": {
        "paper": "#f0f0f0",
        "ink": "#000000",
        "ink_soft": "#181818",
        "primary_blood": "#f00000",
        "neutrals": neutrals,
        "accents": accents,
    },
    "house_accents": {
        "carcass":  "#f000a8",
        "deadsouls": "#00a8a8",
        "abhorrers": "#f0c030",
        "goregrinders": None,
        "gargamox": None,
        "igorri": None,
    },
    "notes": "Some pages are inverted (dark) -> support a dark theme. House "
             "accents null above are sampled per-House during art extraction.",
    "_per_page_samples": per_page,
}

os.makedirs("data", exist_ok=True)
with open("data/style.json","w") as f:
    json.dump(style, f, indent=2)
print("fonts:", fonts)
print("neutrals:", neutrals)
print("accents:", accents)
print("wrote data/style.json")

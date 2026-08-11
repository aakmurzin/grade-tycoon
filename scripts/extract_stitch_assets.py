#!/usr/bin/env python3
"""Slice Stitch concept sheets into public/assets/*. Re-run after updating stitch_grade_tycoon_asset_prompts/."""
from PIL import Image
from collections import deque
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "stitch_grade_tycoon_asset_prompts")
OUT = os.path.join(ROOT, "public", "assets")

def is_bg(r, g, b):
    avg = (r + g + b) / 3.0
    ch = max(r, g, b) - min(r, g, b)
    if ch <= 35 and 20 <= avg <= 175:
        return True
    if ch <= 40 and avg >= 200:
        return True
    if avg >= 210 and ch <= 25:
        return True
    if r >= 215 and g >= 215 and b >= 215:
        return True
    return False

def clear_bg(im):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_bg(r, g, b):
                px[x, y] = (0, 0, 0, 0)

    def soft(r, g, b):
        if is_bg(r, g, b):
            return True
        avg = (r + g + b) / 3
        ch = max(r, g, b) - min(r, g, b)
        return ch <= 45 and (avg <= 185 or avg >= 190)

    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            r, g, b, a = px[x, y]
            if soft(r, g, b) or a == 0:
                if a:
                    px[x, y] = (0, 0, 0, 0)
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if seen[y][x]:
                continue
            r, g, b, a = px[x, y]
            if soft(r, g, b) or a == 0:
                if a:
                    px[x, y] = (0, 0, 0, 0)
                seen[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                r, g, b, a = px[nx, ny]
                if soft(r, g, b):
                    px[nx, ny] = (0, 0, 0, 0)
                    seen[ny][nx] = True
                    q.append((nx, ny))
                else:
                    seen[ny][nx] = True
    return im

def tight(im, pad=2):
    px = im.load()
    w, h = im.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 40:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < 0:
        return None
    return im.crop((max(0, minx - pad), max(0, miny - pad), min(w, maxx + 1 + pad), min(h, maxy + 1 + pad)))

def scale_h(im, h):
    return im.resize((max(1, int(im.width * h / im.height)), h), Image.NEAREST)

def scale_w(im, w):
    return im.resize((w, max(1, int(im.height * w / im.width))), Image.NEAREST)

def split_grid(im, cols, rows, margin=0.01):
    w, h = im.size
    mx, my = int(w * margin), int(h * margin)
    cw, ch = (w - 2 * mx) // cols, (h - 2 * my) // rows
    return [
        im.crop((mx + c * cw, my + r * ch, mx + (c + 1) * cw, my + (r + 1) * ch))
        for r in range(rows)
        for c in range(cols)
    ]

def main():
    for d in ("chars", "furniture", "tiles", "ui"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)

    roles = {
        "dev": "16_bit_pixel_art_character_sprite_sheet_isometric_2_1_game_asset_chibi_1/screen.png",
        "sales": "16_bit_pixel_art_character_sprite_sheet_isometric_2_1_game_asset_chibi_2/screen.png",
        "hr": "16_bit_pixel_art_character_sprite_sheet_isometric_2_1_game_asset_chibi_3/screen.png",
    }
    mapping = {"idle": 0, "walk0": 4, "walk1": 5, "walk2": 6, "walk3": 7, "work0": 12, "work1": 13}
    for role, rel in roles.items():
        sheet = clear_bg(Image.open(os.path.join(SRC, rel)))
        cells = split_grid(sheet, 4, 4, 0.01)
        for name, idx in mapping.items():
            c = tight(clear_bg(cells[idx]))
            c.save(os.path.join(OUT, "chars", f"{role}_{name}.png"))
            scale_h(c, 52).save(os.path.join(OUT, "chars", f"{role}_{name}_sm.png"))
        print(role, "ok")

    print("done — run from repo root: python3 scripts/extract_stitch_assets.py")

if __name__ == "__main__":
    main()

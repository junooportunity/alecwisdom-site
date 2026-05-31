"""
Generate all book textures:
- Cloth/linen weave pattern (dark, tileable)
- Spine texture (dark linen + MPM insignia centered)
- Back cover (dark linen, plain)
- Page edge texture (cream with fine ridges)
- Front cover with linen overlay
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PATH = os.path.join(DIR, '..', 'Logos', 'monos-logo-transparent.png')
COVER_PATH = os.path.join(DIR, 'cover-front.png')

# Cover base color (near-black matching cover-front.png)
BG = (14, 14, 14)

# ─── 1. Generate tileable dark linen texture ────────────────────────────────
def make_linen(size=512, base_color=BG):
    """Create a dark cloth/linen weave texture."""
    img = Image.new('RGB', (size, size), base_color)
    draw = ImageDraw.Draw(img)

    r, g, b = base_color
    random.seed(42)  # deterministic

    # Horizontal threads
    for y in range(0, size, 3):
        variation = random.randint(-4, 4)
        c = max(0, min(255, r + variation + 6))
        draw.line([(0, y), (size, y)], fill=(c, c, c), width=1)

    # Vertical threads (slightly different tone)
    for x in range(0, size, 3):
        variation = random.randint(-4, 4)
        c = max(0, min(255, r + variation + 3))
        for y in range(0, size, 6):
            seg_len = random.randint(2, 4)
            draw.line([(x, y), (x, y + seg_len)], fill=(c, c, c), width=1)

    # Subtle noise for realism
    noise = Image.new('RGB', (size, size))
    noise_draw = ImageDraw.Draw(noise)
    for y in range(size):
        for x in range(size):
            v = random.randint(-3, 3)
            px = img.getpixel((x, y))
            noise.putpixel((x, y), tuple(max(0, min(255, p + v)) for p in px))

    # Slight blur for softness
    result = noise.filter(ImageFilter.GaussianBlur(radius=0.3))
    return result

linen = make_linen(512, BG)
linen.save(os.path.join(DIR, 'linen-texture.png'))
print('Linen texture saved.')

# ─── 2. Crop MPM insignia (circular emblem only, no text) ──────────────────
logo_full = Image.open(LOGO_PATH).convert('RGBA')
# The logo is 519x252. The circular emblem occupies rows 0-181,
# then there's a gap (rows 182-219), then the text (rows 220+).
# Find the gap by scanning for fully transparent rows.
import numpy as np
alpha = np.array(logo_full)[:, :, 3]
gap_start = None
for y in range(logo_full.height):
    if alpha[y].sum() == 0:
        gap_start = y
        break
if gap_start is None:
    gap_start = int(logo_full.height * 0.72)

emblem_region = logo_full.crop((0, 0, logo_full.width, gap_start))

# Find tight bounds of the emblem
bbox = emblem_region.getbbox()
if bbox:
    insignia = emblem_region.crop(bbox)
else:
    insignia = emblem_region

# Make it square with padding
max_dim = max(insignia.width, insignia.height)
square = Image.new('RGBA', (max_dim, max_dim), (0, 0, 0, 0))
ox = (max_dim - insignia.width) // 2
oy = (max_dim - insignia.height) // 2
square.paste(insignia, (ox, oy), insignia)
insignia = square

insignia.save(os.path.join(DIR, 'insignia-cropped.png'))
print(f'Insignia cropped: {insignia.size}')

# ─── 3. Spine texture (dark linen + insignia centered) ──────────────────────
# Spine maps to the narrow left face of the book.
# For a box, the -X face UV has U along Z-axis, V along Y-axis.
# Spine is narrow (book thickness) x tall (book height).
# We'll make it 256 x 1024 (width x height when looking at spine face).
SW, SH = 256, 1024

spine = linen.resize((SW, SH), Image.LANCZOS)

# Place insignia centered, sized to ~70% of spine width
ins_size = int(SW * 0.65)
ins_resized = insignia.resize((ins_size, ins_size), Image.LANCZOS)

# Adjust insignia brightness to be subtle on dark background
# Make it a muted gray version
ins_array = ins_resized.copy()
r, g, b, a = ins_array.split()
# Darken the RGB to be subtle
enhancer = ImageEnhance.Brightness(Image.merge('RGB', (r, g, b)))
darkened = enhancer.enhance(0.35)
dr, dg, db = darkened.split()
ins_subtle = Image.merge('RGBA', (dr, dg, db, a))

ix = (SW - ins_size) // 2
iy = (SH - ins_size) // 2
spine.paste(ins_subtle, (ix, iy), ins_subtle)

spine.save(os.path.join(DIR, 'spine-texture.png'))
print(f'Spine texture saved: {SW}x{SH}')

# ─── 4. Back cover texture (just dark linen) ────────────────────────────────
# Same dimensions as front cover for consistent UV mapping
back = linen.resize((1024, 1536), Image.LANCZOS)
back.save(os.path.join(DIR, 'back-cover-texture.png'))
print('Back cover texture saved.')

# ─── 5. Front cover with linen overlay ──────────────────────────────────────
cover = Image.open(COVER_PATH).convert('RGB')
# Create linen at cover resolution
linen_cover = make_linen(512, BG)
linen_big = linen_cover.resize(cover.size, Image.LANCZOS)

# Blend: mostly keep the cover, add subtle linen texture
# Use a soft light blend mode approximation
from PIL import ImageChops
blended = ImageChops.add(cover, linen_big, scale=2, offset=-5)
# Mix: 85% original cover + 15% blended
result = Image.blend(cover, blended, alpha=0.2)
result.save(os.path.join(DIR, 'cover-front-linen.png'))
print(f'Front cover with linen saved: {result.size}')

# ─── 6. Page edge texture (cream with fine ridges) ──────────────────────────
PW, PH = 512, 512
pages = Image.new('RGB', (PW, PH), (230, 225, 216))  # warm cream
pdraw = ImageDraw.Draw(pages)

random.seed(99)
# Fine horizontal lines simulating page edges
for y in range(0, PH, 2):
    v = random.randint(-6, 6)
    base = 225
    c = max(200, min(240, base + v))
    c2 = max(200, min(240, base + v - 3))
    c3 = max(200, min(240, base + v + 2))
    pdraw.line([(0, y), (PW, y)], fill=(c, c2, c3), width=1)

pages.save(os.path.join(DIR, 'pages-texture.png'))
print('Page edge texture saved.')

print('\nAll textures generated.')

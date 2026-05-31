"""
On Monism — Book Cover Texture Builder
Run: python3 build_cover.py

Generates:
  cover-composite.png  — color texture (printed text)
  cover-bump.png       — bump map for embossed/debossed text

Texture layout (verified from UV inspection of Demo Book model):
  LEFT = back cover (NEAR/+Y side)  |  CENTER = spine  |  RIGHT = front cover (FAR/-Y side)

Adjust CONFIG below, re-run, reload in Blender.
"""
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter, ImageOps
import os

DIR = os.path.dirname(os.path.abspath(__file__))
INSIGNIA_PATH = os.path.join(DIR, 'insignia-cropped.png')
FONT_PATH = '/System/Library/Fonts/Palatino.ttc'
FONT_INDEX = 0  # 0=Regular, 1=Italic, 2=Bold, 3=Bold Italic

# ╔══════════════════════════════════════════════════════════════════════╗
# ║  CONFIG — EDIT THESE TO ADJUST                                      ║
# ╚══════════════════════════════════════════════════════════════════════╝

TOTAL_W, TOTAL_H = 4361, 2813
BACK_W = 1990
SPINE_W = 381
FRONT_W = TOTAL_W - BACK_W - SPINE_W  # 1990

BG = (0, 0, 0)
TEXT_COLOR = (136, 134, 131)          # printed text color (gray on black)

# ── FRONT COVER ──
FRONT_TITLE_SIZE = 120
FRONT_TITLE_SPACING = 14
FRONT_TITLE_MARGIN_RIGHT = 120
FRONT_TITLE_MARGIN_TOP = 180
FRONT_TITLE_LINE_GAP = 130
FRONT_AUTHOR_SIZE = 48
FRONT_AUTHOR_SPACING = 10
FRONT_AUTHOR_MARGIN_BOTTOM = 200

# ── SPINE ──
SPINE_TITLE_SIZE = 46
SPINE_TITLE_SPACING = 6
SPINE_TITLE_Y = 0.45
SPINE_AUTHOR_SIZE = 32
SPINE_AUTHOR_SPACING = 5
SPINE_AUTHOR_Y = 0.12
SPINE_INSIGNIA_SIZE = 0.28
SPINE_INSIGNIA_Y = 0.88
SPINE_INSIGNIA_BRIGHTNESS = 0.35

# ── EMBOSS ──
EMBOSS_BLUR = 0.5                    # blur radius for bump softness

# ╔══════════════════════════════════════════════════════════════════════╗
# ║  END CONFIG                                                         ║
# ╚══════════════════════════════════════════════════════════════════════╝


def draw_spaced(draw, x, y, text, font, color, spacing):
    for ch in text:
        bbox = draw.textbbox((0, 0), ch, font=font)
        draw.text((x, y), ch, font=font, fill=color)
        x += (bbox[2] - bbox[0]) + spacing


def spaced_width(draw, text, font, spacing):
    w = 0
    for i, ch in enumerate(text):
        bbox = draw.textbbox((0, 0), ch, font=font)
        w += bbox[2] - bbox[0]
        if i < len(text) - 1:
            w += spacing
    return w


def mute_insignia(img, brightness):
    r, g, b, a = img.split()
    dark = ImageEnhance.Brightness(Image.merge('RGB', (r, g, b))).enhance(brightness)
    return Image.merge('RGBA', (*dark.split(), a))


def build_front(canvas, fill=None):
    is_bump = (canvas.mode == 'L')
    if fill is None:
        fill = 255 if is_bump else TEXT_COLOR
    d = ImageDraw.Draw(canvas)
    tf = ImageFont.truetype(FONT_PATH, FRONT_TITLE_SIZE, index=FONT_INDEX)
    af = ImageFont.truetype(FONT_PATH, FRONT_AUTHOR_SIZE, index=FONT_INDEX)

    on_w = spaced_width(d, "ON", tf, FRONT_TITLE_SPACING)
    m_w = spaced_width(d, "MONISM", tf, FRONT_TITLE_SPACING)
    draw_spaced(d, FRONT_W - FRONT_TITLE_MARGIN_RIGHT - on_w, FRONT_TITLE_MARGIN_TOP, "ON", tf, fill, FRONT_TITLE_SPACING)
    draw_spaced(d, FRONT_W - FRONT_TITLE_MARGIN_RIGHT - m_w, FRONT_TITLE_MARGIN_TOP + FRONT_TITLE_LINE_GAP, "MONISM", tf, fill, FRONT_TITLE_SPACING)
    aw_w = spaced_width(d, "ALEC  WISDOM", af, FRONT_AUTHOR_SPACING)
    draw_spaced(d, FRONT_W - FRONT_TITLE_MARGIN_RIGHT - aw_w, TOTAL_H - FRONT_AUTHOR_MARGIN_BOTTOM, "ALEC  WISDOM", af, fill, FRONT_AUTHOR_SPACING)


def place_spine_text(canvas, text, font, spacing, y_frac, fill):
    is_bump = (canvas.mode == 'L')
    if is_bump:
        tmp = Image.new('L', (2000, 200), 0)
    else:
        tmp = Image.new('RGBA', (2000, 200), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    draw_spaced(td, 0, 0, text, font, fill, spacing)
    bbox = tmp.getbbox()
    if bbox:
        tmp = tmp.crop(bbox)
    rot = tmp.rotate(-90, expand=True)
    cx = (SPINE_W - rot.width) // 2
    cy = int(TOTAL_H * y_frac) - rot.height // 2
    if is_bump:
        canvas.paste(rot, (cx, cy))
    else:
        canvas.paste(rot, (cx, cy), rot)


def build_spine(canvas, fill=None):
    is_bump = (canvas.mode == 'L')
    if fill is None:
        fill = 255 if is_bump else TEXT_COLOR
    stf = ImageFont.truetype(FONT_PATH, SPINE_TITLE_SIZE, index=FONT_INDEX)
    saf = ImageFont.truetype(FONT_PATH, SPINE_AUTHOR_SIZE, index=FONT_INDEX)
    place_spine_text(canvas, "ALEC WISDOM", saf, SPINE_AUTHOR_SPACING, SPINE_AUTHOR_Y, fill)
    place_spine_text(canvas, "ON MONISM", stf, SPINE_TITLE_SPACING, SPINE_TITLE_Y, fill)


def build_spine_insignia(canvas):
    is_bump = (canvas.mode == 'L')
    ins = Image.open(INSIGNIA_PATH).convert('RGBA')
    ins_sz = int(SPINE_W * SPINE_INSIGNIA_SIZE)
    ins_r = ins.resize((ins_sz, ins_sz), Image.LANCZOS)

    cy = int(TOTAL_H * SPINE_INSIGNIA_Y) - ins_sz // 2
    cx = (SPINE_W - ins_sz) // 2

    if is_bump:
        # Use luminance masked by alpha for bump detail
        gray = ins_r.convert('L')
        alpha = ins_r.split()[3]
        from PIL import ImageChops
        result = ImageChops.multiply(gray, alpha)
        canvas.paste(result, (cx, cy))
    else:
        ins_r = mute_insignia(ins_r, SPINE_INSIGNIA_BRIGHTNESS)
        canvas.paste(ins_r, (cx, cy), ins_r)


# ── Build color texture ──────────────────────────────────────────────────────
print('Building color texture...')
print(f'  Layout: back({BACK_W}) | spine({SPINE_W}) | front({FRONT_W}) = {TOTAL_W}')

back_c = Image.new('RGB', (BACK_W, TOTAL_H), BG)

spine_c = Image.new('RGB', (SPINE_W, TOTAL_H), BG)
build_spine(spine_c)
build_spine_insignia(spine_c)

front_c = Image.new('RGB', (FRONT_W, TOTAL_H), BG)
build_front(front_c)

comp = Image.new('RGB', (TOTAL_W, TOTAL_H), BG)
comp.paste(back_c, (0, 0))
comp.paste(spine_c, (BACK_W, 0))
comp.paste(front_c, (BACK_W + SPINE_W, 0))
comp.save(os.path.join(DIR, 'cover-composite.png'))
print('  cover-composite.png')

# ── Build bump map (white = surface, dark = debossed) ─────────────────────────
print('Building bump map...')

back_b = Image.new('L', (BACK_W, TOTAL_H), 0)

spine_b = Image.new('L', (SPINE_W, TOTAL_H), 0)
build_spine(spine_b)
build_spine_insignia(spine_b)

front_b = Image.new('L', (FRONT_W, TOTAL_H), 0)
build_front(front_b)

bump = Image.new('L', (TOTAL_W, TOTAL_H), 0)
bump.paste(back_b, (0, 0))
bump.paste(spine_b, (BACK_W, 0))
bump.paste(front_b, (BACK_W + SPINE_W, 0))

# Invert: text white → debossed (dark), surface black → raised (white)
bump = ImageOps.invert(bump)
bump = bump.filter(ImageFilter.GaussianBlur(radius=EMBOSS_BLUR))

bump.save(os.path.join(DIR, 'cover-bump.png'))
print('  cover-bump.png')
print('Done.')

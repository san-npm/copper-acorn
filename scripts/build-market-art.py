"""Native 64px market tiles and modular props. Offline, no resampling or model calls."""

import hashlib
import importlib.util
import json
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'web/public/assets/market'
SIZE = 64
INK = '#101722'
GRASS = ('#304833', '#45623c', '#547447', '#6c8c50', '#8fa560')
WOOD = ('#30232b', '#50372e', '#79523b', '#b08050', '#d5ac70')
STONE = ('#303c43', '#4f625f', '#7d8c79', '#a7b393', '#cbd0aa')
GOLD = ('#664c35', '#aa7c47', '#d8b66d', '#f1d994')


class Pixels:
    def __init__(self, size=(64, 64), color=None):
        self.image = Image.new('RGBA', size, color)
        self.d = ImageDraw.Draw(self.image)
        self.d.fontmode = '1'

    def rect(self, box, color, outline=None): self.d.rectangle(box, fill=color, outline=outline)
    def poly(self, points, color, outline=INK): self.d.polygon(points, fill=color, outline=outline)
    def line(self, points, color, width=1): self.d.line(points, fill=color, width=width)
    def ellipse(self, box, color, outline=None): self.d.ellipse(box, fill=color, outline=outline)


def shadow(p, box):
    p.ellipse(box, '#354f36')
    x0, y0, x1, y1 = box
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x + y) % 2 and p.image.getpixel((x, y))[:3] == (53, 79, 54):
                p.image.putpixel((x, y), (0, 0, 0, 0))


def grain(p, box, seed, palette, count):
    rng = random.Random(seed)
    x0, y0, x1, y1 = box
    for _ in range(count):
        x, y = rng.randint(x0, x1 - 3), rng.randint(y0, y1 - 1)
        p.line([(x, y), (x + rng.choice((1, 2, 3)), y)], rng.choice(palette))


def grass(seed):
    p = Pixels(color=GRASS[1]); rng = random.Random(seed)
    grain(p, (0, 0, 64, 64), seed, (GRASS[0], GRASS[2]), 32)
    for _ in range(7):
        x, y = rng.randrange(2, 60), rng.randrange(3, 60)
        p.line([(x - 1, y + 2), (x - 2, y - 1)], GRASS[0])
        p.line([(x, y + 2), (x + 1, y - 2)], GRASS[3])
        p.rect((x + 1, y - 3, x + 1, y - 2), GRASS[2])
    return p.image


def paving(seed):
    p = Pixels(color='#57553d'); rng = random.Random(seed)
    for row, y in enumerate(range(-4, 66, 13)):
        for x in range(-15 if row % 2 else -1, 65, 22):
            p.poly([(x + 3, y), (x + 18, y), (x + 21, y + 3), (x + 19, y + 10), (x + 2, y + 11), (x, y + 7)], STONE[1], STONE[0])
            p.poly([(x + 3, y + 1), (x + 17, y + 1), (x + 19, y + 3), (x + 17, y + 8), (x + 3, y + 8), (x + 1, y + 6)], rng.choice(STONE[2:4]), None)
            p.line([(x + 4, y + 2), (x + 15, y + 2)], STONE[4])
            if rng.randrange(3) == 0: p.line([(x + 12, y + 3), (x + 10, y + 5), (x + 12, y + 6)], STONE[1])
            if rng.randrange(3) == 0: p.line([(x + 2, y + 10), (x + 5, y + 9), (x + 7, y + 10)], GRASS[3])
    return p.image


def sprig(p, x, y, kind, seed):
    rng = random.Random(seed)
    shades = {'sunleaf': ('#304b37', '#739c50', '#b6cc72'), 'moonmint': ('#304c50', '#6ca3a4', '#b5d4ca'), 'emberbloom': ('#573241', '#b45d4d', '#efaf64')}[kind]
    for a in (-5, 0, 5):
        height = rng.randrange(15, 23)
        p.line([(x + a, y), (x + a, y - height)], shades[0])
        for side, b in ((-1, 6), (1, 11)):
            p.poly([(x + a, y - b + 3), (x + a + side * 7, y - b - 4), (x + a + side * 6, y - b + 1)], shades[1], shades[0])
            p.line([(x + a + side * 2, y - b), (x + a + side * 5, y - b - 2)], shades[2])
        if kind == 'emberbloom':
            p.poly([(x + a - 3, y - height + 2), (x + a - 4, y - height - 2), (x + a - 1, y - height - 4), (x + a + 2, y - height - 3), (x + a + 4, y - height), (x + a + 1, y - height + 3)], shades[1])
            p.rect((x + a - 1, y - height - 1, x + a + 1, y - height), shades[2])


def bottle(p, x, y, color):
    p.poly([(x - 2, y - 15), (x + 2, y - 15), (x + 2, y - 9), (x + 6, y - 6), (x + 6, y - 1), (x + 3, y + 1), (x - 4, y + 1), (x - 6, y - 2), (x - 5, y - 7), (x - 2, y - 9)], color)
    p.rect((x - 2, y - 17, x + 2, y - 15), WOOD[3], INK)
    p.line([(x - 3, y - 6), (x - 3, y - 2)], '#d8e1bb')
    p.rect((x + 1, y - 8, x + 3, y - 7), '#aac1aa')


def bed(kind):
    p = Pixels((128, 64)); shadow(p, (3, 49, 122, 62))
    p.poly([(7, 30), (113, 30), (122, 53), (6, 53)], WOOD[1])
    p.poly([(11, 31), (109, 31), (116, 47), (10, 47)], '#483d30', None)
    grain(p, (12, 33, 110, 47), 72, ('#695239', '#776345'), 30)
    for x in (21, 44, 68, 92): sprig(p, x, 44, kind, x)
    p.rect((6, 49, 120, 54), WOOD[2], INK)
    p.line([(8, 50), (116, 50)], WOOD[4])
    for x in (11, 112): p.rect((x, 50, x + 1, 51), GOLD[2])
    p.rect((109, 13, 111, 44), WOOD[2], INK)
    p.rect((104, 7, 120, 16), WOOD[3], INK)
    p.line([(107, 9), (117, 9)], WOOD[4])
    p.line([(110, 11), (115, 13), (111, 15)], GRASS[0])
    return p.image


def small_prop(kind):
    p = Pixels(); shadow(p, (10, 48, 56, 62))
    if kind == 'crate':
        p.poly([(12, 22), (44, 17), (53, 25), (53, 55), (18, 59), (10, 50)], WOOD[2])
        p.poly([(44, 18), (52, 25), (52, 54), (47, 57), (47, 28)], WOOD[1])
        p.poly([(13, 22), (43, 18), (49, 24), (18, 28)], WOOD[3])
        for y in (27, 36, 45, 53): p.line([(15, y), (48, y - 4)], WOOD[1])
        p.line([(15, 27), (48, 49)], WOOD[4], 3); p.line([(48, 23), (18, 54)], WOOD[3], 3)
        for x, y in ((16, 27), (46, 24), (18, 53), (47, 48)): p.rect((x, y, x + 1, y + 1), STONE[3])
    elif kind == 'barrel':
        p.poly([(18, 17), (43, 17), (49, 23), (51, 42), (47, 55), (41, 59), (20, 58), (13, 51), (11, 31), (14, 22)], WOOD[2])
        for x in (18, 26, 35, 43): p.line([(x, 23), (x - 1, 49), (x + 1, 54)], WOOD[1])
        p.line([(21, 24), (20, 48)], WOOD[3], 2)
        for y in (28, 47):
            p.poly([(12, y), (48, y - 1), (50, y + 3), (13, y + 5)], STONE[1])
            p.line([(14, y + 1), (46, y)], STONE[3])
            for x in (19, 33, 45): p.rect((x, y + 2, x, y + 2), STONE[4])
        p.ellipse((16, 13, 45, 24), WOOD[3], INK)
        p.line([(21, 16), (40, 16)], WOOD[4]); p.line([(20, 20), (42, 20)], WOOD[1])
    elif kind == 'lantern':
        p.poly([(15, 59), (16, 8), (22, 3), (42, 3), (46, 8), (45, 13), (42, 13), (42, 8), (22, 8), (21, 59)], WOOD[1])
        p.line([(18, 10), (18, 55)], WOOD[3])
        p.poly([(34, 17), (40, 11), (47, 17), (49, 21), (32, 21)], STONE[1])
        p.rect((33, 21, 47, 40), GOLD[1], INK)
        p.rect((36, 23, 44, 36), GOLD[2]); p.line([(38, 24), (38, 34)], GOLD[3], 2)
        p.rect((32, 39, 48, 42), STONE[1], INK)
    elif kind == 'cauldron':
        p.poly([(8, 31), (56, 31), (53, 49), (46, 58), (18, 58), (11, 49)], '#32434c')
        p.line([(14, 38), (17, 49), (23, 53)], '#536d6d', 2)
        p.ellipse((4, 21, 60, 37), '#738983', INK)
        p.ellipse((9, 24, 55, 33), '#304d3b', INK); p.ellipse((12, 25, 53, 30), '#9bbd76')
        for x, y in ((23, 26), (38, 27), (45, 25)): p.rect((x, y, x + 2, y + 1), '#d2e09c')
        p.line([(19, 20), (17, 16), (20, 12)], '#9bbd9b')
        p.line([(42, 20), (44, 16), (42, 12)], '#9bbd9b')
        p.line([(47, 24), (42, 11)], WOOD[3], 2)
    elif kind == 'flowers':
        for x, y in ((18, 44), (34, 33), (46, 47)):
            p.line([(x, y + 9), (x, y)], GRASS[0])
            p.rect((x - 3, y - 1, x + 3, y + 1), '#bf8a89')
            p.rect((x - 1, y - 3, x + 1, y + 3), '#bf8a89'); p.rect((x, y, x, y), '#e8ce8b')
    if kind in ('crate', 'barrel'):
        rng = random.Random(43)
        for _ in range(45):
            x, y = rng.randrange(13, 48), rng.randrange(24, 55)
            if p.image.getpixel((x, y))[:3] == (121, 82, 59):
                shade = WOOD[3] if x < 30 and y < 45 else WOOD[1]
                for py in range(y, min(y + 3, 56)):
                    if p.image.getpixel((x, py))[:3] == (121, 82, 59): p.rect((x, py, x, py), shade)
    return p.image


def tree(tapped=False):
    p = Pixels((128, 192)); shadow(p, (13, 174, 116, 190))
    p.poly([(48, 183), (53, 115), (77, 115), (79, 179), (91, 187), (74, 185), (64, 179), (51, 188), (39, 187)], WOOD[1])
    p.line([(60, 127), (59, 168), (55, 178)], WOOD[3], 4)
    p.line([(71, 129), (72, 164), (77, 176)], WOOD[2], 3)
    p.line([(63, 137), (66, 143), (63, 153)], WOOD[0])
    shape = [(-24, -8), (-21, -17), (-13, -18), (-9, -25), (1, -27), (7, -22), (15, -23), (18, -15), (25, -12), (23, -4), (28, 3), (22, 10), (21, 18), (12, 19), (5, 25), (-3, 21), (-13, 23), (-16, 17), (-24, 15), (-24, 5), (-28, 1)]
    for n, (cx, cy, scale) in enumerate(((31, 95, 1), (94, 94, 1), (40, 57, 1.1), (84, 56, 1.15), (64, 30, 1.05), (64, 87, 1.25))):
        # Integer polygon clusters, dense stepped highlights and single-pixel leaves.
        points = [(cx + round(a * scale), cy + round(b * scale)) for a, b in shape]
        p.poly(points, GRASS[0])
        p.poly([(cx + round(a * scale * .86), cy - 3 + round(b * scale * .82)) for a, b in shape], GRASS[2], None)
        p.poly([(cx - 4 + round(a * scale * .55), cy - 9 + round(b * scale * .5)) for a, b in shape], GRASS[3], None)
        rng = random.Random(n + 81)
        for _ in range(35):
            x, y = cx + rng.randrange(-19, 19), cy + rng.randrange(-18, 18)
            if 0 <= x < 124 and 0 <= y < 188 and p.image.getpixel((x, y))[3]:
                p.line([(x, y), (x + 2, y)], rng.choice((GRASS[1], GRASS[3], GRASS[4])))
                if rng.randrange(3) == 0: p.rect((x + 1, y - 1, x + 1, y - 1), GRASS[3])
    if tapped:
        p.line([(74, 132), (71, 139), (73, 145)], '#7b9d70')
        p.rect((67, 158, 80, 165), GOLD[1], INK)
        p.rect((76, 163, 82, 175), GOLD[2], INK)
        p.line([(79, 176), (79, 179)], '#d0dfa3')
        p.poly([(68, 181), (88, 181), (86, 190), (72, 190)], WOOD[2])
        p.rect((68, 179, 88, 182), WOOD[3], INK)
    return p.image


def spring():
    p = Pixels((128, 128)); shadow(p, (5, 94, 122, 121))
    p.ellipse((6, 55, 120, 114), STONE[1], INK)
    p.ellipse((9, 49, 118, 101), STONE[3], INK)
    p.ellipse((18, 54, 110, 93), '#3a6767', INK)
    p.ellipse((23, 57, 106, 88), '#619b94')
    p.ellipse((30, 59, 99, 81), '#8bb8a1')
    for x, y in ((29, 69), (75, 73), (47, 81)):
        p.line([(x, y), (x + 12, y), (x + 14, y - 1)], '#c6d9b3')
        p.rect((x + 4, y + 2, x + 9, y + 2), '#76a99b')
    for x, y in ((12, 84), (26, 96), (43, 101), (61, 103), (79, 101), (96, 94), (109, 83)):
        p.poly([(x - 5, y), (x + 8, y - 2), (x + 9, y + 12), (x - 5, y + 14)], STONE[2])
        p.line([(x - 3, y + 1), (x + 6, y - 1)], STONE[4])
        p.line([(x - 2, y + 9), (x + 3, y + 8)], STONE[1])
    p.poly([(53, 13), (78, 13), (81, 58), (73, 64), (67, 56), (55, 55)], STONE[2])
    p.rect((49, 10, 82, 17), STONE[3], INK)
    for y in (23, 37, 49): p.line([(56, y), (77, y - 1)], STONE[1])
    p.rect((64, 44, 70, 59), STONE[0]); p.line([(67, 58), (67, 73)], '#d3e3bf', 2)
    p.line([(73, 20), (74, 34)], STONE[4])
    return p.image


def ore():
    p = Pixels((128, 128)); shadow(p, (9, 94, 120, 115))
    faces = [([(12, 99), (23, 48), (51, 31), (72, 43), (56, 91)], '#7e9490'), ([(51, 31), (79, 26), (103, 60), (72, 72), (72, 43)], '#a2b6a4'), ([(56, 91), (72, 72), (103, 60), (117, 96), (96, 112), (57, 111)], '#536c6e')]
    for points, color in faces: p.poly(points, color)
    for x, y in ((35, 61), (71, 46), (93, 83), (59, 101)):
        p.line([(x - 8, y + 4), (x - 2, y - 3), (x + 2, y), (x + 8, y - 6)], '#d2e0ce', 2)
        p.line([(x - 1, y - 2), (x + 1, y - 1)], '#f0ebcf')
    grain(p, (28, 51, 50, 85), 124, ('#697f7b', '#b0c1ac'), 15)
    for x, y in ((21, 101), (84, 108), (102, 100)): p.line([(x, y), (x + 7, y - 2), (x + 11, y)], GRASS[2], 2)
    return p.image


def building(width, roof_color, stall=False):
    p = Pixels((width, 192 if stall else 256)); rng = random.Random(width)
    roof_h = 64 if stall else 112
    floor_y = 164 if stall else 248
    p.rect((12, roof_h - 5, width - 12, floor_y), WOOD[1], INK)
    p.rect((18, roof_h, width - 18, floor_y - 6), '#a8966d')
    grain(p, (20, roof_h + 2, width - 20, floor_y - 8), 56, ('#bfac7c', '#8d7e5d'), 100)
    if stall:
        for x in range(22, width - 20, 15):
            p.rect((x, floor_y - 35, x + 12, floor_y - 5), WOOD[2])
            p.line([(x + 2, floor_y - 32), (x + 2, floor_y - 8)], WOOD[3])
    else:
        for row, y in enumerate(range(floor_y - 76, floor_y - 5, 11)):
            for x in range(21, width - 20, 47):
                right = min(x + 45, width - 21)
                p.rect((x, y, right, y + 9), WOOD[2], WOOD[1])
                p.line([(x + 1, y + 1), (right - 2, y + 1)], WOOD[3])
                p.line([(x + 7, y + 5), (min(x + 18, right - 1), y + 5)], WOOD[1])
                if (row + x) % 3 == 0: p.line([(x + 22, y + 4), (x + 24, y + 5), (x + 27, y + 4)], WOOD[3])
    for x in (13, width - 20):
        p.rect((x, roof_h - 2, x + 7, floor_y + 5), WOOD[1], INK)
        p.line([(x + 2, roof_h), (x + 2, floor_y)], WOOD[3])
    if stall:
        p.poly([(2, 53), (23, 10), (width - 27, 10), (width - 3, 53)], roof_color[0])
        for col, x in enumerate(range(14, width - 14, 24)):
            p.poly([(x, 52), (x + 10, 12), (x + 29, 12), (x + 24, 52)], roof_color[col % 2])
            p.rect((x, 52, x + 23, 61), roof_color[col % 2], INK)
            p.line([(x + 3, 54), (x + 20, 54)], roof_color[2])
        for y in (105, 132):
            p.rect((28, y, width - 29, y + 5), WOOD[2], INK)
            p.line([(30, y + 1), (width - 32, y + 1)], WOOD[4])
        p.rect((7, 154, width - 7, 177), WOOD[2], INK)
        p.line([(9, 155), (width - 9, 155)], WOOD[4])
        for x in range(14, width - 10, 13): p.line([(x, 158), (x, 173)], WOOD[1])
    else:
        p.poly([(0, 109), (44, 12), (width - 48, 12), (width - 1, 109)], '#28323b')
        for row, y in enumerate(range(15, 108, 14)):
            left, right = 44 - row * 6, width - 48 + row * 6
            for x in range(left - (row % 2) * 6, right - 7, 22):
                if x < left: continue
                p.poly([(x + 1, y), (min(x + 21, right), y), (min(x + 23, right), y + 11), (x - 3, y + 12)], roof_color[rng.randrange(3)], '#25333b')
                p.line([(x + 3, y + 1), (min(x + 18, right), y + 1)], '#9ba996')
                p.line([(x + 2, y + 9), (min(x + 15, right), y + 9)], '#435651')
                if rng.randrange(3) == 0: p.line([(x + 10, y + 3), (x + 8, y + 5), (x + 10, y + 6)], '#455b51')
        p.rect((1, 108, width - 2, 114), WOOD[2], INK)
        p.line([(3, 109), (width - 5, 109)], WOOD[4])
        p.rect((width - 77, 3, width - 52, 48), STONE[2], INK)
        for y in (13, 26, 39): p.line([(width - 75, y), (width - 54, y)], STONE[1])
        p.rect((width - 81, 0, width - 48, 6), STONE[3], INK)
        p.line([(21, 121), (45, 154)], WOOD[2], 4)
        p.line([(width - 24, 121), (width - 46, 154)], WOOD[2], 4)
        # Deep shelf recesses and jars use the same outline and four-tone materials as the sprites.
        for left, right in ((48, 151), (224, 331)):
            p.rect((left, 128, right, 168), WOOD[1], INK)
            p.rect((left + 4, 132, right - 4, 162), '#344d42', INK)
            for x in range(left + 17, right - 8, 25): bottle(p, x, 158, ('#8cac70', '#a593af', '#77a9a2')[(x // 2) % 3])
            p.rect((left - 2, 163, right + 2, 168), WOOD[3], INK)
            p.line([(left, 164), (right, 164)], WOOD[4])
    return p.image


def sign(text, width=128):
    p = Pixels((width, 64))
    p.poly([(3, 17), (width - 7, 15), (width - 3, 44), (8, 47)], WOOD[1])
    p.line([(7, 20), (width - 11, 18)], WOOD[3])
    p.line([(10, 43), (width - 7, 41)], WOOD[0])
    p.d.text((width // 2, 31), text, font=ImageFont.load_default(size=12), fill='#e9d7a8', anchor='mm')
    return p.image


def merchant_assets():
    spec = importlib.util.spec_from_file_location('characters', ROOT / 'scripts/build-characters.py')
    art = importlib.util.module_from_spec(spec); spec.loader.exec_module(art)
    return {name + '.png': art.finish_actor(art.tactics_actor(name, 'south')) for name in ('mira', 'rowan', 'bram')}


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    frames, names, blocks = [], [], {}
    def tile(name, image):
        assert image.size == (64, 64)
        names.append(name); frames.append(image); return len(frames) - 1
    def block(name, image):
        assert image.width % 64 == image.height % 64 == 0
        blocks[name] = [(tile(f'{name}-{x // 64}-{y // 64}', image.crop((x, y, x + 64, y + 64))), x, y)
                        for y in range(0, image.height, 64) for x in range(0, image.width, 64)]
    grass_ids = [tile(f'grass-{i}', grass(i + 53)) for i in range(4)]
    road_ids = [tile(f'cobble-{i}', paving(i + 61)) for i in range(4)]
    for kind in ('crate', 'barrel', 'lantern', 'cauldron', 'flowers'): block(kind, small_prop(kind))
    for kind in ('sunleaf', 'moonmint', 'emberbloom'): block(kind, bed(kind))
    block('tree', tree()); block('essence', tree(True)); block('spring', spring()); block('ore', ore())
    block('shop', building(384, ('#536e66', '#6d8575', '#81937e')))
    for name, colors in (('mira-stall', ('#55774e', '#c6c591', '#e0d7a8')), ('rowan-stall', ('#527f89', '#c3c6a2', '#e1dfb8')), ('bram-stall', ('#765c7b', '#c8b491', '#e2d2aa'))): block(name, building(256, colors, True))
    for name, text, width in (('shop-sign', 'THE COPPER ACORN', 192), ('mira-sign', 'MIRA · HERBS', 128), ('rowan-sign', 'ROWAN · EXTRACTS', 192), ('bram-sign', 'BRAM · CURIOS', 128)): block(name, sign(text, width))
    shelf = Pixels((128, 64))
    shelf.rect((5, 38, 123, 61), WOOD[2], INK); shelf.line([(7, 39), (120, 39)], WOOD[4])
    for x in range(13, 120, 15): shelf.line([(x, 43), (x, 58)], WOOD[1])
    block('shelves', shelf.image)
    rng = random.Random(34)
    ground = [[rng.choice(road_ids if row in (5, 6) or col in (9, 10) or row in (9, 10) and col >= 10 else grass_ids) for col in range(20)] for row in range(13)]
    props = []
    def place(name, x, y, depth=1):
        for frame, dx, dy in blocks[name]: props.append({'frame': frame, 'x': x * 2 + dx, 'y': y * 2 + dy, 'depth': depth})
    for x, y in ((-17, -24), (157, -47), (410, -47), (599, -18), (-18, 304), (586, 318), (205, 343)): place('tree', x, y)
    place('shop', 224, 24); place('shop-sign', 272, 67)
    place('mira-stall', 36, 60); place('mira-sign', 68, 84)
    place('rowan-stall', 470, 60); place('rowan-sign', 486, 84)
    place('bram-stall', 474, 254); place('bram-sign', 506, 278)
    place('shelves', 246, 100); place('cauldron', 352, 118)
    for kind, x, y in (('sunleaf', 50, 220), ('moonmint', 28, 316), ('emberbloom', 150, 314)): place(kind, x, y)
    place('spring', 390, 272); place('ore', 522, 190)
    place('essence', 322, 200, 296)
    for x, y in ((206, 108), (406, 108), (190, 150), (430, 158), (12, 178), (582, 326)): place('lantern', x, y)
    for x, y in ((166, 126), (443, 127), (456, 309)): place('barrel', x, y)
    for x, y in ((20, 126), (600, 126), (448, 131), (599, 320)): place('crate', x, y)
    for x, y in ((121, 257), (218, 275), (200, 226), (370, 253), (100, 347), (464, 214)): place('flowers', x, y)
    # Stall stock is scenery; the player's two shelf listings stay live renderer graphics.
    for name, x, y, color in (('mira-goods', 49, 89, '#8dab6a'), ('rowan-goods', 485, 89, '#8db9aa'), ('bram-goods', 489, 283, '#a1b7b0')):
        goods = Pixels((192, 64))
        for px in range(18, 185, 30):
            if name == 'mira-goods': sprig(goods, px, 53, 'sunleaf', px)
            else: bottle(goods, px, 53, color)
        block(name, goods.image); place(name, x, y)
    atlas = Image.new('RGBA', (8 * SIZE, ((len(frames) + 7) // 8) * SIZE))
    for index, image in enumerate(frames): atlas.paste(image, ((index % 8) * SIZE, (index // 8) * SIZE))
    assert set(atlas.getchannel('A').get_flattened_data()) <= {0, 255}, 'Map pixels must be opaque or transparent, without smoothing'
    layout = {'tileSize': 64, 'sourceScale': 2, 'worldSize': [640, 400], 'columns': 8, 'frames': names, 'ground': ground, 'props': props}
    for prop in props: assert 0 <= prop['frame'] < len(frames) and isinstance(prop['x'], int) and isinstance(prop['y'], int)
    (OUTPUT / 'layout.json').write_text(json.dumps(layout, separators=(',', ':')) + '\n')
    assets = {'tiles.png': atlas, **merchant_assets()}
    for filename, image in assets.items(): image.save(OUTPUT / filename)
    manifest = {name: {'size': image.size, 'sha256': hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()} for name, image in assets.items()}
    (OUTPUT / 'manifest.json').write_text(json.dumps({'tileSize': 64, 'sourceScale': 2, 'worldSize': [640, 400], 'layout_sha256': hashlib.sha256((OUTPUT / 'layout.json').read_bytes()).hexdigest(), 'assets': manifest}, indent=2) + '\n')
    preview = Image.new('RGBA', (1280, 800))
    for row, line in enumerate(ground):
        for col, frame in enumerate(line): preview.alpha_composite(frames[frame], (col * SIZE, row * SIZE))
    for prop in sorted(props, key=lambda p: p['depth']): preview.alpha_composite(frames[prop['frame']], (prop['x'], prop['y']))
    for name, x, y in (('mira', 100, 151), ('rowan', 534, 151), ('bram', 544, 345)):
        preview.alpha_composite(assets[name + '.png'].resize((64, 64), Image.Resampling.NEAREST), (x * 2 - 32, y * 2 - 62))
    preview.convert('RGB').save(ROOT / 'docs/art/market-town.png')
    atlas.save(ROOT / 'docs/art/market-tiles.png')
    board = Pixels((832, 520), '#1c2826')
    samples = [(name, Image.open(ROOT / f'web/public/assets/characters/{name.lower()}.png').crop((0, 0, 128, 128)).resize((64, 64), Image.Resampling.NEAREST)) for name in ('Magician', 'Goblin')]
    samples += [(label, frames[blocks[key][0][0]]) for label, key in (('Barrel', 'barrel'), ('Crate', 'crate'), ('Lantern', 'lantern'), ('Cauldron', 'cauldron'))]
    samples += [('Grass', frames[grass_ids[0]]), ('Paving', frames[road_ids[0]])]
    for index, (label, image) in enumerate(samples):
        x, y = 16 + index % 4 * 204, 16 + index // 4 * 252
        board.d.text((x, y), label + ' / 64x64', fill='#e9d7a8', font=ImageFont.load_default(size=14))
        board.image.alpha_composite(image.resize((192, 192), Image.Resampling.NEAREST), (x, y + 30))
    board.image.convert('RGB').save(ROOT / 'docs/art/market-style.png')
    for obsolete in ('ground.png', 'scenery.png', 'essence-tree.png'): (OUTPUT / obsolete).unlink(missing_ok=True)
    print(f'Built {len(frames)} native 64x64 frames and {len(props)} prop pieces; no source resampling or generation calls.')


if __name__ == '__main__': build()

"""Build an isolated local study from owner-supplied Mana Seed files; never publish it."""
from pathlib import Path
from functools import lru_cache
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PACK = Path('/Users/hodlmedia/Downloads/25.07 - Free Mana Seed RPG Starter Pack')
FARMER = Path('/Users/hodlmedia/Downloads/Mana Seed Farmer Sprite Free Sample')
SOURCE = PACK / 'character_base/char_a_p1'
OUT = ROOT / '.local/mana-review'
DIRECTIONS = ('south', 'west', 'east', 'north')
ROWS = (0, 3, 2, 1)
ROSTER = [('goblin', 'Goblin'), ('magician', 'Magician'), ('dwarf', 'Dwarf'),
          ('skeleton', 'Liche'), ('lizard', 'Lizardman'), ('vampire', 'Vampire'),
          ('elf', 'Elf'), ('dark-elf', 'Dark Elf')]
SKIN = ('#885038', '#d08860', '#f8d098')
SHIRT = ('#5b1839', '#8d2246', '#be5667')
VEST = ('#1e2b41', '#3c5575')
PANTS = ('#716558', '#a69878', '#c7c4a2')
STYLES = {
    'goblin': ('#424c31 #718c45 #b0bf70', '#374638 #667b45 #a4a86b', None),
    'magician': (None, '#393b64 #686399 #a69ac6', None),
    'dwarf': (None, '#613638 #98554a #ce9170', None),
    'skeleton': ('#807050 #c5bb88 #f3e7bd', '#234a54 #397e83 #8ab7aa', None),
    'lizard': ('#284f4d #4b8874 #9fbe83', '#6a4c35 #ac7e40 #e0bd74', None),
    'vampire': ('#696272 #afa0ad #ece0d5', '#452939 #793c52 #bb6878', 'dap1_v10'),
    'elf': (None, '#354c45 #598475 #a0b494', 'bob1_v03'),
    'dark-elf': ('#3c334f #665573 #998398', '#41354f #76618d #af9cb5', 'bob1_v01'),
    'mira': (None, '#3e5141 #718e5a #b6bc87', 'bob1_v02'),
    'rowan': (None, '#34445a #597992 #a0b3ba', 'dap1_v02'),
    'bram': (None, '#5a423b #8f6651 #c0a071', 'dap1_v11'),
}


def rgba(color):
    return (*bytes.fromhex(color.lstrip('#')), 255)


@lru_cache(None)
def layer(name):
    page = Path(name).name.split('_')[2]
    return Image.open(SOURCE.parent / f'char_a_{page}' / name).convert('RGBA')


def cell(name, direction, frame=0, pose=None):
    page, column, band = pose if pose else ('p1', frame - 1 if frame else 0, 4 if frame else 0)
    row = ROWS[DIRECTIONS.index(direction)] + band
    name = name.replace('_p1_', f'_{page}_')
    return layer(name).crop((column * 64, row * 64, column * 64 + 64, row * 64 + 64))


def recolor(image, old, new):
    colors = dict(zip(map(rgba, old), map(rgba, new)))
    result = image.copy()
    result.putdata([colors.get(p, p) for p in image.get_flattened_data()])
    return result


def native_actor(kind, direction, frame=0, pose=None):
    skin, cloth, hair = STYLES[kind]
    base = cell('char_a_p1_0bas_humn_v01.png', direction, frame, pose)
    if pose:
        head = cell('4har/char_a_p1_4har_dap1_v01.png', direction, frame, pose).getbbox()
        cx, y = (head[0] + head[2]) // 2, head[1] + 3
    else:
        head = base.crop((0, 0, 64, 27)).getbbox()
        cx, y = (head[0] + head[2]) // 2, head[1]
    if skin:
        base = recolor(base, SKIN, skin.split())
    outfit = cell('1out/char_a_p1_1out_fstr_v01.png', direction, frame, pose)
    outfit = recolor(outfit, SHIRT, cloth.split())
    outfit = recolor(outfit, VEST, ('#715342', '#bd9a67'))
    outfit = recolor(outfit, PANTS, ('#3d3540', '#645763', '#978179'))
    result = Image.new('RGBA', (64, 64))
    if kind in ('magician', 'skeleton', 'vampire') and direction == 'south':
        # Narrow cape behind the supplied shoulders; preserve the pack's arms and gait.
        d = ImageDraw.Draw(result)
        tail = min(y + 28, base.getbbox()[3] - 1) if pose else y + 28
        d.polygon([(cx-6,y+11),(cx+6,y+11),(cx+9,tail-2),(cx+5,tail),(cx-8,tail-1)], fill=cloth.split()[0])
    result.alpha_composite(base)
    result.alpha_composite(outfit)
    if direction != 'south' and kind in ('magician', 'skeleton', 'vampire'):
        # The cape wraps the rear torso; the visible front arm stays in front of it.
        clothed = result.copy()
        rear_cape = Image.new('RGBA', (64, 64))
        d = ImageDraw.Draw(rear_cape)
        dark, mid, light = cloth.split()
        hem = min(y + 28, base.getbbox()[3] - 3)
        facing = -1 if direction == 'west' else 1
        if direction == 'north':
            d.polygon([(cx-5,y+11),(cx+5,y+11),(cx+7,hem-3),(cx+5,hem),(cx+1,hem-1),(cx-2,hem),(cx-7,hem-2)], fill=dark)
            d.polygon([(cx-3,y+12),(cx+2,y+12),(cx+4,hem-2),(cx+1,hem-3),(cx-3,hem-1),(cx-5,hem-3)], fill=mid)
            d.line([(cx-3,y+14),(cx-3,hem-5),(cx-4,hem-3)], fill=light)
            d.line([(cx+1,y+16),(cx+2,hem-4)], fill=dark)
        else:
            profile = lambda points: [(cx+facing*x, py) for x, py in points]
            d.polygon(profile([(-4,y+11),(0,y+12),(0,y+16),(-1,hem-4),(-2,hem),(-7,hem-1),(-8,hem-3),(-6,y+17)]), fill=dark)
            d.polygon(profile([(-4,y+12),(-1,y+13),(-2,hem-3),(-5,hem-2),(-6,hem-4)]), fill=mid)
            d.line(profile([(-4,y+14),(-5,hem-5),(-4,hem-3)]), fill=light)
        result.alpha_composite(rear_cape)
        for py in range(64):
            for px in range(64):
                exposed_hand = base.getpixel((px,py))[3] and not outfit.getpixel((px,py))[3]
                front_arm = direction != 'north' and (px-cx)*facing >= 0
                if (direction == 'north' and exposed_hand) or front_arm:
                    result.putpixel((px,py), clothed.getpixel((px,py)))
    if hair:
        result.alpha_composite(cell(f'4har/char_a_p1_4har_{hair}.png', direction, frame, pose))
    if kind == 'magician':
        hat = cell('5hat/char_a_p1_5hat_pnty_v01.png', direction, frame, pose)
        hat = recolor(hat, ('#1e2b41','#3c5575','#6293ad','#99d6e3'), ('#39344f','#5c5280','#9284b2','#cbc3d5'))
        result.alpha_composite(hat)
    d = ImageDraw.Draw(result)
    back = direction == 'north'
    if kind in ('goblin', 'elf', 'dark-elf'):
        ramp = (skin.split() if skin else SKIN)
        for side in (-1, 1):
            if direction == 'west' and side == -1 or direction == 'east' and side == 1:
                continue
            x = cx + side * 6
            d.polygon([(x,y+5),(x+side*4,y+3),(x+side*2,y+7),(x,y+8)], fill=ramp[0])
            d.line([(x+side,y+5),(x+side*2,y+5),(x+side,y+6)], fill=ramp[1])
            d.point((x+side,y+5),fill=ramp[2])
    if kind == 'goblin':
        # No hair layer under the cap, and the brim covers the complete crown.
        d.polygon([(cx-7,y+3),(cx-5,y-2),(cx+2,y-4),(cx+7,y-1),(cx+10,y+2),(cx+5,y+2),(cx+1,y-1),(cx+1,y+3)], fill='#713442')
        d.polygon([(cx-5,y+2),(cx-3,y-1),(cx+2,y-3),(cx+5,y-1),(cx+1,y),(cx,y+3)], fill='#b74f52')
        d.line([(cx-7,y+3),(cx+6,y+3)], fill='#aaac9e', width=3)
        d.line([(cx-6,y+2),(cx+5,y+2)], fill='#f1e4c4')
        d.ellipse((cx+8,y,cx+11,y+3), fill='#e7dbc1')
    if kind in ('dwarf', 'bram') and not back:
        dark, mid, light = ('#663e32','#a35e39','#d79855') if kind == 'dwarf' else ('#302e37','#57505a','#92837a')
        if direction == 'south':
            d.polygon([(cx-5,y+10),(cx-3,y+11),(cx+2,y+11),(cx+5,y+10),(cx+5,y+15),(cx+2,y+19),(cx-2,y+19),(cx-5,y+15)], fill=dark)
            d.polygon([(cx-4,y+12),(cx-2,y+13),(cx,y+12),(cx+3,y+12),(cx+3,y+15),(cx+1,y+18),(cx-2,y+17)], fill=mid)
            d.line([(cx-3,y+12),(cx-3,y+15),(cx-1,y+17)], fill=light)
            d.line([(cx+1,y+12),(cx+1,y+16)], fill=light)
        else:
            # The sideburn joins the jaw; the tapered beard hangs in front of the neck.
            facing = -1 if direction == 'west' else 1
            profile = lambda points: [(cx+facing*px, y+py) for px,py in points]
            d.polygon(profile([(-2,8),(0,9),(0,11),(4,10),(6,10),(6,13),(5,17),(2,19),(0,18),(0,15),(-1,11)]), fill=dark)
            d.polygon(profile([(2,11),(5,11),(5,13),(4,16),(2,18),(0,16),(0,13)]), fill=mid)
            d.line(profile([(4,12),(4,14),(2,16),(2,17)]), fill=light)
    if kind == 'skeleton':
        # A fitted striped headdress wraps the skull; stepped gold highlights stay crisp.
        gold_shadow, gold, gold_light, shine = '#81512d', '#d6a747', '#f6d47d', '#fff4c9'
        lapis, lapis_light = '#25495f', '#438698'
        if direction == 'south':
            for side in (-1, 1):
                d.polygon([(cx+side*5,y+2),(cx+side*7,y+2),(cx+side*8,y+7),(cx+side*9,y+12),(cx+side*6,y+14),(cx+side*5,y+11)], fill=gold_shadow)
                d.polygon([(cx+side*6,y+3),(cx+side*7,y+5),(cx+side*8,y+11),(cx+side*6,y+12)], fill=lapis)
                for sy in (y+5,y+8,y+11):
                    d.line([(cx+side*6,sy),(cx+side*8,sy)], fill=gold)
                    d.point((cx+side*6,sy), fill=gold_light)
        elif back:
            d.polygon([(cx-6,y+1),(cx+5,y+1),(cx+8,y+5),(cx+6,y+12),(cx+3,y+14),(cx-4,y+14),(cx-7,y+11),(cx-8,y+5)], fill=lapis)
            d.polygon([(cx-5,y+2),(cx+2,y+2),(cx+4,y+11),(cx-4,y+12),(cx-6,y+6)], fill=lapis_light)
            for offset, width in ((4,6),(7,7),(10,6),(13,3)):
                d.line([(cx-width,y+offset),(cx+width-1,y+offset)], fill=gold)
                d.line([(cx-width+1,y+offset),(cx-width+3,y+offset)], fill=gold_light)
        else:
            facing = -1 if direction == 'west' else 1
            profile = lambda points: [(cx+facing*x, py) for x, py in points]
            d.polygon(profile([(-6,y+1),(-2,y+3),(-2,y+9),(-3,y+14),(-7,y+13),(-9,y+9),(-8,y+4)]), fill=gold_shadow)
            d.polygon(profile([(-6,y+2),(-3,y+4),(-3,y+10),(-5,y+12),(-7,y+10),(-8,y+6)]), fill=lapis)
            d.line(profile([(-6,y+3),(-7,y+8),(-5,y+12)]), fill=lapis_light)
            for sy in (y+5,y+8,y+11):
                d.line(profile([(-7,sy),(-3,sy)]), fill=gold)
                d.line(profile([(-6,sy),(-5,sy)]), fill=gold_light)
        d.polygon([(cx-5,y-2),(cx+4,y-2),(cx+7,y+1),(cx+6,y+4),(cx-6,y+4),(cx-8,y+1)], fill=gold_shadow)
        d.polygon([(cx-5,y-1),(cx+3,y-1),(cx+5,y+1),(cx+4,y+3),(cx-5,y+3),(cx-6,y+1)], fill=lapis_light)
        d.line([(cx-5,y-2),(cx+3,y-2),(cx+6,y+1)], fill=gold_light)
        d.line([(cx-4,y-2),(cx-1,y-2)], fill=shine)
        d.line([(cx-6,y+3),(cx+5,y+3)], fill=gold, width=2)
        d.line([(cx-5,y+3),(cx+4,y+3)], fill=gold_light)
        jewel_x = cx if direction in ('south','north') else cx+(-4 if direction=='west' else 4)
        d.polygon([(jewel_x-2,y-1),(jewel_x,y-5),(jewel_x+2,y-1),(jewel_x+1,y+2),(jewel_x-1,y+2)], fill=gold_shadow)
        d.line([(jewel_x,y-4),(jewel_x,y)], fill=gold_light)
        d.point((jewel_x,y-3), fill=shine)
        if not back:
            d.rectangle((jewel_x-1,y,jewel_x+1,y+1), fill='#20756f')
            d.point((jewel_x,y), fill='#75ded6')
            d.point((jewel_x-1,y), fill='#d5fff2')
        if not back:
            if direction == 'south':
                d.rectangle((cx-4,y+8,cx-2,y+10), fill='#493e43')
                d.rectangle((cx+2,y+8,cx+4,y+10), fill='#493e43')
                d.point((cx-3,y+9),fill='#85c2ba');d.point((cx+3,y+9),fill='#85c2ba')
                d.point((cx,y+11),fill='#67574b')
                d.line([(cx-2,y+13),(cx+2,y+13)],fill='#807050')
                d.point((cx-1,y+12),fill='#f3e7bd');d.point((cx+1,y+12),fill='#f3e7bd')
            else:
                x = cx + (-4 if direction == 'west' else 3)
                d.rectangle((x,y+8,x+2,y+10),fill='#493e43');d.point((x+1,y+9),fill='#85c2ba')
    if kind == 'lizard':
        # Flat face, small crest and gill marks; no added projecting nose or hair.
        x = cx + (5 if direction == 'west' else -5 if direction == 'east' else 0)
        d.line([(x-2,y),(x-1,y-2),(x,y),(x+1,y-2),(x+2,y)],fill='#b29b58')
        if not back:
            eye_x = [cx-3,cx+3] if direction == 'south' else [cx-3 if direction == 'west' else cx+3]
            for ex in eye_x:
                d.line([(ex,y+8),(ex,y+10)],fill='#e8c774');d.point((ex,y+9),fill='#242b34')
            d.line([(cx-2,y+13),(cx+2,y+13)],fill='#426c59')
    if pose:
        result.paste((0,0,0,0),(0,base.getbbox()[3],64,64))
    return result


def actor(kind, direction, frame=0):
    result = native_actor(kind, direction, frame)
    # Adapt the original pixel art with one shared integer scale and foot anchor.
    bottom = result.getbbox()[3]
    crop = result.crop((11, 2, 53, 46)).resize((126, 132), Image.Resampling.NEAREST)
    exported = Image.new('RGBA', (128, 128))
    exported.alpha_composite(crop, (1, 124 - (bottom - 2) * 3))
    assert exported.getbbox()[3] == 124 and exported.getbbox()[1] > 0, (kind,direction,frame)
    assert exported.getbbox()[0] > 0 and exported.getbbox()[2] < 128, (kind,direction,frame)
    assert set(exported.getchannel('A').get_flattened_data()) <= {0,255}
    return exported


def font(size):
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia.ttf', size)


def seated_actor(kind):
    result = native_actor(kind, 'south')
    body = cell('char_a_p1_0bas_humn_v01.png', 'south')
    hips = body.getbbox()[3] - 10
    result.paste((0, 0, 0, 0), (0, hips, 64, 64))
    d = ImageDraw.Draw(result)
    # Bent thighs rest on the bench; boots hang below the knees.
    d.polygon([(26,hips),(38,hips),(40,hips+3),(38,hips+5),(34,hips+4),(32,hips+2),(30,hips+4),(26,hips+5),(24,hips+3)],fill='#645763')
    for x in (25,35):
        d.rectangle((x,hips+3,x+3,hips+7),fill='#3d3540')
        d.rectangle((x,hips+6,x+5,hips+8),fill='#978179')
        d.line((x,hips+8,x+5,hips+8),fill='#302c38')
    crop=result.crop((11,2,53,46)).resize((126,132),Image.Resampling.NEAREST)
    frame=Image.new('RGBA',(128,128));frame.alpha_composite(crop,(1,124-(hips+9-2)*3))
    assert frame.getbbox()[3]==124 and set(frame.getchannel('A').get_flattened_data())<={0,255}
    return frame


def build():
    target = OUT / 'assets/characters'
    target.mkdir(parents=True, exist_ok=True)
    entries = []
    sheets = {}
    seated=Image.new('RGBA',(128*len(ROSTER),128))
    for i,(kind,_) in enumerate(ROSTER):seated.alpha_composite(seated_actor(kind),(i*128,0))
    seated.save(target/'arena-spectators.png')
    for kind, name in ROSTER:
        sheet = Image.new('RGBA', (896, 512))
        for row, direction in enumerate(DIRECTIONS):
            frames = [actor(kind,direction,f) for f in range(7)]
            assert len({f.tobytes() for f in frames[1:]}) == 6, (kind,direction)
            for col, frame in enumerate(frames):sheet.alpha_composite(frame,(col*128,row*128))
        assert len({sheet.crop((0,r*128,128,(r+1)*128)).tobytes() for r in range(4)}) == 4, kind
        path = target / f'{kind}.png';sheet.save(path);sheets[kind] = sheet
        entries.append(dict(id=kind,name=name,file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    manifest = dict(frameSize=128,anchor=[64,124],columns=7,directions=list(DIRECTIONS),walkColumns=[1,2,3,4,5,6],walkFps=8,
                    artSource='Owner-provided Mana Seed files; local derivative study, release rights uncleared',characters=entries)
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Reuse the existing isolated selector rather than adding a second review app.
    html = (ROOT/'web/character-review.html').read_text().replace('All appearances share the same gathering, brewing and trading abilities.', 'Artwork: Mana Seed / Seliel the Shaper; local character study.')
    html = html.replace('<div class="layout">', '<p><a href="actions.html" style="color:#e0bc77">Crafting and gathering animations →</a></p><div class="layout">')
    html = html.replace('</main>', '<section aria-label="Characters in the market"><h2>Against the existing market</h2><img src="map-context.png" alt="The eight character studies against the unchanged market" style="width:100%;image-rendering:pixelated"></section></main>')
    (OUT/'index.html').write_text(html)
    board = Image.new('RGB',(1280,816),'#252d2c');d=ImageDraw.Draw(board)
    d.text((30,20),'COPPER ACORN / LOCAL CHARACTER STUDY',font=font(26),fill='#ead8b1')
    d.text((30,58),'Mana Seed base proportions, clothing and walk cycles / eight appearances',font=font(18),fill='#b6bdaf')
    for i,(kind,name) in enumerate(ROSTER):
        x=20+(i%4)*315;y=102+(i//4)*344
        d.rounded_rectangle((x,y,x+299,y+329),radius=6,fill='#35403a',outline='#687161')
        d.text((x+16,y+14),name,font=font(22),fill='#f0dfbd')
        for col in range(4):
            frame=sheets[kind].crop((0,col*128,128,(col+1)*128))
            if col==0:
                frame=frame.resize((224,224),Image.Resampling.NEAREST);p=(x+37,y+43)
            else:
                frame=frame.resize((80,80),Image.Resampling.NEAREST);p=(x+23+(col-1)*88,y+247)
            board.paste(frame,p,frame)
    d.text((30,795),'Local visual review / Mana Seed art by Seliel the Shaper / no publication',font=font(14),fill='#b6bdaf')
    board.save(OUT/'character-lineup.png')
    world = Image.open(ROOT/'web/public/assets/isometric/world.png').convert('RGBA')
    positions = [(870,760),(644,332),(600,494),(974,439),(1160,650),(1250,886),(1065,890),(687,918)]
    counters = {
        'mira': [(269,708),(331,669),(478,648),(510,677),(510,751),(350,811),(270,768)],
        'rowan': [(1055,421),(1090,401),(1294,466),(1300,508),(1228,533),(1055,472)],
        'bram': [(1260,635),(1378,602),(1504,656),(1501,706),(1441,751),(1262,675)],
    }
    awnings = {
        'mira': [(202,551),(410,503),(498,548),(484,591),(354,633),(217,595)],
        'rowan': [(1074,288),(1124,254),(1310,305),(1302,346),(1227,371),(1067,320)],
        'bram': [(1292,493),(1326,452),(1424,445),(1577,500),(1564,548),(1452,575),(1291,529)],
    }
    for kind,(x,y) in [('mira',(378,724)),('rowan',(1187,477)),('bram',(1398,689))]:
        npc=actor(kind,'south');npc.save(OUT/f'{kind}.png')
        npc=npc.resize((168,168),Image.Resampling.NEAREST)
        overlay=Image.new('RGBA',world.size);overlay.alpha_composite(npc,(x-84,y-round(124*168/128)))
        mask=overlay.getchannel('A');md=ImageDraw.Draw(mask)
        md.polygon(counters[kind],fill=0);md.polygon(awnings[kind],fill=0);overlay.putalpha(mask)
        world.alpha_composite(overlay)
    d=ImageDraw.Draw(world)
    for (kind,name),(x,y) in zip(ROSTER,positions):
        d.ellipse((x-19,y-5,x+19,y+4),fill='#35403b')
        frame=actor(kind,'south').resize((168,168),Image.Resampling.NEAREST)
        world.alpha_composite(frame,(x-84,y-round(124*168/128)))
        box=d.textbbox((0,0),name,font=font(16));w=box[2]+12
        d.rounded_rectangle((x-w//2,y+5,x+w//2,y+31),radius=4,fill='#29352ce8')
        d.text((x-w//2+6,y+8),name,font=font(16),fill='#f1e2be')
    world.convert('RGB').save(OUT/'map-context.png')
    sources={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [*SOURCE.rglob('*.png'), FARMER/'_supporting files/palettes/mana seed skin ramps.png']}
    (OUT/'source-checksums.json').write_text(json.dumps(sources,indent=2)+'\n')
    print(f'Built 224 frames and two local review images in {OUT}; production assets unchanged.')


if __name__ == '__main__':build()

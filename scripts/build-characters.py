"""Draw original compact isometric characters locally; no network calls."""

from pathlib import Path
import hashlib
import json

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/characters/source"
OUTPUT = ROOT / "web/public/assets/characters"
PREVIEW = ROOT / "docs/art"
DIRECTIONS = ("south", "west", "east", "north")
INK = "#070b19"
ROSTER = (
    ("goblin", "Goblin", "#65744c"),
    ("magician", "Magician", "#555c96"),
    ("dwarf", "Dwarf", "#64534a"),
    ("skeleton", "Liche", "#32645d"),
    ("lizard", "Lizardman", "#8a6c39"),
    ("vampire", "Vampire", "#673443"),
    ("elf", "Elf", "#5c7d68"),
    ("dark-elf", "Dark Elf", "#54436f"),
)
FRAME, FEET, HEIGHT = 128, 124, 112


def finish_actor(image):
    """Fit original compact pixel art to the common runtime frame without smoothing."""
    cropped = image.crop(image.getbbox())
    cropped = cropped.resize((round(cropped.width * HEIGHT / cropped.height), HEIGHT), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (FRAME, FRAME))
    canvas.alpha_composite(cropped, ((FRAME - cropped.width) // 2, FEET - HEIGHT))
    assert canvas.getbbox()[1:4:2] == (FEET - HEIGHT, FEET)
    return canvas



def rgb(hex_color):
    return tuple(bytes.fromhex(hex_color[1:]))


def tactics_actor(kind, direction, frame=0):
    """Original compact, three-quarter pixel figures; no reference pixels are copied."""
    image = Image.new("RGBA", (64, 64)); d = ImageDraw.Draw(image)
    ink, cream, gold, brass = "#382a3a", "#fff0bf", "#eac574", "#9c653b"
    colors = {"goblin":"#639657", "magician":"#6663ad", "dwarf":"#b16b3c", "skeleton":"#3c8991",
              "lizard":"#c18e42", "vampire":"#a34763", "elf":"#54967c", "dark-elf":"#7663a2",
              "mira":"#729f5d", "rowan":"#4c91a7", "bram":"#a6754f"}
    def shade(color, target, amount):
        return tuple(round(a*(1-amount)+b*amount) for a,b in zip(rgb(color),rgb(target)))
    cloth = colors[kind]; dark = shade(cloth, ink, .48); light = shade(cloth, cream, .35)
    skin = {"goblin":"#88b95b", "skeleton":"#e1cf98", "lizard":"#58a99a", "vampire":"#e7d5da",
            "dark-elf":"#76658e"}.get(kind, "#ecc091")
    skin_shadow, skin_light = shade(skin, "#6d4560", .32), shade(skin, cream, .32)
    back = direction in ("east", "north")
    stride = 0 if not frame else (-2,-1,1,2,1,-1)[frame-1]
    bob = 0 if not frame else (0,0,1,0,0,1)[frame-1]
    def poly(points, fill, outline=ink): d.polygon([(x,y+bob) for x,y in points], fill=fill, outline=outline)
    def rect(box, fill): d.rectangle((box[0],box[1]+bob,box[2],box[3]+bob), fill=fill)
    def line(points, fill, width=1): d.line([(x,y+bob) for x,y in points],fill=fill,width=width)
    # Short staggered boots, rounded robe and angled shoulder planes.
    for x, shift in ((24,stride),(36,-stride)):
        d.polygon([(x,50),(x+7,50),(x+7,56+shift),(x+10,58+shift),(x+9,59+shift),(x-1,59+shift),(x-2,58+shift)],fill="#684551",outline=ink)
        d.line([(x,58+shift),(x+6,58+shift)],fill="#c28a55",width=2)
    poly([(24,31),(39,31),(44,40),(42,53),(35,57),(22,53),(20,40)],dark)
    poly([(25,32),(35,33),(38,47),(35,53),(23,50),(22,40)],cloth,None)
    poly([(24,34),(29,34),(27,47),(24,47)],light,None)
    if kind in ("magician","skeleton","vampire"):
        poly([(22,31),(38,30),(45,51),(40,56),(34,51),(22,54),(18,51)],dark)
        poly([(23,33),(29,35),(26,49),(22,51),(20,48)],cloth,None)
        line([(23,36),(21,48)],light)
    for x, shift in ((18,-stride),(41,stride)):
        poly([(x,34),(x+5,33),(x+7,39+shift),(x+5,44+shift),(x,43+shift),(x-2,39+shift)],cloth if x<30 else dark)
        poly([(x,40+shift),(x+4,41+shift),(x+4,46+shift),(x+1,48+shift),(x-2,45+shift)],skin)
        line([(x,42+shift),(x+2,42+shift)],skin_light)
    # Apron, diagonal belt and little brass-capped alchemy pouch.
    if not back:
        poly([(27,40),(38,41),(39,53),(32,55),(26,51)],"#b5895e")
        poly([(28,42),(32,42),(32,51),(28,49)],"#e3c38a",None)
        line([(22,42),(41,44)],"#70444a",3)
        rect((31,42,35,45),gold);rect((32,43,34,44),brass)
        poly([(37,45),(43,44),(45,48),(43,53),(38,53)],"#8a5b46")
        line([(38,46),(42,45)],gold)
    else:
        line([(23,34),(37,47)],"#bda16c",3);line([(25,34),(39,47)],"#75504b")
        poly([(28,41),(37,43),(37,51),(29,51),(26,46)],"#aa8059")
        line([(28,43),(34,44)],gold)
    # Large head, with the far eye and far cheek narrower in the three-quarter view.
    head=[(23,10),(34,8),(42,12),(46,20),(44,28),(38,34),(28,34),(21,28),(19,19)]
    poly(head,skin_shadow)
    poly([(24,11),(34,10),(41,14),(42,23),(38,30),(29,30),(24,26),(21,19)],skin,None)
    poly([(24,13),(30,11),(35,12),(28,16),(24,23),(22,20)],skin_light,None)
    if kind in ("goblin","elf","dark-elf"):
        poly([(22,17),(10,12),(15,24),(23,27)],skin_shadow)
        poly([(21,19),(13,15),(17,22)],skin,None)
        poly([(43,18),(51,14),(48,25),(43,27)],skin)
        line([(47,19),(45,23)],skin_light)
    if not back:
        rect((29,21,32,24),ink);rect((39,20,41,23),ink)
        rect((30,21,31,22),"#fff4cd" if kind not in ("goblin","lizard") else "#e8cf6c")
        rect((40,20,40,21),cream)
        line([(34,25),(36,26),(35,27)],skin_shadow)
        line([(32,30),(37,30),(39,29)],"#8d5b5a" if kind not in ("goblin","lizard") else "#386354")
        line([(27,26),(29,27)],skin_light)
    hair_colors={"dwarf":"#ac5737","elf":"#d9b86d","dark-elf":"#d9d4e3","vampire":"#403447",
                 "mira":"#ba7950","rowan":"#5d463e","bram":"#795446"}
    if kind in hair_colors:
        hair=hair_colors[kind]; shadow=shade(hair,ink,.4); highlight=shade(hair,cream,.32)
        if back:
            poly([(24,10),(35,8),(43,13),(45,23),(41,31),(29,34),(21,27),(19,18)],shadow)
            poly([(24,12),(34,10),(40,13),(39,25),(32,30),(24,26),(21,19)],hair,None)
            line([(25,14),(25,23),(29,27)],highlight);line([(33,12),(32,24),(35,27)],highlight)
        else:
            poly([(20,20),(20,14),(25,9),(35,8),(42,12),(44,18),(39,16),(35,13),(29,17),(24,17),(23,23)],shadow)
            poly([(22,15),(26,11),(34,10),(38,12),(32,13),(28,16)],hair,None)
            line([(25,12),(30,11),(34,11)],highlight)
        if kind in ("elf","dark-elf","mira"):
            poly([(21,23),(25,25),(26,35),(23,39),(20,34)],hair)
            line([(22,26),(23,34)],highlight);rect((22,35,25,36),gold)
    if kind in ("dwarf","bram") and not back:
        beard=hair_colors[kind]
        poly([(23,27),(28,29),(34,28),(40,26),(41,34),(37,42),(31,44),(24,39),(21,33)],shade(beard,ink,.3))
        poly([(25,30),(29,32),(35,30),(38,29),(37,36),(32,41),(27,37)],beard,None)
        for x,y in ((26,33),(30,35),(35,32)):
            line([(x,y),(x+1,y+4)],"#e6ae67");rect((x,y+5,x+2,y+6),gold)
    if kind=="goblin":
        poly([(20,15),(23,8),(31,4),(37,5),(42,11),(46,12),(48,17),(43,19),(39,15),(23,18)],"#b44353")
        poly([(23,12),(28,7),(34,6),(37,9),(29,10),(25,15)],"#ee8069",None)
        poly([(20,15),(39,14),(44,17),(43,21),(23,21),(19,19)],"#d5d6b6")
        line([(22,16),(37,15),(41,17)],cream,2)
        poly([(46,15),(50,16),(51,20),(48,23),(44,21),(44,18)],cream)
        if not back: line([(30,29),(31,31)],cream)
    elif kind=="magician":
        if back:
            poly([(22,17),(41,16),(42,25),(37,32),(28,33),(23,28)],"#85634f")
            line([(26,21),(26,27),(30,30)],"#bc9366")
        poly([(20,15),(24,8),(27,1),(32,2),(35,7),(41,13),(48,17),(44,21),(21,21),(16,19)],dark)
        poly([(23,14),(27,4),(30,3),(32,8),(36,13)],cloth,None)
        line([(27,5),(26,11)],light,2)
        poly([(21,14),(39,13),(43,16),(24,18)],gold)
        line([(21,19),(42,19)],light)
        rect((34,14,37,16),brass);rect((35,14,36,15),cream)
    elif kind=="skeleton":
        poly([(21,18),(21,10),(25,5),(36,4),(43,10),(46,20),(43,37),(37,38),(36,18),(28,18),(27,37),(21,35)],"#345c76")
        for y in (12,17,23,28,33):
            line([(22,y),(26,y)],gold,2);line([(39,y),(44,y)],gold,2)
        poly([(24,9),(28,5),(35,5),(40,9),(40,13),(24,14)],gold)
        poly([(30,6),(34,6),(36,10),(33,14),(30,11)],"#67bfb1")
        if back:
            poly([(28,15),(36,14),(38,30),(34,35),(28,32)],"#345c76")
            for y in (19,24,29):line([(29,y),(36,y)],gold,2)
        else:
            rect((29,21,32,24),ink);rect((38,20,40,23),ink)
            rect((30,22,31,23),"#8fe1cb");rect((39,21,39,22),"#8fe1cb")
            poly([(34,25),(36,28),(33,28)],ink,None)
            for x in (30,33,36):line([(x,30),(x,32)],cream)
            poly([(24,35),(31,39),(38,36),(40,39),(33,43),(25,39)],gold)
    elif kind=="lizard":
        for x,y in ((25,11),(31,7),(38,10)):
            poly([(x-2,y+2),(x,y-5),(x+3,y+2)],gold)
        if not back:
            rect((29,21,32,24),"#e7c665");rect((39,20,41,23),"#e7c665")
            line([(31,21),(31,24)],ink);line([(40,20),(40,23)],ink)
            for x,y in ((25,24),(28,28),(39,26)):line([(x,y),(x+1,y+1),(x+2,y)],"#8cceab")
        tail=Image.new("RGBA",(64,64));td=ImageDraw.Draw(tail)
        td.polygon([(39,48),(48,47),(53,50),(53,56),(49,59),(45,57),(49,54),(47,51),(39,52)],fill="#56a28d",outline=ink)
        td.line([(43,49),(48,49),(51,52)],fill="#a1d6b0")
        tail.alpha_composite(image);image=tail
    elif kind=="vampire":
        poly([(22,33),(15,25),(18,38),(27,40)],"#7b354e")
        poly([(39,33),(47,24),(45,38),(37,40)],"#ba657a")
        if not back:rect((33,30,33,32),cream)
    elif kind=="rowan":
        poly([(20,14),(24,8),(34,7),(41,12),(45,17),(22,18)],dark)
        line([(22,14),(38,13)],gold,2)
    elif kind=="mira":
        poly([(19,15),(23,9),(34,7),(41,11),(43,16)],cloth)
        line([(23,12),(29,10),(36,11)],light,2)
    if direction in ("west","north"):
        image=image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return image


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True); PREVIEW.mkdir(parents=True, exist_ok=True)
    columns = 7
    entries = []; sheets = {}; stills = {}
    seated = Image.new('RGBA',(128*len(ROSTER),128))
    for i,(kind,_,_) in enumerate(ROSTER):
        pose=tactics_actor(kind,'south')
        hips=49;pose.paste((0,0,0,0),(0,hips,64,64));d=ImageDraw.Draw(pose)
        d.polygon([(25,hips),(39,hips),(42,hips+3),(39,hips+5),(34,hips+4),(32,hips+2),(30,hips+4),(25,hips+5),(22,hips+3)],fill='#645763')
        for x in (23,36):
            d.rectangle((x,hips+3,x+4,hips+8),fill='#3d3540')
            d.rectangle((x,hips+7,x+6,hips+9),fill='#978179')
        frame=Image.new('RGBA',(128,128));frame.alpha_composite(pose.resize((128,128),Image.Resampling.NEAREST),(0,124-(hips+10)*2))
        seated.alpha_composite(frame,(i*128,0))
    seated.save(OUTPUT/'arena-spectators.png')
    for kind, label, coat in ROSTER:
        sheet = Image.new("RGBA", (columns * FRAME, 4 * FRAME))
        for row, direction in enumerate(DIRECTIONS):
            for col in range(columns):
                result = tactics_actor(kind, direction, col)
                assert result.size == (64, 64) and result.getbbox(), f"Invalid frame: {kind}/{direction}/{col}"
                bbox = result.getbbox()
                assert 0 < bbox[0] < bbox[2] < 64 and 0 < bbox[1] < bbox[3] < 64, f"Clipped frame: {kind}/{direction}/{col} {bbox}"
                result = finish_actor(result)
                sheet.alpha_composite(result, (col * FRAME, row * FRAME))
                if row == 0 and col == 0: stills[kind] = result
        sheet.save(OUTPUT / (kind + ".png")); sheets[kind] = sheet
        entries.append({"id": kind, "name": label, "file": kind + ".png", "sha256": hashlib.sha256((OUTPUT / (kind + ".png")).read_bytes()).hexdigest()})
    # Shape changes must be real edits; eight color swaps would fail this check.
    assert len({stills[k].getchannel("A").tobytes() for k, _, _ in ROSTER}) >= 6
    assert len({stills[k].tobytes() for k, _, _ in ROSTER}) == 8
    manifest = {"frameSize": FRAME, "anchor": [FRAME // 2, FEET], "opaqueHeight": HEIGHT, "columns": columns, "directions": DIRECTIONS, "idleColumn": 0, "walkColumns": list(range(1, 7)), "walkFps": 8, "status": "compact isometric redraw review", "artSource": "original local pixel drawing", "characters": entries}
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    font = lambda size: ImageFont.truetype(font_path, size) if Path(font_path).exists() else ImageFont.load_default(size=size)
    board = Image.new("RGB", (1184, 822), "#171f23"); bd = ImageDraw.Draw(board)
    bd.text((48, 28), "BRIARBRIDGE  /  CHARACTER ART", font=font(18), fill="#c6a56c")
    bd.text((48, 62), "Eight ways to be an alchemist", font=font(34), fill="#eee4d0")
    for i, (kind, label, coat) in enumerate(ROSTER):
        x, y = 48 + (i % 4) * 276, 134 + (i // 4) * 324
        bd.rounded_rectangle((x, y, x + 259, y + 307), radius=10, fill="#25302f", outline="#46514b", width=1)
        bd.rectangle((x + 18, y + 22, x + 21, y + 43), fill=coat)
        bd.text((x + 32, y + 20), label, font=font(23), fill="#eee4d0")
        bd.ellipse((x + 72, y + 235, x + 190, y + 250), fill="#182323")
        preview = stills[kind].resize((192, 192), Image.Resampling.NEAREST)
        board.paste(preview, (x + 34, y + 58), preview)
        bd.text((x + 20, y + 275), "128 × 128  ·  compact isometric", font=font(15), fill="#adb4a3")
    bd.text((48, 798), "Original fantasy designs · one shared base · appearance choices share the same abilities", font=font(15), fill="#a3ab9f")
    board.save(PREVIEW / "character-lineup.png")

    directions_board = Image.new("RGB", (896, 1608), "#171f23"); dd = ImageDraw.Draw(directions_board)
    for col, direction in enumerate(DIRECTIONS):
        dd.text((128 + col * 192, 16), direction.upper(), font=font(18), fill="#c6a56c")
    for row, (kind, label, _) in enumerate(ROSTER):
        dd.text((12, 120 + row * 192), label, font=font(18), fill="#eee4d0")
        for col, direction in enumerate(DIRECTIONS):
            tile = sheets[kind].crop((0, col * FRAME, FRAME, (col + 1) * FRAME)).resize((192, 192), Image.Resampling.NEAREST)
            directions_board.paste(tile, (128 + col * 192, 64 + row * 192), tile)
    directions_board.save(PREVIEW / "character-directions.png")
    heads = Image.new("RGB", (1184, 744), "#171f23"); hd = ImageDraw.Draw(heads)
    hd.text((24, 16), "Head details / four views", font=font(23), fill="#eee4d0")
    inspected = ("goblin", "magician", "skeleton", "lizard", "elf", "dark-elf")
    labels = {kind: label for kind, label, _ in ROSTER}
    for col, kind in enumerate(inspected):
        hd.text((80 + col * 184, 56), labels[kind], font=font(18), fill="#c6a56c")
        for row, direction in enumerate(DIRECTIONS):
            head = sheets[kind].crop((24, row * FRAME, 104, row * FRAME + 64)).resize((160, 128), Image.Resampling.NEAREST)
            heads.paste(head, (80 + col * 184, 88 + row * 160), head)
    for row, direction in enumerate(DIRECTIONS):
        hd.text((8, 136 + row * 160), direction.upper(), font=font(13), fill="#c6a56c")
    heads.save(PREVIEW / "character-heads.png")
    print("Built eight compact animated character sheets and three review boards; original local pixel drawing.")


if __name__ == "__main__":
    build()

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


from original_actors import actor as tactics_actor


def build():
    if (ROOT / 'deploy/approved-art.json').exists():
        raise RuntimeError('Approved artwork is pinned; this retired redraw must not replace it.')
    OUTPUT.mkdir(parents=True, exist_ok=True); PREVIEW.mkdir(parents=True, exist_ok=True)
    columns = 7
    entries = []; sheets = {}; stills = {}
    seated = Image.new('RGBA',(128*len(ROSTER),128))
    for i,(kind,_,_) in enumerate(ROSTER):
        pose=tactics_actor(kind,'south')
        hips=48;pose.paste((0,0,0,0),(0,hips,64,64));d=ImageDraw.Draw(pose)
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
    manifest = {"frameSize": FRAME, "anchor": [FRAME // 2, FEET], "opaqueHeight": HEIGHT, "columns": columns, "directions": DIRECTIONS, "idleColumn": 0, "walkColumns": list(range(1, 7)), "walkFps": 8, "status": "original alchemist redraw", "artSource": "original local pixel drawing", "characters": entries}
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    merchants=ROOT/'web/public/assets/market';merchants.mkdir(parents=True,exist_ok=True)
    for kind in ('mira','rowan','bram'):
        for blink in (False,True):
            finish_actor(tactics_actor(kind,'south',blink=blink)).save(merchants/(kind+('-blink' if blink else '')+'.png'))

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

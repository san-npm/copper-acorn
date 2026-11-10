"""Original 48px alchemy icons, drawn locally without external assets or model calls."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/assets/items'
IDS = ('sunleaf','moonmint','emberbloom','spring_water','wood_essence','silver_dust','healing_tonic','focus_draught','restoration_elixir','copper')
INK, GOLD, CREAM = '#44344b', '#dfb16a', '#fff0bf'


def draw_item(kind):
    image = Image.new('RGBA', (48,48)); d = ImageDraw.Draw(image)
    def poly(points,color,outline=INK):d.polygon(points,fill=color,outline=outline)
    def line(points,color,width=1):d.line(points,fill=color,width=width)
    if kind in ('sunleaf','moonmint','emberbloom'):
        dark,mid,light = {'sunleaf':('#466a48','#779957','#c4c878'),'moonmint':('#526f84','#83a5ac','#c8d8cd'),'emberbloom':('#635b58','#7f925b','#c8b578')}[kind]
        line([(15,42),(24,31),(29,14)],dark,3)
        for x,y,side in ((21,34,-1),(25,27,1),(27,20,-1)):
            poly([(x,y),(x+side*11,y-7),(x+side*12,y-12),(x+side*4,y-11),(x+side,y-3)],mid)
            line([(x,y-2),(x+side*8,y-9)],light)
        if kind=='sunleaf':
            for x,y in ((28,11),(35,23)):
                poly([(x-7,y),(x-2,y-2),(x,y-8),(x+3,y-3),(x+8,y),(x+3,y+3),(x,y+7),(x-3,y+2)],'#d9a84c')
                d.rectangle((x-2,y-2,x+2,y+2),fill='#f4d982');d.point((x,y-1),fill=CREAM)
        elif kind=='moonmint':
            for x,y in ((28,9),(33,28)):
                poly([(x-5,y+4),(x-3,y-2),(x,y-7),(x+4,y-1),(x+4,y+5),(x,y+8)],'#8999bf')
                line([(x,y-4),(x,y+5)],'#dedecb',2)
                line([(x-3,y+1),(x+2,y-1)],'#c1c3d6')
        else:
            for x,y in ((28,10),(35,27)):
                poly([(x-7,y),(x-3,y-3),(x-3,y-7),(x+1,y-4),(x+5,y-7),(x+5,y-2),(x+9,y+1),(x+4,y+3),(x+1,y+8),(x-2,y+3),(x-6,y+5)],'#b85458')
                poly([(x-4,y),(x-1,y-3),(x+3,y-2),(x+5,y+1),(x+1,y+5)],'#e88c62',None)
                d.rectangle((x,y,x+2,y+2),fill='#f6d084')
        poly([(13,36),(18,36),(22,40),(19,44),(14,44)],'#a67b52')
        line([(14,39),(19,41)],GOLD)
    elif kind=='silver_dust':
        poly([(6,32),(14,27),(36,27),(43,32),(40,40),(31,44),(15,43),(8,38)],'#7b6157')
        poly([(8,31),(18,27),(34,28),(41,33),(31,38),(15,37)],'#be9a6b')
        for x,y,s in ((16,28,6),(25,24,8),(33,30,5),(22,33,5)):
            poly([(x-s,y),(x-2,y-s),(x+3,y-s-2),(x+s,y),(x+2,y+4),(x-4,y+3)],'#8a9cab')
            poly([(x-2,y-s),(x+2,y-s),(x+1,y+1),(x-4,y+2)],'#dde0d0',None)
            line([(x+3,y-s+1),(x+s-1,y)],'#adbcca')
        line([(11,36),(17,40),(31,41),(38,37)],GOLD)
        line([(10,16),(10,22)],CREAM);line([(7,19),(13,19)],CREAM)
    elif kind=='copper':
        for x,y in ((17,30),(28,24),(20,14)):
            d.ellipse((x-10,y-6,x+9,y+9),fill='#a76b43',outline=INK)
            d.ellipse((x-10,y-9,x+9,y+5),fill=GOLD,outline=INK)
            d.ellipse((x-6,y-6,x+5,y+2),outline='#b07d47')
            line([(x-3,y-5),(x+2,y-5)],CREAM)
            line([(x,y-4),(x-1,y+1)],'#b07d47')
    else:
        # Isometric glass: offset neck, lit left plane, shaded right face and colored liquid.
        colors={'spring_water':('#4c83a6','#84c5cf','#d4efdc'),'wood_essence':('#916144','#ca9956','#f0d08a'),
                'healing_tonic':('#9c4a64','#da7680','#f6c1a0'),'focus_draught':('#62548c','#9d88bc','#ded0e4'),
                'restoration_elixir':('#427d79','#79b7a1','#d5e5b4')}
        dark,mid,light=colors[kind]
        shape = [(18,14),(31,14),(31,21),(38,27),(40,37),(35,43),(18,44),(10,39),(9,30),(17,22)]
        if kind=='focus_draught':shape=[(18,14),(30,14),(30,22),(36,24),(39,35),(33,44),(16,44),(10,36),(14,25),(18,22)]
        if kind=='restoration_elixir':shape=[(19,13),(30,13),(30,20),(37,25),(39,39),(34,45),(16,44),(10,37),(13,26),(19,20)]
        poly(shape,'#aebcc0')
        poly([(18,23),(29,22),(35,28),(36,37),(32,41),(18,41),(12,37),(12,30)],dark,None)
        poly([(15,29),(24,27),(32,29),(32,39),(20,42),(13,37)],mid,None)
        poly([(18,17),(22,17),(21,24),(15,30),(15,36),(12,33),(13,27),(18,22)],light,None)
        line([(31,24),(36,29),(37,37),(33,41)],'#758091')
        line([(16,29),(16,35)],CREAM,2);d.point((19,25),fill=CREAM)
        poly([(16,10),(27,8),(33,11),(31,17),(20,18),(16,15)],'#ab8058')
        poly([(17,10),(27,9),(31,11),(22,13)],'#e3c38d')
        line([(21,14),(29,13)],'#78554b')
        if kind not in ('spring_water','wood_essence'):
            poly([(23,15),(30,14),(32,18),(26,20),(21,18)],GOLD)
            line([(23,17),(28,16)],CREAM)
        if kind=='healing_tonic':
            poly([(23,31),(27,30),(31,33),(28,36),(24,36),(21,34)],'#efbf99')
            d.rectangle((25,31,26,35),fill='#a95468');line([(23,33),(28,33)],'#a95468')
        elif kind=='focus_draught':
            poly([(24,29),(27,32),(31,33),(28,35),(27,39),(25,35),(21,34),(25,32)],'#e6dca9',None)
        elif kind=='restoration_elixir':
            poly([(25,29),(30,33),(27,38),(22,36),(21,32)],GOLD)
            poly([(25,31),(28,33),(26,36),(23,35)],'#b5d3b8',None)
        elif kind=='wood_essence':
            poly([(22,28),(31,29),(32,38),(22,39),(20,33)],'#e4c084')
            line([(26,30),(24,33),(27,34),(25,37)],'#9f714a')
    assert image.getbbox() and set(image.getchannel('A').get_flattened_data()) <= {0,255}
    return image


def build():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest={'frameSize':48,'source':'original local pixel drawing','items':[]}
    board=Image.new('RGB',(800,400),'#24322e');d=ImageDraw.Draw(board)
    for i,kind in enumerate(IDS):
        image=draw_item(kind);path=OUT/(kind+'.png');image.save(path)
        manifest['items'].append({'id':kind,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        x,y=20+(i%5)*156,16+(i//5)*196
        board.paste(image.resize((120,120),Image.Resampling.NEAREST),(x+10,y+12),image.resize((120,120),Image.Resampling.NEAREST))
        d.text((x+4,y+143),kind.replace('_',' ').title(),font=ImageFont.load_default(size=12),fill='#f4e5c6')
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    board.save(ROOT/'docs/art/alchemy-items.png')
    print('Built ten original 48px icons and review board; no generation calls.')


if __name__=='__main__':build()

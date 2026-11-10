"""Original 64px alchemists, drawn from coordinates without external sprite inputs."""
import math
from PIL import Image, ImageDraw

INK = '#382a3a'
CREAM = '#fff0bf'
GOLD = '#eac574'
BRASS = '#9c653b'
CLOTH = {'goblin':'#667b45','magician':'#686399','dwarf':'#98554a','skeleton':'#397e83',
         'lizard':'#ac7e40','vampire':'#793c52','elf':'#598475','dark-elf':'#76618d',
         'mira':'#718e5a','rowan':'#4c91a7','bram':'#a6754f'}
SKIN = {'goblin':'#90a95d','skeleton':'#e8d6a1','lizard':'#5b9c83','vampire':'#d9c8ce',
        'dark-elf':'#665573'}
HAIR = {'elf':'#d6b66d','dark-elf':'#c3becd','vampire':'#3e3442','mira':'#a76944',
        'rowan':'#534234','bram':'#835038'}
DIRECTIONS = ('south','west','east','north')


def shade(color, target, amount):
    a=bytes.fromhex(color[1:]);b=bytes.fromhex(target[1:])
    return tuple(round(x*(1-amount)+y*amount) for x,y in zip(a,b))


def hand(direction, action=None, phase=0):
    active=action is not None and phase not in (0,7)
    if not active:x,y=41,44
    elif action in ('harvest','water'):x,y=39+phase%2,49+(phase in (2,3))
    elif action=='brew':x,y=41+(phase%3-1),38+phase%2
    else:
        angle=math.radians((-85,-100,-140,-35,20,0,-60,-85)[phase])
        x,y=round(39+math.cos(angle)*7),round(34+math.sin(angle)*7)
    if direction=='west':x=64-x
    if direction=='south':y+=2 if active else 0
    if direction=='north':y-=4 if active else 0
    return x,y


def actor(kind, direction, frame=0, action=None, phase=0, blink=False):
    assert kind in CLOTH and direction in DIRECTIONS
    image=Image.new('RGBA',(64,64));d=ImageDraw.Draw(image)
    side=direction in ('west','east');back=direction=='north';left=direction=='west'
    cloth=CLOTH[kind];dark=shade(cloth,INK,.48);light=shade(cloth,CREAM,.30)
    skin=SKIN.get(kind,'#e5b485');shadow=shade(skin,INK,.33);highlight=shade(skin,CREAM,.30)
    stride=0 if not frame else (-2,-1,1,2,1,-1)[frame-1]
    bob=0 if not frame else (0,0,1,0,0,1)[frame-1]
    lean=2 if action in ('harvest','water') and phase in (1,2,3,4) else 0
    def pt(p):
        x,y=p
        if y<45:x+=lean;y+=lean+bob
        return (64-x if left else x,y)
    def poly(points,color,outline=INK):d.polygon([pt(p) for p in points],fill=color,outline=outline)
    def line(points,color,width=1):d.line([pt(p) for p in points],fill=color,width=width)
    def rect(box,color):
        x,y=pt(box[:2]);a,b=pt(box[2:]);d.rectangle((min(x,a),min(y,b),max(x,a),max(y,b)),fill=color)
    # Boots keep a shared floor; the upper silhouette has independent species details.
    for x,step in ((26,stride),(35,-stride)):
        poly([(x,45),(x+5,45),(x+5,54+step),(x+7,57+step),(x+6,59+step),(x-2,59+step),(x-2,57+step),(x,54+step)],'#51434b')
        line([(x-1,57+step),(x+4,57+step)],'#9c7c62')
    if kind=='lizard':
        poly([(38,43),(44,45),(49,51),(49,55),(45,56),(43,54),(46,53),(44,49),(37,48)],skin)
        line([(42,46),(47,51),(47,53)],highlight)
    cloaked=kind in ('magician','skeleton','vampire')
    if cloaked:
        poly([(26,29),(37,29),(42,47),(39,53),(33,51),(25,53),(22,48)],dark)
        line([(25,34),(24,46),(27,50)],light)
    poly([(27,29),(36,29),(40,33),(39,44),(36,49),(27,48),(24,43),(24,34)],dark)
    poly([(27,31),(33,31),(34,43),(31,47),(26,44),(26,35)],cloth,None)
    line([(27,33),(27,39)],light)
    # Far arm sits behind the coat; the near hand remains above a side-view cape.
    poly([(25,32),(23,34),(23,41),(25,45),(28,43),(27,37),(28,33)],dark)
    rect((24,42,26,45),skin)
    if not back and not side:
        poly([(28,37),(35,37),(36,46),(31,48),(27,45)],'#bc9661')
        line([(28,38),(28,43)],'#e5c891')
        line([(25,38),(38,39)],'#604247',2)
        rect((31,38,33,40),GOLD)
        poly([(36,41),(40,40),(41,44),(39,47),(36,46)],'#80543f')
        line([(37,41),(39,41)],GOLD)
    elif back:
        if cloaked:
            poly([(27,30),(36,30),(39,47),(35,51),(31,50),(27,51),(24,47)],cloth)
            line([(28,33),(27,46),(29,48)],light)
            line([(34,35),(36,47)],dark)
        else:
            line([(26,32),(36,44)],'#c29c68',2)
            poly([(29,39),(35,39),(37,44),(34,47),(29,46)],'#82604a')
    else:
        line([(29,32),(35,42)],'#c29c68',2)
        if cloaked:
            poly([(26,30),(31,31),(31,39),(29,49),(25,51),(23,47)],cloth)
            line([(26,34),(25,46),(26,48)],light)
    hx,hy=hand(direction,action,phase)
    if left:hx=64-hx
    poly([(36,32),(39,32),(41,35),(hx+1,hy-3),(hx+1,hy),(hx-2,hy),(38,37)],cloth)
    poly([(hx-2,hy-2),(hx+1,hy-2),(hx+2,hy+1),(hx,hy+3),(hx-2,hy+1)],skin)
    line([(hx-1,hy-1),(hx+1,hy)],highlight)
    # A small neck under the jaw, never a detached square below the chin.
    rect((29,27,34,31),shadow)
    face=[(27,15),(34,14),(39,17),(40,23),(37,28),(31,30),(26,27),(24,21)]
    if side:face=[(29,15),(36,16),(38,19),(41,22),(39,24),(39,27),(34,30),(29,27),(27,21)]
    poly(face,shadow)
    poly([(28,16),(34,16),(37,18),(37,24),(34,27),(29,27),(27,23),(26,19)],skin,None)
    line([(28,18),(28,22)],highlight)
    if kind in ('goblin','elf','dark-elf'):
        if not side:poly([(26,19),(18,15),(21,23),(26,25)],skin)
        poly([(37,20),(44,16),(42,23),(38,25)],skin)
        line([(40,20),(42,18)],highlight)
    if not back:
        if not side and not blink:
            rect((28,21,29,22),INK);rect((35,20,36,21),INK)
            rect((28,21,28,21),CREAM)
            line([(31,26),(34,26)],shadow)
        elif side:
            rect((36,20,37,22),INK)
            rect((37,20,37,20),CREAM)
            line([(38,26),(36,27)],shadow)
        else:
            line([(28,22),(29,22)],shadow);line([(35,21),(36,21)],shadow)
    if kind in HAIR:
        hair=HAIR[kind];hairshadow=shade(hair,INK,.4);hairlight=shade(hair,CREAM,.25)
        if back:
            poly([(27,15),(35,14),(39,18),(39,25),(35,29),(28,28),(25,23),(25,18)],hairshadow)
            poly([(28,16),(34,16),(36,19),(35,26),(29,27),(27,23)],hair,None)
            line([(29,18),(29,24)],hairlight)
        else:
            poly([(25,20),(25,16),(29,13),(35,14),(39,17),(39,20),(35,18),(32,16),(28,19),(27,24)],hairshadow)
            line([(28,16),(32,15),(35,16)],hairlight)
        if kind in ('elf','dark-elf'):
            poly([(26,23),(28,24),(28,31),(26,34),(24,31)],hair)
            line([(26,25),(26,30)],hairlight)
    if kind in ('dwarf','bram') and not back:
        beard='#a15b35' if kind=='dwarf' else HAIR['bram']
        if side:
            poly([(35,25),(40,24),(41,30),(39,36),(36,39),(32,36),(32,30)],shade(beard,INK,.3))
            line([(37,28),(38,33),(36,36)],beard,3)
            line([(37,29),(37,34)],'#dbaa64')
        else:
            poly([(26,24),(30,26),(34,25),(38,23),(39,29),(36,36),(32,40),(27,36),(25,29)],shade(beard,INK,.3))
            poly([(28,27),(31,29),(35,26),(36,29),(34,35),(31,37),(28,33)],beard,None)
            line([(29,29),(30,34)],'#dfad69');line([(34,29),(33,34)],'#dfad69')
        rect((32 if not side else 36,35,33 if not side else 37,36),GOLD)
    if kind=='goblin':
        poly([(24,17),(27,10),(33,8),(38,11),(41,17),(39,19)],'#b44353')
        poly([(27,15),(30,11),(34,10),(35,12),(31,13)],'#e57a68',None)
        poly([(24,17),(36,16),(40,18),(39,21),(25,21)],'#d7d6b7')
        line([(26,18),(35,17),(38,18)],CREAM)
        poly([(40,15),(43,16),(44,19),(42,21),(39,20),(38,17)],CREAM)
    elif kind=='magician':
        poly([(23,18),(27,13),(29,5),(33,6),(34,11),(39,16),(43,18),(40,21),(25,21),(21,20)],dark)
        poly([(27,16),(30,8),(32,9),(33,13),(36,16)],cloth,None)
        line([(30,9),(29,13)],light)
        poly([(25,16),(36,16),(39,18),(26,19)],GOLD)
        rect((33,16,35,18),BRASS);rect((34,16,34,17),CREAM)
        if back:poly([(28,22),(37,22),(37,26),(33,29),(28,27)],dark)
    elif kind=='skeleton':
        poly([(25,21),(25,14),(29,9),(35,9),(40,14),(41,25),(39,32),(36,31),(35,20),(29,20),(28,32),(24,30)],'#2e626f')
        for y in (17,22,27):line([(25,y),(28,y)],GOLD,2);line([(37,y),(40,y)],GOLD,2)
        poly([(27,14),(29,10),(35,10),(38,14),(38,17),(27,17)],GOLD)
        line([(29,12),(34,11),(36,13)],CREAM)
        poly([(31,11),(34,12),(34,16),(32,18),(30,15)],'#80cfb8')
        if not back:
            rect((29,22,30,24),INK);rect((35,21,36,23),INK)
            rect((29,22,29,22),'#8fe1cb');rect((35,21,35,21),'#8fe1cb')
            for x in (30,32,34):line([(x,27),(x,28)],CREAM)
        else:poly([(29,20),(35,20),(37,29),(32,31),(29,28)],cloth)
    elif kind=='lizard':
        for x,y in ((28,16),(33,13),(38,17)):poly([(x-2,y),(x,y-5),(x+2,y)],GOLD)
        if not back:
            line([(31,25),(35,25)],shadow)
            rect((36 if side else 29,21,36 if side else 29,22),GOLD)
    elif kind=='vampire':
        poly([(26,31),(22,26),(23,33),(28,35)],'#9c5367')
        poly([(35,31),(40,25),(40,32),(36,35)],'#9c5367')
        if not back:rect((34,27,34,28),CREAM)
    elif kind in ('rowan','mira'):
        poly([(24,18),(27,12),(33,11),(38,14),(40,18)],cloth)
        line([(27,15),(34,14),(37,16)],light)
    return image

"""Build original working poses and effects; no packs, model calls or network access."""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
from PIL import Image, ImageDraw
from original_actors import actor, hand, DIRECTIONS

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/public/assets/actions'
spec=importlib.util.spec_from_file_location('characters',ROOT/'scripts/build-characters.py')
ART=importlib.util.module_from_spec(spec);spec.loader.exec_module(ART)
ACTIONS={
    'brew':('Brew potion',[220,220,220,220,220,220,380,340]),
    'mine':('Mine silver',[260,170,260,90,110,170,220,340]),
    'harvest':('Harvest herbs',[240,200,200,160,180,220,260,340]),
    'water':('Collect water',[220,220,240,340,180,200,260,320]),
    'tap':('Tap wood essence',[240,170,200,100,130,340,300,340]),
}


def transform(point):
    return round(point[0]*2+64),round(point[1]*2+56)


def tool(action,direction,frame):
    image=Image.new('RGBA',(256,256));d=ImageDraw.Draw(image)
    if frame in (0,7):return image
    h=hand(direction,action,frame);x,y=transform(h)
    if action in ('water','harvest') or action=='brew' and frame==6:
        color={'water':'#75bacb','harvest':'#8fae57','brew':'#97bf72'}[action]
        if action=='harvest':
            for dx in (-4,0,4):
                d.line([(x,y),(x+dx,y-12)],fill='#516d44',width=2)
                d.polygon([(x+dx,y-10),(x+dx-4,y-16),(x+dx+3,y-14)],fill=color)
        else:
            d.rectangle((x-2,y-6,x+2,y-2),fill='#d5bd82')
            d.polygon([(x-3,y-2),(x+3,y-2),(x+6,y+3),(x+5,y+10),(x-5,y+10),(x-6,y+3)],fill='#374454')
            d.rectangle((x-4,y+3,x+4,y+7),fill=color)
            d.line([(x-4,y+1),(x-4,y+5)],fill='#e6e9ce',width=2)
        return image
    vector={'south':(0,1),'west':(-1,0),'east':(1,0),'north':(0,-1)}[direction]
    base=math.atan2(vector[1],vector[0]);angle=base+math.radians((-100,-100,-150,-40,0,-10,-65,-100)[frame])
    if action=='brew':angle=base+math.sin(frame)*.3
    ux,uy=math.cos(angle),math.sin(angle);tip=(round(x+ux*23),round(y+uy*23))
    d.line([(round(x-ux*4),round(y-uy*4)),tip],fill='#46383e',width=6)
    d.line([(x,y),tip],fill='#c39b60',width=2)
    if action=='brew':
        d.ellipse((tip[0]-3,tip[1]-3,tip[0]+3,tip[1]+3),fill='#9a754c')
    else:
        span=15 if action=='mine' else 8
        ends=[(round(tip[0]-uy*span-ux*4),round(tip[1]+ux*span-uy*4)),tip,
              (round(tip[0]+uy*span-ux*4),round(tip[1]-ux*span-uy*4))]
        d.line(ends,fill='#36404b',width=7)
        d.line(ends,fill='#b9c5bd' if action=='mine' else '#c19a65',width=3)
    return image


def effects(action,direction,frame):
    image=Image.new('RGBA',(256,256));d=ImageDraw.Draw(image)
    if frame in (0,7):return image
    vx,vy={'south':(0,1),'west':(-1,0),'east':(1,0),'north':(0,-1)}[direction]
    x,y=transform((32+vx*18,52+vy*12))
    if action=='brew':
        for i in range(4):
            px=x+((frame*5+i*7)%25)-12;py=y-20-((frame*6+i*9)%26)
            d.rectangle((px,py,px+2,py+3),fill=('#a9c780','#d5e6a1')[i%2])
    elif action in ('mine','tap') and frame in (4,5,6):
        for i in range(6):
            dx=(i%3-1)*(3+(frame-4)*4);dy=-i*3+(frame-4)*3
            d.rectangle((x+dx,y+dy,x+dx+2,y+dy+2),fill='#e4d6a2' if i%2 else '#a4b3b1')
    elif action=='water' and frame in (2,3,4,5):
        size=4+(frame-2)*5
        d.arc((x-size,y-size//3,x+size,y+size//3),0,300,fill='#b0d8d7',width=2)
    elif action=='harvest' and frame in (3,4,5,6):
        for i in range(4):
            px=x+(i-2)*6+(frame-3)*2;py=y-i*4-(frame-3)*3
            d.polygon([(px,py),(px+4,py-3),(px+5,py+1),(px+1,py+3)],fill='#b6c477')
    return image


def build():
    OUT.mkdir(parents=True,exist_ok=True)
    records=[];hashes={}
    for action,(name,durations) in ACTIONS.items():
        files={}
        for kind,_,_ in ART.ROSTER:
            sheet=Image.new('RGBA',(2048,1024))
            for row,direction in enumerate(DIRECTIONS):
                for frame in range(8):
                    native=actor(kind,direction,action=action,phase=frame)
                    assert native.getbbox() and set(native.getchannel('A').get_flattened_data())<={0,255}
                    pose=ART.finish_actor(native)
                    cell=Image.new('RGBA',(256,256));cell.alpha_composite(pose,(64,52))
                    box=native.getbbox();scale=112/(box[3]-box[1])
                    width=round((box[2]-box[0])*scale)
                    held=tool(action,direction,frame).crop((64,56,192,184))
                    held=held.resize((round(64*scale),round(64*scale)),Image.Resampling.NEAREST)
                    cell.alpha_composite(held,(64+(128-width)//2-round(box[0]*scale),64-round(box[1]*scale)))
                    sheet.alpha_composite(cell,(frame*256,row*256))
            file=f'{kind}-{action}.png';sheet.save(OUT/file);files[kind]=file
        # Tools are part of each actor sheet so they stay in that character's hands.
        for layer,render in [('tools',lambda *_:Image.new('RGBA',(256,256))),('effects',effects)]:
            sheet=Image.new('RGBA',(2048,1024))
            for row,direction in enumerate(DIRECTIONS):
                for frame in range(8):sheet.alpha_composite(render(action,direction,frame),(frame*256,row*256))
            sheet.save(OUT/f'{action}-{layer}.png')
        records.append({'id':action,'name':name,'durations':durations,'files':files})
    for p in sorted(OUT.glob('*.png')):hashes[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
    metadata={'frameSize':256,'anchor':[128,176],'columns':8,'directions':list(DIRECTIONS),
              'artSource':'original coordinate drawing; no external sprite inputs','actions':records,'sha256':hashes}
    (OUT/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
    # A contact sheet lets reviewers compare all five working poses at the same scale.
    board=Image.new('RGBA',(256*5,256),'#253b40')
    for index,action in enumerate(ACTIONS):
        for layer in [f'magician-{action}',f'{action}-tools',f'{action}-effects']:
            sheet=Image.open(OUT/(layer+'.png')).convert('RGBA')
            board.alpha_composite(sheet.crop((4*256,0,5*256,256)),(index*256,0))
    (ROOT/'docs/art').mkdir(parents=True,exist_ok=True);board.save(ROOT/'docs/art/original-actions.png')
    print('Built 1,280 original action poses and 320 tool/effect frames without external packs.')


if __name__=='__main__':build()

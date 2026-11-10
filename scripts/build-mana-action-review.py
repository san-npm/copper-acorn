"""Export local action studies using the approved character layers and supplied forest art."""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('characters', ROOT/'scripts/build-mana-character-review.py')
ART = importlib.util.module_from_spec(spec);spec.loader.exec_module(ART)
FOREST = Path('/Users/hodlmedia/Downloads/19.07a - Gentle Forest 3.0a ($0 palettes)')
TILED = Path('/Users/hodlmedia/Downloads/sample map and Tiled files')
OUT = ART.OUT/'assets/actions'
VECTORS = {'south': (0,1), 'west': (-1,0), 'east': (1,0), 'north': (0,-1)}
# Page1 palm anchors; working hands are occluded in the north-facing source poses.
HANDS = {
    'south': [(36,33),(36,40),(37,42),(33,36),(33,30)],
    'west': [(28,33),(24,29),(23,28),(25,30),(25,29)],
    'east': [(35,33),(39,29),(40,28),(38,30),(38,29)],
    'north': [(27,33),(32,22),(32,21),(32,28),(32,30)],
}
IDLE = ('p1',0,0)
SWING = [IDLE,('pONE3',0,0),('pONE3',2,0),('pONE3',1,0),('pONE3',3,0),('pONE3',3,0),('pONE3',0,0),IDLE]
REACH = [IDLE,('p1',1,0),('p1',2,0),('p1',2,0),('p1',1,0),('p1',3,0),('p1',4,0),IDLE]
ACTIONS = {
    'brew': {'name':'Brew potion', 'poses':[IDLE,*[('pONE2',c,0) for c in (0,1,2,3,1)],('p1',3,0),IDLE],
             'durations':[220,220,220,220,220,220,380,340], 'phases':['Ready','Reach','Stir','Stir','Infuse','Lift','Bottle','Ready']},
    'mine': {'name':'Mine silver', 'poses':SWING, 'durations':[260,170,260,90,110,170,220,340],
             'phases':['Ready','Grip','Raise','Swing','Strike','Dust settles','Recover','Ready']},
    'harvest': {'name':'Harvest herbs', 'poses':REACH, 'durations':[240,200,200,160,180,220,260,340],
                'phases':['Ready','Bend','Reach','Pluck','Lift','Bundle','Stow','Ready']},
    'water': {'name':'Collect water', 'poses':REACH, 'durations':[220,220,240,340,180,200,260,320],
              'phases':['Ready','Kneel','Dip','Fill','Lift','Seal','Stow','Ready']},
    'tap': {'name':'Tap wood essence', 'poses':SWING, 'durations':[240,170,200,100,130,340,300,340],
            'phases':['Ready','Grip','Raise','Tap','Tap','Collect','Stow','Ready']},
}
SOURCES = set()


def image(path):
    SOURCES.add(path)
    return Image.open(path).convert('RGBA')


def animation(filename, tile_id):
    path = TILED/filename;SOURCES.add(path)
    xml = ET.parse(path).getroot()
    frames = xml.find(f"tile[@id='{tile_id}']/animation").findall('frame')
    ids = [int(f.attrib['tileid']) for f in frames]
    times = [int(f.attrib['duration']) for f in frames]
    assert ids and len(ids)==len(times) and all(t>0 for t in times)
    return ids,times


def native_layer(kind, direction, pose):
    base = ART.cell('char_a_p1_0bas_humn_v01.png',direction,pose=pose)
    result = Image.new('RGBA',(96,96))
    result.alpha_composite(ART.native_actor(kind,direction,pose=pose),(16,16+44-base.getbbox()[3]))
    assert set(result.getchannel('A').get_flattened_data())<={0,255}
    assert result.getbbox()[3]==60, (kind,direction,pose,result.getbbox())
    return result


def grip(direction, pose):
    base = ART.cell('char_a_p1_0bas_humn_v01.png',direction,pose=pose)
    dy = 44-base.getbbox()[3]
    if pose[0]!='p1':
        weapon = ART.cell('6tla/char_a_p1_6tla_sw01_v01.png',direction,pose=pose)
        points=[(x,y) for y in range(64) for x in range(64)
                if weapon.getpixel((x,y)) in ((127,73,53,255),(180,127,84,255),(218,185,136,255))]
        assert points, (direction,pose)
        return round(sum(x for x,y in points)/len(points)),round(sum(y for x,y in points)/len(points))+dy
    x,y=HANDS[direction][pose[1]]
    return x,y+dy


def resource_point(action,direction):
    dx,dy=VECTORS[direction]
    if action in ('brew','mine','tap'):
        g=grip(direction,ACTIONS[action]['poses'][3 if action=='brew' else 4])
        length=10 if action=='brew' else 11 if action=='mine' else 9
        return g[0]+dx*length-(4 if action=='tap' else 0),g[1]+dy*length+(12 if action!='tap' else 15)
    return 32+dx*18,44+dy*(12 if action=='harvest' else 14)


def exported(native):
    bbox=native.getbbox()
    if bbox:
        assert bbox[0]>=6 and bbox[1]>=2 and bbox[2]<=90 and bbox[3]<=86, bbox
    scaled=native.resize((288,288),Image.Resampling.NEAREST)
    result=Image.new('RGBA',(256,256));result.alpha_composite(scaled,(-16,-4))
    return result


def dot_image():
    return Image.new('RGBA',(96,96))


def point(p):
    return round(p[0])+16,round(p[1])+16


def tool(action,direction,frame):
    result=dot_image();d=ImageDraw.Draw(result)
    if frame in (0,7) or action in ('harvest','water') or action=='tap' and frame>4:
        return result
    x,y=grip(direction,ACTIONS[action]['poses'][frame]);dx,dy=VECTORS[direction]
    if action=='brew':
        if frame==6:return result
        cx,cy=resource_point(action,direction)
        tip=(cx+(-2,0,2,1,-1,0,0,0)[frame],cy-18)
        d.line([point((x,y)),point(tip)],fill='#493547',width=3)
        d.line([point((x,y)),point(tip)],fill='#be995e')
        tx,ty=point(tip);d.ellipse((tx-1,ty-1,tx+1,ty+1),fill='#e5c890')
        return result
    angle=math.atan2(dy,dx)+math.radians((-110,-110,-170,-45,0,-20,-65,-110)[frame])
    ux,uy=math.cos(angle),math.sin(angle)
    length=11 if action=='mine' else 9
    tip=(x+ux*length,y+uy*length)
    d.line([point((x-ux*2,y-uy*2)),point(tip)],fill='#4e3840',width=3)
    d.line([point((x-ux,y-uy)),point(tip)],fill='#bb8e57')
    if action=='mine':
        curve=[(tip[0]-uy*7-ux*2,tip[1]+ux*7-uy*2),(tip[0]-uy*4+ux,tip[1]+ux*4+uy),
               (tip[0]+uy*4+ux,tip[1]-ux*4+uy),(tip[0]+uy*7-ux*2,tip[1]-ux*7-uy*2)]
        d.line(list(map(point,curve)),fill='#3b3f4b',width=3)
        d.line(list(map(point,curve)),fill='#b4c2b4',width=2)
        d.line(list(map(point,curve[:2])),fill='#eef0d8')
    else:
        a=(tip[0]-uy*4,tip[1]+ux*4);b=(tip[0]+uy*4,tip[1]-ux*4)
        d.line([point(a),point(b)],fill='#503944',width=5)
        d.line([point(a),point(b)],fill='#be9557',width=3)
        d.line([point((a[0]-ux,a[1]-uy)),point((b[0]-ux,b[1]-uy))],fill='#ead19a')
    return result


def bottle(d,x,y,color):
    x,y=point((x,y))
    d.rectangle((x-1,y-4,x+1,y-2),fill='#d6ba80')
    d.polygon([(x-1,y-2),(x+1,y-2),(x+3,y),(x+3,y+4),(x+2,y+5),(x-2,y+5),(x-3,y+4),(x-3,y)],fill='#353e4c')
    d.rectangle((x-2,y+1,x+2,y+3),fill=color)
    d.line([(x-2,y),(x-2,y+2)],fill='#e8ead2')


def effects(action,direction,frame):
    result=dot_image();d=ImageDraw.Draw(result);cx,cy=resource_point(action,direction)
    gx,gy=grip(direction,ACTIONS[action]['poses'][frame])
    if action=='brew':
        if 1<=frame<=5:
            for i in range(3):
                x,y=point((cx+(i*5+frame*2)%13-6,cy-20-(frame+i*3)%8))
                d.rectangle((x,y,x+1,y+1),fill='#d2d9b3')
            for i in range(3):
                x,y=point((cx-5+i*4,cy-17+(frame+i)%2));d.point((x,y),fill='#dfeb9d')
        if frame==6:bottle(d,gx,gy-3,'#9dbb5f')
    elif action=='mine' and 4<=frame<=6:
        age=frame-4
        for i in range(7):
            x,y=point((cx+(i-3)*(2+age),cy-13-((i*3)%5)-age*3+age*age))
            d.rectangle((x,y,x+1,y+1),fill=('#ebe9c9','#adbab9','#8b9699')[i%3])
        if frame==4:
            x,y=point((cx,cy-12));d.line([(x-3,y),(x+3,y)],fill='#fff2bf');d.line([(x,y-3),(x,y+3)],fill='#fff2bf')
    elif action=='harvest' and 3<=frame<=6:
        t=(frame-3)/3
        x=cx*(1-t)+gx*t;y=(cy-13)*(1-t)+(gy-4)*t-4*math.sin(t*math.pi)
        for ox,oy in [(-2,0),(1,-2),(2,1)]:
            px,py=point((x+ox,y+oy));d.polygon([(px,py-2),(px+1,py-1),(px+1,py+1),(px,py+2),(px-1,py)],fill='#9bc857')
        px,py=point((x,y));d.point((px,py-2),fill='#f4d47b')
    elif action=='water' and 2<=frame<=6:
        if frame in (2,3):
            x,y=point((gx,gy+7));d.ellipse((x-7,y-2,x+7,y+2),outline='#bfd9c9')
        bottle(d,gx,gy+3,'#78b8c2' if frame>=3 else '#536b78')
    elif action=='tap':
        if frame==4:
            x,y=point((cx,cy-15));d.point((x-2,y-1),fill='#edd18d');d.point((x+2,y-2),fill='#edd18d')
        if frame in (4,5):
            x,y=point((cx+4,cy-12+(frame-4)*4));d.rectangle((x,y,x+1,y+1),fill='#e3b85c')
        if frame==6:bottle(d,gx,gy-3,'#d0a155')
    return result


def resource(action,direction,objects,water):
    result=dot_image();d=ImageDraw.Draw(result);cx,cy=resource_point(action,direction);x,y=point((cx,cy))
    if action in ('mine','harvest','tap'):
        col={'tap':0,'mine':1,'harvest':2}[action]
        prop=objects.crop((col*32,0,col*32+32,32))
        size=16 if action=='harvest' else 24
        prop=prop.resize((size,size),Image.Resampling.NEAREST)
        result.alpha_composite(prop,(x-prop.width//2,y-prop.height))
        if action=='mine':
            d.line([(x-3,y-21),(x-1,y-18),(x-3,y-15),(x,y-12)],fill='#c6d4d3')
            d.line([(x+3,y-13),(x+5,y-10)],fill='#e6e4ca')
        elif action=='harvest':
            for ox,oy in [(-6,-10),(2,-15),(6,-8)]:
                d.rectangle((x+ox,y+oy,x+ox+1,y+oy+1),fill='#edcd74')
        else:
            # Small leafy branch and copper spout distinguish a sap tap from chopping.
            d.line([(x-2,y-20),(x+5,y-25),(x+9,y-24)],fill='#7e653d',width=2)
            d.polygon([(x+3,y-26),(x+8,y-28),(x+8,y-25),(x+5,y-23)],fill='#82a24c')
            d.line([(x,y-15),(x+4,y-15),(x+4,y-13)],fill='#d4af6c',width=2)
            bottle(d,cx+4,cy-5,'#8d783e')
    elif action=='water':
        # Reuse the supplied water surface and retain hard pixel edges.
        pond=Image.new('RGBA',(32,16));pond.alpha_composite(water.crop((0,0,32,16)))
        mask=Image.new('L',(32,16));ImageDraw.Draw(mask).ellipse((0,0,31,15),fill=255);pond.putalpha(mask)
        d.ellipse((x-18,y-18,x+18,y+1),fill='#435f4c')
        result.alpha_composite(pond,(x-16,y-16))
    else:
        d.ellipse((x-12,y-6,x+12,y+2),fill='#443441')
        d.polygon([(x-5,y-3),(x-2,y+1),(x,y-4),(x+3,y+1),(x+6,y-3),(x+3,y-7),(x-3,y-7)],fill='#c97c3d')
        d.polygon([(x-12,y-17),(x+12,y-17),(x+14,y-10),(x+12,y-4),(x+8,y-1),(x-8,y-1),(x-12,y-4),(x-14,y-10)],fill='#493e48')
        d.polygon([(x-10,y-15),(x+9,y-15),(x+11,y-8),(x+8,y-4),(x-6,y-3),(x-10,y-6)],fill='#797263')
        d.line([(x-9,y-10),(x-8,y-6),(x-4,y-4)],fill='#b6aa7c',width=2)
        d.ellipse((x-14,y-21,x+14,y-13),fill='#3c3c45',outline='#b6aa7c')
        d.ellipse((x-11,y-20,x+11,y-15),fill='#5a8850')
        d.line([(x-7,y-19),(x-1,y-20),(x+5,y-18)],fill='#a9bf66')
    return result


def strip(frames,columns,rows):
    sheet=Image.new('RGBA',(256*columns,256*rows))
    for i,frame in enumerate(frames):sheet.alpha_composite(exported(frame),((i%columns)*256,(i//columns)*256))
    return sheet


def review_images(metadata):
    board=Image.new('RGB',(1280,250),'#25302f');bd=ImageDraw.Draw(board)
    for index,action in enumerate(metadata['actions']):
        background=Image.open(OUT/('workshop-floor.png' if action['id']=='brew' else 'forest-floor.png')).convert('RGBA')
        layers={name:Image.open(OUT/file).convert('RGBA') for name,file in {
            'actor':action['files']['magician'],'tools':f"{action['id']}-tools.png",
            'effects':f"{action['id']}-effects.png",'resource':f"{action['id']}-resource.png"}.items()}
        frames=[]
        for frame in range(8):
            scene=background.copy()
            order=['resource','actor','tools','effects'] if action['resourcePoints'][0][1]<44 else ['actor','resource','tools','effects']
            for name in order:
                col=0 if name=='resource' else frame
                scene.alpha_composite(layers[name].crop((col*256,0,col*256+256,256)),(64,4))
            labeled=Image.new('RGB',(384,320),'#25302f');labeled.paste(scene.convert('RGB'),(0,32))
            ImageDraw.Draw(labeled).text((12,6),f"{action['name']} · {action['phases'][frame]}",font=ART.font(16),fill='#eee4d0')
            frames.append(labeled)
        frames[0].save(ART.OUT/f"{action['id']}.gif",save_all=True,append_images=frames[1:],duration=action['durations'],loop=0,disposal=2)
        preview=frames[4].resize((256,213),Image.Resampling.NEAREST);board.paste(preview,(index*256,30))
    bd.text((12,6),'COPPER ACORN / LOCAL ACTION STUDIES',font=ART.font(16),fill='#ead8b1')
    board.save(ART.OUT/'actions-lineup.png')


def build():
    OUT.mkdir(parents=True,exist_ok=True)
    approved=json.loads((ART.OUT/'assets/characters/manifest.json').read_text())['characters']
    ART.build()
    for entry in approved:
        assert hashlib.sha256((ART.OUT/'assets/characters'/entry['file']).read_bytes()).hexdigest()==entry['sha256'],entry['id']
    objects=image(FOREST/'gentle sheets/gentle 32x32 v01.png')
    tiles=image(FOREST/'gentle sheets/gentle forest v01.png')
    water=tiles.crop((16,144,48,176))
    ground=Image.new('RGBA',(128,96))
    for row in range(6):
        for col in range(8):
            tile=(97+(row+col)%2) if col in (0,7) or row in (0,5) else 17+(row+col)%2
            x,y=tile%16*16,tile//16*16
            ground.alpha_composite(tiles.crop((x,y,x+16,y+16)),(col*16,row*16))
    ground.resize((384,288),Image.Resampling.NEAREST).save(OUT/'forest-floor.png')
    furniture=image(ART.PACK/'icons & objects/cozy furnishings sampler.png')
    wood=furniture.crop((44,12,60,28));workshop=Image.new('RGBA',(128,96))
    for y in range(0,96,16):
        for x in range(0,128,16):workshop.alpha_composite(wood,(x,y))
    workshop.resize((384,288),Image.Resampling.NEAREST).save(OUT/'workshop-floor.png')
    records=[];generated=[]
    for action,config in ACTIONS.items():
        poses=config['poses'];assert len(poses)==len(config['durations'])==len(config['phases'])==8
        files={}
        for kind,name in ART.ROSTER:
            frames=[native_layer(kind,d,p) for d in ART.DIRECTIONS for p in poses]
            for row in range(4):assert len({f.tobytes() for f in frames[row*8:(row+1)*8]})>=4,(kind,action,row)
            file=f'{kind}-{action}.png';strip(frames,8,4).save(OUT/file);files[kind]=file;generated.append(file)
        for suffix,render in [('tools',tool),('effects',effects)]:
            file=f'{action}-{suffix}.png'
            strip([render(action,d,f) for d in ART.DIRECTIONS for f in range(8)],8,4).save(OUT/file);generated.append(file)
        file=f'{action}-resource.png';strip([resource(action,d,objects,water) for d in ART.DIRECTIONS],1,4).save(OUT/file);generated.append(file)
        records.append(dict(id=action,name=config['name'],durations=config['durations'],phases=config['phases'],poses=poses,files=files,
                            resourcePoints=[resource_point(action,d) for d in ART.DIRECTIONS]))
    ids,times=animation('gentle water sparkles A v01.tsx',0)
    sparkles=image(FOREST/'gentle animations/gentle water sparkles A v01.png')
    sparkling=Image.new('RGBA',(16*len(ids),16))
    for i,tile in enumerate(ids):sparkling.alpha_composite(sparkles.crop((tile%3*16,tile//3*16,tile%3*16+16,tile//3*16+16)),(i*16,0))
    sparkling.resize((48*len(ids),48),Image.Resampling.NEAREST).save(OUT/'water-sparkles.png')
    wids,wtimes=animation('gentle waterfall A v01.tsx',6)
    waterfall=image(FOREST/'gentle animations/gentle waterfall A v01.png');falls=Image.new('RGBA',(16*len(wids),80))
    for i,tile in enumerate(wids):
        for y,row in enumerate((1,2,3,6,7)):
            x=tile%6*16;falls.alpha_composite(waterfall.crop((x,row*16,x+16,row*16+16)),(i*16,y*16))
    falls.resize((48*len(wids),240),Image.Resampling.NEAREST).save(OUT/'waterfall.png')
    metadata=dict(frameSize=256,anchor=[128,176],columns=8,directions=list(ART.DIRECTIONS),characters=approved,actions=records,
                  sparkles=dict(durations=times,sourceTileIds=ids),waterfall=dict(durations=wtimes,sourceTileIds=wids),
                  sha256={f:hashlib.sha256((OUT/f).read_bytes()).hexdigest() for f in generated},
                  status='Local animation study; action poses adapted from free movement/combat layers, not paid farming pages')
    (OUT/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
    # Keep supplied artwork out of production/publication; only this ignored review references it.
    (ART.OUT/'actions.html').write_text((ROOT/'scripts/mana-action-review.html').read_text())
    review_images(metadata)
    for page in {pose[0] for config in ACTIONS.values() for pose in config['poses']}:
        SOURCES.update((ART.SOURCE.parent/f'char_a_{page}').rglob('*.png'))
    sources={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
    (OUT/'source-checksums.json').write_text(json.dumps(sources,indent=2)+'\n')
    print(f'Built 1,280 character action frames, shared tools/effects/resources and two Tiled-timed water loops in {OUT}.')
    print('All eight approved idle/walk sheets are unchanged. Production game and hosting unchanged.')


if __name__=='__main__':build()

"""Check the approved packaged animation sheets and their runtime contract."""
import hashlib
import json
import unittest
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/public/assets/actions'


class ActionArtTests(unittest.TestCase):
    def test_every_runtime_file_is_present_hashed_and_has_the_expected_grid(self):
        metadata=json.loads((OUT/'manifest.json').read_text())
        self.assertEqual((metadata['frameSize'],metadata['anchor'],metadata['columns']),(256,[128,176],8))
        self.assertEqual(metadata['directions'],['south','west','east','north'])
        self.assertEqual({a['id'] for a in metadata['actions']},{'brew','mine','harvest','water','tap'})
        roster=json.loads((ROOT/'web/public/assets/characters/manifest.json').read_text())['characters']
        wanted=set()
        for action in metadata['actions']:
            self.assertEqual(set(action['files']),{c['id'] for c in roster})
            self.assertEqual(len(action['durations']),8)
            self.assertTrue(all(50<=t<=2000 for t in action['durations']))
            wanted.update(action['files'].values())
            wanted.update(action['id']+'-'+suffix+'.png' for suffix in ('tools','effects'))
            wanted.add(action['id']+'-resource.png')
        self.assertEqual(set(metadata['sha256']),wanted)
        for file in wanted:
            self.assertEqual(hashlib.sha256((OUT/file).read_bytes()).hexdigest(),metadata['sha256'][file],file)
            with Image.open(OUT/file) as image:self.assertEqual(image.size,(256,1024) if file.endswith('-resource.png') else (2048,1024),file)

    def test_working_actors_move_in_all_views_without_clipped_pixels(self):
        metadata=json.loads((OUT/'manifest.json').read_text())
        for action in metadata['actions']:
            for file in action['files'].values():
                image=Image.open(OUT/file).convert('RGBA')
                for row in range(4):
                    frames=[image.crop((i*256,row*256,(i+1)*256,(row+1)*256)) for i in range(8)]
                    self.assertGreaterEqual(len({f.tobytes() for f in frames}),4,(file,row))
                    for frame in frames:
                        box=frame.getbbox();self.assertTrue(box and 0<box[0]<box[2]<256 and 0<box[1]<box[3]<256,(file,row,box))
                        self.assertLessEqual(set(frame.getchannel('A').get_flattened_data()),{0,255})

    def test_blinking_changes_eyes_without_moving_the_merchant(self):
        for name in ('mira','rowan','bram'):
            normal=Image.open(ROOT/f'web/public/assets/market/{name}.png').convert('RGBA')
            blink=Image.open(ROOT/f'web/public/assets/market/{name}-blink.png').convert('RGBA')
            self.assertEqual(normal.size,blink.size)
            self.assertEqual(normal.getchannel('A').tobytes(),blink.getchannel('A').tobytes())
            changed=[(x,y) for y in range(128) for x in range(128) if normal.getpixel((x,y))!=blink.getpixel((x,y))]
            self.assertTrue(changed)
            self.assertTrue(all(20<x<100 and 20<y<65 for x,y in changed),(name,changed))


if __name__=='__main__':unittest.main()

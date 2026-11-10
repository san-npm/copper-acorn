"""Check the ten local item assets and their publication manifest."""
import hashlib
import json
import unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/public/assets/items'


class ItemTests(unittest.TestCase):
    def test_all_items_are_distinct_transparent_pixel_art_with_matching_hashes(self):
        manifest=json.loads((OUT/'manifest.json').read_text())
        self.assertEqual(manifest['frameSize'],48)
        self.assertEqual({i['id'] for i in manifest['items']},{'sunleaf','moonmint','emberbloom','spring_water','wood_essence','silver_dust','healing_tonic','focus_draught','restoration_elixir','copper'})
        hashes=set();shapes=set()
        for entry in manifest['items']:
            path=OUT/entry['file'];image=Image.open(path).convert('RGBA')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),entry['sha256'])
            self.assertEqual(image.size,(48,48));self.assertLessEqual(set(image.getchannel('A').get_flattened_data()),{0,255})
            box=image.getbbox();self.assertTrue(box and min(box)>0 and max(box)<48)
            self.assertGreaterEqual(len({p for p in image.get_flattened_data() if p[3]}),4)
            hashes.add(entry['sha256']);shapes.add(image.getchannel('A').tobytes())
        self.assertEqual(len(hashes),10);self.assertGreaterEqual(len(shapes),7)


if __name__=='__main__':unittest.main()

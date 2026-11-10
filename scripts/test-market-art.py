"""Check the native 64px atlas, layout and exported assets without network requests."""

import hashlib
import json
from pathlib import Path
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets/market'
LAYOUT = json.loads((ASSETS / 'layout.json').read_text())


class MarketArtTests(unittest.TestCase):
    def test_atlas_frames_are_native_64px_and_have_no_smoothed_alpha(self):
        atlas = Image.open(ASSETS / 'tiles.png').convert('RGBA')
        self.assertEqual(LAYOUT['tileSize'], 64)
        self.assertEqual(LAYOUT['sourceScale'], 2)
        self.assertEqual(atlas.size, (8 * 64, ((len(LAYOUT['frames']) + 7) // 8) * 64))
        self.assertEqual(len(LAYOUT['frames']), len(set(LAYOUT['frames'])))
        self.assertEqual(set(atlas.getchannel('A').get_flattened_data()), {0, 255})
        for index, name in enumerate(LAYOUT['frames']):
            frame = atlas.crop((index % 8 * 64, index // 8 * 64, index % 8 * 64 + 64, index // 8 * 64 + 64))
            with self.subTest(frame=name):
                self.assertLessEqual(len({color for color in frame.get_flattened_data() if color[3]}), 64)

    def test_layout_covers_the_world_with_valid_frames_and_integer_pixel_positions(self):
        self.assertEqual(LAYOUT['worldSize'], [640, 400])
        self.assertEqual(len(LAYOUT['ground']), 13)
        self.assertTrue(all(len(row) == 20 for row in LAYOUT['ground']))
        for row in LAYOUT['ground']:
            for frame in row:
                self.assertIsInstance(frame, int)
                self.assertTrue(0 <= frame < len(LAYOUT['frames']))
                self.assertTrue(LAYOUT['frames'][frame].startswith(('grass-', 'cobble-')))
        for prop in LAYOUT['props']:
            self.assertIsInstance(prop['frame'], int)
            self.assertTrue(0 <= prop['frame'] < len(LAYOUT['frames']))
            for field in ('x', 'y', 'depth'): self.assertIsInstance(prop[field], int)
        self.assertTrue(any(prop['depth'] == 296 and LAYOUT['frames'][prop['frame']].startswith('essence-') for prop in LAYOUT['props']))

    def test_export_hashes_and_merchant_feet_remain_valid(self):
        manifest = json.loads((ASSETS / 'manifest.json').read_text())
        self.assertEqual(hashlib.sha256((ASSETS / 'layout.json').read_bytes()).hexdigest(), manifest['layout_sha256'])
        self.assertEqual(set(manifest['assets']), {'tiles.png', 'mira.png', 'rowan.png', 'bram.png'})
        for filename, entry in manifest['assets'].items():
            self.assertEqual(hashlib.sha256((ASSETS / filename).read_bytes()).hexdigest(), entry['sha256'])
            with Image.open(ASSETS / filename) as image:
                self.assertEqual(list(image.size), entry['size'])
                if filename != 'tiles.png':
                    self.assertEqual(image.size, (128, 128))
                    self.assertEqual(image.getbbox()[3], 124)


if __name__ == '__main__': unittest.main()

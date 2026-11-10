"""The Liche's crown wraps the skull, shines in every view and preserves the face."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('actions', ROOT/'scripts/build-mana-action-review.py')
ACTIONS = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ACTIONS)
ART = ACTIONS.ART


class HeaddressTests(unittest.TestCase):
    def test_crown_coverage_shine_and_profile_silhouette(self):
        poses = {tuple(p) for action in ACTIONS.ACTIONS.values() for p in action['poses']}
        bones = {ART.rgba(c) for c in ART.STYLES['skeleton'][0].split()}
        for direction in ART.DIRECTIONS:
            for frame, pose in [*((f, None) for f in range(7)), *((0, p) for p in poses)]:
                with self.subTest(direction=direction, frame=frame, pose=pose):
                    body = ART.cell('char_a_p1_0bas_humn_v01.png', direction, frame, pose)
                    head = ART.cell('4har/char_a_p1_4har_dap1_v01.png', direction, frame, pose).getbbox() if pose else body.crop((0,0,64,27)).getbbox()
                    cx, top = (head[0]+head[2])//2, head[1]+(3 if pose else 0)
                    actor = ART.native_actor('skeleton', direction, frame, pose)
                    self.assertNotIn(actor.getpixel((cx,top+1)), bones)
                    self.assertEqual(actor.getpixel((cx,top+1))[3], 255)
                    highlights = sum(actor.getpixel((x,y)) == ART.rgba('#fff4c9') for x in range(64) for y in range(top-5,top+15))
                    self.assertGreaterEqual(highlights, 3)
                    self.assertEqual(actor.getbbox()[3], body.getbbox()[3])
                    if direction != 'north':
                        self.assertIn(ART.rgba('#85c2ba'), actor.crop((cx-5,top+7,cx+6,top+11)).get_flattened_data())
                    if not pose and direction in ('west','east'):
                        front = -1 if direction == 'west' else 1
                        self.assertEqual(actor.getpixel((cx+front*8,top+9))[3], 0)


if __name__ == '__main__':
    unittest.main()

"""Directional cloaks cover the rear torso without hiding the front arm or moving the feet."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('actions', ROOT/'scripts/build-mana-action-review.py')
ACTIONS = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ACTIONS)
ART = ACTIONS.ART


class CapeTests(unittest.TestCase):
    def check_back(self, kind, frame=0, pose=None):
        body = ART.cell('char_a_p1_0bas_humn_v01.png', 'north', frame, pose)
        outfit = ART.cell('1out/char_a_p1_1out_fstr_v01.png', 'north', frame, pose)
        if pose:
            head = ART.cell('4har/char_a_p1_4har_dap1_v01.png', 'north', frame, pose).getbbox()
            top = head[1]+3
        else:
            head = body.crop((0, 0, 64, 27)).getbbox()
            top = head[1]
        center = (head[0]+head[2])//2
        actor = ART.native_actor(kind, 'north', frame, pose)
        cloth = {ART.rgba(c) for c in ART.STYLES[kind][1].split()}
        self.assertIn(actor.getpixel((center, min(top+19, body.getbbox()[3]-4))), cloth)
        self.assertEqual(actor.getbbox()[3], body.getbbox()[3])
        skin = ART.STYLES[kind][0]
        expected = ART.recolor(body, ART.SKIN, skin.split()) if skin else body
        for y in range(top+17, 64):
            for x in range(64):
                if body.getpixel((x,y))[3] and not outfit.getpixel((x,y))[3]:
                    self.assertEqual(actor.getpixel((x,y)), expected.getpixel((x,y)))

    def test_idle_and_walk_capes_cover_the_back(self):
        for kind in ('magician', 'skeleton', 'vampire'):
            for frame in range(7):
                with self.subTest(kind=kind, frame=frame):
                    self.check_back(kind, frame)

    def test_action_capes_keep_the_back_covered_and_hands_free(self):
        poses = {tuple(p) for action in ACTIONS.ACTIONS.values() for p in action['poses']}
        for kind in ('magician', 'skeleton', 'vampire'):
            for pose in poses:
                with self.subTest(kind=kind, pose=pose):
                    self.check_back(kind, pose=pose)

    def test_profile_capes_cover_the_rear_half_and_leave_the_front_arm_free(self):
        poses = {tuple(p) for action in ACTIONS.ACTIONS.values() for p in action['poses']}
        for kind in ('magician', 'skeleton', 'vampire'):
            for direction, facing in (('west', -1), ('east', 1)):
                for frame, pose in [*((f, None) for f in range(7)), *((0, p) for p in poses)]:
                    with self.subTest(kind=kind, direction=direction, frame=frame, pose=pose):
                        body = ART.cell('char_a_p1_0bas_humn_v01.png', direction, frame, pose)
                        head = ART.cell('4har/char_a_p1_4har_dap1_v01.png', direction, frame, pose).getbbox() if pose else body.crop((0, 0, 64, 27)).getbbox()
                        center, top = (head[0]+head[2])//2, head[1]+(3 if pose else 0)
                        actor = ART.native_actor(kind, direction, frame, pose)
                        cloth = {ART.rgba(c) for c in ART.STYLES[kind][1].split()}
                        self.assertIn(actor.getpixel((center-facing*3, min(top+19, body.getbbox()[3]-4))), cloth)
                        skin, colors, _ = ART.STYLES[kind]
                        original = ART.recolor(body, ART.SKIN, skin.split()) if skin else body.copy()
                        outfit = ART.cell('1out/char_a_p1_1out_fstr_v01.png', direction, frame, pose)
                        for old, new in [(ART.SHIRT, colors.split()), (ART.VEST, ('#715342', '#bd9a67')), (ART.PANTS, ('#3d3540', '#645763', '#978179'))]:
                            outfit = ART.recolor(outfit, old, new)
                        original.alpha_composite(outfit)
                        for y in range(top+17, 64):
                            for x in range(64):
                                if (x-center)*facing >= 0:
                                    expected = original.getpixel((x,y))
                                    actual = actor.getpixel((x,y))
                                    self.assertEqual(actual[3], expected[3])
                                    if expected[3]:
                                        self.assertEqual(actual, expected)
                        self.assertEqual(actor.getbbox()[3], body.getbbox()[3])


if __name__ == '__main__':
    unittest.main()

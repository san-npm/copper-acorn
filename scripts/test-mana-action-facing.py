"""Check physical facing from the source eye pixels, independently of direction labels."""
from pathlib import Path
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('actions',ROOT/'scripts/build-mana-action-review.py')
REVIEW=importlib.util.module_from_spec(spec);spec.loader.exec_module(REVIEW)
ART=REVIEW.ART


class FacingTests(unittest.TestCase):
    def test_profile_eyes_point_toward_the_selected_side(self):
        for direction,sign in [('west',-1),('east',1)]:
            with self.subTest(direction=direction):
                body=ART.cell('char_a_p1_0bas_humn_v01.png',direction)
                hair=ART.cell('4har/char_a_p1_4har_dap1_v01.png',direction).getbbox()
                eyes=[x for y in range(12,28) for x in range(64) if body.getpixel((x,y))==(248,240,224,255)]
                self.assertEqual(len(eyes),2)
                self.assertGreater((sum(eyes)/len(eyes)-(hair[0]+hair[2])/2)*sign,0)

    def test_every_resource_is_in_front_of_the_character(self):
        for action in REVIEW.ACTIONS:
            for direction,(dx,dy) in REVIEW.VECTORS.items():
                with self.subTest(action=action,direction=direction):
                    x,y=REVIEW.resource_point(action,direction)
                    self.assertGreater((x-32)*dx+(y-44)*dy,0)

    def test_water_collection_faces_the_pond_while_filling(self):
        for direction in ('west','east'):
            with self.subTest(direction=direction):
                pose=REVIEW.ACTIONS['water']['poses'][3]
                body=ART.cell('char_a_p1_0bas_humn_v01.png',direction,pose=pose)
                head=ART.cell('4har/char_a_p1_4har_dap1_v01.png',direction,pose=pose).getbbox()
                eyes=[x for y in range(64) for x in range(64) if body.getpixel((x,y))==(248,240,224,255)]
                self.assertTrue(eyes)
                center=(head[0]+head[2])/2
                self.assertGreater((sum(eyes)/len(eyes)-center)*(REVIEW.resource_point('water',direction)[0]-center),0)

    def test_visible_palm_anchors_match_exposed_source_skin(self):
        for direction in ('south','west','east'):
            for column,hand in enumerate(REVIEW.HANDS[direction]):
                with self.subTest(direction=direction,column=column):
                    body=ART.cell('char_a_p1_0bas_humn_v01.png',direction,pose=('p1',column,0))
                    body.alpha_composite(ART.cell('1out/char_a_p1_1out_fstr_v01.png',direction,pose=('p1',column,0)))
                    self.assertIn(body.getpixel(hand),{ART.rgba(c) for c in ART.SKIN})

    def test_filling_bottle_is_held_by_the_hand_and_touches_water(self):
        for direction in ART.DIRECTIONS:
            with self.subTest(direction=direction):
                x,y=REVIEW.grip(direction,REVIEW.ACTIONS['water']['poses'][3])
                effects=REVIEW.effects('water',direction,3)
                self.assertEqual(effects.getpixel(REVIEW.point((x,y))),ART.rgba('#d6ba80'))
                cx,cy=REVIEW.resource_point('water',direction)
                self.assertLessEqual(((x-cx)/16)**2+((y+8-(cy-8))/8)**2,1)


if __name__=='__main__':unittest.main()

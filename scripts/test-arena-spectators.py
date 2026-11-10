"""Seated poses retain accepted heads and fit the shared sprite anchor."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('art',Path(__file__).with_name('build-mana-character-review.py'))
ART=importlib.util.module_from_spec(spec);spec.loader.exec_module(ART)

class SeatedSpectators(unittest.TestCase):
    def test_all_eight_seats_keep_heads_and_have_bent_legs(self):
        for kind,_ in ART.ROSTER:
            with self.subTest(kind=kind):
                seated=ART.seated_actor(kind)
                self.assertEqual(seated.getbbox()[3],124)
                self.assertEqual(seated.size,(128,128))
                # The top stays unchanged; the lower silhouette has a gap between hanging boots.
                original=ART.actor(kind,'south')
                self.assertEqual(seated.crop((0,3,128,78)).tobytes(),original.crop((0,0,128,75)).tobytes())
                self.assertNotEqual(seated.tobytes(),original.tobytes())
                self.assertEqual(seated.getpixel((64,121))[3],0)
                self.assertGreater(seated.getchannel('A').getbbox()[2]-seated.getchannel('A').getbbox()[0],20)

if __name__=='__main__':unittest.main()

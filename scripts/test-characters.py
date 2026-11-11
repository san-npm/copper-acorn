"""Check the current compact actors and preserve the original source archive, offline."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('art',ROOT/'scripts/build-characters.py')
ART=importlib.util.module_from_spec(spec);spec.loader.exec_module(ART)


class ActorTests(unittest.TestCase):
    def test_original_source_archive_is_unchanged(self):
        provenance=json.loads((ART.SOURCE/'provenance.json').read_text())
        self.assertEqual(len(provenance['source_sha256']),32)
        for name,digest in provenance['source_sha256'].items():
            self.assertEqual(hashlib.sha256((ART.SOURCE/name).read_bytes()).hexdigest(),digest)

    def test_all_224_approved_frames_fit_the_runtime_grid_and_baseline(self):
        manifest=json.loads((ART.OUTPUT/'manifest.json').read_text())
        self.assertEqual((manifest['frameSize'],manifest['anchor']),(128,[64,124]))
        self.assertEqual([c['id'] for c in manifest['characters']],[c[0] for c in ART.ROSTER])
        for entry in manifest['characters']:
            path=ART.OUTPUT/entry['file'];sheet=Image.open(path).convert('RGBA')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),entry['sha256'])
            self.assertEqual(sheet.size,(896,512))
            for row in range(4):
                for col in range(7):
                    frame=sheet.crop((col*128,row*128,col*128+128,row*128+128))
                    with self.subTest(character=entry['id'],row=row,col=col):
                        self.assertGreater(frame.getbbox()[1],0);self.assertEqual(frame.getbbox()[3],124)
                        self.assertGreater(frame.getbbox()[0],0);self.assertLess(frame.getbbox()[2],128)
                        self.assertLessEqual(set(frame.getchannel('A').get_flattened_data()),{0,255})

    def test_front_back_and_six_walking_poses_are_distinct(self):
        for kind,_,_ in ART.ROSTER:
            sheet=Image.open(ART.OUTPUT/(kind+'.png')).convert('RGBA')
            self.assertEqual(len({sheet.crop((0,row*128,128,(row+1)*128)).tobytes() for row in range(4)}),4)
            for row in range(4):
                self.assertEqual(len({sheet.crop((col*128,row*128,(col+1)*128,(row+1)*128)).tobytes() for col in range(7)}),7)

    def test_every_published_character_and_action_file_matches_the_approved_set(self):
        approved=json.loads((ROOT/'deploy/approved-art.json').read_text())['files']
        self.assertEqual(len(approved),70)
        for file,digest in approved.items():
            self.assertEqual(hashlib.sha256((ROOT/'web/public'/file).read_bytes()).hexdigest(),digest,file)

    def test_retired_redraws_cannot_silently_overwrite_the_approved_designs(self):
        for script in ('build-characters.py','build-original-actions.py'):
            result=subprocess.run([sys.executable,str(ROOT/'scripts'/script)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('Approved artwork is pinned',result.stderr)

    def test_all_three_merchants_share_the_player_frame_and_height(self):
        for name in ('mira','rowan','bram'):
            image=Image.open(ROOT/f'web/public/assets/market/{name}.png')
            self.assertEqual(image.size,(128,128));self.assertEqual(image.getbbox()[1:4:2],(12,124))


if __name__=='__main__':unittest.main()

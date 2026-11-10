"""Check the current compact actors and preserve the original source archive, offline."""
import hashlib
import importlib.util
import json
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

    def test_all_224_exported_frames_fit_the_same_height_and_baseline(self):
        manifest=json.loads((ART.OUTPUT/'manifest.json').read_text())
        self.assertEqual((manifest['frameSize'],manifest['opaqueHeight'],manifest['anchor']),(128,112,[64,124]))
        self.assertEqual([c['id'] for c in manifest['characters']],[c[0] for c in ART.ROSTER])
        for entry in manifest['characters']:
            path=ART.OUTPUT/entry['file'];sheet=Image.open(path).convert('RGBA')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),entry['sha256'])
            self.assertEqual(sheet.size,(896,512))
            for row in range(4):
                for col in range(7):
                    frame=sheet.crop((col*128,row*128,col*128+128,row*128+128))
                    with self.subTest(character=entry['id'],row=row,col=col):
                        self.assertEqual(frame.getbbox()[1:4:2],(12,124))
                        self.assertGreater(frame.getbbox()[0],0);self.assertLess(frame.getbbox()[2],128)
                        self.assertLessEqual(set(frame.getchannel('A').get_flattened_data()),{0,255})
                        self.assertIn((56,42,58,255),frame.get_flattened_data())
                        self.assertLess(len({p for p in frame.get_flattened_data() if p[3]}),64)

    def test_front_back_and_six_walking_poses_are_distinct(self):
        for kind,_,_ in ART.ROSTER:
            self.assertEqual(len({ART.tactics_actor(kind,d).tobytes() for d in ART.DIRECTIONS}),4)
            for direction in ART.DIRECTIONS:
                self.assertEqual(len({ART.tactics_actor(kind,direction,frame).tobytes() for frame in range(7)}),7)

    def test_heads_leave_room_for_the_body_and_working_arms(self):
        for kind,_,_ in ART.ROSTER:
            for direction in ART.DIRECTIONS:
                image=ART.tactics_actor(kind,direction)
                head=sum(bool(p[3]) for p in image.crop((0,0,64,35)).get_flattened_data())
                body=sum(bool(p[3]) for p in image.crop((0,35,64,64)).get_flattened_data())
                self.assertGreater(head/(head+body),.25)
                self.assertLess(head/(head+body),.60)

    def test_species_costume_markers_survive_all_views_and_walks(self):
        markers={'goblin':'#b44353','magician':'#686399','skeleton':'#2e626f','lizard':'#5b9c83','dark-elf':'#665573'}
        for kind,color in markers.items():
            for direction in ART.DIRECTIONS:
                for frame in range(7):
                    self.assertTrue((*ART.rgb(color),255) in ART.tactics_actor(kind,direction,frame).get_flattened_data(),(kind,direction,frame))

    def test_all_three_merchants_share_the_player_frame_and_height(self):
        for name in ('mira','rowan','bram'):
            image=Image.open(ROOT/f'web/public/assets/market/{name}.png')
            self.assertEqual(image.size,(128,128));self.assertEqual(image.getbbox()[1:4:2],(12,124))


if __name__=='__main__':unittest.main()

import base64,io,sys,unittest
from copy import deepcopy
from pathlib import Path
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
from architectural_grounding import grounded_scene

class GroundingTests(unittest.TestCase):
    def fixture(self):
        image=Image.new('RGB',(1000,760),'white');d=ImageDraw.Draw(image)
        d.line([(120,120),(840,120),(840,600),(120,600),(120,120)],fill='black',width=18)
        d.line([(325,120),(505,120)],fill='white',width=20)
        d.line([(325,116),(505,116)],fill='blue',width=3);d.line([(325,124),(505,124)],fill='blue',width=3)
        d.line([(120,455),(120,565)],fill='white',width=20)
        out=io.BytesIO();image.save(out,format='PNG')
        raw={'building':[110,144,847,797],'walls':[{'start':[110,144],'end':[110,797],'exterior':True},{'start':[110,797],'end':[847,797],'exterior':True},{'start':[847,144],'end':[847,797],'exterior':True},{'start':[110,144],'end':[847,144],'exterior':True}],'windows':[{'box':[310,144,500,170]}],'doors':[{'box':[110,580,230,797]}],'furniture':[{'kind':'sofa','box':[155,200,255,520]},{'kind':'table','box':[320,390,460,520]}]}
        return raw,base64.b64encode(out.getvalue()).decode()

    def test_raster_walls_and_gaps_calibrate_to_owner_dimensions(self):
        raw,image=self.fixture();s=grounded_scene(raw,{'width':6,'depth':4,'height':3},image)
        self.assertEqual((s['width'],s['depth'],s['height']),(6,4,3))
        self.assertEqual(len(s['walls']),4);self.assertEqual(len(s['openings']),2)
        door=next(o for o in s['openings'] if o['kind']=='door')
        window=next(o for o in s['openings'] if o['kind']=='window')
        self.assertEqual(door['wallId'],'w1');self.assertEqual(window['wallId'],'w4')
        self.assertEqual(door['bottom'],0);self.assertAlmostEqual(door['width'],110/120,delta=.03)
        self.assertAlmostEqual(window['width'],180/120,delta=.03)
        self.assertAlmostEqual(s['walls'][0]['thickness'],.15,delta=.02)
        self.assertLess(s['furniture'][0]['position'][0],1.1)

    def test_repeated_objects_are_deduplicated_without_inventing_any(self):
        raw,image=self.fixture();raw['furniture']*=3
        self.assertEqual(len(grounded_scene(raw,{'width':6,'depth':4,'height':3},image)['furniture']),2)

    def test_open_exterior_cannot_be_replaced_by_a_fabricated_rectangle(self):
        raw,image=self.fixture();raw['walls'].pop()
        with self.assertRaises(ValueError):grounded_scene(raw,{'width':6,'depth':4,'height':3},image)

    def test_nonfinite_outside_and_unknown_objects_are_rejected(self):
        raw,image=self.fixture()
        for box in [[0,0,2000,1000],[float('nan'),1,5,6]]:
            bad=deepcopy(raw);bad['furniture'][0]['box']=box
            with self.assertRaises(ValueError):grounded_scene(bad,{'width':6,'depth':4,'height':3},image)
        bad=deepcopy(raw);bad['furniture'][0]['kind']='code'
        with self.assertRaises(ValueError):grounded_scene(bad,{'width':6,'depth':4,'height':3},image)

    def test_unseen_window_cannot_cut_a_solid_raster_wall(self):
        raw,image=self.fixture();raw['windows']=[{'box':[830,300,850,500]}]
        with self.assertRaises(ValueError):grounded_scene(raw,{'width':6,'depth':4,'height':3},image)

    def test_missing_internal_partition_is_not_published_as_an_empty_room(self):
        raw,encoded=self.fixture();image=Image.open(io.BytesIO(base64.b64decode(encoded)))
        ImageDraw.Draw(image).line([(480,120),(480,600)],fill='black',width=12)
        out=io.BytesIO();image.save(out,format='PNG')
        with self.assertRaises(ValueError):grounded_scene(raw,{'width':6,'depth':4,'height':3},base64.b64encode(out.getvalue()).decode())

    def test_concave_footprint_keeps_its_actual_six_corners(self):
        image=Image.new('RGB',(1000,760),'white');corners=[(100,100),(900,100),(900,400),(500,400),(500,700),(100,700)]
        ImageDraw.Draw(image).line(corners+[corners[0]],fill='black',width=12)
        out=io.BytesIO();image.save(out,format='PNG')
        p=lambda v:[v[0],v[1]*1000/760]
        raw={'building':[94,94*1000/760,906,706*1000/760],'walls':[{'start':p(corners[i]),'end':p(corners[(i+1)%6]),'exterior':True} for i in range(6)],'windows':[],'doors':[],'furniture':[]}
        s=grounded_scene(raw,{'width':8,'depth':6,'height':3},base64.b64encode(out.getvalue()).decode())
        self.assertEqual(len(s['floors'][0]['points']),6)

    def test_diagonal_walls_cannot_be_invented_on_a_blank_plan(self):
        image=Image.new('RGB',(1000,760),'white');out=io.BytesIO();image.save(out,format='PNG')
        points=[[100,100],[900,300],[500,900]]
        raw={'building':[100,100,900,900],'walls':[{'start':points[i],'end':points[(i+1)%3],'exterior':True} for i in range(3)],'windows':[],'doors':[],'furniture':[]}
        with self.assertRaises(ValueError):grounded_scene(raw,{'width':8,'depth':6,'height':3},base64.b64encode(out.getvalue()).decode())

    def test_light_gray_plan_strokes_are_supported(self):
        image=Image.new('RGB',(1000,760),(255,255,255));d=ImageDraw.Draw(image)
        d.rectangle([120,120,840,600],fill=(236,236,236))
        d.line([(120,120),(840,120),(840,600),(120,600),(120,120)],fill=(170,170,170),width=14)
        d.line([(325,120),(505,120)],fill=(236,236,236),width=16)
        d.line([(120,455),(120,565)],fill=(236,236,236),width=16)
        out=io.BytesIO();image.save(out,format='PNG')
        raw={'building':[110,144,847,797],'walls':[{'start':[110,144],'end':[110,797],'exterior':True},{'start':[110,797],'end':[847,797],'exterior':True},{'start':[847,144],'end':[847,797],'exterior':True},{'start':[110,144],'end':[847,144],'exterior':True}],'windows':[{'box':[310,144,500,170]}],'doors':[{'box':[110,580,230,797]}],'furniture':[]}
        s=grounded_scene(raw,{'width':6,'depth':4,'height':3},base64.b64encode(out.getvalue()).decode())
        self.assertEqual(len(s['walls']),4);self.assertEqual(len(s['openings']),2)

    def test_opening_observation_must_touch_the_wall_it_describes(self):
        raw,image=self.fixture();raw['windows']=[{'box':[350,300,450,400]}]
        with self.assertRaises(ValueError):grounded_scene(raw,{'width':6,'depth':4,'height':3},image)

if __name__=='__main__':unittest.main()

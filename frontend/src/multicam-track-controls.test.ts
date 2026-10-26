import {describe,expect,it} from 'vitest';
import {deleteCameraTrack} from './multicam-track-controls';
import {emptyObservation,type Domain} from './types';

function fixture():Domain{
 return {identities:{shared:{id:'shared',person_id:1,name:'Track 1'},other:{id:'other',person_id:2,name:'Track 2'}},segments:{a:{id:'a',video_id:'camera-a',identity_uuid:'shared',start:0,end:null,status:'verified'},b:{id:'b',video_id:'camera-b',identity_uuid:'shared',start:0,end:null,status:'verified'}},observations:{one:{...emptyObservation('camera-a',0,'shared','a'),id:'one',person_visible:[1,2,3,4]},two:{...emptyObservation('camera-b',0,'shared','b'),id:'two',person_visible:[11,12,13,14]}},intervals:{gap:{id:'gap',video_id:'camera-a',identity_uuid:'shared',start:2,end:4,reason:'occlusion',evidence_note:''}},links:{link:{id:'link',source:'shared',target:'other',relation:'same',evidence_note:''}},reviews:{},proposal_reviews:{}};
}
describe('camera-scoped track deletion',()=>{
 it('keeps the other camera geometry and identity links when an older track UUID spans videos',()=>{const domain=fixture(),other=structuredClone(domain.observations.two),identity=structuredClone(domain.identities.shared),link=structuredClone(domain.links.link);expect(deleteCameraTrack(domain,'camera-a','shared')).toBe(1);expect(domain.observations.one).toBeUndefined();expect(domain.segments.a).toBeUndefined();expect(domain.intervals.gap).toBeUndefined();expect(domain.observations.two).toEqual(other);expect(domain.identities.shared).toEqual(identity);expect(domain.links.link).toEqual(link);});
 it('removes the identity and its links only after its last camera track is removed',()=>{const domain=fixture();deleteCameraTrack(domain,'camera-a','shared');deleteCameraTrack(domain,'camera-b','shared');expect(domain.observations).toEqual({});expect(domain.segments).toEqual({});expect(domain.identities.shared).toBeUndefined();expect(domain.links.link).toBeUndefined();expect(domain.identities.other.person_id).toBe(2);});
 it('rejects a stale or wrong-camera selection before changing annotation data',()=>{const domain=fixture(),before=structuredClone(domain);expect(()=>deleteCameraTrack(domain,'camera-c','shared')).toThrow('not in this camera');expect(()=>deleteCameraTrack(domain,'camera-a','missing')).toThrow('no longer exists');expect(domain).toEqual(before);});
});

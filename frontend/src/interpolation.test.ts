import {describe,it,expect} from 'vitest';
import {interpolatePerson,markCorrected} from './interpolation';
import {type Domain,emptyObservation} from './types';
function setup(){
 const d:Domain={identities:{p:{id:'p',person_id:null,name:'Person'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 const add=(frame:number,x:number)=>{const o=emptyObservation('v',frame,'p','s');o.person_visible=[x,20,x+50,100];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;return o};
 const a=add(1,10),b=add(10,100);const at=(f:number)=>Object.values(d.observations).find(o=>o.frame_index===f)!;
 return {d,a,b,at,add};
}
describe('visible-person keyframes',()=>{
 it('fills only interior frames as visible-only drafts',()=>{const {d,at}=setup();expect(interpolatePerson(d,'v','p')).toBe(8);expect(Object.values(d.observations)).toHaveLength(10);expect(at(5).person_visible).toEqual([50,20,100,100]);expect(at(5).person_ext).toBeNull();expect(at(5).review_state).toBe('draft');expect(at(0)).toBeUndefined();expect(at(11)).toBeUndefined();expect(d.reviews).toEqual({});});
 it('uses source timestamps and falls back for incomplete ledgers',()=>{const {d,at}=setup();const times=[0,1,2,3,4,6,7,8,9,10,11];interpolatePerson(d,'v','p',times);expect(at(5).person_visible![0]).toBe(55);interpolatePerson(d,'v','p',[0,1]);expect(at(5).person_visible![0]).toBe(50);});
 it('a corrected intermediate frame splits interpolation and retains stable IDs',()=>{const {d,at}=setup();interpolatePerson(d,'v','p');const id=at(3).id;markCorrected(at(5));at(5).person_visible=[90,20,140,100];interpolatePerson(d,'v','p',[],5);expect(at(3).id).toBe(id);expect(at(3).person_visible![0]).toBe(50);expect(at(7).person_visible![0]).toBe(94);expect(at(5).person_visible![0]).toBe(90);});
 it('preserves approved frames and does not regenerate unrelated spans',()=>{const {d,a,at,add}=setup();add(20,200);interpolatePerson(d,'v','p');at(5).review_state='approved';const saved=structuredClone(at(5)),far=structuredClone(at(15));a.person_visible=[20,20,70,100];interpolatePerson(d,'v','p',[],1);expect(at(5)).toEqual(saved);expect(at(15)).toEqual(far);});
 it('respects identity, video, gaps, and segment boundaries',()=>{for(const mode of ['identity','video','gap','segment','unresolved']){const {d,b}=setup();if(mode==='identity')b.identity_uuid='other';if(mode==='video')b.video_id='other';if(mode==='gap')d.intervals.g={id:'g',video_id:'v',identity_uuid:'p',start:5,end:6,reason:'occlusion',evidence_note:''};if(mode==='segment')b.segment_id='other';if(mode==='unresolved')d.segments.s.status='unresolved';expect(interpolatePerson(d,'v','p')).toBe(0);}});
 it('a deleted visible box is a barrier and is not recreated',()=>{const {d,at}=setup();interpolatePerson(d,'v','p');markCorrected(at(5));at(5).person_visible=null;expect(interpolatePerson(d,'v','p')).toBe(0);expect(at(5).person_visible).toBeNull();});
});

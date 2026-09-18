import {describe,it,expect} from 'vitest';
import {assignPerson} from './identity';
import {interpolatePerson} from './interpolation';
import {type Domain,emptyObservation} from './types';
function setup(){
 const d:Domain={identities:{old:{id:'old',person_id:7,name:'Person'},new:{id:'new',person_id:null,name:'Draft'}},segments:{s:{id:'s',identity_uuid:'old',video_id:'v',start:40,end:null,status:'verified'},t:{id:'t',identity_uuid:'new',video_id:'v',start:20,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const [who,frame,x,seg] of [['old',40,100,'s'],['new',20,20,'t']] as const){const o=emptyObservation('v',frame,who,seg);o.person_visible=[x,20,x+50,100];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;}
 return d;
}
describe('reuse person ID',()=>{
 it('joins earlier and later keyframes and fills their interior',()=>{const d=setup();assignPerson(d,'new','old','v',20,7,'Worker','#FF7700');expect(Object.keys(d.identities)).toEqual(['old']);expect(d.identities.old).toMatchObject({person_id:7,class_name:'Worker',color:'#ff7700'});expect(Object.keys(d.segments)).toHaveLength(1);expect(interpolatePerson(d,'v','old',[],20)).toBe(19);expect(Object.values(d.observations).find(o=>o.frame_index===30)?.person_visible).toEqual([60,20,110,100]);});
 it('permits choosing an ID before drawing and extends its first span',()=>{const d=setup();d.observations={};delete d.segments.t;assignPerson(d,'new','old','v',20,7,'person_visible','#123456');expect(d.segments.s.start).toBe(20);});
 it('rejects overlapping boxes before changing anything',()=>{const d=setup();Object.values(d.observations).forEach(o=>o.frame_index=40);const before=structuredClone(d);expect(()=>assignPerson(d,'new','old','v',40,7,'person_visible','#123456')).toThrow('same frame');expect(d).toEqual(before);});
 it('preserves explicit gaps and separate visible spans',()=>{const d=setup();d.segments.t.end=24;d.intervals.g={id:'g',video_id:'v',identity_uuid:'old',start:25,end:39,reason:'occlusion',evidence_note:''};assignPerson(d,'new','old','v',20,7,'person_visible','#123456');expect(Object.keys(d.segments)).toHaveLength(2);expect(interpolatePerson(d,'v','old')).toBe(0);});
 it('does not override an explicit different-person decision',()=>{const d=setup();d.links.l={id:'l',source:'old',target:'new',relation:'different',evidence_note:'Different clothing'};expect(()=>assignPerson(d,'new','old','v',20,7,'person_visible','#123456')).toThrow('marked different');});
});

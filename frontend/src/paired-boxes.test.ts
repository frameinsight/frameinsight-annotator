import {describe,it,expect} from 'vitest';
import {assignPerson} from './identity';
import {interpolatePerson,markCorrected} from './interpolation';
import {deleteGeometryRange,prepareGeometryFrame} from './hidden-range';
import {type Domain,type Geometry,type Video,emptyObservation,validateDomain} from './types';
const videos={v:{id:'v',frame_count:24,width:640,height:360} as Video};
function setup(){
 const d:Domain={identities:{p:{id:'p',person_id:1,name:'Person 1',class_name:'person_visible'},q:{id:'q',person_id:null,name:'Legacy extended',class_name:'person_extended',color:'#123456'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:null,status:'verified'},t:{id:'t',identity_uuid:'q',video_id:'v',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 const add=(f:number,g:Geometry,who='p',x=100+f)=>{const o=Object.values(d.observations).find(o=>o.identity_uuid===who&&o.frame_index===f)||emptyObservation('v',f,who,who==='p'?'s':'t');o[g]=[x,20,x+50,200];o.provenance[g]={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;return o;};
 const at=(f:number)=>Object.values(d.observations).find(o=>o.identity_uuid==='p'&&o.frame_index===f)!;
 return {d,add,at};
}
describe('paired boxes under one identity',()=>{
 it('interpolates different keyframes independently and preserves corrections to the other type',()=>{
  const {d,add,at}=setup();add(0,'person_visible');add(20,'person_visible');interpolatePerson(d,'v','p');
  add(3,'person_ext');add(13,'person_ext');interpolatePerson(d,'v','p',[],undefined,'person_ext');
  const visible=at(8).person_visible!.slice(),visibleProvenance={...at(8).provenance.person_visible};
  markCorrected(at(8),'person_ext');at(8).person_ext=[150,20,200,200];interpolatePerson(d,'v','p',[],8,'person_ext');
  expect(at(8).person_visible).toEqual(visible);expect(at(8).provenance.person_visible).toEqual(visibleProvenance);
  expect(at(6).person_ext![0]).toBeCloseTo(131.2);expect(at(2).person_ext).toBeNull();
  const corrected=at(8).person_ext!.slice();add(10,'person_visible','p',200);interpolatePerson(d,'v','p',[],10,'person_visible');expect(at(8).person_ext).toEqual(corrected);validateDomain(d,videos);
 });
 it('deleting and redrawing visible boxes leaves extended boxes intact and does not refill the gap',()=>{
  const {d,add,at}=setup();for(const g of ['person_visible','person_ext'] as Geometry[]){add(0,g);add(20,g);interpolatePerson(d,'v','p',[],undefined,g);}
  const ext=structuredClone(at(10).person_ext);deleteGeometryRange(d,'v','p',8,12,24,'person_visible');
  expect(at(10).person_visible).toBeNull();expect(at(10).person_ext).toEqual(ext);
  interpolatePerson(d,'v','p',[],undefined,false);expect(at(10).person_visible).toBeNull();
  prepareGeometryFrame(d,'v','p',10,'person_visible');add(10,'person_visible');interpolatePerson(d,'v','p');
  expect(at(9).person_visible).toBeNull();expect(at(11).person_visible).toBeNull();expect(at(10).person_ext).toEqual(ext);validateDomain(d,videos);
 });
 it('joins legacy extended and visible boxes on the same frames without changing either rectangle',()=>{
  const {d,add,at}=setup();const v=add(5,'person_visible'),e=add(5,'person_visible','q',80);const boxes=[v.person_visible,e.person_visible];
  assignPerson(d,'q','p','v',5,1,'person_extended','#123456','person_ext');
  expect(Object.keys(d.identities)).toEqual(['p']);expect(Object.keys(d.observations)).toHaveLength(1);
  expect(at(5).person_visible).toEqual(boxes[0]);expect(at(5).person_ext).toEqual(boxes[1]);
  expect(d.identities.p.class_name).toBe('person_visible');expect(d.identities.p.box_styles?.person_ext).toEqual({class_name:'person_extended',color:'#123456'});validateDomain(d,videos);
 });
 it('rejects collisions of the same type atomically, including after legacy conversion',()=>{
  const {d,add}=setup();add(5,'person_ext');add(5,'person_visible','q');const before=structuredClone(d);
  expect(()=>assignPerson(d,'q','p','v',5,1,'person_extended','#123456','person_ext')).toThrow('same box type');expect(d).toEqual(before);
 });
 it('keeps a visible gap when linking an extended track spanning it',()=>{
  const {d,add,at}=setup();add(0,'person_visible');add(20,'person_visible');interpolatePerson(d,'v','p');deleteGeometryRange(d,'v','p',8,12,24,'person_visible');
  add(10,'person_visible','q');assignPerson(d,'q','p','v',10,1,'person_extended','#123456','person_ext');
  expect(at(10).person_ext).not.toBeNull();expect(at(10).person_visible).toBeNull();validateDomain(d,videos);
 });
});

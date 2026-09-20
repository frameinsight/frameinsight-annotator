import {describe,it,expect} from 'vitest';
import {copyVisibleToExtended,COPY_COLORS} from './copy-visible';
import {interpolatePerson} from './interpolation';
import {deleteGeometryRange} from './hidden-range';
import {emptyObservation,validateDomain,type Domain,type Video} from './types';

function setup(){
 const d:Domain={identities:{p:{id:'p',person_id:7,name:'Person 7',class_name:'person_visible'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const f of [0,10]){const o=emptyObservation('v',f,'p','s');o.person_visible=[100+f,80,180+f,240];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;}
 interpolatePerson(d,'v','p');
 return {d,at:(f:number)=>Object.values(d.observations).find(o=>o.frame_index===f)!};
}
describe('copy Visible to Extended',()=>{
 it('copies an interpolated visible box without promoting or changing it, retaining the ID',()=>{
  const {d,at}=setup(),before=structuredClone(d);copyVisibleToExtended(d,'v','p',5);
  expect(Object.keys(d.identities)).toEqual(['p']);expect(d.identities.p.person_id).toBe(7);
  expect(at(5).person_ext).toEqual(at(5).person_visible);expect(at(5).person_ext).not.toBe(at(5).person_visible);
  expect(at(5).geometry_link).toBe('independent');expect(at(5).full_quality).toBe('estimated');
  expect(at(5).provenance.person_ext?.origin).toBe('copied');
  for(const row of Object.values(d.observations)){expect(row.person_visible).toEqual(before.observations[row.id].person_visible);expect(row.provenance.person_visible).toEqual(before.observations[row.id].provenance.person_visible);}
  expect(d.identities.p.box_styles).toEqual({person_visible:{class_name:'person_visible',color:COPY_COLORS.person_visible},person_ext:{class_name:'person_extended',color:COPY_COLORS.person_ext}});
  validateDomain(d,{v:{frame_count:24,width:640,height:360} as Video});
 });
 it('copies only the current frame; later resizing interpolates only Extended',()=>{
  const {d,at}=setup();copyVisibleToExtended(d,'v','p',0);copyVisibleToExtended(d,'v','p',10);
  expect(at(5).person_ext).toBeNull();const before=structuredClone(d);
  at(10).person_ext![3]=320;interpolatePerson(d,'v','p',[],10,'person_ext');
  expect(at(5).person_ext![3]).toBe(280);
  for(const row of Object.values(d.observations)){expect(row.person_visible).toEqual(before.observations[row.id].person_visible);expect(row.provenance.person_visible).toEqual(before.observations[row.id].provenance.person_visible);}
 });
 it('restores only the copied frame inside an Extended deletion range',()=>{
  const {d,at}=setup();copyVisibleToExtended(d,'v','p',0);copyVisibleToExtended(d,'v','p',10);interpolatePerson(d,'v','p',[],undefined,'person_ext');
  deleteGeometryRange(d,'v','p',3,7,24,'person_ext');copyVisibleToExtended(d,'v','p',5);interpolatePerson(d,'v','p',[],5,'person_ext');
  for(const f of [3,4,6,7]){expect(at(f).person_ext).toBeNull();expect(at(f).person_visible).not.toBeNull();}
  expect(at(5).person_ext).toEqual(at(5).person_visible);
  expect(Object.values(d.intervals).map(i=>[i.start,i.end])).toEqual([[3,4],[6,7]]);
  validateDomain(d,{v:{frame_count:24,width:640,height:360} as Video});
 });
 it('rejects missing sources, existing destinations and legacy tracks before mutation',()=>{
  const {d}=setup();let before=structuredClone(d);expect(()=>copyVisibleToExtended(d,'v','p',20)).toThrow('Visible box');expect(d).toEqual(before);
  copyVisibleToExtended(d,'v','p',0);before=structuredClone(d);expect(()=>copyVisibleToExtended(d,'v','p',0)).toThrow('already exists');expect(d).toEqual(before);
  delete d.identities.p.box_styles;d.identities.p.class_name='person_extended';before=structuredClone(d);expect(()=>copyVisibleToExtended(d,'v','p',1)).toThrow('older track');expect(d).toEqual(before);
 });
 it('retains custom class names and later color choices on further copies',()=>{
  const {d}=setup();d.identities.p.box_styles={person_visible:{class_name:'Visible worker',color:'#112233'},person_ext:{class_name:'Estimated worker',color:'#445566'}};
  copyVisibleToExtended(d,'v','p',0);d.identities.p.box_styles.person_visible!.color='#abcdef';d.identities.p.box_styles.person_ext!.color='#fedcba';
  const styles=structuredClone(d.identities.p.box_styles);copyVisibleToExtended(d,'v','p',10);expect(d.identities.p.box_styles).toEqual(styles);
 });
});

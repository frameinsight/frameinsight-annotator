import {describe,it,expect} from 'vitest';
import {copyVisibleToExtended,COPY_COLORS} from './copy-visible';
import {interpolatePerson,markCorrected} from './interpolation';
import {deleteGeometryRange} from './hidden-range';
import {emptyObservation,validateDomain,type Domain,type Video} from './types';
function setup(){
 const d:Domain={identities:{p:{id:'p',person_id:7,name:'Person 7',class_name:'person_visible'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const f of [0,10]){const o=emptyObservation('v',f,'p','s');o.person_visible=[100+f,80,180+f,240];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;}
 interpolatePerson(d,'v','p');return {d,at:(f:number)=>Object.values(d.observations).find(o=>o.video_id==='v'&&o.identity_uuid==='p'&&o.frame_index===f)!};
}
const videos={v:{frame_count:24,width:640,height:360} as Video};
describe('copy Visible to Extended across video',()=>{
 it('copies every visible frame, retaining identity and all visible coordinates/provenance',()=>{
  const {d,at}=setup(),before=structuredClone(d);expect(copyVisibleToExtended(d,'v','p')).toBe(11);
  expect(Object.keys(d.identities)).toEqual(['p']);expect(d.identities.p.person_id).toBe(7);
  for(const row of Object.values(d.observations)){
   expect(row.person_ext).toEqual(row.person_visible);expect(row.person_ext).not.toBe(row.person_visible);
   expect(row.geometry_link).toBe('independent');expect(row.provenance.person_ext?.origin).toBe('copied_track');
   expect(row.person_visible).toEqual(before.observations[row.id].person_visible);expect(row.provenance.person_visible).toEqual(before.observations[row.id].provenance.person_visible);
  }
  expect(at(5).full_quality).toBe('estimated');expect(d.identities.p.box_styles).toEqual({person_visible:{class_name:'person_visible',color:COPY_COLORS.person_visible},person_ext:{class_name:'person_extended',color:COPY_COLORS.person_ext}});validateDomain(d,videos);
 });
 it('resizing spaced keyframes updates copied boxes between them without changing Visible',()=>{
  const {d,at}=setup();copyVisibleToExtended(d,'v','p');const before=structuredClone(d);
  for(const [f,y] of [[0,280],[10,320]]){at(f).person_ext![3]=y;markCorrected(at(f),'person_ext');interpolatePerson(d,'v','p',[],f,'person_ext');}
  expect(at(5).person_ext![3]).toBe(300);expect(at(5).provenance.person_ext?.origin).toBe('interpolated');
  at(5).person_ext![3]=330;markCorrected(at(5),'person_ext');interpolatePerson(d,'v','p',[],5,'person_ext');expect(at(3).person_ext![3]).toBe(310);
  for(const row of Object.values(d.observations)){expect(row.person_visible).toEqual(before.observations[row.id].person_visible);expect(row.provenance.person_visible).toEqual(before.observations[row.id].provenance.person_visible);}validateDomain(d,videos);
 });
 it('fills missing Extended boxes including deleted frames with Visible; preserves existing Extended corrections',()=>{
  const {d,at}=setup();copyVisibleToExtended(d,'v','p');at(0).person_ext![3]=310;markCorrected(at(0),'person_ext');
  deleteGeometryRange(d,'v','p',3,7,24,'person_ext');const existing=structuredClone(at(0));expect(copyVisibleToExtended(d,'v','p')).toBe(5);expect(at(0)).toEqual(existing);
  for(const f of [3,4,5,6,7])expect(at(f).person_ext).toEqual(at(f).person_visible);
  expect(Object.values(d.intervals)).toHaveLength(0);const before=structuredClone(d);expect(copyVisibleToExtended(d,'v','p')).toBe(0);expect(d).toEqual(before);validateDomain(d,videos);
 });
 it('keeps absent source frames empty even after interpolation and preserves existing Extended-only boxes',()=>{
  const {d,at}=setup();for(const f of [3,4,5,6,7])delete d.observations[at(f).id];
  const e=emptyObservation('v',5,'p','s');e.person_ext=[120,70,200,300];e.provenance.person_ext={origin:'manual',proposal_id:null,human_corrected:false};d.observations[e.id]=e;
  const before=structuredClone(e);expect(copyVisibleToExtended(d,'v','p')).toBe(6);
  for(const f of [0,10]){at(f).person_ext![3]=320;markCorrected(at(f),'person_ext');interpolatePerson(d,'v','p',[],f,'person_ext');}
  for(const f of [3,4,6,7])expect(at(f)).toBeUndefined();expect(at(5)).toEqual(before);expect(Object.values(d.intervals).map(g=>[g.start,g.end])).toEqual([[3,4],[6,7]]);validateDomain(d,videos);
 });
 it('does not touch another person or another video',()=>{
  const {d}=setup();d.identities.q={id:'q',person_id:8,name:'Person 8'};
  const otherPerson=emptyObservation('v',2,'q','qseg'),otherVideo=emptyObservation('other',2,'p','otherseg');
  for(const row of [otherPerson,otherVideo]){row.person_visible=[10,20,30,40];d.observations[row.id]=row;}
  const before=structuredClone([otherPerson,otherVideo]);copyVisibleToExtended(d,'v','p');expect([otherPerson,otherVideo]).toEqual(before);
 });
 it('handles no eligible boxes without mutation and rejects legacy tracks',()=>{
  const {d}=setup();const before=structuredClone(d);expect(copyVisibleToExtended(d,'other','p')).toBe(0);expect(d).toEqual(before);
  d.identities.p.class_name='person_extended';const legacy=structuredClone(d);expect(()=>copyVisibleToExtended(d,'v','p')).toThrow('older track');expect(d).toEqual(legacy);
 });
 it('preserves older single-frame copies as anchors when nearby bulk copies are adjusted',()=>{
  const {d,at}=setup();at(5).person_ext=[110,80,190,335];at(5).provenance.person_ext={origin:'copied',proposal_id:null,human_corrected:false};
  copyVisibleToExtended(d,'v','p');for(const f of [0,10]){at(f).person_ext![3]=300;markCorrected(at(f),'person_ext');interpolatePerson(d,'v','p',[],f,'person_ext');}
  expect(at(5).person_ext![3]).toBe(335);expect(at(5).provenance.person_ext?.origin).toBe('copied');
 });
 it('retains custom class names and subsequent color choices when filling more missing boxes',()=>{
  const {d,at}=setup();d.identities.p.box_styles={person_visible:{class_name:'Visible worker',color:'#112233'},person_ext:{class_name:'Estimated worker',color:'#445566'}};
  copyVisibleToExtended(d,'v','p');d.identities.p.box_styles.person_visible!.color='#abcdef';d.identities.p.box_styles.person_ext!.color='#fedcba';
  at(10).person_ext=null;const styles=structuredClone(d.identities.p.box_styles);copyVisibleToExtended(d,'v','p');expect(d.identities.p.box_styles).toEqual(styles);
 });
});

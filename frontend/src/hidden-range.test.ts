import {describe,it,expect} from 'vitest';
import {markHiddenRange,prepareVisibleFrame} from './hidden-range';
import {interpolatePerson,isInterpolated} from './interpolation';
import {type Domain,type Video,emptyObservation,validateDomain} from './types';

const videos={v:{id:'v',frame_count:24,width:640,height:360} as Video};
function setup(){
 const d:Domain={identities:{p:{id:'p',person_id:7,name:'Person'},other:{id:'other',person_id:8,name:'Other'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:null,status:'verified'},t:{id:'t',identity_uuid:'other',video_id:'v',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const f of [0,20]){const o=emptyObservation('v',f,'p','s');o.person_visible=[100+f,20,200+f,200];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;}
 const other=emptyObservation('v',10,'other','t');other.person_visible=[300,20,400,200];d.observations[other.id]=other;
 interpolatePerson(d,'v','p');
 return {d,other,at:(f:number)=>Object.values(d.observations).find(o=>o.identity_uuid==='p'&&o.frame_index===f)!};
}
describe('hidden frame ranges',()=>{
 it('removes only the selected inclusive range and keeps both visible sides editable',()=>{
  const {d,other,at}=setup();const originalOther=structuredClone(other);
  expect(markHiddenRange(d,'v','p',8,12,24)).toBe(5);
  expect(Object.values(d.intervals)).toMatchObject([{start:8,end:12,reason:'unknown'}]);
  for(let f=8;f<=12;f++)expect(at(f)).toBeUndefined();
  expect(d.observations[other.id]).toEqual(originalOther);
  expect(at(7).segment_id).not.toBe(at(13).segment_id);
  expect(isInterpolated(at(7))).toBe(false);expect(isInterpolated(at(13))).toBe(false);
  at(0).person_visible=[80,20,180,200];interpolatePerson(d,'v','p',[],0);
  expect(at(3).person_visible![0]).toBeCloseTo(80+27*3/7);
  at(20).person_visible=[140,20,240,200];interpolatePerson(d,'v','p',[],20);
  expect(at(16).person_visible![0]).toBeCloseTo(113+27*3/7);
  for(let f=8;f<=12;f++)expect(at(f)).toBeUndefined();validateDomain(d,videos);
 });
 it('handles a first-frame, last-frame, single-frame, and whole-video range',()=>{
  for(const [start,end] of [[0,3],[20,23],[10,10],[0,23]]){const {d,at}=setup();markHiddenRange(d,'v','p',start,end,24);validateDomain(d,videos);interpolatePerson(d,'v','p');for(let f=start;f<=end;f++)expect(at(f)).toBeUndefined();if(start===0&&end===23)expect(Object.values(d.segments).filter(s=>s.identity_uuid==='p')).toHaveLength(0);}
 });
 it('can overlap older gaps without losing their outside reason or evidence',()=>{
  const {d}=setup();markHiddenRange(d,'v','p',5,15,24);const old=Object.values(d.intervals)[0];old.reason='outside';old.evidence_note='Left the image';
  markHiddenRange(d,'v','p',8,10,24);
  const gaps=Object.values(d.intervals).sort((a,b)=>a.start-b.start);
  expect(gaps.map(g=>[g.start,g.end,g.reason])).toEqual([[5,7,'outside'],[8,10,'unknown'],[11,15,'outside']]);
  expect(gaps[0].evidence_note).toBe('Left the image');expect(gaps[2].evidence_note).toBe('Left the image');validateDomain(d,videos);
 });
 it('invalidates review status and reassigns previously approved right-hand boxes safely',()=>{
  const {d,at}=setup();at(20).review_state='approved';d.reviews.r={id:'r',video_id:'v',frame_index:10,complete:true,checked_all_people:true,note:''};
  markHiddenRange(d,'v','p',8,12,24);expect(at(20).review_state).toBe('draft');expect(d.reviews.r.complete).toBe(false);validateDomain(d,videos);
 });
 it('rejects invalid ranges before changing the domain',()=>{
  for(const [start,end] of [[-1,2],[12,8],[1.5,3],[0,24],[NaN,3]]){const {d}=setup(),before=structuredClone(d);expect(()=>markHiddenRange(d,'v','p',start,end,24)).toThrow('valid range');expect(d).toEqual(before);}
 });
});

describe('drawing restores visibility automatically',()=>{
 it('restores only the drawn frame inside a deleted range',()=>{
  const {d}=setup();markHiddenRange(d,'v','p',8,12,24);
  const segment=prepareVisibleFrame(d,'v','p',10),o=emptyObservation('v',10,'p',segment.id);o.person_visible=[130,20,230,200];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;
  expect(Object.values(d.intervals).map(g=>[g.start,g.end]).sort((a,b)=>a[0]!-b[0]!)).toEqual([[8,9],[11,12]]);
  interpolatePerson(d,'v','p');for(const f of [8,9,11,12])expect(Object.values(d.observations).some(o=>o.identity_uuid==='p'&&o.frame_index===f)).toBe(false);validateDomain(d,videos);
 });
 it('resumes an older open gap by drawing without H',()=>{
  const {d}=setup();for(const o of Object.values(d.observations))if(o.identity_uuid==='p'&&o.frame_index>=8)delete d.observations[o.id];d.segments.s.end=7;d.intervals.g={id:'g',video_id:'v',identity_uuid:'p',start:8,end:null,reason:'unknown',evidence_note:''};
  const segment=prepareVisibleFrame(d,'v','p',15);expect(d.intervals.g.end).toBe(14);expect(segment.start).toBe(15);expect(segment.end).toBeNull();validateDomain(d,videos);
 });
 it('extends a track before or after its old boundaries when no explicit gap blocks it',()=>{
  const {d}=setup();d.observations={};d.segments.s.start=5;d.segments.s.end=20;
  expect(prepareVisibleFrame(d,'v','p',2).id).toBe('s');expect(d.segments.s.start).toBe(2);
  expect(prepareVisibleFrame(d,'v','p',23).id).toBe('s');expect(d.segments.s.end).toBe(23);validateDomain(d,videos);
 });
});
